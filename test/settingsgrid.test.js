'use strict';
// The model grid's own logic (t-sgrp, src/settingsgrid.ts) — the one hand-built block on the
// settings page. Its read side is `resolveModels`, already covered by test/model.test.js; what is
// new here is the WRITE side: which cell edits become which config patches, and which are refused.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildModelGrid, gridPatch, clampGroomConcurrency, isKnownSlot, isGridField, slotKey,
  GRID_APPLY_NOTE, GRID_FIELDS,
} = require('../out-test/settingsgrid.js');
const { MAX_GROOM_CONCURRENCY } = require('../out-test/model.js');
const { APPLIES_RESTART_TAIL } = require('../out-test/settingsform.js');

const cfg = (over = {}) => ({
  opus: { enabled: true, model: 'opus[1m]', effort: 'high', groomConcurrency: 3 },
  sonnet: { enabled: true, model: '', effort: 'high', groomConcurrency: 3 },
  fable: { enabled: false, model: '', effort: 'medium', groomConcurrency: 2 },
  ...over,
});
const grid = (over, worker = 'sonnet', groomer = 'opus') => buildModelGrid(cfg(over), worker, groomer);

test('the grid is the resolved 3 x 6 matrix, in BUILTIN_MODELS order', () => {
  const g = grid();
  assert.deepEqual(g.rows.map((r) => r.id), ['opus', 'sonnet', 'fable']);
  assert.deepEqual(g.rows.map((r) => r.label), ['Opus', 'Sonnet', 'Fable']);
  assert.deepEqual(g.rows.map((r) => r.enabled), [true, true, false]);
  assert.deepEqual(g.rows.map((r) => r.worker), [false, true, false]);
  assert.deepEqual(g.rows.map((r) => r.groomer), [true, false, false]);
  assert.deepEqual(g.rows.map((r) => r.effort), ['high', 'high', 'medium']);
  assert.deepEqual(g.rows.map((r) => r.groomConcurrency), [3, 3, 2]);
  assert.equal(g.defaultWorker, 'sonnet');
  assert.equal(g.defaultGroomer, 'opus');
});

test('the --model cell shows the RAW override, and the row shows what is actually spawned', () => {
  const g = grid();
  // Opus has an override: the field shows it and the slot spawns it.
  assert.equal(g.rows[0].model, 'opus[1m]');
  assert.equal(g.rows[0].spawned, 'opus[1m]');
  // Sonnet has none: the field is EMPTY (so it can read as "default" and be cleared back to it),
  // while the row still reports the built-in string the loop would be started with.
  assert.equal(g.rows[1].model, '');
  assert.equal(g.rows[1].spawned, 'sonnet');
});

test('an invalid stored --model string is rejected exactly the way resolveModels rejects it', () => {
  const g = grid({ opus: { enabled: true, model: 'opus; rm -rf /', effort: 'high', groomConcurrency: 3 } });
  assert.equal(g.rows[0].model, 'opus; rm -rf /', 'the field still shows what is stored');
  assert.equal(g.rows[0].spawned, 'opus', 'but the built-in default is what would reach the shell line');
});

test('the grid states when a change actually lands', () => {
  // model/effort/groomers are frozen into the spawn command, so the surface must say so instead of
  // implying the change is live.
  assert.equal(grid().note, GRID_APPLY_NOTE);
  // And it says it in the page's ONE wording (src/settingsform.ts), so the grid and a marked row
  // cannot state the same fact in two voices.
  assert.ok(GRID_APPLY_NOTE.endsWith(APPLIES_RESTART_TAIL), GRID_APPLY_NOTE);
  assert.ok(GRID_APPLY_NOTE.startsWith('model · effort · groomers'), 'the note must name the columns it covers');
});

test('a slot toggle round-trips', () => {
  const off = gridPatch(grid(), 'opus', 'enabled', false);
  // Opus is the default GROOMER in the fixture, so turning it off is refused — use a free slot.
  assert.equal(off.ok, false);
  const free = grid({}, 'sonnet', 'sonnet');
  assert.deepEqual(
    gridPatch(free, 'opus', 'enabled', false),
    { ok: true, patches: [{ key: 'loopBoard.models.opus.enabled', value: false }] }
  );
  assert.deepEqual(
    gridPatch(free, 'fable', 'enabled', true),
    { ok: true, patches: [{ key: 'loopBoard.models.fable.enabled', value: true }] }
  );
  // Anything non-boolean from the webview is coerced to `false`, never written through raw.
  assert.deepEqual(
    gridPatch(free, 'fable', 'enabled', 'yes'),
    { ok: true, patches: [{ key: 'loopBoard.models.fable.enabled', value: false }] }
  );
});

test('disabling the slot that is the default worker or groomer is REFUSED, not auto-reassigned', () => {
  // The decided case. A disabled slot is hidden from the Loops overview and the board's model
  // selects, so a disabled default would route every unlabelled task to a slot the user can no
  // longer see or start; silently moving the default elsewhere would change which model runs the
  // work without asking. The radio column is in the same row, so the fix is one click.
  const worker = gridPatch(grid({}, 'sonnet', 'opus'), 'sonnet', 'enabled', false);
  assert.equal(worker.ok, false);
  assert.match(worker.reason, /default worker/);

  const groomer = gridPatch(grid({}, 'sonnet', 'opus'), 'opus', 'enabled', false);
  assert.equal(groomer.ok, false);
  assert.match(groomer.reason, /default groomer/);

  // Re-ENABLING is never refused, whatever the slot's role.
  assert.equal(gridPatch(grid({}, 'sonnet', 'opus'), 'sonnet', 'enabled', true).ok, true);
});

test('the worker/groomer radios are single-choice writes to the two default keys', () => {
  assert.deepEqual(
    gridPatch(grid(), 'opus', 'worker', true),
    { ok: true, patches: [{ key: 'loopBoard.defaultWorkerModel', value: 'opus' }] }
  );
  assert.deepEqual(
    gridPatch(grid(), 'sonnet', 'groomer', true),
    { ok: true, patches: [{ key: 'loopBoard.defaultGroomerModel', value: 'sonnet' }] }
  );
});

test('a slot that is OFF cannot be made the default worker or groomer', () => {
  // The same invariant read from the other side, so the pair can never disagree.
  const w = gridPatch(grid(), 'fable', 'worker', true);
  assert.equal(w.ok, false);
  assert.match(w.reason, /Fable is off/);
  const g = gridPatch(grid(), 'fable', 'groomer', true);
  assert.equal(g.ok, false);
  assert.match(g.reason, /default groomer/);
});

test('an invalid --model string is refused with the reason shown, a valid one writes through', () => {
  assert.deepEqual(
    gridPatch(grid(), 'sonnet', 'model', 'sonnet[1m]'),
    { ok: true, patches: [{ key: 'loopBoard.models.sonnet.model', value: 'sonnet[1m]' }] }
  );
  const bad = gridPatch(grid(), 'sonnet', 'model', 'sonnet; rm -rf /');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /not a valid --model string/);
  assert.match(bad.reason, /sonnet/, 'the reason must name what would be spawned instead');
  // A space alone is enough to fail the allowlist — nothing unvalidated ever reaches the shell line.
  assert.equal(gridPatch(grid(), 'sonnet', 'model', 'claude 5').ok, false);
});

test('an empty --model CLEARS the override rather than being rejected', () => {
  assert.deepEqual(
    gridPatch(grid(), 'opus', 'model', '   '),
    { ok: true, patches: [{ key: 'loopBoard.models.opus.model', value: '' }] }
  );
});

test('effort is checked against the declared ceiling levels', () => {
  assert.deepEqual(
    gridPatch(grid(), 'fable', 'effort', 'max'),
    { ok: true, patches: [{ key: 'loopBoard.models.fable.effort', value: 'max' }] }
  );
  const bad = gridPatch(grid(), 'fable', 'effort', 'ludicrous');
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
  assert.deepEqual(
    gridPatch(grid(), 'opus', 'groomConcurrency', 0),
    { ok: true, patches: [{ key: 'loopBoard.models.opus.groomConcurrency', value: 1 }] }
  );
  const bad = gridPatch(grid(), 'opus', 'groomConcurrency', 'lots');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /whole number/);
});

test('an unknown slot or field is refused — the webview is never trusted', () => {
  assert.equal(gridPatch(grid(), 'haiku', 'enabled', true).ok, false);
  assert.equal(gridPatch(grid(), 'opus', 'nonsense', true).ok, false);
  assert.equal(isKnownSlot('opus'), true);
  assert.equal(isKnownSlot('haiku'), false);
  assert.equal(isKnownSlot(7), false);
  assert.equal(isGridField('model'), true);
  assert.equal(isGridField('__proto__'), false);
});

test('the six columns are exactly the six editable attributes', () => {
  assert.deepEqual(GRID_FIELDS, ['enabled', 'worker', 'groomer', 'model', 'effort', 'groomConcurrency']);
});

test('slotKey builds the flattened manifest keys, not a legacy nested object path', () => {
  assert.equal(slotKey('opus', 'groomConcurrency'), 'loopBoard.models.opus.groomConcurrency');
  assert.equal(slotKey('fable', 'enabled'), 'loopBoard.models.fable.enabled');
});

test('the legacy bare-string slot config still renders a row', () => {
  // `"sonnet": "sonnet[1m]"` is an accepted shorthand for the --model override (src/model.ts).
  const g = buildModelGrid({ sonnet: 'sonnet[1m]' }, 'sonnet', 'opus');
  const row = g.rows.find((r) => r.id === 'sonnet');
  assert.equal(row.model, 'sonnet[1m]');
  assert.equal(row.spawned, 'sonnet[1m]');
  assert.equal(row.enabled, true);
});
