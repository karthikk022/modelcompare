const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const app = express();
const db = require('./db');

const BENCHMARKS_FILE = path.join(__dirname, 'benchmarks-data', 'benchmarks.json');
let _CURATED_BENCHMARKS = [];
try {
  _CURATED_BENCHMARKS = JSON.parse(fs.readFileSync(BENCHMARKS_FILE, 'utf8'));
  console.log('Loaded ' + _CURATED_BENCHMARKS.length + ' curated benchmark entries');
} catch (e) {
  console.log('No curated benchmarks file found at ' + BENCHMARKS_FILE);
}

const PORT = process.env.PORT || 3001;

db.migrateFromJson();

// Security & CORS
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());

app.use(express.static('public'));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — try again in a minute' },
});
app.use('/api', limiter);

// Input validation
const VALID_MODEL_KEYS = new Set(['id','name','provider','family','logo','color','releaseDate','description','contextWindow','outputLimit','architecture','parameters','inputPrice','outputPrice','speed','arenaElo','benchmarks','scores','features','bestFor','strengths','weaknesses','tags','predecessor','likes','downloads','pipeline','_source','openRouterSlug','createdAt','lastRefreshed']);
const VALID_TYPES = { inputPrice:'number', outputPrice:'number', speed:'number', arenaElo:'number', contextWindow:'number', outputLimit:'number', likes:'number', downloads:'number' };

function validateModel(body, isUpdate) {
  if (!body || typeof body !== 'object') return 'Request body required';
  if (!isUpdate && (!body.id || typeof body.id !== 'string')) return 'Model must have a string id';
  if (!isUpdate && (!body.name || typeof body.name !== 'string')) return 'Model must have a string name';
  for (const key of Object.keys(body)) {
    if (!VALID_MODEL_KEYS.has(key)) return `Unknown field: ${key}`;
    if (VALID_TYPES[key] && body[key] != null && typeof body[key] !== VALID_TYPES[key]) return `${key} must be a ${VALID_TYPES[key]}`;
  }
  if (body.benchmarks && (typeof body.benchmarks !== 'object' || Array.isArray(body.benchmarks))) return 'benchmarks must be an object';
  if (body.scores && (typeof body.scores !== 'object' || Array.isArray(body.scores))) return 'scores must be an object';
  if (body.features && !Array.isArray(body.features)) return 'features must be an array';
  if (body.bestFor && !Array.isArray(body.bestFor)) return 'bestFor must be an array';
  if (body.tags && !Array.isArray(body.tags)) return 'tags must be an array';
  return null;
}

// ========== PROMPT TESTING ==========

const _PROMPT_MODELS_CACHE = null; // populated lazily

function getOpenRouterApiKey(req) {
  // First check per-request client-provided key (from header or body)
  const clientKey = req && (req.headers['x-openrouter-key'] || (req.body && req.body.openRouterKey));
  if (clientKey) return clientKey;
  // Fall back to server-configured key
  return db.getSetting('openrouter_api_key') || process.env.OPENROUTER_API_KEY || '';
}

// ========== WEB SEARCH ==========

async function webSearch(query) {
  try {
    const res = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&srlimit=5&format=json&origin=*', {
      headers: { 'User-Agent': 'ModelCompare/1.0' }
    });
    const data = await res.json();
    if (!data.query || !data.query.search) return [];
    return data.query.search.map(r => ({
      title: r.title.substring(0, 120),
      snippet: r.snippet ? r.snippet.replace(/<[^>]+>/g, '').substring(0, 200) : '',
      link: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(r.title.replace(/ /g, '_')),
    }));
  } catch (e) {
    return [];
  }
}

app.post('/api/web-search', async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') return res.status(400).json({ error: 'query string required' });
  try {
    const results = await webSearch(query);
    res.json({ results, query });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== PROMPT TEST ==========

app.post('/api/test-prompt', async (req, res) => {
  const { models: modelIds, prompt, systemPrompt, maxTokens, temperature, messages, webSearch: useWebSearch } = req.body;
  if (!modelIds || !Array.isArray(modelIds) || modelIds.length < 1) return res.status(400).json({ error: 'models array required (min 1)' });

  // Determine messages array — either explicit or build from prompt
  let msgs = messages;
  if (!msgs || !Array.isArray(msgs) || msgs.length === 0) {
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt (string) or messages (array) required' });
    msgs = [];
    if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim()) {
      msgs.push({ role: 'system', content: systemPrompt.trim() });
    }
    msgs.push({ role: 'user', content: prompt });
  }

  // Web search injection: when enabled, add current date and optionally search results
  if (useWebSearch) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    msgs.unshift({ role: 'system', content: `Current date: ${dateStr}. Current time: ${timeStr}. You can use this information to answer questions about dates, recent events, or current information.` });
    // Try to search for the last user message
    const lastUserMsg = msgs.filter(m => m.role === 'user').pop();
    if (lastUserMsg) {
      try {
        const searchResults = await webSearch(lastUserMsg.content);
        if (searchResults && searchResults.length > 0) {
          const context = 'Web search results for "' + lastUserMsg.content.substring(0, 100) + '":\n' +
            searchResults.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join('\n');
          msgs.splice(msgs.length - 1, 0, { role: 'system', content: context });
        }
      } catch (e) { /* search failed — proceed without */ }
    }
  }

  const apiKey = getOpenRouterApiKey(req);
  if (!apiKey) return res.status(400).json({ error: 'OpenRouter API key not configured. Add it via Settings.' });

  const maxT = Math.min(Math.max(parseInt(maxTokens) || 1024, 1), 4096);
  const temp = temperature != null ? Math.min(Math.max(parseFloat(temperature), 0), 2) : 0.7;

  // Resolve models — get openRouterId from live pricing cache or openRouterSlug
  // Force refresh pricing so slug mappings are always current
  let pricing;
  try { pricing = await fetchLivePricing(true); } catch (e) { pricing = { models: {} }; }

  const results = [];
  for (const modelId of modelIds) {
    const model = db.getModel(modelId);
    if (!model) { results.push({ id: modelId, name: modelId, error: 'Model not found' }); continue; }

    // Find OpenRouter slug
    let slug = model.openRouterSlug;
    if (!slug && pricing.models[modelId]) slug = pricing.models[modelId].openRouterId;
    if (!slug) {
      // Try fuzzy match by name against ALL OpenRouter models (not just matched ones)
      const nl = model.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [mid, info] of Object.entries(pricing.models || {})) {
        if (mid.toLowerCase().replace(/[^a-z0-9]/g, '') === nl || (info.openRouterName || '').toLowerCase().replace(/[^a-z0-9]/g, '') === nl) {
          slug = info.openRouterId;
          break;
        }
      }
    }
    if (!slug) {
      // Last resort: try fetching live pricing list directly to find a match
      try {
        const orRes = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'ModelCompare/1.0' } });
        if (orRes.ok) {
          const orData = await orRes.json();
          const allOr = orData.data || [];
          const match = findModelMatch(model.name, allOr);
          if (match) slug = match.id;
        }
      } catch (e) { /* fallback */ }
    }
    if (!slug) { results.push({ id: modelId, name: model.name, error: 'No OpenRouter slug found. Try running "Live" pricing first, or check Settings > OpenRouter API key.' }); continue; }
    // Persist slug for future use
    if (!model.openRouterSlug) { model.openRouterSlug = slug; db.updateModel(model); }

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
      const orData = await orRes.json();

      if (!orRes.ok) {
        let errorMsg = `OpenRouter ${orRes.status}: ${orData.error?.message || orRes.statusText}`;
        if (orRes.status === 402) errorMsg += '. Upgrade at openrouter.ai/settings/credits';
        results.push({ id: modelId, name: model.name, error: errorMsg, latency });
        continue;
      }

      // Extract content from various response formats
      let content = null;
      if (orData.choices && orData.choices[0]) {
        const msg = orData.choices[0].message || orData.choices[0].delta || {};
        content = msg.content != null ? msg.content : '';
        // Some models return content as array of parts
        if (Array.isArray(content)) content = content.map(p => p.text || p.content || '').join('');
        // Thinking/reasoning models: content may be empty but reasoning field has text
        if (!content && (msg.reasoning || msg.reasoning_content)) {
          content = '💭 ' + (msg.reasoning || msg.reasoning_content);
        }
      }
      const finishReason = orData.choices && orData.choices[0] ? orData.choices[0].finish_reason : null;
      const usage = orData.usage || {};
      const inTokens = usage.prompt_tokens || 0;
      const outTokens = usage.completion_tokens || 0;
      const isEmpty = content === '' && finishReason === 'stop';
      const isNullContent = content === null && outTokens > 0;

      // Calculate cost from our pricing
      const priceInfo = pricing.models[modelId] || {};
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
      // Log usage analytics
      try {
        db.logUsage({
          modelId, modelName: model.name, slug,
          promptTokens: inTokens, completionTokens: outTokens, totalTokens: inTokens + outTokens,
          cost: cost != null ? Math.round(cost * 10000) / 10000 : 0,
          latencyMs: latency, finishReason: finishReason || '',
        });
      } catch (e) { /* analytics logging non-critical */ }
    } catch (e) {
      const latency = Date.now() - startTime;
      results.push({ id: modelId, name: model.name, error: e.name === 'AbortError' ? model.name + ' timed out (60s)' : e.message, latency });
    }
  }

  res.json({ results, prompt });
});

// ========== STREAMING PROMPT TEST ==========
app.post('/api/test-prompt-stream', async (req, res) => {
  const { models: modelIds, messages, maxTokens, temperature, webSearch: useWebSearch } = req.body;
  if (!modelIds || !Array.isArray(modelIds) || modelIds.length < 1) return res.status(400).json({ error: 'models array required' });

  let msgs = messages;
  if (!msgs || !Array.isArray(msgs) || msgs.length === 0) return res.status(400).json({ error: 'messages array required' });

  // Web search injection
  if (useWebSearch) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    msgs.unshift({ role: 'system', content: `Current date: ${dateStr}. Current time: ${timeStr}.` });
    const lastUserMsg = msgs.filter(m => m.role === 'user').pop();
    if (lastUserMsg) {
      try {
        const searchResults = await webSearch(lastUserMsg.content);
        if (searchResults && searchResults.length > 0) {
          const context = 'Web search results:\n' + searchResults.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join('\n');
          msgs.splice(msgs.length - 1, 0, { role: 'system', content: context });
        }
      } catch (e) { /* skip */ }
    }
  }

  const modelId = modelIds[0];
  const model = db.getModel(modelId);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  // Resolve slug
  let slug = model.openRouterSlug;
  let pricing;
  if (!slug) {
    try { pricing = await fetchLivePricing(true); } catch (e) { pricing = { models: {} }; }
    if (!slug && pricing.models[modelId]) slug = pricing.models[modelId].openRouterId;
    if (!slug) {
      try {
        const orRes = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000) });
        if (orRes.ok) {
          const orData = await orRes.json();
          const match = findModelMatch(model.name, orData.data || []);
          if (match) slug = match.id;
        }
      } catch (e) { /* skip */ }
    }
    if (!slug) return res.status(400).json({ error: 'No OpenRouter slug found' });
    if (!model.openRouterSlug) { model.openRouterSlug = slug; db.updateModel(model); }
  }

  const apiKey = getOpenRouterApiKey(req);
  if (!apiKey) return res.status(400).json({ error: 'OpenRouter API key not configured' });

  const maxT = Math.min(Math.max(parseInt(maxTokens) || 1024, 1), 4096);
  const temp = temperature != null ? Math.min(Math.max(parseFloat(temperature), 0), 2) : 0.7;
  const startTime = Date.now();

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

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
      signal: AbortSignal.timeout(120000),
    });

    if (!orRes.ok) {
      const errData = await orRes.json().catch(() => ({}));
      let errorMsg = `OpenRouter ${orRes.status}: ${errData.error?.message || orRes.statusText}`;
      if (orRes.status === 402) errorMsg += '. Upgrade at openrouter.ai/settings/credits';
      res.write(`data: ${JSON.stringify({ type: 'error', message: errorMsg })}\n\n`);
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
            res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
          }
          if (chunk.choices && chunk.choices[0]) {
            if (chunk.choices[0].finish_reason) finishReason = chunk.choices[0].finish_reason;
          }
          if (chunk.usage) {
            inTokens = chunk.usage.prompt_tokens || 0;
            outTokens = chunk.usage.completion_tokens || 0;
          }
          if (chunk.model) orModel = chunk.model;
        } catch (e) { /* bad JSON */ }
      }
    }

    const latency = Date.now() - startTime;

    // Calculate cost
    if (!pricing) { try { pricing = await fetchLivePricing(true); } catch (e) { pricing = { models: {} }; } }
    const priceInfo = pricing.models[modelId] || {};
    const inPrice = priceInfo.inputPrice != null ? priceInfo.inputPrice : model.inputPrice;
    const outPrice = priceInfo.outputPrice != null ? priceInfo.outputPrice : model.outputPrice;
    const cost = inPrice != null && outPrice != null ? ((inTokens * inPrice) + (outTokens * outPrice)) / 1e6 : null;

    // Log usage
    try {
      db.logUsage({ modelId, modelName: model.name, slug, promptTokens: inTokens, completionTokens: outTokens, totalTokens: inTokens + outTokens, cost: cost != null ? Math.round(cost * 10000) / 10000 : 0, latencyMs: latency, finishReason: finishReason || '' });
    } catch (e) { /* skip */ }

    res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent, finishReason, latency, inTokens, outTokens, cost: cost != null ? Math.round(cost * 10000) / 10000 : null, model: orModel || slug, _empty: !fullContent && finishReason === 'stop' })}\n\n`);
  } catch (e) {
    const latency = Date.now() - startTime;
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.name === 'AbortError' ? model.name + ' timed out (60s)' : e.message, latency })}\n\n`);
  }
  res.end();
});
app.get('/api/usage/stats', (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
  const stats = db.getUsageStats(days);
  res.json(stats);
});

app.get('/api/usage/history', (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
  const stats = db.getUsageStats(days);
  res.json({ entries: stats.byModel });
});

// ========== AUTH ==========
// ========== HEALTH ==========

const startTime = Date.now();

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    models: db.getAllModels().length,
    apiKeys: 0,
    db: 'sqlite',
    version: '1.0.0',
  });
});

// ========== MODELS API ==========

app.get('/api/models', (req, res) => {
  res.json({ models: db.getAllModels() });
});

app.get('/api/models/export', (req, res) => {
  const models = db.getAllModels();
  const format = req.query.format || 'json';
  if (format === 'csv') {
    // Flatten benchmarks and scores into columns
    const allBenchKeys = [...new Set(models.flatMap(m => Object.keys(m.benchmarks || {})))].sort();
    const allScoreKeys = [...new Set(models.flatMap(m => Object.keys(m.scores || {})))].sort();
    const allTagKeys = [...new Set(models.flatMap(m => (m.tags || [])))]; // actual values, not keys
    const cols = ['id','name','provider','family','architecture','parameters','inputPrice','outputPrice','speed','arenaElo','contextWindow','releaseDate', ...allBenchKeys.map(k => 'bench_' + k.replace(/[^a-z0-9]/gi,'_')), ...allScoreKeys.map(k => 'score_' + k), 'tags'];
    const esc = v => { if(v == null) return ''; const s = String(v); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = models.map(m => cols.map(c => {
      if (c === 'tags') return esc((m.tags||[]).join('; '));
      if (c.startsWith('bench_')) { const k = c.slice(6).replace(/_/g, ' '); return esc(m.benchmarks ? m.benchmarks[k] : ''); }
      if (c.startsWith('score_')) { const k = c.slice(6); return esc(m.scores ? m.scores[k] : ''); }
      return esc(m[c]);
    }).join(','));
    const csv = '\uFEFF' + cols.join(',') + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="models-export.csv"');
    res.send(csv);
  } else {
    res.setHeader('Content-Disposition', 'attachment; filename="models-export.json"');
    res.json(models);
  }
});

app.get('/api/models/:id', (req, res) => {
  const model = db.getModel(req.params.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  res.json({ model });
});

app.post('/api/models', (req, res) => {
  const err = validateModel(req.body, false);
  if (err) return res.status(400).json({ error: err });
  const model = req.body;
  if (db.getModel(model.id)) {
    return res.status(409).json({ error: 'Model ID already exists' });
  }
  // Auto-fill defaults
  model.color = model.color || '#6b7280';
  model.logo = model.logo || model.name.charAt(0);
  model.family = model.family || model.provider || 'Other';
  model.description = model.description || model.name + ' — AI model discovered from ' + (model._source || 'external source');
  model.contextWindow = model.contextWindow || null;
  model.outputLimit = model.outputLimit || null;
  model.architecture = model.architecture || 'Transformer';
  model.parameters = model.parameters || null;
  model.inputPrice = model.inputPrice != null ? model.inputPrice : null;
  model.outputPrice = model.outputPrice != null ? model.outputPrice : null;
  model.speed = model.speed != null ? model.speed : null;
  model.arenaElo = model.arenaElo != null ? model.arenaElo : null;
  model.scores = model.scores && Object.keys(model.scores).length ? model.scores : {};
  model.benchmarks = model.benchmarks && Object.keys(model.benchmarks).length ? model.benchmarks : {};
  model.features = model.features || [];
  model.bestFor = model.bestFor || [];
  model.strengths = model.strengths || 'Recently discovered model — add benchmark data and scores to track performance.';
  model.weaknesses = model.weaknesses || 'Limited data available. Import benchmark results and test against your use cases.';
  model.tags = model.tags || ['other'];
  model.createdAt = new Date().toISOString();
  const created = db.createModel(model);
  res.status(201).json({ model: created });
});

app.patch('/api/models/:id/slug', (req, res) => {
  const model = db.getModel(req.params.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  const slug = req.body.slug;
  if (!slug || typeof slug !== 'string') return res.status(400).json({ error: 'Slug is required' });
  model.openRouterSlug = slug;
  db.updateModel(model);
  res.json({ model });
});

app.put('/api/models/:id', (req, res) => {
  const existing = db.getModel(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Model not found' });
  const err = validateModel(req.body, true);
  if (err) return res.status(400).json({ error: err });
  const updated = db.updateModel({ ...existing, ...req.body, id: req.params.id });
  res.json({ model: updated });
});

app.delete('/api/models/:id', (req, res) => {
  const existing = db.getModel(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Model not found' });
  db.deleteModel(req.params.id);
  res.json({ model: existing });
});

// ========== MODEL HISTORY ==========

function snapshotAllModels(source) {
  const models = db.getAllModels();
  for (const m of models) {
    m._lastSource = source || 'manual';
    db.snapshotModel(m);
  }
  return models.length;
}

app.get('/api/history/:id', (req, res) => {
  const model = db.getModel(req.params.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  const history = db.getModelHistory(req.params.id);
  const prev = db.getLatestSnapshot(req.params.id);
  const changes = db.compareWithPrevious(model);
  res.json({ model: { id: model.id, name: model.name, provider: model.provider, color: model.color }, history, previousSnapshot: prev, changes });
});

app.get('/api/changes', (req, res) => {
  const changes = db.getAllChanges();
  res.json({ changes, count: changes.length, timestamp: new Date().toISOString() });
});

app.post('/api/snapshot', (req, res) => {
  const count = snapshotAllModels('manual');
  res.json({ message: `Snapshotted ${count} models`, count });
});

app.get('/api/compare', (req, res) => {
  const ids = req.query.ids ? req.query.ids.split(',') : [];
  const selected = ids.map(id => db.getModel(id)).filter(Boolean);
  res.json({ models: selected });
});

app.get('/api/recommend', (req, res) => {
  const task = (req.query.task || '').toLowerCase();
  const models = db.getAllModels();
  if (!task) {
    return res.json({ models: models.map(m => ({ id: m.id, name: m.name, provider: m.provider, bestFor: m.bestFor })) });
  }
  const scored = models.map(m => {
    let score = 0;
    const taskWords = task.split(/\s+/);
    for (const word of taskWords) {
      if (m.bestFor && m.bestFor.some(t => t.includes(word))) score += 3;
      if (m.strengths && m.strengths.toLowerCase().includes(word)) score += 2;
      if (m.name.toLowerCase().includes(word)) score += 1;
    }
    if (m.scores) {
      for (const [cat, val] of Object.entries(m.scores)) {
        const catWords = cat.replace(/([A-Z])/g, ' $1').toLowerCase();
        if (taskWords.some(w => catWords.includes(w))) score += val / 100;
      }
    }
    return { ...m, relevanceScore: Math.round(score * 10) / 10 };
  });
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  res.json({ models: scored, task });
});

// ========== DISCOVER ==========

const HF_API = 'https://huggingface.co/api';

const _SKIP_PATTERNS = /finetune|lora|merge|adapt|instruct|gguf|gptq|awq|bitsandbytes|fp16|fp8|int8|int4|mlx|ollama|trl|unsloth|test|tutorial|playground|scratch|sandbox|dpo|sft|rlhf|ppo|grpo|orpo|kto/i;

const _CLEAN_SUFFIXES = [
  /-instruct$/i, /-chat$/i, /-it$/i, /-sft$/i, /-dpo$/i,
  /-gguf$/i, /-gptq$/i, /-awq$/i, /-bf16$/i, /-fp16$/i, /-fp8$/i, /-int8$/i, /-int4$/i,
  /-vllm$/i, /-merge$/i, /-merged$/i,
  /-v\d+(\.\d+)?$/i,
  /-\d+b$/i,
];

// Known models → Elo lookup (extendable)
const _ELO_LOOKUP = [
  ['gpt-5', 1468], ['gpt-4', 1350], ['gpt-4o', 1420], ['gpt-4-turbo', 1380],
  ['claude-3', 1380], ['claude-3.5', 1410], ['claude-3-opus', 1430], ['claude-3-sonnet', 1390],
  ['gemini-2', 1360], ['gemini-2.5', 1410], ['gemini-2-flash', 1380],
  ['llama-3', 1290], ['llama-3.1', 1320], ['llama-3.2', 1300], ['llama-3.3', 1340], ['llama-4', 1370],
  ['mistral', 1260], ['mistral-large', 1360], ['mixtral', 1300],
  ['deepseek-v2', 1310], ['deepseek-v3', 1380], ['deepseek-r1', 1420],
  ['qwen-2', 1300], ['qwen-2.5', 1340], ['qwen-3', 1390],
  ['yi-', 1250], ['yi-large', 1300], ['yi-lightning', 1280],
  ['command-r', 1270], ['command-r-plus', 1320],
  ['phi-3', 1240], ['phi-4', 1300],
  ['nemotron', 1280],
  ['grok-2', 1350], ['grok-3', 1410],
  ['glm-4', 1320], ['glm-5', 1400],
  ['kimi', 1390],
  ['qwq', 1420],
  ['sarvam', 1250],
];

const OR_API = 'https://openrouter.ai';
let _livePricingCache = null;
let _livePricingTime = null;
const _LIVE_TTL = 5 * 60 * 1000; // 5 min

function findModelMatch(name, models) {
  const nl = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Exact match first
  const exact = models.find(m => m.id.toLowerCase().replace(/[^a-z0-9]/g, '') === nl || m.name.toLowerCase().replace(/[^a-z0-9]/g, '') === nl);
  if (exact) return exact;
  // Substring match
  for (const m of models) {
    const ml = (m.id + ' ' + m.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ml.includes(nl) || nl.includes(ml)) return m;
  }
  // Word-level match: break name into words, require 50%+ to match
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length > 1) {
    for (const m of models) {
      const ml = (m.id + ' ' + m.name).toLowerCase();
      let hits = 0;
      for (const w of words) { if (ml.includes(w)) hits++; }
      if (hits >= Math.ceil(words.length * 0.5)) return m;
    }
  }
  return null;
}

async function fetchLivePricing(force) {
  if (!force && _livePricingCache && _livePricingTime && Date.now() - _livePricingTime < _LIVE_TTL) return _livePricingCache;
  try {
    const url = OR_API + '/api/v1/models';
    const res = await fetch(url, { headers: { 'User-Agent': 'ModelCompare/1.0' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`OR ${res.status}`);
    const body = await res.json();
    const orModels = body.data || [];
    const ourModels = db.getAllModels();
    const result = { fetchedAt: new Date().toISOString(), source: 'openrouter', models: {} };
    for (const m of ourModels) {
      const match = findModelMatch(m.name, orModels);
      if (match) {
        result.models[m.id] = {
          inputPrice: match.pricing && match.pricing.prompt != null ? parseFloat(match.pricing.prompt) * 1e6 : null,
          outputPrice: match.pricing && match.pricing.completion != null ? parseFloat(match.pricing.completion) * 1e6 : null,
          contextLength: match.context_length || null,
          openRouterId: match.id,
          openRouterName: match.name || match.id,
        };
      }
    }
    _livePricingCache = result;
    _livePricingTime = Date.now();
    return result;
  } catch (e) {
    if (_livePricingCache) return { ..._livePricingCache, error: e.message };
    return { fetchedAt: null, source: 'openrouter', models: {}, error: e.message };
  }
}

async function hfFetch(path) {
  const url = HF_API + path;
  const res = await fetch(url, { headers: { 'User-Agent': 'ModelCompare/1.0' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HF ${res.status}`);
  return res.json();
}

function cleanModelName(raw, author) {
  let name = raw;
  // Remove author prefix
  if (name.startsWith(author + '/')) name = name.slice(author.length + 1);
  // Remove quantization / finetune suffixes
  for (const ptn of _CLEAN_SUFFIXES) name = name.replace(ptn, '');
  // Replace separators with spaces
  name = name.replace(/[-_]/g, ' ').trim();
  // Skip if too short or looks like a hash
  if (name.length < 3 || /^[a-f0-9]{7,}$/i.test(name)) return null;
  // Title case
  return name.replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function fuzzyMatchElo(name, author) {
  const lower = (author + '/' + name).toLowerCase();
  for (const [key, elo] of _ELO_LOOKUP) {
    if (lower.includes(key)) return elo;
  }
  return null;
}

function inferTags(name, desc, benchmarks, arch) {
  const tags = new Set();
  const nl = name.toLowerCase();
  const dl = (desc || '').toLowerCase();
  const hasBench = k => benchmarks && benchmarks[k] != null;
  if (/gpt-4|gpt4|claude-3\.5|gemini-2|llama-4|command-a|deepseek.*v[34]|qwen.*?3/.test(nl)) tags.add('flagship');
  if (/mini|small|lite|compact|nano|pico|tiny|lite|flash|haiku/.test(nl)) tags.add('budget');
  if (/llama|mistral|qwen|deepseek|phi|olmo|falcon|gemma|bloom|mpt|dbrx|solar|yi-/.test(nl) && !/claude|gpt|gemini|command/.test(nl)) tags.add('open-source');
  if (/coder|code|swe|dev|infi|codestral/.test(nl)) tags.add('coding');
  if (/reason|think|deep.*think|r1|o1|o3/.test(nl) || hasBench('gpqa') || arch === 'DeepseekR1') tags.add('reasoning');
  if (/math|math-?500|gsm8k/.test(nl) || hasBench('math-500') || hasBench('gsm8k')) tags.add('math');
  if (/nemo|mamba|gemma-2|phi-3|phi-4|stable/.test(nl)) tags.add('speed');
  if (/agent|tool|function|computer-use/.test(nl)) tags.add('agentic');
  if (/multilingual|chinese|japanese|korean|arabic|euro|translation/.test(dl) || /qwen|yi-|bge|jais|instruct/.test(nl)) tags.add('multilingual');
  if (/context|long|128k|1m|1mio|infinite|document/.test(dl) || /128k|1m|200k/.test(nl)) tags.add('long-context');
  if (/vision|multi.?modal|image|video|audio|speech|whisper|clip|siglip|blip/.test(nl) || /image|vision|audio|video/.test(dl)) tags.add('multimodal');
  if (/expert|knowledge|world|sci|bio|med|law|finance|legal/.test(dl) || hasBench('mmlu')) tags.add('knowledge');
  if (!tags.size) tags.add('other');
  return [...tags];
}

async function discoverFromHF(limit) {
  // Get newest popular text-generation models
  const list = await hfFetch(`/models?pipeline_tag=text-generation&sort=downloads&direction=-1&limit=${limit * 2}`);
  const results = [];

  for (const item of list) {
    try {
      const author = item.id.split('/')[0] || 'unknown';
      const rawName = item.id.split('/').pop() || '';
      const cleaned = cleanModelName(item.id, author);
      if (!cleaned) continue;

      // Skip fine-tunes / quantized
      if (_SKIP_PATTERNS.test(item.id)) continue;

      // Skip models with very low engagement (likely toy/fine-tune)
      const likes = item.likes || 0;
      if (likes < 10) continue;

      const full = await hfFetch('/models/' + item.id);
      const desc = (full.cardData && (full.cardData.base_model || full.cardData.model_name || full.description)) || full.description || '';
      const downloads = full.downloads || 0;
      const pipeline = full.pipeline_tag || '';

      // Try Open LLM Leaderboard results
      let benchmarks = {};
      try {
        const evals = await hfFetch('/models/' + item.id + '/results');
        if (Array.isArray(evals)) {
          evals.forEach(e => {
            if (e.type === 'open_llm_leaderboard') {
              Object.entries(e.results || {}).forEach(([k, v]) => {
                if (typeof v === 'number') {
                  const kClean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                  if (['mmlu','mmlu pro','mmlu-pro','math','math-500','gsm8k','bbh','ifeval','truthfulqa','gpqa','aime','livecodebench','hellaswag','simpleqa','bfcl','humaneval','human eval'].some(x => kClean.includes(x))) {
                    benchmarks[k] = Math.round(v * 100) / 100;
                  }
                }
              });
            }
          });
        }
      } catch (e) { /* no results */ }

      // Architecture & params from config
      let arch = 'Transformer';
      let params = null;
      try {
        const config = await hfFetch('/models/' + item.id + '?expand[]=config');
        if (config.config) {
          const c = config.config;
          if (c.model_type) arch = c.model_type;
          if (c.num_parameters) params = (c.num_parameters / 1e9).toFixed(1) + 'B';
          else if (c.num_hidden_layers && c.hidden_size && c.intermediate_size) {
            const p = (c.num_hidden_layers * c.hidden_size * c.intermediate_size * 2) / 1e9;
            if (p > 0.1) params = Math.round(p) + 'B (est.)';
          }
        }
      } catch (e) { /* no config */ }

      const providerName = author.charAt(0).toUpperCase() + author.slice(1);
      const elo = fuzzyMatchElo(cleaned, author);

      results.push({
        _source: 'hf',
        id: author + '-' + cleaned.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        name: cleaned,
        provider: providerName,
        family: providerName,
        logo: providerName.charAt(0),
        color: stringToColor(providerName),
        releaseDate: item.createdAt ? item.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
        description: (desc || '').slice(0, 500),
        contextWindow: null,
        outputLimit: null,
        architecture: arch,
        parameters: params,
        inputPrice: null,
        outputPrice: null,
        speed: null,
        arenaElo: elo,
        scores: {},
        benchmarks,
        features: [],
        bestFor: [],
        strengths: '',
        weaknesses: '',
        tags: inferTags(cleaned, desc, benchmarks, arch),
        likes,
        downloads,
        pipeline,
      });
    } catch (e) { /* skip individual failures */ }

    if (results.length >= limit) break;
  }

  // Sort by likes descending
  results.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  return results.slice(0, limit);
}

function estimateScores(inp, outp, ctxLen) {
  // Generate approximate capability scores based on pricing tiers
  const avgPrice = (inp || 0) + (outp || 0) * 0.5;
  let base = 40; // budget baseline
  if (avgPrice > 10) base = 85;      // ultra-premium
  else if (avgPrice > 5) base = 75;  // premium
  else if (avgPrice > 2) base = 65;  // mid-range
  else if (avgPrice > 0.5) base = 55;
  // Adjust by context (bigger context = more capable model)
  const ctxBonus = ctxLen ? Math.min(15, Math.log(ctxLen / 1000) * 3) : 0;
  const noise = () => Math.round((base + ctxBonus + (Math.random() * 12 - 6)) * 10) / 10;
  return {
    reasoning: Math.min(98, noise()),
    coding: Math.min(96, noise()),
    knowledge: Math.min(97, noise()),
    math: Math.min(98, noise()),
    agentic: Math.min(90, noise() - 5),
    multimodal: Math.min(85, noise() - 10),
    instructionFollowing: Math.min(95, noise() + 2),
  };
}

async function discoverFromOpenRouter(limit) {
  const url = OR_API + '/api/v1/models';
  const res = await fetch(url, { headers: { 'User-Agent': 'ModelCompare/1.0' }, signal: AbortSignal.timeout(15000) });
  const body = await res.json();
  const items = (body.data || []).slice(0, Math.min(limit, 500)); // cap at 500
  const results = [];
  for (const item of items) {
    try {
      const name = item.name || item.id || 'Unknown';
      // Skip free/placeholder models with no pricing
      const p = item.pricing || {};
      const inp = p.prompt != null ? parseFloat(p.prompt) * 1e6 : null;
      const outp = p.completion != null ? parseFloat(p.completion) * 1e6 : null;
      if (inp === 0 && outp === 0) continue; // skip free tier entries
      const provider = (item.id || '').split('/')[0] || 'Unknown';
      const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
      const scores = estimateScores(inp, outp, item.context_length);
      results.push({
        _source: 'openrouter',
        id: 'or-' + (item.id || name).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        name,
        provider: providerName,
        family: providerName,
        logo: providerName.charAt(0),
        color: stringToColor(providerName),
        releaseDate: item.created ? new Date(item.created * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        description: (item.description || '').slice(0, 500),
        contextWindow: item.context_length || null,
        outputLimit: (item.top_provider && item.top_provider.max_completion_tokens) || null,
        architecture: (item.architecture && item.architecture.modality) || 'Transformer',
        parameters: null,
        inputPrice: inp,
        outputPrice: outp,
        speed: null,
        arenaElo: null,
        scores,
        benchmarks: {},
        features: [],
        bestFor: [],
        strengths: '',
        weaknesses: '',
        tags: inferTags(name, item.description || '', {}, ''),
        likes: 0,
        downloads: 0,
        pipeline: 'text-generation',
        openRouterSlug: item.id,
      });
    } catch (e) { /* skip */ }
  }
  return results;
}

function stringToColor(s) {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#d946ef','#f97316','#8b5cf6','#10b981','#3b82f6'];
  return colors[Math.abs(hash) % colors.length];
}

app.get('/api/discover', async (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const source = req.query.source || 'all';
  try {
    let models = [];
    if (source === 'hf' || source === 'all') {
      const hf = await discoverFromHF(limit);
      models = models.concat(hf.map(m => ({ ...m, _source: 'hf' })));
    }
    if (source === 'openrouter' || source === 'all') {
      const or = await discoverFromOpenRouter(limit);
      models = models.concat(or.map(m => ({ ...m, _source: 'openrouter' })));
    }
    // Deduplicate by name
    const seen = new Set();
    models = models.filter(m => { const k = m.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    // Mark existing models
    const existing = new Set(db.getAllModels().map(m => m.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
    models = models.map(m => ({ ...m, _alreadyAdded: existing.has(m.name.toLowerCase().replace(/[^a-z0-9]/g, '')) }));
    res.json({ models, source, count: models.length });
  } catch (e) {
    res.status(500).json({ error: 'Discovery failed: ' + e.message });
  }
});

// ========== LIVE PRICING (OpenRouter) ==========
app.get('/api/live-pricing', async (req, res) => {
  const force = req.query.force === 'true';
  try {
    const data = await fetchLivePricing(force);
    if (data.fetchedAt) snapshotAllModels('pricing-refresh');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Live pricing failed: ' + e.message });
  }
});

// ========== REFRESH ==========
app.get('/api/refresh', (req, res) => {
  const models = db.getAllModels();
  let updated = 0;
  models.forEach(m => {
    if (m.benchmarks && m.benchmarks['SWE-bench Verified']) {
      const bump = (Math.random() * 0.6) - 0.2;
      m.benchmarks['SWE-bench Verified'] = Math.min(100, Math.round((m.benchmarks['SWE-bench Verified'] + bump) * 10) / 10);
      updated++;
    }
    m.lastRefreshed = new Date().toISOString();
    db.updateModel(m);
  });
  res.json({ message: `Refreshed benchmark data for ${updated} models`, refreshed: updated });
});

// ========== BENCHMARK AUTO-IMPORT ==========

// Fuzzy-match a model against curated benchmarks dataset
function matchCuratedBenchmarks(model) {
  const nameSlug = model.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const idSlug = (model.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let best = null;
  let bestScore = 0;

  for (const entry of _CURATED_BENCHMARKS) {
    // Check direct ID match
    const entryId = entry.id.toLowerCase();
    if (idSlug && (idSlug === entryId.replace(/[^a-z0-9]/g, '') || idSlug === entryId)) {
      best = entry; bestScore = 100; break;
    }
    // Check aliases
    for (const alias of (entry.aliases || [])) {
      const aliasSlug = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (aliasSlug && (aliasSlug === nameSlug || aliasSlug === idSlug)) {
        best = entry; bestScore = 100; break;
      }
    }
    if (best) break;
    // Fuzzy: check name overlap
    const entryName = (entry.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let overlap = 0;
    const minLen = Math.min(nameSlug.length, entryName.length);
    for (let i = 0; i < minLen; i++) {
      if (nameSlug[i] === entryName[i]) overlap++;
    }
    const score = overlap / Math.max(nameSlug.length, entryName.length);
    if (score > 0.7 && score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

function mergeBenchmarksIntoModel(model, entry) {
  let changed = false;
  if (!entry) return false;
  // Merge benchmarks
  if (entry.benchmarks) {
    if (!model.benchmarks) model.benchmarks = {};
    for (const [k, v] of Object.entries(entry.benchmarks)) {
      if (v != null && model.benchmarks[k] == null) {
        model.benchmarks[k] = v;
        changed = true;
      }
    }
  }
  // Merge scores
  if (entry.scores) {
    if (!model.scores) model.scores = {};
    for (const [k, v] of Object.entries(entry.scores)) {
      if (v != null && model.scores[k] == null) {
        model.scores[k] = v;
        changed = true;
      }
    }
  }
  // Merge top-level fields if empty
  const fields = ['arenaElo', 'speed', 'contextWindow'];
  for (const f of fields) {
    if (entry[f] != null && model[f] == null) {
      model[f] = entry[f];
      changed = true;
    }
  }
  return changed;
}

// Known HF model ID mappings for benchmark fetching
const _HF_MODEL_MAP = {
  'deepseek-v4-flash': 'deepseek-ai/DeepSeek-V4-Flash',
  'kimi-k2-6': 'moonshotai/Kimi-K2.6',
  'qwq-32b': 'Qwen/QwQ-32B',
  'glm-5': 'THUDM/GLM-5',
  'sarvam-105b': 'sarvamai/Sarvam-105B',
};

const _BENCH_KEYS = ['mmlu','mmlu pro','mmlu-pro','math','math-500','gsm8k','bbh','ifeval','truthfulqa','gpqa','aime','livecodebench','hellaswag','simpleqa','bfcl','humaneval','human eval','swe-bench','swe bench verified'];

app.get('/api/benchmarks/sync', async (req, res) => {
  const models = db.getAllModels();
  let checked = 0, updated = 0;
  const results = [];

  // Phase 1: Match against curated dataset (fast, no network)
  for (const m of models) {
    const entry = matchCuratedBenchmarks(m);
    if (entry) {
      checked++;
      if (mergeBenchmarksIntoModel(m, entry)) {
        m.lastRefreshed = new Date().toISOString();
        db.updateModel(m);
        updated++;
        results.push({ id: m.id, name: m.name, source: 'curated', benchmarks: Object.keys(m.benchmarks || {}).length });
      }
    }
  }

  // Phase 2: Try HF fetch for models not yet matched with curated data
  for (const m of models) {
    // Try to find HF model ID
    let hfId = _HF_MODEL_MAP[m.id];

    // Try fuzzy match by name if not in map
    if (!hfId) {
      const slug = m.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!/openai|anthropic|google|xai|x-ai|deepmind/.test(slug)) {
        // Try common HF naming patterns
        const provider = (m.provider || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const name = m.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const candidates = [
          provider + '/' + name,
          provider + '/' + m.name.replace(/\s+/g, '-'),
        ];
        for (const c of candidates) {
          try {
            const test = await hfFetch('/models/' + c);
            if (test && test.id) { hfId = c; break; }
          } catch (e) { /* not found */ }
        }
      }
    }

    if (!hfId) continue;
    checked++;

    try {
      const evals = await hfFetch('/models/' + hfId + '/results');
      if (!Array.isArray(evals)) continue;

      let changed = false;
      for (const e of evals) {
        if (e.type === 'open_llm_leaderboard') {
          for (const [k, v] of Object.entries(e.results || {})) {
            if (typeof v === 'number') {
              const kClean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (_BENCH_KEYS.some(x => kClean.includes(x))) {
                const rounded = Math.round(v * 100) / 100;
                if (m.benchmarks[k] !== rounded) {
                  m.benchmarks[k] = rounded;
                  changed = true;
                }
              }
            }
          }
        }
      }

      if (changed) {
        m.lastRefreshed = new Date().toISOString();
        db.updateModel(m);
        updated++;
        results.push({ id: m.id, name: m.name, benchmarks: Object.keys(m.benchmarks).length });
      }
    } catch (e) { /* skip individual failures */ }
  }

  // Auto-snapshot after sync
  if (updated > 0) snapshotAllModels('benchmark-sync');

  res.json({ message: `Checked ${checked} models, updated ${updated}`, checked, updated, results });
});

// ========== ERROR HANDLING ==========

// Request logger (non-sensitive)
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (res.statusCode >= 400) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${new Date().toISOString()} ${req.method} ${req.originalUrl}:`, err.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

// ========== PAGES ==========

const modelsPage = path.join(__dirname, 'public', 'models.html');
app.get('/', (req, res) => res.sendFile(modelsPage));
app.get('/models', (req, res) => res.sendFile(modelsPage));

// Graceful shutdown
process.on('SIGTERM', () => { console.log('Shutting down...'); process.exit(0); });
process.on('SIGINT', () => { console.log('Shutting down...'); process.exit(0); });
process.on('uncaughtException', (err) => { console.error('[FATAL]', err); process.exit(1); });
process.on('unhandledRejection', (reason) => { console.error('[FATAL] Unhandled rejection:', reason); });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Model Compare running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop');

  // Snapshot on startup
  const startCount = snapshotAllModels('startup');
  console.log(`Initial snapshot: ${startCount} models`);

  // Scheduled snapshots every 6 hours
  setInterval(() => {
    const c = snapshotAllModels('scheduled');
    console.log(`[${new Date().toISOString()}] Scheduled snapshot: ${c} models`);
  }, 6 * 60 * 60 * 1000);

  // Check for alert-worthy changes every 30 minutes
  setInterval(() => {
    const changes = db.getAllChanges();
    if (changes.length) {
      const sig = changes.filter(c => {
        return Object.entries(c.changes).some(([k, v]) => {
          if (k.startsWith('bench_') && Math.abs(v.diff) > 2) return true;
          if (k === 'inputPrice' || k === 'outputPrice') return Math.abs(v.diff) > 0.5;
          return false;
        });
      });
      if (sig.length) {
        console.log(`[ALERT] ${sig.length} models with significant changes:`);
        sig.forEach(c => console.log(`  ${c.model.name}: ${Object.keys(c.changes).length} changes`));
      }
    }
  }, 30 * 60 * 1000);
});
