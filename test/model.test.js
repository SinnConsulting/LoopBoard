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
} = require('../out-test/model.js');

test('haiku is a built-in model slot alongside opus/sonnet/fable', () => {
  assert.deepEqual(BUILTIN_MODEL_IDS, ['opus', 'sonnet', 'fable', 'haiku']);
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

test('resolveModels defaults: every slot enabled, --model equals its id', () => {
  const r = resolveModels(undefined);
  assert.equal(r.length, 4);
  for (const m of r) {
    assert.equal(m.enabled, true);
    assert.equal(m.model, m.id);
  }
});

test('a valid override REPLACES the default --model string; invalid is ignored', () => {
  const r = resolveModels({ opus: { model: 'opus[1m]' }, sonnet: { model: 'bad;rm' } });
  assert.equal(r.find((m) => m.id === 'opus').model, 'opus[1m]');
  assert.equal(r.find((m) => m.id === 'sonnet').model, 'sonnet'); // invalid -> default
});

test('string shorthand sets the --model override (e.g. "haiku": "haiku[1m]")', () => {
  const r = resolveModels({ haiku: 'haiku[1m]', opus: 'bad;rm' });
  assert.equal(r.find((m) => m.id === 'haiku').model, 'haiku[1m]');
  assert.equal(r.find((m) => m.id === 'haiku').enabled, true);
  assert.equal(r.find((m) => m.id === 'opus').model, 'opus'); // invalid shorthand -> default
});

test('enabled: false drops a slot from enabledModels', () => {
  const en = enabledModels({ fable: { enabled: false } });
  assert.deepEqual(en.map((m) => m.id), ['opus', 'sonnet', 'haiku']);
});

test('resolveModelString returns the override or the built-in default', () => {
  assert.equal(resolveModelString('haiku', undefined), 'haiku');
  assert.equal(resolveModelString('opus', { opus: { model: 'opus[1m]' } }), 'opus[1m]');
});
