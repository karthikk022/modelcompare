const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const app = express();
const db = require('./db');
const { handle } = require('./routes/utils');
const { requireAuth, requireCsrf } = require('./routes/auth');
const { changeBus } = require('./routes/events');

const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : (process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3001', 'http://localhost:5173']);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors(ALLOWED_ORIGINS.length > 0 ? { origin: ALLOWED_ORIGINS } : undefined));
app.use(express.json());

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many read requests — try again in a minute' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests — try again in a minute' },
});

app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return writeLimiter(req, res, next);
  readLimiter(req, res, next);
});

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
require('./routes/events').register(app);

/* Auth + CSRF guards for mutation endpoints: settings, model CRUD, snapshots */
app.use(/^\/(api\/settings|api\/models|api\/snapshot)/, (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const fns: any[] = [requireAuth, requireCsrf];
    let i = 0;
    function run(err?: any) { if (err) return next(err); const fn = fns[i++]; if (fn) fn(req, res, run); else next(); }
    run();
  } else next();
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

const PROJECT_ROOT = path.resolve(__dirname, fs.realpathSync(__dirname).includes('dist-server') ? '../..' : '..');
const reactDistDir = path.join(PROJECT_ROOT, 'client', 'dist');
const reactIndex = path.join(reactDistDir, 'index.html');
app.use(express.static(reactDistDir));
app.get(/^\/(?!api\/)/, (req, res) => res.sendFile(reactIndex));

let server;
const intervals = [];

process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('uncaughtException', (err) => { console.error('[FATAL]', err); process.exit(1); });
process.on('unhandledRejection', (reason) => { console.error('[FATAL] Unhandled rejection:', reason); process.exit(1); });

async function gracefulShutdown(signal) {
  console.log('Shutting down on ' + signal + '...');
  intervals.forEach(clearInterval);
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

async function start() {
  await db.migrateFromJson();
  if (!require('fs').existsSync(reactIndex)) {
    console.log('React build not found — building client...');
    const { execSync } = require('child_process');
    execSync('npm run build:client', { cwd: __dirname, stdio: 'inherit' });
  }
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
      if (!changes.length) return;
      const sig = changes.filter((c: any) => {
        return Object.entries(c.changes).some(([k, v]) => {
          const diff = (v as any).diff;
          if (k.startsWith('bench_') && Math.abs(diff) > 2) return true;
          if (k === 'inputPrice' || k === 'outputPrice') return Math.abs(diff) > 0.5;
          return false;
        });
      });
      if (sig.length) {
        console.log('[ALERT] ' + sig.length + ' models with significant changes:');
        sig.forEach(c => console.log('  ' + c.model.name + ': ' + Object.keys(c.changes).length + ' changes'));
        changeBus.emit('changes', sig);
      }
    }, 30 * 60 * 1000));
  });
}

start();