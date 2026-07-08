const db = require('../db');
const { getOpenRouterApiKey, webSearch, fetchLivePricing, findModelMatch, handle } = require('./utils');

function register(app) {

  app.post('/api/test-prompt', handle(async (req, res) => {
    const { models: modelIds, prompt, systemPrompt, maxTokens, temperature, messages, webSearch: useWebSearch } = req.body;
    if (!modelIds || !Array.isArray(modelIds) || modelIds.length < 1) return res.status(400).json({ error: 'models array required (min 1)' });

    let msgs = messages;
    if (!msgs || !Array.isArray(msgs) || msgs.length === 0) {
      if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt (string) or messages (array) required' });
      msgs = [];
      if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim()) {
        msgs.push({ role: 'system', content: systemPrompt.trim() });
      }
      msgs.push({ role: 'user', content: prompt });
    }

    if (useWebSearch) {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      msgs.unshift({ role: 'system', content: 'Current date: ' + dateStr + '. Current time: ' + timeStr + '. You can use this information to answer questions about dates, recent events, or current information.' });
      const lastUserMsg = msgs.filter(m => m.role === 'user').pop();
      if (lastUserMsg) {
        try {
          const searchResults = await webSearch(lastUserMsg.content);
          if (searchResults && searchResults.length > 0) {
            const context = 'Web search results for "' + lastUserMsg.content.substring(0, 100) + '":\n' +
              searchResults.map((r, i) => (i + 1) + '. ' + r.title + ': ' + r.snippet).join('\n');
            msgs.splice(msgs.length - 1, 0, { role: 'system', content: context });
          }
        } catch (e) { console.warn('[prompt] webSearch failed:', e.message); }
      }
    }

    const apiKey = await getOpenRouterApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'OpenRouter API key not configured. Add it via Settings.' });

    const maxT = Math.min(Math.max(parseInt(maxTokens) || 1024, 1), 4096);
    const temp = temperature != null ? Math.min(Math.max(parseFloat(temperature), 0), 2) : 0.7;

    let pricing;
    try { pricing = await fetchLivePricing(true); } catch (e) { console.warn('[prompt] pricing fetch failed:', e.message); pricing = { models: {} }; }

    const results = [];
    for (const modelId of modelIds) {
      const model = await db.getModel(modelId);
      if (!model) { results.push({ id: modelId, name: modelId, error: 'Model not found' }); continue; }

      let slug = model.openRouterSlug;
      if (!slug && (pricing.models as any)[modelId]) slug = (pricing.models as any)[modelId].openRouterId;
      if (!slug) {
        const nl = model.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const [mid, info] of Object.entries(pricing.models || {})) {
          const pricingInfo = info as any;
          if (mid.toLowerCase().replace(/[^a-z0-9]/g, '') === nl || (pricingInfo.openRouterName || '').toLowerCase().replace(/[^a-z0-9]/g, '') === nl) {
            slug = pricingInfo.openRouterId;
            break;
          }
        }
      }
      if (!slug) {
        try {
          const orRes = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'ModelCompare/1.0' } });
          if (orRes.ok) {
            const orData = await orRes.json() as any;
            const allOr = orData.data || [];
            const match = findModelMatch(model.name, allOr);
            if (match) slug = match.id;
          }
        } catch (e) { console.warn('[prompt] slug lookup failed:', e.message); }
      }
      if (!slug) { results.push({ id: modelId, name: model.name, error: 'No OpenRouter slug found. Try running "Live" pricing first, or check Settings > OpenRouter API key.' }); continue; }
      if (!model.openRouterSlug) { model.openRouterSlug = slug; await db.updateModel(model); }

      const startTime = Date.now();
      try {
        const body = {
          model: slug,
          messages: msgs,
          max_tokens: maxT,
          temperature: temp,
        };

        const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'http://localhost:3001',
            'X-Title': 'ModelCompare',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });

        const latency = Date.now() - startTime;
        const orData = await orRes.json() as any;

        if (!orRes.ok) {
          let errorMsg = 'OpenRouter ' + orRes.status + ': ' + (orData.error?.message || orRes.statusText);
          if (orRes.status === 402) errorMsg += '. Upgrade at openrouter.ai/settings/credits';
          results.push({ id: modelId, name: model.name, error: errorMsg, latency });
          continue;
        }

        let content = null;
        if (orData.choices && orData.choices[0]) {
          const msg = orData.choices[0].message || orData.choices[0].delta || {};
          content = msg.content != null ? msg.content : '';
          if (Array.isArray(content)) content = content.map(p => p.text || p.content || '').join('');
          if (!content && (msg.reasoning || msg.reasoning_content)) {
            content = '\u{1F4AD} ' + (msg.reasoning || msg.reasoning_content);
          }
        }
        const finishReason = orData.choices && orData.choices[0] ? orData.choices[0].finish_reason : null;
        const usage = orData.usage || {};
        const inTokens = usage.prompt_tokens || 0;
        const outTokens = usage.completion_tokens || 0;
        const isEmpty = content === '' && finishReason === 'stop';
        const isNullContent = content === null && outTokens > 0;

        const priceInfo = (pricing.models[modelId] || {}) as any;
        const inPrice = priceInfo.inputPrice != null ? priceInfo.inputPrice : model.inputPrice;
        const outPrice = priceInfo.outputPrice != null ? priceInfo.outputPrice : model.outputPrice;
        const cost = inPrice != null && outPrice != null
          ? ((inTokens * inPrice) + (outTokens * outPrice)) / 1e6
          : null;

        results.push({
          id: modelId,
          name: model.name,
          slug,
          content: content || (isEmpty ? '(model returned empty response)' : null),
          finishReason,
          latency,
          inTokens,
          outTokens,
          cost: cost != null ? Math.round(cost * 10000) / 10000 : null,
          model: orData.model || slug,
          usage: { promptTokens: inTokens, completionTokens: outTokens },
          _empty: isEmpty || isNullContent || false,
        });
        try {
          await db.logUsage({
            modelId, modelName: model.name, slug,
            promptTokens: inTokens, completionTokens: outTokens, totalTokens: inTokens + outTokens,
            cost: cost != null ? Math.round(cost * 10000) / 10000 : 0,
            latencyMs: latency, finishReason: finishReason || '',
          });
        } catch (e) { console.warn('[prompt] usage log failed:', e.message); }
      } catch (e) {
        const latency = Date.now() - startTime;
        results.push({ id: modelId, name: model.name, error: e.name === 'AbortError' ? model.name + ' timed out (60s)' : e.message, latency });
      }
    }

    res.json({ results, prompt });
  }));

  app.post('/api/test-prompt-stream', handle(async (req, res) => {
    const { models: modelIds, messages, maxTokens, temperature, webSearch: useWebSearch } = req.body;
    if (!modelIds || !Array.isArray(modelIds) || modelIds.length < 1) return res.status(400).json({ error: 'models array required' });

    let msgs = messages;
    if (!msgs || !Array.isArray(msgs) || msgs.length === 0) return res.status(400).json({ error: 'messages array required' });

    if (useWebSearch) {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      msgs.unshift({ role: 'system', content: 'Current date: ' + dateStr + '. Current time: ' + timeStr + '.' });
      const lastUserMsg = msgs.filter(m => m.role === 'user').pop();
      if (lastUserMsg) {
        try {
          const searchResults = await webSearch(lastUserMsg.content);
          if (searchResults && searchResults.length > 0) {
            const context = 'Web search results:\n' + searchResults.map((r, i) => (i + 1) + '. ' + r.title + ': ' + r.snippet).join('\n');
            msgs.splice(msgs.length - 1, 0, { role: 'system', content: context });
          }
        } catch (e) { console.warn('[stream] webSearch failed:', e.message); }
      }
    }

    const modelId = modelIds[0];
    const model = await db.getModel(modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    let slug = model.openRouterSlug;
    let pricing;
    if (!slug) {
      try { pricing = await fetchLivePricing(true); } catch (e) { console.warn('[stream] pricing fetch failed:', e.message); pricing = { models: {} }; }
      if (!slug && (pricing.models as any)[modelId]) slug = (pricing.models as any)[modelId].openRouterId;
      if (!slug) {
        try {
          const orRes = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000) });
          if (orRes.ok) {
            const orData = await orRes.json() as any;
            const match = findModelMatch(model.name, orData.data || []);
            if (match) slug = match.id;
          }
        } catch (e) { console.warn('[stream] slug lookup failed:', e.message); }
      }
      if (!slug) return res.status(400).json({ error: 'No OpenRouter slug found' });
      if (!model.openRouterSlug) { model.openRouterSlug = slug; await db.updateModel(model); }
    }

    const apiKey = await getOpenRouterApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'OpenRouter API key not configured' });

    const maxT = Math.min(Math.max(parseInt(maxTokens) || 1024, 1), 4096);
    const temp = temperature != null ? Math.min(Math.max(parseFloat(temperature), 0), 2) : 0.7;
    const startTime = Date.now();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 120000);
    req.on('close', () => { ac.abort(); clearTimeout(timeout); if (!res.writableEnded) res.end(); });

    try {
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'http://localhost:3001',
          'X-Title': 'ModelCompare',
        },
        body: JSON.stringify({ model: slug, messages: msgs, max_tokens: maxT, temperature: temp, stream: true }),
        signal: ac.signal,
      });

      if (!orRes.ok) {
        const errData = await orRes.json().catch(() => ({})) as any;
        let errorMsg = 'OpenRouter ' + orRes.status + ': ' + (errData.error?.message || orRes.statusText);
        if (orRes.status === 402) errorMsg += '. Upgrade at openrouter.ai/settings/credits';
        res.write('data: ' + JSON.stringify({ type: 'error', message: errorMsg }) + '\n\n');
        res.end();
        return;
      }

      let fullContent = '';
      let finishReason = null;
      let outTokens = 0;
      let inTokens = 0;
      let orModel = slug;

      const reader = orRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const chunk = JSON.parse(jsonStr);
            const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
            const content = delta && delta.content ? delta.content : '';
            if (content) {
              fullContent += content;
              res.write('data: ' + JSON.stringify({ type: 'chunk', content }) + '\n\n');
            }
            if (chunk.choices && chunk.choices[0]) {
              if (chunk.choices[0].finish_reason) finishReason = chunk.choices[0].finish_reason;
            }
            if (chunk.usage) {
              inTokens = chunk.usage.prompt_tokens || 0;
              outTokens = chunk.usage.completion_tokens || 0;
            }
            if (chunk.model) orModel = chunk.model;
          } catch (e) { console.warn('[stream] chunk parse failed:', e.message); }
        }
      }

      const latency = Date.now() - startTime;

      if (!pricing) { try { pricing = await fetchLivePricing(true); } catch (e) { console.warn('[stream] pricing fallback failed:', e.message); pricing = { models: {} }; } }
      const priceInfo = pricing.models[modelId] || {};
      const inPrice = priceInfo.inputPrice != null ? priceInfo.inputPrice : model.inputPrice;
      const outPrice = priceInfo.outputPrice != null ? priceInfo.outputPrice : model.outputPrice;
      const cost = inPrice != null && outPrice != null ? ((inTokens * inPrice) + (outTokens * outPrice)) / 1e6 : null;

      try {
        await db.logUsage({ modelId, modelName: model.name, slug, promptTokens: inTokens, completionTokens: outTokens, totalTokens: inTokens + outTokens, cost: cost != null ? Math.round(cost * 10000) / 10000 : 0, latencyMs: latency, finishReason: finishReason || '' });
      } catch (e) { console.warn('[stream] usage log failed:', e.message); }

      res.write('data: ' + JSON.stringify({ type: 'done', content: fullContent, finishReason, latency, inTokens, outTokens, cost: cost != null ? Math.round(cost * 10000) / 10000 : null, model: orModel || slug, _empty: !fullContent && finishReason === 'stop' }) + '\n\n');
    } catch (e) {
      const latency = Date.now() - startTime;
      res.write('data: ' + JSON.stringify({ type: 'error', message: e.name === 'AbortError' ? model.name + ' timed out (60s)' : e.message, latency }) + '\n\n');
    }
    res.end();
  }));
}

module.exports = { register };
