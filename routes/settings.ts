const { param, body, validationResult } = require('express-validator');
const db = require('../db');
const { handle } = require('./utils');

function requireValid(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

function register(app) {
  app.get('/api/settings', handle(async (req, res) => {
    const obj = await db.getAllSettings();
    res.json(obj);
  }));

  app.put('/api/settings/:key',
    param('key').isString().notEmpty().withMessage('Key is required'),
    body('value').exists().withMessage('Value is required'),
    requireValid,
    handle(async (req, res) => {
      const { key } = req.params;
      const { value } = req.body;
      await db.setSetting(key, String(value));
      res.json({ key, value: String(value) });
    })
  );
}

module.exports = { register };
