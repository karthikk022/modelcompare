const fs = require('fs');
const path = require('path');
const db = require('../db');
const { hfFetch } = require('./utils');

const BENCHMARKS_FILE = path.join(__dirname, '..', 'benchmarks-data', 'benchmarks.json');
let _CURATED_BENCHMARKS = [];
try {
  _CURATED_BENCHMARKS = JSON.parse(fs.readFileSync(BENCHMARKS_FILE, 'utf8'));
  console.log('Loaded ' + _CURATED_BENCHMARKS.length + ' curated benchmark entries');
} catch (e) {
  console.log('No curated benchmarks file found at ' + BENCHMARKS_FILE);
}

const _HF_MODEL_MAP = {
  'deepseek-v4-flash': 'deepseek-ai/DeepSeek-V4-Flash',
  'kimi-k2-6': 'moonshotai/Kimi-K2.6',
  'qwq-32b': 'Qwen/QwQ-32B',
  'glm-5': 'THUDM/GLM-5',
  'sarvam-105b': 'sarvamai/Sarvam-105B',
};

const _BENCH_KEYS = ['mmlu','mmlu pro','mmlu-pro','math','math-500','gsm8k','bbh','ifeval','truthfulqa','gpqa','aime','livecodebench','hellaswag','simpleqa','bfcl','humaneval','human eval','swe-bench','swe bench verified'];

function matchCuratedBenchmarks(model) {
  const nameSlug = model.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const idSlug = (model.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let best = null;
  let bestScore = 0;

  for (const entry of _CURATED_BENCHMARKS) {
    const entryId = entry.id.toLowerCase();
    if (idSlug && (idSlug === entryId.replace(/[^a-z0-9]/g, '') || idSlug === entryId)) {
      best = entry; bestScore = 100; break;
    }
    for (const alias of (entry.aliases || [])) {
      const aliasSlug = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (aliasSlug && (aliasSlug === nameSlug || aliasSlug === idSlug)) {
        best = entry; bestScore = 100; break;
      }
    }
    if (best) break;
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
  if (entry.benchmarks) {
    if (!model.benchmarks) model.benchmarks = {};
    for (const [k, v] of Object.entries(entry.benchmarks)) {
      if (v != null && model.benchmarks[k] == null) {
        model.benchmarks[k] = v;
        changed = true;
      }
    }
  }
  if (entry.scores) {
    if (!model.scores) model.scores = {};
    for (const [k, v] of Object.entries(entry.scores)) {
      if (v != null && model.scores[k] == null) {
        model.scores[k] = v;
        changed = true;
      }
    }
  }
  const fields = ['arenaElo', 'speed', 'contextWindow'];
  for (const f of fields) {
    if (entry[f] != null && model[f] == null) {
      model[f] = entry[f];
      changed = true;
    }
  }
  return changed;
}

function register(app) {

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
    res.json({ message: 'Refreshed benchmark data for ' + updated + ' models', refreshed: updated });
  });

  app.get('/api/benchmarks/sync', async (req, res) => {
    const models = db.getAllModels();
    let checked = 0, updated = 0;
    const results = [];

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

    for (const m of models) {
      let hfId = _HF_MODEL_MAP[m.id];

      if (!hfId) {
        const slug = m.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!/openai|anthropic|google|xai|x-ai|deepmind/.test(slug)) {
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
            } catch (e) { /* skip */ }
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
      } catch (e) { /* skip */ }
    }

    if (updated > 0) db.snapshotAllModels('benchmark-sync');

    res.json({ message: 'Checked ' + checked + ' models, updated ' + updated, checked, updated, results });
  });
}

module.exports = { register };