const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const app = express();
const db = require('./db');
const { handle } = require('./routes/utils');

const PORT = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — try again in a minute' },
});
app.use('/api', limiter);

app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (res.statusCode >= 400) {
      console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.originalUrl + ' ' + res.statusCode + ' ' + ms + 'ms');
    }
  });
  next();
});

require('./routes/models').register(app);
require('./routes/prompts').register(app);
require('./routes/analytics').register(app);
require('./routes/discovery').register(app);
require('./routes/settings').register(app);
require('./routes/benchmarks').register(app);

app.get('/api/health', handle(async (req, res) => {
  const models = await db.getAllModels();
  res.json({
    status: 'ok',
    uptime: Math.floor((process.uptime ? process.uptime() : 0)),
    models: models.length,
    apiKeys: 0,
    db: 'sqlite',
    version: '1.0.0',
  });
}));

app.use((err, req, res, next) => {
  console.error('[ERROR] ' + new Date().toISOString() + ' ' + req.method + ' ' + req.originalUrl + ':', err.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

const reactDistDir = path.join(__dirname, 'client', 'dist');
const reactIndex = path.join(reactDistDir, 'index.html');
const hasReact = require('fs').existsSync(reactIndex);
if (hasReact) {
  app.use(express.static(reactDistDir));
  app.get(/^\/(?!api\/)/, (req, res) => res.sendFile(reactIndex));
} else {
  const modelsPage = path.join(__dirname, 'public', 'models.html');
  app.get('/', (req, res) => res.sendFile(modelsPage));
  app.get('/models', (req, res) => res.sendFile(modelsPage));
}

let server;
const intervals = [];

process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('uncaughtException', (err) => { console.error('[FATAL]', err); process.exit(1); });
process.on('unhandledRejection', (reason) => { console.error('[FATAL] Unhandled rejection:', reason); });

async function gracefulShutdown(signal) {
  console.log('Shutting down on ' + signal + '...');
  intervals.forEach(clearInterval);
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

async function start() {
  await db.migrateFromJson();
  server = app.listen(PORT, '0.0.0.0', async () => {
    console.log('AI Model Compare running on http://localhost:' + PORT);
    console.log('Press Ctrl+C to stop');

    const startCount = await db.snapshotAllModels('startup');
    console.log('Initial snapshot: ' + startCount + ' models');

    intervals.push(setInterval(async () => {
      const c = await db.snapshotAllModels('scheduled');
      console.log('[' + new Date().toISOString() + '] Scheduled snapshot: ' + c + ' models');
    }, 6 * 60 * 60 * 1000));

    intervals.push(setInterval(async () => {
      const changes = await db.getAllChanges();
      if (changes.length) {
        const sig = changes.filter(c => {
          return Object.entries(c.changes).some(([k, v]) => {
            if (k.startsWith('bench_') && Math.abs(v.diff) > 2) return true;
            if (k === 'inputPrice' || k === 'outputPrice') return Math.abs(v.diff) > 0.5;
            return false;
          });
        });
        if (sig.length) {
          console.log('[ALERT] ' + sig.length + ' models with significant changes:');
          sig.forEach(c => console.log('  ' + c.model.name + ': ' + Object.keys(c.changes).length + ' changes'));
        }
      }
    }, 30 * 60 * 1000));
  });
}

start();