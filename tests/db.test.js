const assert = require('chai').assert;
const db = require('../db');

describe('db.js', function () {
  before(function () {
    db.migrateFromJson();
  });

  after(function () {
    try { db.deleteModel('test-model-1'); } catch (e) { /* skip */ }
    try { db.deleteModel('test-model-2'); } catch (e) { /* skip */ }
  });

  describe('getAllModels()', function () {
    it('should return an array', function () {
      const models = db.getAllModels();
      assert.isArray(models);
    });

    it('should return models with required fields', function () {
      const models = db.getAllModels();
      if (models.length > 0) {
        const m = models[0];
        assert.property(m, 'id');
        assert.property(m, 'name');
        assert.property(m, 'provider');
      }
    });
  });

  describe('getModel()', function () {
    it('should return null for non-existent model', function () {
      const m = db.getModel('non-existent-id');
      assert.isNull(m);
    });

    it('should return a model object for valid id', function () {
      const models = db.getAllModels();
      if (models.length > 0) {
        const m = db.getModel(models[0].id);
        assert.isNotNull(m);
        assert.equal(m.id, models[0].id);
      }
    });
  });

  describe('createModel()', function () {
    it('should create a model and return it', function () {
      const m = db.createModel({ id: 'test-model-1', name: 'Test Model', provider: 'TestProvider' });
      assert.isNotNull(m);
      assert.equal(m.id, 'test-model-1');
      assert.equal(m.name, 'Test Model');
    });

    it('should set default values for missing fields', function () {
      const m = db.getModel('test-model-1');
      assert.equal(m.color, '#6b7280');
      assert.equal(m.architecture, 'Transformer');
    });
  });

  describe('updateModel()', function () {
    it('should update model fields', function () {
      const m = db.getModel('test-model-1');
      m.name = 'Updated Test Model';
      m.inputPrice = 5.0;
      const updated = db.updateModel(m);
      assert.equal(updated.name, 'Updated Test Model');
      assert.equal(updated.inputPrice, 5.0);
    });
  });

  describe('snapshotAllModels()', function () {
    it('should snapshot all models and return count', function () {
      const count = db.snapshotAllModels('test');
      assert.isAtLeast(count, 1);
    });
  });

  describe('Settings', function () {
    it('should set and get settings', function () {
      db.setSetting('test_key', 'test_value');
      assert.equal(db.getSetting('test_key'), 'test_value');
    });

    it('should return all settings', function () {
      const all = db.getAllSettings();
      assert.property(all, 'test_key');
    });
  });

  describe('Usage logging', function () {
    it('should log and retrieve usage stats', function () {
      db.logUsage({ modelId: 'test-model-1', modelName: 'Test Model', slug: 'test/model', promptTokens: 100, completionTokens: 50, totalTokens: 150, cost: 0.002, latencyMs: 500, finishReason: 'stop' });
      const stats = db.getUsageStats(7);
      assert.isObject(stats);
      assert.isArray(stats.byModel);
    });
  });

  describe('Chat history', function () {
    it('should add and retrieve chat entries', function () {
      db.addChatEntry('user', 'Hello');
      db.addChatEntry('bot', 'Hi there');
      const history = db.getChatHistory();
      assert.isAtLeast(history.length, 2);
    });
  });
});