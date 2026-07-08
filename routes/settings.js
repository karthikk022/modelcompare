const db = require('../db');
const { handle } = require('./utils');

function register(app) {
  app.get('/api/settings', handle(async (req, res) => {
    const obj = await db.getAllSettings();
    res.json(obj);
  }));

  app.put('/api/settings/:key', handle(async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;
    if (value === undefined || value === null) return res.status(400).json({ error: 'value required' });
    await db.setSetting(key, String(value));
    res.json({ key, value: String(value) });
  }));
}

module.exports = { register };
