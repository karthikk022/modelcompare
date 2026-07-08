const request = require('supertest');
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const db = require('../db');
const { requireAuth } = require('../routes/auth');

/* App without auth (matching production API_KEY=unset) */
const app = express();
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json());

require('../routes/models').register(app);
require('../routes/analytics').register(app);
require('../routes/benchmarks').register(app);
require('../routes/events').register(app);

app.get('/api/health', async (req, res) => {
  const models = await db.getAllModels();
  res.json({ status: 'ok', models: models.length, db: 'sqlite', version: '1.0.0' });
});

/* App with auth enabled (simulating API_KEY set) */
const authApp = express();
authApp.use(express.json());
authApp.use(/^\/(api\/settings|api\/models|api\/snapshot)/, (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return requireAuth(req, res, next);
  next();
});
require('../routes/models').register(authApp);
require('../routes/analytics').register(authApp);
require('../routes/benchmarks').register(authApp);

describe('API Routes', function () {
  before(async function () {
    await db.migrateFromJson();
  });

  after(async function () {
    try { await db.deleteModel('test-api-model'); } catch (e) { console.warn('[test] cleanup failed:', e.message); }
  });

  describe('GET /api/health', function () {
    it('should return health status', function (done) {
      request(app)
        .get('/api/health')
        .expect(200)
        .expect(function (res) {
          if (res.body.status !== 'ok') throw new Error('Expected status ok');
          if (typeof res.body.models !== 'number') throw new Error('Expected models to be a number');
        })
        .end(done);
    });
  });

  describe('GET /api/models', function () {
    it('should return list of models', function (done) {
      request(app)
        .get('/api/models')
        .expect(200)
        .expect(function (res) {
          if (!Array.isArray(res.body.models)) throw new Error('Expected models array');
          if (res.body.models.length === 0) throw new Error('Expected at least one model');
        })
        .end(done);
    });
  });

  describe('POST /api/models', function () {
    it('should create a new model', function (done) {
      request(app)
        .post('/api/models')
        .send({ id: 'test-api-model', name: 'API Test Model', provider: 'Test' })
        .expect(201)
        .expect(function (res) {
          if (res.body.model.id !== 'test-api-model') throw new Error('Expected model id');
          if (res.body.model.name !== 'API Test Model') throw new Error('Expected model name');
        })
        .end(done);
    });

    it('should reject model without name', function (done) {
      request(app)
        .post('/api/models')
        .send({ id: 'no-name-model' })
        .expect(400)
        .end(done);
    });

    it('should reject duplicate model id', function (done) {
      request(app)
        .post('/api/models')
        .send({ id: 'test-api-model', name: 'Duplicate', provider: 'Test' })
        .expect(409)
        .end(done);
    });
  });

  describe('GET /api/models/:id', function () {
    it('should return a single model', function (done) {
      request(app)
        .get('/api/models/test-api-model')
        .expect(200)
        .expect(function (res) {
          if (res.body.model.id !== 'test-api-model') throw new Error('Expected test-api-model');
        })
        .end(done);
    });

    it('should return 404 for non-existent model', function (done) {
      request(app)
        .get('/api/models/non-existent')
        .expect(404)
        .end(done);
    });
  });

  describe('PUT /api/models/:id', function () {
    it('should update an existing model', function (done) {
      request(app)
        .put('/api/models/test-api-model')
        .send({ name: 'Updated API Model', inputPrice: 10 })
        .expect(200)
        .expect(function (res) {
          if (res.body.model.name !== 'Updated API Model') throw new Error('Expected updated name');
          if (res.body.model.inputPrice !== 10) throw new Error('Expected inputPrice 10');
        })
        .end(done);
    });
  });

  describe('GET /api/compare', function () {
    it('should compare selected models', function (done) {
      request(app)
        .get('/api/compare?ids=test-api-model')
        .expect(200)
        .expect(function (res) {
          if (!Array.isArray(res.body.models)) throw new Error('Expected models array');
        })
        .end(done);
    });
  });

  describe('GET /api/recommend', function () {
    it('should return recommendations for a task', function (done) {
      request(app)
        .get('/api/recommend?task=coding')
        .expect(200)
        .expect(function (res) {
          if (!Array.isArray(res.body.models)) throw new Error('Expected models array');
        })
        .end(done);
    });
  });

  describe('GET /api/changes', function () {
    it('should return recent changes', function (done) {
      request(app)
        .get('/api/changes')
        .expect(200)
        .expect(function (res) {
          if (!Array.isArray(res.body.changes)) throw new Error('Expected changes array');
        })
        .end(done);
    });
  });

  describe('POST /api/web-search', function () {
    it('should reject empty query', function (done) {
      request(app)
        .post('/api/web-search')
        .send({ query: '' })
        .expect(400)
        .end(done);
    });
  });

  describe('POST /api/snapshot', function () {
    it('should snapshot all models', function (done) {
      request(app)
        .post('/api/snapshot')
        .expect(200)
        .expect(function (res) {
          if (typeof res.body.count !== 'number') throw new Error('Expected count');
        })
        .end(done);
    });
  });

  describe('GET /api/models/export', function () {
    it('should export models as JSON', function (done) {
      request(app)
        .get('/api/models/export')
        .expect(200)
        .expect('Content-Type', /json/)
        .end(done);
    });

    it('should export models as CSV', function (done) {
      request(app)
        .get('/api/models/export?format=csv')
        .expect(200)
        .expect('Content-Type', /csv/)
        .end(done);
    });
  });

  describe('DELETE /api/models/:id', function () {
    it('should delete a model', function (done) {
      request(app)
        .delete('/api/models/test-api-model')
        .expect(200)
        .expect(function (res) {
          if (res.body.model.id !== 'test-api-model') throw new Error('Expected deleted model');
        })
        .end(done);
    });

    it('should return 404 for already deleted model', function (done) {
      request(app)
        .delete('/api/models/test-api-model')
        .expect(404)
        .end(done);
    });
  });

  describe('Auth guard (API_KEY set)', function () {
    before(function () { process.env.API_KEY = 'test-secret-key'; });
    after(function () { delete process.env.API_KEY; });

    it('should reject POST /api/models without key', function (done) {
      request(authApp)
        .post('/api/models')
        .send({ id: 'test-auth-model', name: 'Auth Test' })
        .expect(401)
        .end(done);
    });

    it('should reject POST /api/models with wrong key', function (done) {
      request(authApp)
        .post('/api/models')
        .set('x-api-key', 'wrong-key')
        .send({ id: 'test-auth-model', name: 'Auth Test' })
        .expect(401)
        .end(done);
    });

    it('should accept POST /api/models with correct key', function (done) {
      request(authApp)
        .post('/api/models')
        .set('x-api-key', 'test-secret-key')
        .send({ id: 'test-auth-model', name: 'Auth Test' })
        .expect(201)
        .end(done);
    });

    it('should accept Authorization: Bearer <key>', function (done) {
      request(authApp)
        .delete('/api/models/test-auth-model')
        .set('Authorization', 'Bearer test-secret-key')
        .expect(200)
        .end(done);
    });

    it('should allow GET /api/models without key', function (done) {
      request(authApp)
        .get('/api/models')
        .expect(200)
        .end(done);
    });
  });

  describe('GET /api/providers', function () {
    it('should return a sorted list of providers', function (done) {
      request(app)
        .get('/api/providers')
        .expect(200)
        .expect(function (res) {
          if (!Array.isArray(res.body.providers)) throw new Error('Expected providers array');
          const sorted = [...res.body.providers].sort();
          if (JSON.stringify(res.body.providers) !== JSON.stringify(sorted)) throw new Error('Expected sorted providers');
        })
        .end(done);
    });
  });

  describe('GET /api/models — search/filter/sort/pagination', function () {
    before(function (done) {
      // ensure a known model exists for filtering tests
      request(app)
        .post('/api/models')
        .send({ id: 'search-test-model', name: 'Search Test Model', provider: 'TestSearch', arenaElo: 1200, inputPrice: 5 })
        .expect(201)
        .end(done);
    });

    it('should filter by ?q=', function (done) {
      request(app)
        .get('/api/models?q=Search+Test')
        .expect(200)
        .expect(function (res) {
          if (res.body.models.length === 0) throw new Error('Expected at least one match');
          if (!res.body.models.every(m => m.name.toLowerCase().includes('search test') || m.id.toLowerCase().includes('search test'))) throw new Error('Expected all results to match query');
        })
        .end(done);
    });

    it('should filter by ?provider=', function (done) {
      request(app)
        .get('/api/models?provider=TestSearch')
        .expect(200)
        .expect(function (res) {
          if (res.body.models.length === 0) throw new Error('Expected at least one match');
          if (!res.body.models.every(m => m.provider === 'TestSearch')) throw new Error('Expected all results to match provider');
        })
        .end(done);
    });

    it('should sort by ?sort=name', function (done) {
      request(app)
        .get('/api/models?sort=name')
        .expect(200)
        .expect(function (res) {
          const names = res.body.models.filter(m => m.name).map(m => m.name.toLowerCase());
          const sorted = [...names].sort();
          if (JSON.stringify(names) !== JSON.stringify(sorted)) throw new Error('Expected ascending sort by name');
        })
        .end(done);
    });

    it('should sort ascending with ?sort=arenaElo', function (done) {
      request(app)
        .get('/api/models?sort=arenaElo')
        .expect(200)
        .expect(function (res) {
          const elos = res.body.models
            .filter(m => m.arenaElo != null && typeof m.arenaElo === 'number')
            .map(m => m.arenaElo);
          if (elos.length < 2) {
            // skip assertion if fewer than 2 numeric ELOS — still test that at least the test model appears with right provider
            const testModel = res.body.models.find(m => m.id === 'search-test-model');
            if (!testModel) throw new Error('Expected search-test-model in results');
            if (testModel.arenaElo !== 1200) throw new Error('Expected arenaElo 1200');
            return;
          }
          for (let i = 1; i < elos.length; i++) {
            if (elos[i] < elos[i - 1]) throw new Error('Expected ascending ELO sort, got ' + elos[i] + ' after ' + elos[i - 1]);
          }
        })
        .end(done);
    });

    it('should paginate with ?limit= and ?offset=', function (done) {
      request(app)
        .get('/api/models?limit=1&offset=0')
        .expect(200)
        .expect(function (res) {
          if (res.body.models.length > 1) throw new Error('Expected at most 1 model');
          if (typeof res.body.total !== 'number') throw new Error('Expected total count');
          if (typeof res.body.count !== 'number') throw new Error('Expected count');
        })
        .end(done);
    });

    it('should return total regardless of pagination', function (done) {
      request(app)
        .get('/api/models?limit=1')
        .expect(200)
        .expect(function (res) {
          if (res.body.total < res.body.count) throw new Error('Expected total >= count');
        })
        .end(done);
    });

    after(function (done) {
      request(app).delete('/api/models/search-test-model').end(() => done());
    });
  });

  describe('GET /api/events SSE endpoint', function () {
    it('should return 200 with text/event-stream content type', function (done) {
      const srv = app.listen(0, function () {
        const port = srv.address().port;
        const http = require('http');
        const req = http.get('http://localhost:' + port + '/api/events', function (res) {
          if (res.statusCode !== 200) { srv.close(); return done(new Error('Expected 200, got ' + res.statusCode)); }
          if (!/text\/event-stream/.test(res.headers['content-type'])) { srv.close(); return done(new Error('Expected event-stream content-type')); }
          res.destroy();
          srv.close();
          done();
        });
        req.on('error', function (err) { srv.close(); done(err); });
      });
    });
  });
});