'use strict';
// The settings page's hand-built block (t-sgrp, rebuilt by t-0e99, src/settingsgrid.ts): the Roles
// table (orchestrator, groomer, worker, reviewer: model and effort selects) and the Models table (on
// switch, model id, effort floor and ceiling). Its read side is `resolveOrchestrator` /
// `resolveTaskDefaults` / `resolveModels`, covered by test/model.test.js; what is tested here is the
// WRITE side: which cell edits become which config patches, and which are refused.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildModelGrid, gridPatch, clampGroomConcurrency, isKnownSlot, isGridField, enabledKey, modelKey,
  GRID_APPLY_NOTE, GRID_FIELDS, GRID_ROLES,
} = require('../out-test/settingsgrid.js');
const { MAX_GROOM_CONCURRENCY, TASK_DEFAULTS, ORCHESTRATOR_DEFAULTS } = require('../out-test/model.js');
const { APPLIES_RESTART_TAIL } = require('../out-test/settingsform.js');

const models = (over = {}) => ({
  opus: { enabled: true },
  sonnet: { enabled: true },
  fable: { enabled: false },
  haiku: { enabled: true },
  ...over,
});
const grid = (over, defaults = {}, orchestrator = {}) =>
  buildModelGrid(models(over), { ...ORCHESTRATOR_DEFAULTS, ...orchestrator }, { ...TASK_DEFAULTS, ...defaults });
const role = (g, id) => g.roles.find((r) => r.id === id);
const model = (g, id) => g.models.find((m) => m.id === id);

test('the Roles table: orchestrator, groomer, worker, reviewer, each a model select over the enabled models', () => {
  const g = grid();
  assert.deepEqual(g.roles.map((r) => r.id), GRID_ROLES);
  assert.deepEqual(GRID_ROLES, ['orchestrator', 'groomer', 'worker', 'reviewer']);
  assert.deepEqual(g.roles.map((r) => r.label), ['Orchestrator', 'Groomer', 'Worker', 'Reviewer']);
  assert.deepEqual(g.roles.map((r) => r.model), ['opus', 'opus', 'opus', 'opus'], 'the shipped role defaults (owner decision 2026-10-14)');
  for (const id of ['orchestrator', 'groomer', 'worker']) assert.deepEqual(role(g, id).models, ['opus', 'sonnet', 'haiku'], id + ': Fable is off');
  assert.deepEqual(role(g, 'reviewer').models, ['opus', 'sonnet', 'haiku', 'none'], 'none is a reviewer value only');
  assert.deepEqual(g.roles.map((r) => r.effort), ['low', 'medium', 'medium', 'medium'], 'the reviewer has its own effort (t-403e)');
  assert.equal(role(g, 'orchestrator').groomConcurrency, 3);
  assert.equal(role(g, 'groomer').groomConcurrency, undefined);
  assert.deepEqual([...g.efforts], ['low', 'medium', 'high', 'xhigh', 'max'], 'every role effort may be max');
  for (const r of g.roles) assert.ok(!r.models.includes('auto'), 'no auto option (owner decision 2026-10-14)');
});

test('a role still on a model that is off keeps it as an option, so the select shows the truth', () => {
  const g = grid({}, { worker: 'fable' });
  assert.deepEqual(role(g, 'worker').models, ['opus', 'sonnet', 'haiku', 'fable']);
});

test('the Models table: the four models with on switch, model id and effort floor/ceiling, and which roles use each', () => {
  const g = grid({ opus: { enabled: true, modelId: 'claude-opus-5-5[1m]', minEffort: 'medium', maxEffort: 'xhigh' } });
  assert.deepEqual(g.models.map((m) => m.id), ['opus', 'sonnet', 'fable', 'haiku']);
  assert.deepEqual(g.models.map((m) => m.enabled), [true, true, false, true]);
  assert.deepEqual([model(g, 'opus').modelId, model(g, 'opus').minEffort, model(g, 'opus').maxEffort], ['claude-opus-5-5[1m]', 'medium', 'xhigh']);
  assert.deepEqual([model(g, 'sonnet').modelId, model(g, 'sonnet').minEffort, model(g, 'sonnet').maxEffort], ['', 'low', 'max']);
  assert.deepEqual(model(g, 'opus').usedBy, ['orchestrator', 'groomer', 'worker', 'reviewer']);
  assert.deepEqual(model(g, 'haiku').usedBy, []);
  assert.deepEqual(model(g, 'sonnet').usedBy, []);
});

test('the grid states when a change actually lands, in the page wording', () => {
  assert.equal(grid().note, GRID_APPLY_NOTE);
  assert.ok(GRID_APPLY_NOTE.endsWith(APPLIES_RESTART_TAIL), GRID_APPLY_NOTE);
  assert.ok(GRID_APPLY_NOTE.startsWith('orchestrator · models · defaults'), 'the note must name what it covers');
});

test('the role model selects write the four model keys; none only for the reviewer; an OFF model is refused', () => {
  const g = grid();
  assert.deepEqual(gridPatch(g, 'orchestrator', 'model', 'opus'), { ok: true, patches: [{ key: 'loopBoard.orchestrator.model', value: 'opus' }] });
  assert.deepEqual(gridPatch(g, 'groomer', 'model', 'haiku'), { ok: true, patches: [{ key: 'loopBoard.defaultGroomerModel', value: 'haiku' }] });
  assert.deepEqual(gridPatch(g, 'worker', 'model', 'sonnet'), { ok: true, patches: [{ key: 'loopBoard.defaultWorkerModel', value: 'sonnet' }] });
  assert.deepEqual(gridPatch(g, 'reviewer', 'model', 'none'), { ok: true, patches: [{ key: 'loopBoard.defaultReviewerModel', value: 'none' }] });
  assert.deepEqual(gridPatch(g, 'reviewer', 'model', 'opus'), { ok: true, patches: [{ key: 'loopBoard.defaultReviewerModel', value: 'opus' }] });
  for (const r of ['orchestrator', 'groomer', 'worker']) {
    assert.equal(gridPatch(g, r, 'model', 'none').ok, false, r + ': none');
    assert.equal(gridPatch(g, r, 'model', 'auto').ok, false, r + ': auto');
    assert.equal(gridPatch(g, r, 'model', 'opus[1m]').ok, false, r + ': a free string is no model');
  }
  for (const r of GRID_ROLES) {
    const off = gridPatch(g, r, 'model', 'fable');
    assert.equal(off.ok, false, r);
    assert.match(off.reason, /Fable is off/);
  }
});

test('the role effort selects write the four effort keys, max included; the reviewer its own (t-403e)', () => {
  const g = grid();
  assert.deepEqual(gridPatch(g, 'orchestrator', 'effort', 'max'), { ok: true, patches: [{ key: 'loopBoard.orchestrator.effort', value: 'max' }] });
  assert.deepEqual(gridPatch(g, 'groomer', 'effort', 'xhigh'), { ok: true, patches: [{ key: 'loopBoard.defaultGroomerEffort', value: 'xhigh' }] });
  assert.deepEqual(gridPatch(g, 'worker', 'effort', 'max'), { ok: true, patches: [{ key: 'loopBoard.defaultWorkerEffort', value: 'max' }] });
  for (const bad of ['auto', 'ludicrous']) {
    const r = gridPatch(g, 'worker', 'effort', bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.reason, /low, medium, high, xhigh, max/);
  }
  assert.deepEqual(gridPatch(g, 'reviewer', 'effort', 'high'), { ok: true, patches: [{ key: 'loopBoard.defaultReviewerEffort', value: 'high' }] });
  assert.equal(role(grid(undefined, { reviewerEffort: 'xhigh' }), 'reviewer').effort, 'xhigh');
});

test('switching off a model that a role uses is REFUSED, the orchestrator included', () => {
  // Decided (t-sgrp, kept by t-0e99): a disabled model is hidden from the board's selects and the
  // bootstrap prompt, so a disabled default would send work to a model the user can no longer see;
  // silently moving the default elsewhere would change which model runs the work without asking.
  const g = grid({}, { groomer: 'opus', worker: 'sonnet', reviewer: 'opus' }, { model: 'haiku' });
  for (const [m, r] of [['opus', 'groomer'], ['sonnet', 'worker'], ['haiku', 'orchestrator']]) {
    const res = gridPatch(g, m, 'enabled', false);
    assert.equal(res.ok, false, m);
    assert.match(res.reason, new RegExp(`the ${r} model`), m);
  }
  assert.equal(gridPatch(g, 'sonnet', 'enabled', true).ok, true, 're-enabling is never refused');
  const free = grid({}, { groomer: 'sonnet', worker: 'sonnet', reviewer: 'none' }, { model: 'sonnet' });
  assert.deepEqual(gridPatch(free, 'opus', 'enabled', false), { ok: true, patches: [{ key: 'loopBoard.models.opus.enabled', value: false }] });
  assert.deepEqual(gridPatch(free, 'haiku', 'enabled', 'yes'), { ok: true, patches: [{ key: 'loopBoard.models.haiku.enabled', value: false }] }, 'non-boolean is false');
});

test('a model id is validated like any spawn value; empty RESETS it to the CLI alias; both retire the legacy key (FB4, FB10)', () => {
  const g = grid();
  assert.deepEqual(gridPatch(g, 'opus', 'modelId', ' claude-opus-5-5[1m] '), { ok: true, patches: [
    { key: 'loopBoard.models.opus.modelId', value: 'claude-opus-5-5[1m]' },
    { key: 'loopBoard.models.opus.model', value: undefined },
  ] });
  assert.deepEqual(gridPatch(g, 'opus', 'modelId', '   '), { ok: true, patches: [
    { key: 'loopBoard.models.opus.modelId', value: undefined },
    { key: 'loopBoard.models.opus.model', value: undefined },
  ] });
  for (const bad of ['opus; rm -rf /', 'claude 5', '$(x)']) {
    const r = gridPatch(g, 'opus', 'modelId', bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.reason, /not a valid model id/);
  }
});

test('the effort floor and ceiling write per model and are refused when they would cross (FB7)', () => {
  const g = grid({ haiku: { enabled: true, minEffort: 'medium', maxEffort: 'high' } });
  assert.deepEqual(gridPatch(g, 'haiku', 'minEffort', 'high'), { ok: true, patches: [{ key: 'loopBoard.models.haiku.minEffort', value: 'high' }] });
  assert.deepEqual(gridPatch(g, 'haiku', 'maxEffort', 'max'), { ok: true, patches: [{ key: 'loopBoard.models.haiku.maxEffort', value: 'max' }] });
  const up = gridPatch(g, 'haiku', 'minEffort', 'xhigh');
  assert.equal(up.ok, false);
  assert.match(up.reason, /cannot be above the highest/);
  assert.equal(gridPatch(g, 'haiku', 'maxEffort', 'low').ok, false);
  assert.equal(gridPatch(g, 'haiku', 'maxEffort', 'auto').ok, false);
});

test('groomConcurrency is CLAMPED to its minimum of 1, not refused, and only on the orchestrator row', () => {
  assert.equal(clampGroomConcurrency(0), 1);
  assert.equal(clampGroomConcurrency(-7), 1);
  assert.equal(clampGroomConcurrency(1), 1);
  assert.equal(clampGroomConcurrency(4), 4);
  assert.equal(clampGroomConcurrency(2.9), 2);
  assert.equal(clampGroomConcurrency(MAX_GROOM_CONCURRENCY + 100), MAX_GROOM_CONCURRENCY);
  assert.equal(clampGroomConcurrency('6'), 6);
  assert.equal(clampGroomConcurrency('lots'), null);
  assert.deepEqual(gridPatch(grid(), 'orchestrator', 'groomConcurrency', 0), { ok: true, patches: [{ key: 'loopBoard.orchestrator.groomConcurrency', value: 1 }] });
  const bad = gridPatch(grid(), 'orchestrator', 'groomConcurrency', 'lots');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /whole number/);
  assert.equal(gridPatch(grid(), 'groomer', 'groomConcurrency', 2).ok, false);
});

test('an unknown row or field is refused: the webview is never trusted', () => {
  assert.equal(gridPatch(grid(), 'gpt', 'enabled', true).ok, false);
  assert.equal(gridPatch(grid(), 'auto', 'enabled', true).ok, false);
  assert.equal(gridPatch(grid(), 'opus', 'nonsense', true).ok, false);
  assert.equal(gridPatch(grid(), 'opus', 'model', 'opus').ok, false, 'a model row has no model cell');
  assert.equal(gridPatch(grid(), 'orchestrator', 'enabled', true).ok, false);
  for (const id of ['opus', 'sonnet', 'fable', 'haiku', 'orchestrator', 'groomer', 'worker', 'reviewer']) assert.equal(isKnownSlot(id), true, id);
  for (const id of ['gpt', 'auto', 'none', 'defaults', 7]) assert.equal(isKnownSlot(id), false, String(id));
  assert.equal(isGridField('model'), true);
  assert.equal(isGridField('__proto__'), false);
});

test('the editable attributes are exactly the grid fields', () => {
  assert.deepEqual(GRID_FIELDS, ['model', 'effort', 'groomConcurrency', 'enabled', 'modelId', 'minEffort', 'maxEffort']);
});

test('enabledKey and modelKey build the flattened manifest keys', () => {
  assert.equal(enabledKey('haiku'), 'loopBoard.models.haiku.enabled');
  assert.equal(modelKey('opus', 'maxEffort'), 'loopBoard.models.opus.maxEffort');
});

// t-0e99 FB10: the owner's user settings still held `"loopBoard.models.sonnet.model":
// "claude-haiku-5-5"`; clearing the Sonnet id deleted only `modelId`, the read-both fallback read the
// legacy string back, and Sonnet subagents kept running on Haiku. Replays the grid's writes against a
// settings map and re-reads it the way the host does.
test('clearing (or setting) a model id sticks even with the legacy per-slot --model string still in user settings', () => {
  const { readModelsConfig, resolveModels, aliasEnv } = require('../out-test/model.js');
  const settings = { 'loopBoard.models.sonnet.model': 'claude-haiku-5-5' };
  const get = (k, d) => (`loopBoard.${k}` in settings ? settings[`loopBoard.${k}`] : d);
  const set = (k) => settings[`loopBoard.${k}`];
  const read = () => resolveModels(readModelsConfig(get, set));
  const sonnet = () => read().find((m) => m.id === 'sonnet').modelId;
  const apply = (r) => { assert.equal(r.ok, true); for (const p of r.patches) { if (p.value === undefined) delete settings[p.key]; else settings[p.key] = p.value; } };
  assert.equal(sonnet(), 'claude-haiku-5-5', 'precondition: the legacy string is read as the id');
  const g = buildModelGrid(readModelsConfig(get, set), ORCHESTRATOR_DEFAULTS, TASK_DEFAULTS);
  assert.equal(g.models.find((m) => m.id === 'sonnet').modelId, 'claude-haiku-5-5', 'the field shows it');
  apply(gridPatch(g, 'sonnet', 'modelId', ''));
  assert.equal(sonnet(), '', 'cleared: the CLI alias applies');
  assert.deepEqual(aliasEnv(read()), {}, 'no env override is sent');
  assert.ok(!('loopBoard.models.sonnet.model' in settings), 'the legacy key is retired');
  settings['loopBoard.models.sonnet.model'] = 'claude-haiku-5-5';
  apply(gridPatch(g, 'sonnet', 'modelId', 'claude-sonnet-5-5[1m]'));
  assert.equal(sonnet(), 'claude-sonnet-5-5[1m]');
  assert.ok(!('loopBoard.models.sonnet.model' in settings), 'setting an id retires the legacy key too');
});
