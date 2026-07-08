const fs = require('fs');
const path = require('path');
const db = require('../db');
const { fetchLivePricing, hfFetch, stringToColor, handle } = require('./utils');

const _PROJECT_ROOT = (() => {
  let d = fs.realpathSync(__dirname);
  for (let i = 0; i < 4; i++) { if (fs.existsSync(path.join(d, 'package.json'))) return d; const up = path.resolve(d, '..'); if (up === d) break; d = up; }
  return __dirname;
})();
const _ELO_LOOKUP = JSON.parse(fs.readFileSync(path.join(_PROJECT_ROOT, 'benchmarks-data', 'elo-lookup.json'), 'utf8'));

const _SKIP_PATTERNS = /\bfinetune\b|\blora\b|\bmerge\b|\badapt\b|\binstruct\b|\bgguf\b|\bgptq\b|\bawq\b|\bbitsandbytes\b|\bfp16\b|\bfp8\b|\bint8\b|\bint4\b|\bmlx\b|\bollama\b|\btrl\b|\bunsloth\b|\btest\b|\btutorial\b|\bplayground\b|\bscratch\b|\bsandbox\b|\bdpo\b|\bsft\b|\brlhf\b|\bppo\b|\bgrpo\b|\borpo\b|\bkto\b/i;

const _CLEAN_SUFFIXES = [
  /-instruct$/i, /-chat$/i, /-it$/i, /-sft$/i, /-dpo$/i,
  /-gguf$/i, /-gptq$/i, /-awq$/i, /-bf16$/i, /-fp16$/i, /-fp8$/i, /-int8$/i, /-int4$/i,
  /-vllm$/i, /-merge$/i, /-merged$/i,
  /-v\d+(\.\d+)?$/i,
  /-\d+b$/i,
];

function cleanModelName(raw, author) {
  let name = raw;
  if (name.startsWith(author + '/')) name = name.slice(author.length + 1);
  for (const ptn of _CLEAN_SUFFIXES) name = name.replace(ptn, '');
  name = name.replace(/[-_]/g, ' ').trim();
  if (name.length < 3 || /^[a-f0-9]{7,}$/i.test(name)) return null;
  return name.replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function fuzzyMatchElo(name, author) {
  const lower = (author + '/' + name).toLowerCase();
  for (const { key, elo } of _ELO_LOOKUP) {
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

function estimateScores(inp, outp, ctxLen) {
  const avgPrice = (inp || 0) + (outp || 0) * 0.5;
  let base = 40;
  if (avgPrice > 10) base = 85;
  else if (avgPrice > 5) base = 75;
  else if (avgPrice > 2) base = 65;
  else if (avgPrice > 0.5) base = 55;
  const ctxBonus = ctxLen ? Math.min(15, Math.log(ctxLen / 1000) * 3) : 0;
  const offset = inp != null && outp != null ? ((inp * 7 + outp * 3) % 12) - 6 : 0;
  const v = (cap) => Math.min(98, Math.round((base + ctxBonus + offset + cap) * 10) / 10);
  return {
    reasoning: v(0),
    coding: v(-2),
    knowledge: v(1),
    math: v(-1),
    agentic: v(-7),
    multimodal: v(-12),
    instructionFollowing: v(4),
  };
}

async function discoverFromHF(limit) {
  const list = await hfFetch('/models?pipeline_tag=text-generation&sort=downloads&direction=-1&limit=' + (limit * 2));
  const candidates = [];

  for (const item of list) {
    const author = item.id.split('/')[0] || 'unknown';
    const cleaned = cleanModelName(item.id, author);
    if (!cleaned || _SKIP_PATTERNS.test(item.id)) continue;
    if ((item.likes || 0) < 10) continue;
    candidates.push(item);
  }

  const CONCURRENCY = 5;
  const results = [];

  async function processItem(item) {
    const author = item.id.split('/')[0] || 'unknown';
    const cleaned = cleanModelName(item.id, author);
    const full = await hfFetch('/models/' + item.id);
    const desc = (full.cardData && (full.cardData.base_model || full.cardData.model_name || full.description)) || full.description || '';
    const downloads = full.downloads || 0;
    const pipeline = full.pipeline_tag || '';

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
    } catch (e) { console.warn('[discover] HF results fetch failed:', e.message); }

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
    } catch (e) { console.warn('[discover] HF config fetch failed:', e.message); }

    const providerName = author.charAt(0).toUpperCase() + author.slice(1);
    const elo = fuzzyMatchElo(cleaned, author);

    return {
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
      likes: item.likes || 0,
      downloads,
      pipeline,
    };
  }

  for (let i = 0; i < candidates.length && results.length < limit; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY).map(item => processItem(item).catch(() => null));
    const batchResults = await Promise.all(batch);
    for (const r of batchResults) {
      if (r) results.push(r);
      if (results.length >= limit) break;
    }
  }

  results.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  return results.slice(0, limit);
}

async function discoverFromOpenRouter(limit) {
  const url = 'https://openrouter.ai/api/v1/models';
  const res = await fetch(url, { headers: { 'User-Agent': 'ModelCompare/1.0' }, signal: AbortSignal.timeout(15000) });
  const body = await res.json() as any;
  const items = (body.data || []).slice(0, Math.min(limit, 500));
  const results = [];
  for (const item of items) {
    try {
      const name = item.name || item.id || 'Unknown';
      const p = item.pricing || {};
      const inp = p.prompt != null ? parseFloat(p.prompt) * 1e6 : null;
      const outp = p.completion != null ? parseFloat(p.completion) * 1e6 : null;
      if (inp === 0 && outp === 0) continue;
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
    } catch (e) { console.warn('[discover] OpenRouter item failed:', e.message); }
  }
  return results;
}

function register(app) {

  app.get('/api/discover', handle(async (req, res) => {
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
      const seen = new Set();
      models = models.filter(m => { const k = m.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
      const allModels = await db.getAllModels();
      const existing = new Set(allModels.map(m => m.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
      models = models.map(m => ({ ...m, _alreadyAdded: existing.has(m.name.toLowerCase().replace(/[^a-z0-9]/g, '')) }));
      res.json({ models, source, count: models.length });
    } catch (e) {
      res.status(500).json({ error: 'Discovery failed: ' + e.message });
    }
  }));

  app.get('/api/live-pricing', handle(async (req, res) => {
    const force = req.query.force === 'true';
    try {
      const data = await fetchLivePricing(force);
      if (data.fetchedAt) await db.snapshotAllModels('pricing-refresh');
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: 'Live pricing failed: ' + e.message });
    }
  }));
}

module.exports = { register };
