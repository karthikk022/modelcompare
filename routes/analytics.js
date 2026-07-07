const db = require('../db');
const { webSearch } = require('./utils');

function register(app) {

  app.get('/api/usage/stats', async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
    const stats = await db.getUsageStats(days);
    res.json(stats);
  });

  app.get('/api/usage/history', async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    const rows = await db.getUsageStats(days);
    const entries = (Array.isArray(rows) ? rows : []).map(r => ({
      id: r.id,
      modelId: r.model_id,
      modelName: r.model_name,
      totalTokens: r.total_tokens,
      cost: r.cost,
      latencyMs: r.latency_ms,
      timestamp: r.created_at,
    }));
    res.json({ usage: entries });
  });

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
}

module.exports = { register };