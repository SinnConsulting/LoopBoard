'use strict';
// Configurable models: built-in slots, per-slot enable + validated --model override (t-c1a7).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILTIN_MODEL_IDS,
  isValidModelString,
  resolveModels,
  enabledModels,
  resolveModelString,
  readModelsConfig,
  EFFORT_LEVELS,
  isValidEffort,
} = require('../out-test/model.js');

test('the built-in model slots are exactly opus/sonnet/fable', () => {
  assert.deepEqual(BUILTIN_MODEL_IDS, ['opus', 'sonnet', 'fable']);
});

test('isValidModelString admits the [1m] suffix and org aliases, rejects shell metachars', () => {
  assert.ok(isValidModelString('opus'));
  assert.ok(isValidModelString('opus[1m]'));
  assert.ok(isValidModelString('claude-opus-4-8'));
  assert.ok(isValidModelString('my.org_alias-1'));
  assert.ok(!isValidModelString('opus; rm -rf'));
  assert.ok(!isValidModelString('opus $(x)'));
  assert.ok(!isValidModelString(''));
});

test('resolveModels defaults: every slot enabled, --model equals its id, effort defaults to high', () => {
  const r = resolveModels(undefined);
  assert.equal(r.length, 3);
  for (const m of r) {
    assert.equal(m.enabled, true);
    assert.equal(m.model, m.id);
    assert.equal(m.effort, 'high');
  }
});

test('EFFORT_LEVELS / isValidEffort: the five ordered stops, rejects garbage', () => {
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']);
  for (const e of EFFORT_LEVELS) assert.ok(isValidEffort(e), `${e} valid`);
  assert.ok(!isValidEffort('HIGH'), 'case-sensitive');
  assert.ok(!isValidEffort('extreme'));
  assert.ok(!isValidEffort(''));
});

test('a valid per-slot effort REPLACES the default; invalid falls back to high', () => {
  const r = resolveModels({ opus: { effort: 'xhigh' }, sonnet: { effort: 'extreme' } });
  assert.equal(r.find((m) => m.id === 'opus').effort, 'xhigh');
  assert.equal(r.find((m) => m.id === 'sonnet').effort, 'high'); // invalid -> default
});

test('string-shorthand model config still resolves effort to the default (no effort field to set)', () => {
  const r = resolveModels({ sonnet: 'sonnet[1m]' });
  assert.equal(r.find((m) => m.id === 'sonnet').effort, 'high');
});

test('a valid override REPLACES the default --model string; invalid is ignored', () => {
  const r = resolveModels({ opus: { model: 'opus[1m]' }, sonnet: { model: 'bad;rm' } });
  assert.equal(r.find((m) => m.id === 'opus').model, 'opus[1m]');
  assert.equal(r.find((m) => m.id === 'sonnet').model, 'sonnet'); // invalid -> default
});

test('string shorthand sets the --model override (e.g. "sonnet": "sonnet[1m]")', () => {
  const r = resolveModels({ sonnet: 'sonnet[1m]', opus: 'bad;rm' });
  assert.equal(r.find((m) => m.id === 'sonnet').model, 'sonnet[1m]');
  assert.equal(r.find((m) => m.id === 'sonnet').enabled, true);
  assert.equal(r.find((m) => m.id === 'opus').model, 'opus'); // invalid shorthand -> default
});

test('enabled: false drops a slot from enabledModels', () => {
  const en = enabledModels({ fable: { enabled: false } });
  assert.deepEqual(en.map((m) => m.id), ['opus', 'sonnet']);
});

test('resolveModelString returns the override or the built-in default', () => {
  assert.equal(resolveModelString('fable', undefined), 'fable');
  assert.equal(resolveModelString('opus', { opus: { model: 'opus[1m]' } }), 'opus[1m]');
});

test('readModelsConfig maps flat per-slot enabled/model keys into a ModelsConfig for resolveModels', () => {
  const store = {
    'models.opus.enabled': true,
    'models.opus.model': 'opus[1m]',
    'models.opus.effort': 'xhigh',
    'models.sonnet.enabled': false,
    'models.sonnet.model': '',
  };
  const get = (k, d) => (k in store ? store[k] : d);
  const cfg = readModelsConfig(get);
  assert.equal(cfg.opus.model, 'opus[1m]');
  assert.equal(cfg.opus.enabled, true);
  assert.equal(cfg.opus.effort, 'xhigh');
  assert.equal(cfg.sonnet.enabled, false);
  // Unset slots fall back to the passed defaults (enabled true, empty override, high effort).
  assert.equal(cfg.fable.enabled, true);
  assert.equal(cfg.fable.model, '');
  assert.equal(cfg.fable.effort, 'high');
  // Flows straight through resolveModels: override applied, disabled slot dropped from enabled set.
  const r = resolveModels(cfg);
  assert.equal(r.find((m) => m.id === 'opus').model, 'opus[1m]');
  assert.equal(r.find((m) => m.id === 'sonnet').enabled, false);
  assert.deepEqual(enabledModels(cfg).map((m) => m.id), ['opus', 'fable']);
});
