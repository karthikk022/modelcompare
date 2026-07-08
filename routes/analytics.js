const db = require('../db');
const { webSearch, handle } = require('./utils');

function register(app) {

  app.get('/api/usage/stats', handle(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
    const stats = await db.getUsageStats(days);
    res.json(stats);
  }));

  app.get('/api/usage/history', handle(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    const entries = await db.getUsageLogs(days);
    res.json({ usage: entries });
  }));

  app.post('/api/web-search', handle(async (req, res) => {
    const { query } = req.body;
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'query string required' });
    try {
      const results = await webSearch(query);
      res.json({ results, query });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));
}

module.exports = { register };