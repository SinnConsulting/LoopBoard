'use strict';
// The settings page's hand-built block (t-sgrp, rebuilt by t-0e99, src/settingsgrid.ts): the
// Orchestrator block and the Models table. Its read side is `resolveOrchestrator` /
// `resolveTaskDefaults` / `resolveModels`, covered by test/model.test.js; what is tested here is the
// WRITE side: which cell edits become which config patches, and which are refused.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildModelGrid, gridPatch, clampGroomConcurrency, isKnownSlot, isGridField, enabledKey,
  GRID_APPLY_NOTE, GRID_FIELDS, GRID_ROLES,
} = require('../out-test/settingsgrid.js');
const { MAX_GROOM_CONCURRENCY, TASK_DEFAULTS, resolveOrchestrator } = require('../out-test/model.js');
const { APPLIES_RESTART_TAIL } = require('../out-test/settingsform.js');

const models = (over = {}) => ({
  opus: { enabled: true },
  sonnet: { enabled: true },
  fable: { enabled: false },
  haiku: { enabled: true },
  ...over,
});
const orch = (raw = 'opus[1m]') => ({ raw, resolved: resolveOrchestrator((k) => (k === 'orchestrator.model' ? raw : undefined)) });
const grid = (over, defaults = {}) => buildModelGrid(models(over), orch(), { ...TASK_DEFAULTS, ...defaults });
const row = (g, id) => g.rows.find((r) => r.id === id);

test('the Models table lists the four task models, then auto, then none for the reviewer', () => {
  const g = grid();
  assert.deepEqual(g.rows.map((r) => r.id), ['opus', 'sonnet', 'fable', 'haiku', 'auto', 'none']);
  assert.deepEqual(g.rows.map((r) => r.label), ['Opus', 'Sonnet', 'Fable', 'Haiku', 'auto', 'none']);
  assert.deepEqual(g.rows.map((r) => r.toggle), [true, true, true, true, false, false], 'only task models have an on switch');
  assert.deepEqual(g.rows.map((r) => r.enabled), [true, true, false, true, true, true]);
  for (const id of ['opus', 'sonnet', 'fable', 'haiku', 'auto']) assert.deepEqual(row(g, id).roles, GRID_ROLES, id);
  assert.deepEqual(row(g, 'none').roles, ['reviewer'], 'none is a reviewer value only');
});

test('the radios mark the current defaults, one per role', () => {
  const g = grid({}, { groomer: 'auto', worker: 'haiku', reviewer: 'none' });
  assert.deepEqual(g.rows.filter((r) => r.groomer).map((r) => r.id), ['auto']);
  assert.deepEqual(g.rows.filter((r) => r.worker).map((r) => r.id), ['haiku']);
  assert.deepEqual(g.rows.filter((r) => r.reviewer).map((r) => r.id), ['none']);
  assert.deepEqual(g.defaults, { ...TASK_DEFAULTS, groomer: 'auto', worker: 'haiku', reviewer: 'none' });
  assert.deepEqual([...g.taskEfforts], ['auto', 'low', 'medium', 'high', 'xhigh'], 'no max for a per-task effort');
  assert.deepEqual([...g.efforts], ['low', 'medium', 'high', 'xhigh', 'max'], 'the orchestrator session may use max');
});

test('the Orchestrator block shows the RAW --model and what is actually spawned', () => {
  assert.deepEqual(grid().orchestrator, { model: 'opus[1m]', spawned: 'opus[1m]', effort: 'medium', groomConcurrency: 3 });
  // Nothing configured: the field is EMPTY (so it reads as "default"), the row reports the spawn.
  const unset = buildModelGrid(models(), orch(''), TASK_DEFAULTS);
  assert.equal(unset.orchestrator.model, '');
  assert.equal(unset.orchestrator.spawned, 'opus');
  // An invalid stored string is shown as stored but never spawned.
  const bad = buildModelGrid(models(), orch('opus; rm -rf /'), TASK_DEFAULTS);
  assert.equal(bad.orchestrator.model, 'opus; rm -rf /');
  assert.equal(bad.orchestrator.spawned, 'opus');
});

test('the grid states when a change actually lands, in the page wording', () => {
  assert.equal(grid().note, GRID_APPLY_NOTE);
  assert.ok(GRID_APPLY_NOTE.endsWith(APPLIES_RESTART_TAIL), GRID_APPLY_NOTE);
  assert.ok(GRID_APPLY_NOTE.startsWith('orchestrator · models · defaults'), 'the note must name what it covers');
});

test('a model toggle round-trips; anything non-boolean is coerced to false', () => {
  const free = grid({}, { groomer: 'auto', worker: 'auto', reviewer: 'none' });
  assert.deepEqual(gridPatch(free, 'opus', 'enabled', false), { ok: true, patches: [{ key: 'loopBoard.models.opus.enabled', value: false }] });
  assert.deepEqual(gridPatch(free, 'fable', 'enabled', true), { ok: true, patches: [{ key: 'loopBoard.models.fable.enabled', value: true }] });
  assert.deepEqual(gridPatch(free, 'haiku', 'enabled', 'yes'), { ok: true, patches: [{ key: 'loopBoard.models.haiku.enabled', value: false }] });
  assert.equal(gridPatch(free, 'auto', 'enabled', false).ok, false, 'auto has no on switch');
  assert.equal(gridPatch(free, 'none', 'enabled', false).ok, false, 'none has no on switch');
});

test('disabling a model that is a current default groomer, worker or reviewer is REFUSED', () => {
  // Decided (t-sgrp, kept by t-0e99): a disabled model is hidden from the board's selects and never
  // offered to `auto`, so a disabled default would send work to a model the user can no longer see;
  // silently moving the default elsewhere would change which model runs the work without asking.
  const g = grid({}, { groomer: 'opus', worker: 'sonnet', reviewer: 'haiku' });
  for (const [model, role] of [['opus', 'groomer'], ['sonnet', 'worker'], ['haiku', 'reviewer']]) {
    const r = gridPatch(g, model, 'enabled', false);
    assert.equal(r.ok, false, model);
    assert.match(r.reason, new RegExp(`default ${role}`), model);
  }
  // Re-ENABLING is never refused, whatever the model's role.
  assert.equal(gridPatch(g, 'sonnet', 'enabled', true).ok, true);
});

test('the three radios are single-choice writes to the three default-model keys', () => {
  const g = grid();
  assert.deepEqual(gridPatch(g, 'opus', 'worker', true), { ok: true, patches: [{ key: 'loopBoard.defaultWorkerModel', value: 'opus' }] });
  assert.deepEqual(gridPatch(g, 'haiku', 'groomer', true), { ok: true, patches: [{ key: 'loopBoard.defaultGroomerModel', value: 'haiku' }] });
  assert.deepEqual(gridPatch(g, 'auto', 'reviewer', true), { ok: true, patches: [{ key: 'loopBoard.defaultReviewerModel', value: 'auto' }] });
  assert.deepEqual(gridPatch(g, 'none', 'reviewer', true), { ok: true, patches: [{ key: 'loopBoard.defaultReviewerModel', value: 'none' }] });
  assert.deepEqual(gridPatch(g, 'auto', 'worker', true), { ok: true, patches: [{ key: 'loopBoard.defaultWorkerModel', value: 'auto' }] });
});

test('none is refused as a default groomer or worker; an OFF model cannot become any default', () => {
  const g = grid();
  assert.equal(gridPatch(g, 'none', 'groomer', true).ok, false);
  assert.equal(gridPatch(g, 'none', 'worker', true).ok, false);
  for (const role of GRID_ROLES) {
    const r = gridPatch(g, 'fable', role, true);
    assert.equal(r.ok, false, role);
    assert.match(r.reason, /Fable is off/);
  }
});

test('the default-effort selects write the two effort keys, never max', () => {
  const g = grid();
  assert.deepEqual(gridPatch(g, 'defaults', 'groomerEffort', 'xhigh'), { ok: true, patches: [{ key: 'loopBoard.defaultGroomerEffort', value: 'xhigh' }] });
  assert.deepEqual(gridPatch(g, 'defaults', 'workerEffort', 'auto'), { ok: true, patches: [{ key: 'loopBoard.defaultWorkerEffort', value: 'auto' }] });
  const max = gridPatch(g, 'defaults', 'workerEffort', 'max');
  assert.equal(max.ok, false);
  assert.match(max.reason, /auto, low, medium, high, xhigh/);
  assert.equal(gridPatch(g, 'defaults', 'enabled', true).ok, false);
});

test('an invalid orchestrator --model is refused with the reason shown, a valid one writes through', () => {
  assert.deepEqual(gridPatch(grid(), 'orchestrator', 'model', 'sonnet[1m]'), { ok: true, patches: [{ key: 'loopBoard.orchestrator.model', value: 'sonnet[1m]' }] });
  const bad = gridPatch(grid(), 'orchestrator', 'model', 'sonnet; rm -rf /');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /not a valid --model string/);
  // A space alone is enough to fail the allowlist: nothing unvalidated ever reaches the shell line.
  assert.equal(gridPatch(grid(), 'orchestrator', 'model', 'claude 5').ok, false);
});

test('an empty orchestrator --model RESETS the key rather than being rejected', () => {
  assert.deepEqual(gridPatch(grid(), 'orchestrator', 'model', '   '), { ok: true, patches: [{ key: 'loopBoard.orchestrator.model', value: undefined }] });
});

test('the orchestrator effort is checked against the session effort levels, max included', () => {
  assert.deepEqual(gridPatch(grid(), 'orchestrator', 'effort', 'max'), { ok: true, patches: [{ key: 'loopBoard.orchestrator.effort', value: 'max' }] });
  const bad = gridPatch(grid(), 'orchestrator', 'effort', 'ludicrous');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /low, medium, high, xhigh, max/);
});

test('groomConcurrency is CLAMPED to its minimum of 1, not refused', () => {
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
});

test('an unknown row or field is refused: the webview is never trusted', () => {
  assert.equal(gridPatch(grid(), 'gpt', 'enabled', true).ok, false);
  assert.equal(gridPatch(grid(), 'opus', 'nonsense', true).ok, false);
  assert.equal(gridPatch(grid(), 'opus', 'model', 'opus').ok, false, 'a task model has no --model cell');
  assert.equal(gridPatch(grid(), 'orchestrator', 'worker', true).ok, false);
  for (const id of ['opus', 'sonnet', 'fable', 'haiku', 'auto', 'none', 'orchestrator', 'defaults']) assert.equal(isKnownSlot(id), true, id);
  assert.equal(isKnownSlot('gpt'), false);
  assert.equal(isKnownSlot(7), false);
  assert.equal(isGridField('model'), true);
  assert.equal(isGridField('__proto__'), false);
});

test('the editable attributes are exactly the grid fields', () => {
  assert.deepEqual(GRID_FIELDS, ['enabled', 'groomer', 'worker', 'reviewer', 'model', 'effort', 'groomConcurrency', 'groomerEffort', 'workerEffort']);
});

test('enabledKey builds the flattened manifest key', () => {
  assert.equal(enabledKey('haiku'), 'loopBoard.models.haiku.enabled');
});
