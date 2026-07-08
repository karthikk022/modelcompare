const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const app = express();
const db = require('./db');
const { handle } = require('./routes/utils');
const { requireAuth } = require('./routes/auth');

const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : (process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3001', 'http://localhost:5173']);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors(ALLOWED_ORIGINS.length > 0 ? { origin: ALLOWED_ORIGINS } : undefined));
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

/* Auth guard for mutation endpoints: settings, model CRUD, snapshots */
app.use(/^\/(api\/settings|api\/models|api\/snapshot)/, (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return requireAuth(req, res, next);
  next();
});

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

/*
 * Two frontend codebases exist: client/ (React SPA) and public/models.html (legacy SPA).
 * The React production build (client/dist/) takes priority when present.
 * Otherwise the legacy HTML frontend is served as a fallback.
 * To switch: `cd client && npm run build` to enable React; delete client/dist to revert.
 */
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