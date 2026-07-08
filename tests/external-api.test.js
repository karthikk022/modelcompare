const request = require('supertest');
const express = require('express');
const db = require('../db');

let originalFetch;

function mockFetch(responses) {
  return async function (url) {
    for (const { match, handler } of responses) {
      if (url.includes(match)) return handler(url);
    }
    return { ok: false, status: 404, json: async () => ({ error: 'unexpected fetch: ' + url }) };
  };
}

function okJson(data) {
  return { ok: true, status: 200, json: async () => data };
}

describe('External API routes (mocked fetch)', function () {
  before(async function () {
    await db.migrateFromJson();
    process.env.OPENROUTER_API_KEY = 'test-or-key';
  });

  after(async function () {
    delete process.env.OPENROUTER_API_KEY;
  });

  beforeEach(function () { originalFetch = global.fetch; });
  afterEach(function () { global.fetch = originalFetch; });

  describe('POST /api/test-prompt', function () {
    before(async function () {
      try { await db.createModel({ id: 'ext-test-model', name: 'External Test Model', openRouterSlug: 'test/model', inputPrice: 1, outputPrice: 2 }); } catch (e) {/* ok */}
    });
    after(async function () { try { await db.deleteModel('ext-test-model'); } catch (e) {/* ok */} });

    it('should return results from a mocked completion', function (done) {
      const app = express();
      app.use(express.json());
      require('../routes/prompts').register(app);

      const callLog = [];
      global.fetch = mockFetch([
        {
          match: 'openrouter.ai/api/v1/chat/completions',
          handler: (url, opts) => {
            callLog.push('completions');
            return okJson({
              choices: [{ message: { content: 'Mock response' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 20 },
              model: 'test/model',
            });
          },
        },
        {
          match: 'openrouter.ai/api/v1/models',
          handler: () => okJson({ data: [{ id: 'test/model', name: 'Test Model', pricing: { prompt: 0.000001, completion: 0.000002 } }] }),
        },
      ]);

      request(app)
        .post('/api/test-prompt')
        .send({ models: ['ext-test-model'], prompt: 'Hello' })
        .expect(200)
        .expect(function (res) {
          if (!Array.isArray(res.body.results)) throw new Error('Expected results array');
          if (res.body.results.length !== 1) throw new Error('Expected 1 result');
          if (res.body.results[0].content !== 'Mock response') throw new Error('Expected Mock response');
          if (res.body.results[0].inTokens !== 10) throw new Error('Expected 10 input tokens');
          if (res.body.results[0].outTokens !== 20) throw new Error('Expected 20 output tokens');
          if (res.body.results[0].cost == null) throw new Error('Expected cost to be calculated');
          if (callLog.length !== 1) throw new Error('Expected 1 completion call');
        })
        .end(done);
    });

    it('should reject missing models array', function (done) {
      const app = express();
      app.use(express.json());
      require('../routes/prompts').register(app);
      request(app)
        .post('/api/test-prompt')
        .send({ prompt: 'Hello' })
        .expect(400)
        .end(done);
    });

    it('should reject when no prompt or messages', function (done) {
      const app = express();
      app.use(express.json());
      require('../routes/prompts').register(app);
      request(app)
        .post('/api/test-prompt')
        .send({ models: ['ext-test-model'] })
        .expect(400)
        .end(done);
    });
  });

  describe('GET /api/discover', function () {
    const HF_LISTING = 'huggingface.co/api/models?pipeline_tag=text-generation';

    it('should return models from HF', function (done) {
      const app = express();
      app.use(express.json());
      require('../routes/discovery').register(app);

      global.fetch = mockFetch([
        { match: HF_LISTING, handler: () => okJson([
          { id: 'org-alpha/Omega-Model', likes: 100, downloads: 5000, pipeline_tag: 'text-generation', createdAt: '2025-01-01T00:00:00Z' },
          { id: 'org-alpha/Beta-Model', likes: 50, downloads: 2000, pipeline_tag: 'text-generation', createdAt: '2025-06-01T00:00:00Z' },
        ]) },
        { match: 'Omega-Model/results', handler: () => okJson([{ type: 'open_llm_leaderboard', results: { mmlu: 0.85 } }]) },
        { match: 'Beta-Model/results', handler: () => okJson([]) },
        { match: 'Omega-Model?expand[]=config', handler: () => okJson({ config: { model_type: 'Transformer', num_parameters: 7000000000 } }) },
        { match: 'Beta-Model?expand[]=config', handler: () => okJson({ config: { model_type: 'Mamba', num_parameters: 3000000000 } }) },
        { match: 'org-alpha/Omega-Model', handler: () => okJson({ cardData: { base_model: 'Omega Model' }, downloads: 5000, pipeline_tag: 'text-generation' }) },
        { match: 'org-alpha/Beta-Model', handler: () => okJson({ cardData: {}, downloads: 2000, pipeline_tag: 'text-generation' }) },
      ]);

      request(app)
        .get('/api/discover?source=hf&limit=10')
        .expect(200)
        .expect(function (res) {
          if (!Array.isArray(res.body.models)) throw new Error('Expected models array');
          if (res.body.models.length === 0) throw new Error('Expected at least 1 model');
          if (!res.body.models[0].name) throw new Error('Expected model name');
          if (!res.body.models[0].provider) throw new Error('Expected model provider');
        })
        .end(done);
    });

    it('should return models from OpenRouter', function (done) {
      const app = express();
      app.use(express.json());
      require('../routes/discovery').register(app);

      global.fetch = mockFetch([
        {
          match: 'openrouter.ai/api/v1/models',
          handler: () => okJson({
            data: [
              { id: 'org/Test-Model', name: 'Test Model', pricing: { prompt: '1', completion: '2' }, context_length: 128000, created: 1700000000 },
              { id: 'org/Cheap', name: 'Cheap Model', pricing: { prompt: '0.1', completion: '0.2' }, context_length: 32000, created: 1700000001 },
            ],
          }),
        },
      ]);

      request(app)
        .get('/api/discover?source=openrouter&limit=10')
        .expect(200)
        .expect(function (res) {
          if (!Array.isArray(res.body.models)) throw new Error('Expected models array');
          if (res.body.models.length === 0) throw new Error('Expected at least 1 model');
          if (!res.body.models[0].name) throw new Error('Expected model name');
          if (res.body.source !== 'openrouter') throw new Error('Expected openrouter source');
        })
        .end(done);
    });

    it('should return 500 on HF fetch failure', function (done) {
      const app = express();
      app.use(express.json());
      require('../routes/discovery').register(app);
      global.fetch = mockFetch([]);
      request(app)
        .get('/api/discover?source=hf&limit=10')
        .expect(500)
        .end(done);
    });
  });

  describe('Benchmark routes', function () {
    before(async function () {
      try { await db.createModel({ id: 'ext-bench-model', name: 'Llama 4 Test', provider: 'Meta' }); } catch (e) {/* ok */}
    });
    after(async function () { try { await db.deleteModel('ext-bench-model'); } catch (e) {/* ok */} });

    it('GET /api/refresh should sync curated benchmarks', function (done) {
      const app = express();
      app.use(express.json());
      require('../routes/benchmarks').register(app);
      request(app)
        .get('/api/refresh')
        .expect(200)
        .expect(function (res) {
          if (typeof res.body.refreshed !== 'number') throw new Error('Expected refreshed count');
          if (typeof res.body.message !== 'string') throw new Error('Expected message');
        })
        .end(done);
    });
  });
});
