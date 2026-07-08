const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = (() => {
  let d = fs.realpathSync(__dirname);
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    const up = path.resolve(d, '..');
    if (up === d) break;
    d = up;
  }
  return __dirname;
})();
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'models.db');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ========== SCHEMA ==========
db.exec(`
  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT DEFAULT '',
    family TEXT DEFAULT '',
    logo TEXT DEFAULT '',
    color TEXT DEFAULT '#6b7280',
    release_date TEXT DEFAULT '',
    description TEXT DEFAULT '',
    context_window INTEGER,
    output_limit INTEGER,
    architecture TEXT DEFAULT 'Transformer',
    parameters TEXT,
    input_price REAL,
    output_price REAL,
    speed REAL,
    arena_elo REAL,
    benchmarks TEXT DEFAULT '{}',
    scores TEXT DEFAULT '{}',
    features TEXT DEFAULT '[]',
    best_for TEXT DEFAULT '[]',
    strengths TEXT DEFAULT '',
    weaknesses TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    predecessor TEXT,
    likes INTEGER DEFAULT 0,
    downloads INTEGER DEFAULT 0,
    pipeline TEXT DEFAULT 'text-generation',
    last_refreshed TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS model_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL,
    snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
    input_price REAL,
    output_price REAL,
    speed REAL,
    arena_elo REAL,
    benchmarks TEXT DEFAULT '{}',
    scores TEXT DEFAULT '{}',
    source TEXT DEFAULT 'manual'
  );
  CREATE INDEX IF NOT EXISTS idx_model_history_model ON model_history(model_id);
  CREATE INDEX IF NOT EXISTS idx_model_history_time ON model_history(snapshot_at);

  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL,
    model_name TEXT DEFAULT '',
    slug TEXT DEFAULT '',
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    finish_reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_usage_log_model ON usage_log(model_id);
  CREATE INDEX IF NOT EXISTS idx_usage_log_time ON usage_log(created_at);
`);

// ========== MIGRATIONS ==========
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`);

const migrations = [
  {
    name: '001_add_open_router_slug',
    run: () => {
      // check if column exists before adding (handles migration from pre-migration system)
      const cols = db.prepare("PRAGMA table_info('models')").all().map(c => c.name);
      if (!cols.includes('open_router_slug')) {
        db.exec("ALTER TABLE models ADD COLUMN open_router_slug TEXT DEFAULT ''");
      }
    },
  },
];

const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
for (const m of migrations) {
  if (applied.has(m.name)) continue;
  const tx = db.transaction(() => { m.run(); db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(m.name); });
  tx();
  console.log('Migration applied: ' + m.name);
}

// ========== MIGRATE FROM JSON ==========
function migrateFromJson() {
  const jsonPath = path.join(PROJECT_ROOT, 'models-data', 'models.json');
  if (!fs.existsSync(jsonPath)) return;
  
  const count = db.prepare('SELECT COUNT(*) as c FROM models').get().c;
  if (count > 0) return; // already migrated
  
  const models = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(models) || !models.length) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO models (id, name, provider, family, logo, color, release_date, description,
      context_window, output_limit, architecture, parameters, input_price, output_price, speed, arena_elo,
      benchmarks, scores, features, best_for, strengths, weaknesses, tags, predecessor, likes, downloads,
      pipeline, last_refreshed, created_at, updated_at)
    VALUES (@id, @name, @provider, @family, @logo, @color, @releaseDate, @description,
      @contextWindow, @outputLimit, @architecture, @parameters, @inputPrice, @outputPrice, @speed, @arenaElo,
      @benchmarks, @scores, @features, @bestFor, @strengths, @weaknesses, @tags, @predecessor, @likes, @downloads,
      @pipeline, @lastRefreshed, @createdAt, @updatedAt)
  `);

  const tx = db.transaction(() => {
    for (const m of models) {
      insert.run({
        id: m.id,
        name: m.name,
        provider: m.provider || '',
        family: m.family || '',
        logo: m.logo || '',
        color: m.color || '#6b7280',
        releaseDate: m.releaseDate || '',
        description: m.description || '',
        contextWindow: m.contextWindow ?? null,
        outputLimit: m.outputLimit ?? null,
        architecture: m.architecture || 'Transformer',
        parameters: m.parameters || null,
        inputPrice: m.inputPrice ?? null,
        outputPrice: m.outputPrice ?? null,
        speed: m.speed ?? null,
        arenaElo: m.arenaElo ?? null,
        benchmarks: JSON.stringify(m.benchmarks || {}),
        scores: JSON.stringify(m.scores || {}),
        features: JSON.stringify(m.features || []),
        bestFor: JSON.stringify(m.bestFor || []),
        strengths: m.strengths || '',
        weaknesses: m.weaknesses || '',
        tags: JSON.stringify(m.tags || []),
        predecessor: m.predecessor || null,
        likes: m.likes || 0,
        downloads: m.downloads || 0,
        pipeline: m.pipeline || 'text-generation',
        lastRefreshed: m.lastRefreshed || null,
        createdAt: m.createdAt || m.created_at || new Date().toISOString(),
        updatedAt: m.updatedAt || m.updated_at || new Date().toISOString(),
      });
    }
  });
  tx();
  console.log(`Migrated ${models.length} models from JSON to SQLite`);
}

// ========== QUERIES ==========
const stmts = {
  getAll: db.prepare('SELECT * FROM models ORDER BY name'),
  getById: db.prepare('SELECT * FROM models WHERE id = ?'),
  insert: db.prepare(`INSERT INTO models (id, name, provider, family, logo, color, release_date, description,
    context_window, output_limit, architecture, parameters, input_price, output_price, speed, arena_elo,
    benchmarks, scores, features, best_for, strengths, weaknesses, tags, predecessor, likes, downloads,
    pipeline, last_refreshed, created_at, updated_at, open_router_slug)
    VALUES (@id, @name, @provider, @family, @logo, @color, @releaseDate, @description,
    @contextWindow, @outputLimit, @architecture, @parameters, @inputPrice, @outputPrice, @speed, @arenaElo,
    @benchmarks, @scores, @features, @bestFor, @strengths, @weaknesses, @tags, @predecessor, @likes, @downloads,
    @pipeline, @lastRefreshed, @createdAt, @updatedAt, @openRouterSlug)`),
  update: db.prepare(`UPDATE models SET name=@name, provider=@provider, family=@family, logo=@logo, color=@color,
    release_date=@releaseDate, description=@description, context_window=@contextWindow, output_limit=@outputLimit,
    architecture=@architecture, parameters=@parameters, input_price=@inputPrice, output_price=@outputPrice,
    speed=@speed, arena_elo=@arenaElo, benchmarks=@benchmarks, scores=@scores, features=@features,
    best_for=@bestFor, strengths=@strengths, weaknesses=@weaknesses, tags=@tags, predecessor=@predecessor,
    likes=@likes, downloads=@downloads, pipeline=@pipeline, last_refreshed=@lastRefreshed, updated_at=@updatedAt,
    open_router_slug=@openRouterSlug WHERE id=@id`),
  delete: db.prepare('DELETE FROM models WHERE id = ?'),
  insertHistory: db.prepare(`INSERT INTO model_history (model_id, snapshot_at, input_price, output_price, speed, arena_elo, benchmarks, scores, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  getHistory: db.prepare('SELECT * FROM model_history WHERE model_id = ? ORDER BY snapshot_at DESC LIMIT 50'),
  getHistoryLatest: db.prepare('SELECT snapshot_at, model_id, MAX(id) as id FROM model_history GROUP BY model_id'),
  getLatestSnapshot: db.prepare('SELECT * FROM model_history WHERE model_id = ? ORDER BY snapshot_at DESC LIMIT 1'),
  getRecentChanges: db.prepare(`SELECT mh.*, m.name, m.provider, m.color FROM model_history mh JOIN models m ON m.id = mh.model_id WHERE mh.id IN (SELECT MAX(id) FROM model_history GROUP BY model_id) ORDER BY mh.snapshot_at DESC`),
  getAlertConfig: db.prepare('SELECT value FROM settings WHERE key = ?'),
  logUsage: db.prepare('INSERT INTO usage_log (model_id, model_name, slug, prompt_tokens, completion_tokens, total_tokens, cost, latency_ms, finish_reason) VALUES (@modelId, @modelName, @slug, @promptTokens, @completionTokens, @totalTokens, @cost, @latencyMs, @finishReason)'),
  getUsageStats: db.prepare('SELECT * FROM usage_log WHERE created_at >= ? ORDER BY created_at DESC'),
};

// ========== HELPERS ==========
function rowToModel(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    family: row.family,
    logo: row.logo,
    color: row.color,
    releaseDate: row.release_date,
    description: row.description,
    contextWindow: row.context_window,
    outputLimit: row.output_limit,
    architecture: row.architecture,
    parameters: row.parameters,
    inputPrice: row.input_price,
    outputPrice: row.output_price,
    speed: row.speed,
    arenaElo: row.arena_elo,
    benchmarks: safeJson(row.benchmarks, {}),
    scores: safeJson(row.scores, {}),
    features: safeJson(row.features, []),
    bestFor: safeJson(row.best_for, []),
    strengths: row.strengths,
    weaknesses: row.weaknesses,
    tags: safeJson(row.tags, []),
    predecessor: row.predecessor,
    likes: row.likes,
    downloads: row.downloads,
    pipeline: row.pipeline,
    openRouterSlug: row.open_router_slug || '',
    lastRefreshed: row.last_refreshed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function modelToRow(m) {
  return {
    id: m.id,
    name: m.name,
    provider: m.provider || '',
    family: m.family || '',
    logo: m.logo || '',
    color: m.color || '#6b7280',
    releaseDate: m.releaseDate || '',
    description: m.description || '',
    contextWindow: m.contextWindow ?? null,
    outputLimit: m.outputLimit ?? null,
    architecture: m.architecture || 'Transformer',
    parameters: m.parameters || null,
    inputPrice: m.inputPrice ?? null,
    outputPrice: m.outputPrice ?? null,
    speed: m.speed ?? null,
    arenaElo: m.arenaElo ?? null,
    benchmarks: JSON.stringify(m.benchmarks || {}),
    scores: JSON.stringify(m.scores || {}),
    features: JSON.stringify(m.features || []),
    bestFor: JSON.stringify(m.bestFor || []),
    strengths: m.strengths || '',
    weaknesses: m.weaknesses || '',
    tags: JSON.stringify(m.tags || []),
    predecessor: m.predecessor || null,
    likes: m.likes || 0,
    downloads: m.downloads || 0,
    pipeline: m.pipeline || 'text-generation',
    openRouterSlug: m.openRouterSlug || '',
    lastRefreshed: m.lastRefreshed || null,
    createdAt: m.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function safeJson(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

const api: Record<string, any> = {};

// ========== ASYNC PUBLIC API ==========
async function snapshotAllModels(source) {
  const models = stmts.getAll.all().map(rowToModel);
  const now = new Date().toISOString();
  for (const m of models) {
    stmts.insertHistory.run(m.id, now, m.inputPrice, m.outputPrice, m.speed, m.arenaElo, JSON.stringify(m.benchmarks || {}), JSON.stringify(m.scores || {}), source || 'manual');
  }
  return models.length;
}

api.db = db;
api.migrateFromJson = migrateFromJson;
api.snapshotAllModels = snapshotAllModels;
api.getAllModels = async () => stmts.getAll.all().map(rowToModel);
api.getModel = async (id) => rowToModel(stmts.getById.get(id));
api.createModel = async (m) => {
  const row = modelToRow(m);
  stmts.insert.run(row);
  return rowToModel(stmts.getById.get(m.id));
};
api.updateModel = async (m) => {
  const row = modelToRow(m);
  stmts.update.run(row);
  return rowToModel(stmts.getById.get(m.id));
};
api.deleteModel = async (id) => stmts.delete.run(id);
api.getSetting = async (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};
api.setSetting = async (key, value) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
};
api.getAllSettings = async () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
};
api.getModelHistory = async (id) => stmts.getHistory.all(id).map(r => ({
  id: r.id,
  modelId: r.model_id,
  snapshotAt: r.snapshot_at,
  inputPrice: r.input_price,
  outputPrice: r.output_price,
  speed: r.speed,
  arenaElo: r.arena_elo,
  benchmarks: safeJson(r.benchmarks, {}),
  scores: safeJson(r.scores, {}),
  source: r.source,
}));
api.getLatestSnapshot = async (id) => {
  const r = stmts.getLatestSnapshot.get(id);
  if (!r) return null;
  return { inputPrice: r.input_price, outputPrice: r.output_price, speed: r.speed, arenaElo: r.arena_elo, benchmarks: safeJson(r.benchmarks, {}), snapshotAt: r.snapshot_at };
};
api.compareWithPrevious = async (model) => {
  const prev = await api.getLatestSnapshot(model.id);
  if (!prev) return null;
  const changes = {};
  for (const key of ['inputPrice', 'outputPrice', 'speed', 'arenaElo']) {
    if (model[key] != null && prev[key] != null && model[key] !== prev[key]) {
      changes[key] = { from: prev[key], to: model[key], diff: model[key] - prev[key] };
    }
  }
  const benchKeys = [...new Set([...Object.keys(model.benchmarks || {}), ...Object.keys(prev.benchmarks)])];
  for (const k of benchKeys) {
    const cur = model.benchmarks && model.benchmarks[k];
    const old = prev.benchmarks && prev.benchmarks[k];
    if (cur != null && old != null && cur !== old) {
      changes['bench_' + k] = { from: old, to: cur, diff: cur - old };
    } else if (cur != null && old == null) {
      changes['bench_' + k] = { from: null, to: cur, diff: null, label: 'new' };
    }
  }
  return Object.keys(changes).length ? changes : null;
};
api.getAllChanges = async () => {
  const rows = stmts.getRecentChanges.all();
  const result = [];
  for (const row of rows) {
    const m = { id: row.model_id, name: row.name, provider: row.provider, color: row.color };
    const current = stmts.getById.get(row.model_id);
    if (!current) continue;
    const prev = { inputPrice: row.input_price, outputPrice: row.output_price, speed: row.speed, arenaElo: row.arena_elo, benchmarks: safeJson(row.benchmarks, {}), snapshotAt: row.snapshot_at, scores: safeJson(row.scores, {}) };
    const cur = { inputPrice: current.input_price, outputPrice: current.output_price, speed: current.speed, arenaElo: current.arena_elo, benchmarks: safeJson(current.benchmarks, {}), scores: safeJson(current.scores, {}) };
    const changes = {};
    for (const key of ['inputPrice', 'outputPrice', 'speed', 'arenaElo']) {
      if (cur[key] != null && prev[key] != null && Math.abs(cur[key] - prev[key]) > 0.001) {
        changes[key] = { from: prev[key], to: cur[key], diff: cur[key] - prev[key] };
      }
    }
    const benchKeys = [...new Set([...Object.keys(cur.benchmarks), ...Object.keys(prev.benchmarks)])];
    for (const k of benchKeys) {
      const cv = cur.benchmarks[k];
      const ov = prev.benchmarks[k];
      if (cv != null && ov != null && Math.abs(cv - ov) > 0.01) {
        changes['bench_' + k] = { from: ov, to: cv, diff: cv - ov };
      }
    }
    if (Object.keys(changes).length) {
      result.push({ model: m, snapshotAt: row.snapshot_at, changes });
    }
  }
  return result;
};
api.logUsage = async (entry) => stmts.logUsage.run(entry);
api.getUsageLogs = async (days) => {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return stmts.getUsageStats.all(since).map(r => ({
    id: r.id, modelId: r.model_id, modelName: r.model_name,
    totalTokens: r.total_tokens, cost: r.cost, latencyMs: r.latency_ms,
    promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens,
    finishReason: r.finish_reason, timestamp: r.created_at,
  }));
};
api.getUsageStats = async (days) => {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = stmts.getUsageStats.all(since);
  const total = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, latencyMs: 0 };
  const byModel = {};
  const byDay = {};
  for (const r of rows) {
    total.calls++;
    total.promptTokens += r.prompt_tokens;
    total.completionTokens += r.completion_tokens;
    total.totalTokens += r.total_tokens;
    total.cost += r.cost;
    total.latencyMs += r.latency_ms;
    const mid = r.model_id;
    if (!byModel[mid]) byModel[mid] = { modelId: mid, modelName: r.model_name, calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, latencyMs: 0 };
    byModel[mid].calls++;
    byModel[mid].promptTokens += r.prompt_tokens;
    byModel[mid].completionTokens += r.completion_tokens;
    byModel[mid].totalTokens += r.total_tokens;
    byModel[mid].cost += r.cost;
    byModel[mid].latencyMs += r.latency_ms;
    const day = r.created_at ? r.created_at.substring(0, 10) : 'unknown';
    if (!byDay[day]) byDay[day] = { date: day, calls: 0, totalTokens: 0, cost: 0 };
    byDay[day].calls++;
    byDay[day].totalTokens += r.total_tokens;
    byDay[day].cost += r.cost;
  }
  return { total, byModel: Object.values(byModel), byDay: (Object.values(byDay) as { date: string; calls: number; totalTokens: number; cost: number }[]).sort((a, b) => a.date.localeCompare(b.date)) };
};

module.exports = api;
