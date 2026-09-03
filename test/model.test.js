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
  sanitizeGroomConcurrency,
  EFFORT_LEVELS,
  isValidEffort,
  AFTER_TASK_MODES,
  resolveAfterTask,
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

// ---- grooming concurrency cap (t-23ce) ----

test('resolveModels defaults groomConcurrency to 3 on every slot', () => {
  for (const m of resolveModels()) assert.equal(m.groomConcurrency, 3);
});

test('a valid per-slot groomConcurrency REPLACES the default; invalid falls back to 3', () => {
  const r = resolveModels({
    opus: { groomConcurrency: 6 },
    sonnet: { groomConcurrency: 0 },     // below the minimum
    fable: { groomConcurrency: 2.5 },    // not an integer
  });
  assert.equal(r.find((m) => m.id === 'opus').groomConcurrency, 6);
  assert.equal(r.find((m) => m.id === 'sonnet').groomConcurrency, 3);
  assert.equal(r.find((m) => m.id === 'fable').groomConcurrency, 3);
});

test('sanitizeGroomConcurrency rejects everything that is not a plain in-range integer', () => {
  assert.equal(sanitizeGroomConcurrency(1), 1);
  assert.equal(sanitizeGroomConcurrency(99), 99);
  // No `0 = unlimited` sentinel: unbounded fan-out is the defect the cap removes.
  for (const bad of [0, -1, 1.5, 100, NaN, Infinity, '3', null, undefined, {}]) {
    assert.equal(sanitizeGroomConcurrency(bad), 3, `expected ${JSON.stringify(bad)} -> 3`);
  }
});

test('readModelsConfig reads the per-slot groomConcurrency key', () => {
  const settings = { 'models.opus.groomConcurrency': 7 };
  const cfg = readModelsConfig((k, d) => (k in settings ? settings[k] : d));
  assert.equal(cfg.opus.groomConcurrency, 7);
  assert.equal(cfg.sonnet.groomConcurrency, 3, 'unset slots take the default');
});

// ---- afterTask: one 3-state mode replacing the recycle boolean pair (t-1f1e) ----

test('the after-task modes are exactly none/clear/recycle', () => {
  assert.deepEqual(AFTER_TASK_MODES, ['none', 'clear', 'recycle']);
});

test('an explicitly set afterTask always wins over the deprecated booleans', () => {
  assert.equal(resolveAfterTask('none', true, true), 'none');
  assert.equal(resolveAfterTask('clear', true, false), 'clear');
  assert.equal(resolveAfterTask('recycle', false, false), 'recycle');
});

test('with afterTask unset the legacy booleans map losslessly', () => {
  assert.equal(resolveAfterTask(undefined, false, false), 'none');
  assert.equal(resolveAfterTask(undefined, false, true), 'clear');
  assert.equal(resolveAfterTask(undefined, true, false), 'recycle');
  // autoRecycle already suppressed clearSessionAfterTask at the only call site, so the combination
  // has always meant "recycle" — the merge loses nothing.
  assert.equal(resolveAfterTask(undefined, true, true), 'recycle');
});

test('an unrecognized afterTask value falls back rather than disabling the feature', () => {
  assert.equal(resolveAfterTask('RECYCLE', true, false), 'recycle');
  assert.equal(resolveAfterTask('', false, true), 'clear');
  assert.equal(resolveAfterTask('nonsense', false, false), 'none');
});

test('afterTask defaults to none with no config at all', () => {
  assert.equal(resolveAfterTask(undefined), 'none');
});
