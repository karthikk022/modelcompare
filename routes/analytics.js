const db = require('../db');
const { webSearch } = require('./utils');

function register(app) {

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