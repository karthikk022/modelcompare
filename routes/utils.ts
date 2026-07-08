const db = require('../db');

const OR_API = 'https://openrouter.ai';

const PROVIDERS = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', title: 'OpenRouter' },
  openai: { baseUrl: 'https://api.openai.com/v1', title: 'OpenAI' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', title: 'Groq' },
  together: { baseUrl: 'https://api.together.xyz/v1', title: 'Together' },
};

async function getProviderConfig(req) {
  const provider = (req?.body?.apiProvider) || (await db.getSetting('api_provider')) || 'openrouter';
  const cfg = PROVIDERS[provider] || PROVIDERS.openrouter;
  const keySetting = provider === 'openrouter' ? 'openrouter_api_key' : provider + '_api_key';
  let apiKey = req?.headers['x-api-key'] || req?.body?.apiKey;
  if (!apiKey) {
    apiKey = (await db.getSetting(keySetting)) || process.env[provider.toUpperCase() + '_API_KEY'] || '';
  }
  return { ...cfg, apiKey, provider };
}

let _livePricingCache = null;
let _livePricingTime = null;
const _LIVE_TTL = 5 * 60 * 1000;

/*
 * BYO-key pattern: accepts a client-supplied OpenRouter key via x-openrouter-key header
 * or body.openRouterKey field. This lets each user bring their own billing without
 * the server provisioning a shared key. The key is used server-side for the OpenRouter
 * API call — it is never stored, logged, or exposed to other clients.
 * WARNING: if the server is public, any client-provided key is transiently in server
 * memory during the request. Do not use this pattern if you require server-side key
 * isolation guarantees.
 */
async function getOpenRouterApiKey(req) {
  const clientKey = req && (req.headers['x-openrouter-key'] || (req.body && req.body.openRouterKey));
  if (clientKey) return clientKey;
  return (await db.getSetting('openrouter_api_key')) || process.env.OPENROUTER_API_KEY || '';
}

async function webSearch(query) {
  try {
    const res = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&srlimit=5&format=json&origin=*', {
      headers: { 'User-Agent': 'ModelCompare/1.0' }
    });
    const data = await res.json() as any;
    if (!data.query || !data.query.search) return [];
    return data.query.search.map(r => ({
      title: r.title.substring(0, 120),
      snippet: r.snippet ? r.snippet.replace(/<[^>]+>/g, '').substring(0, 200) : '',
      link: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(r.title.replace(/ /g, '_')),
    }));
  } catch (e) {
    console.warn('[webSearch] failed:', e.message);
    return [];
  }
}

function findModelMatch(name, models) {
  const nl = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = models.find(m => m.id.toLowerCase().replace(/[^a-z0-9]/g, '') === nl || m.name.toLowerCase().replace(/[^a-z0-9]/g, '') === nl);
  if (exact) return exact;
  for (const m of models) {
    const ml = (m.id + ' ' + m.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ml.includes(nl) || nl.includes(ml)) return m;
  }
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
    if (!res.ok) throw new Error('OR ' + res.status);
    const body = await res.json() as any;
    const orModels = body.data || [];
    const ourModels = await db.getAllModels();
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
  const url = 'https://huggingface.co/api' + path;
  const res = await fetch(url, { headers: { 'User-Agent': 'ModelCompare/1.0' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('HF ' + res.status);
  return res.json();
}

function stringToColor(s) {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#d946ef','#f97316','#8b5cf6','#10b981','#3b82f6'];
  return colors[Math.abs(hash) % colors.length];
}

function handle(handler) {
  return async (req, res, next) => {
    try { await handler(req, res, next); } catch (e) { next(e); }
  };
}

module.exports = { getProviderConfig, getOpenRouterApiKey, webSearch, findModelMatch, fetchLivePricing, hfFetch, stringToColor, handle };
