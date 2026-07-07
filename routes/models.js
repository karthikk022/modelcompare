const db = require('../db');

const VALID_MODEL_KEYS = new Set(['id','name','provider','family','logo','color','releaseDate','description','contextWindow','outputLimit','architecture','parameters','inputPrice','outputPrice','speed','arenaElo','benchmarks','scores','features','bestFor','strengths','weaknesses','tags','predecessor','likes','downloads','pipeline','_source','openRouterSlug','createdAt','lastRefreshed']);
const VALID_TYPES = { inputPrice:'number', outputPrice:'number', speed:'number', arenaElo:'number', contextWindow:'number', outputLimit:'number', likes:'number', downloads:'number' };

function validateModel(body, isUpdate) {
  if (!body || typeof body !== 'object') return 'Request body required';
  if (!isUpdate && (!body.id || typeof body.id !== 'string')) return 'Model must have a string id';
  if (!isUpdate && (!body.name || typeof body.name !== 'string')) return 'Model must have a string name';
  for (const key of Object.keys(body)) {
    if (!VALID_MODEL_KEYS.has(key)) return 'Unknown field: ' + key;
    if (VALID_TYPES[key] && body[key] != null && typeof body[key] !== VALID_TYPES[key]) return key + ' must be a ' + VALID_TYPES[key];
  }
  if (body.benchmarks && (typeof body.benchmarks !== 'object' || Array.isArray(body.benchmarks))) return 'benchmarks must be an object';
  if (body.scores && (typeof body.scores !== 'object' || Array.isArray(body.scores))) return 'scores must be an object';
  if (body.features && !Array.isArray(body.features)) return 'features must be an array';
  if (body.bestFor && !Array.isArray(body.bestFor)) return 'bestFor must be an array';
  if (body.tags && !Array.isArray(body.tags)) return 'tags must be an array';
  return null;
}

function handle(handler) {
  return async (req, res, next) => {
    try { await handler(req, res, next); } catch (e) { next(e); }
  };
}

function register(app) {

  app.get('/api/models', handle(async (req, res) => {
    res.json({ models: await db.getAllModels() });
  }));

  app.get('/api/models/export', handle(async (req, res) => {
    const models = await db.getAllModels();
    const format = req.query.format || 'json';
    if (format === 'csv') {
      const allBenchKeys = [...new Set(models.flatMap(m => Object.keys(m.benchmarks || {})))].sort();
      const allScoreKeys = [...new Set(models.flatMap(m => Object.keys(m.scores || {})))].sort();
      const cols = ['id','name','provider','family','architecture','parameters','inputPrice','outputPrice','speed','arenaElo','contextWindow','releaseDate', ...allBenchKeys.map(k => 'bench_' + k.replace(/[^a-z0-9]/gi,'_')), ...allScoreKeys.map(k => 'score_' + k), 'tags'];
      const esc = v => { if(v == null) return ''; const s = String(v).replace(/^[=+\-@]/, "'$&"); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s; };
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
  }));

  app.get('/api/models/:id', handle(async (req, res) => {
    const model = await db.getModel(req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    res.json({ model });
  }));

  app.post('/api/models', handle(async (req, res) => {
    const err = validateModel(req.body, false);
    if (err) return res.status(400).json({ error: err });
    const model = req.body;
    if (await db.getModel(model.id)) {
      return res.status(409).json({ error: 'Model ID already exists' });
    }
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
    const created = await db.createModel(model);
    res.status(201).json({ model: created });
  }));

  app.patch('/api/models/:id/slug', handle(async (req, res) => {
    const model = await db.getModel(req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    const slug = req.body.slug;
    if (!slug || typeof slug !== 'string') return res.status(400).json({ error: 'Slug is required' });
    model.openRouterSlug = slug;
    await db.updateModel(model);
    res.json({ model });
  }));

  app.put('/api/models/:id', handle(async (req, res) => {
    const existing = await db.getModel(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Model not found' });
    const err = validateModel(req.body, true);
    if (err) return res.status(400).json({ error: err });
    const updated = await db.updateModel({ ...existing, ...req.body, id: req.params.id });
    res.json({ model: updated });
  }));

  app.delete('/api/models/:id', handle(async (req, res) => {
    const existing = await db.getModel(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Model not found' });
    await db.deleteModel(req.params.id);
    res.json({ model: existing });
  }));

  app.get('/api/history/:id', handle(async (req, res) => {
    const model = await db.getModel(req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    const history = await db.getModelHistory(req.params.id);
    const prev = await db.getLatestSnapshot(req.params.id);
    const changes = await db.compareWithPrevious(model);
    res.json({ model: { id: model.id, name: model.name, provider: model.provider, color: model.color }, history, previousSnapshot: prev, changes });
  }));

  app.get('/api/changes', handle(async (req, res) => {
    const changes = await db.getAllChanges();
    res.json({ changes, count: changes.length, timestamp: new Date().toISOString() });
  }));

  app.post('/api/snapshot', handle(async (req, res) => {
    const count = await db.snapshotAllModels('manual');
    res.json({ message: 'Snapshotted ' + count + ' models', count });
  }));

  app.get('/api/compare', handle(async (req, res) => {
    const ids = req.query.ids ? req.query.ids.split(',') : [];
    const selected = (await Promise.all(ids.map(id => db.getModel(id)))).filter(Boolean);
    res.json({ models: selected });
  }));

  app.get('/api/recommend', handle(async (req, res) => {
    const task = (req.query.task || '').toLowerCase();
    const models = await db.getAllModels();
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
  }));
}

module.exports = { register };