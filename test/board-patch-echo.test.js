'use strict';
// Card-select echo guards (t-bbad). media/board.js is a webview asset the Docker suite never
// loads (tsconfig.test.json compiles src/ pure modules only), so — exactly like
// test/packaging.test.js — these invariants are asserted over the SOURCE TEXT, compiling nothing.
//
// The defect they pin down: a `change` handler that patches through the bare `sendPatch(...)`
// never echoes the picked value into the live `board` object, so (a) the card keeps painting the
// old value until a click-out flushes the deferred refresh, (b) a second pick sends the ORIGINAL
// value as `base` and trips a false same-field conflict, and (c) picking the original value back
// is a no-op that leaves disk on the intermediate value. `commitPatch` (t-ff54) is the echoing
// path; every card select and the two title editors must stay on it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// Code lines only: the file's prose comments mention `sendPatch` (e.g. next to the answer path)
// and must neither fail a guard nor satisfy an allowlist.
const codeLines = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//'));

const board = codeLines(read('media', 'board.js'));
const controller = codeLines(read('src', 'controller.ts'));

test('no change listener in media/board.js patches without the local echo', () => {
  const offenders = board.filter((l) => l.includes("addEventListener('change',") && l.includes('sendPatch('));
  assert.deepEqual(offenders, [], 'a change handler bypasses commitPatch — the card will not repaint on pick');
  // Sanity: the guard is looking at real handlers, not an empty file.
  assert.ok(board.some((l) => l.includes("addEventListener('change',")), 'expected change listeners in media/board.js');
});

test('the two title editors patch through the local echo', () => {
  assert.deepEqual(board.filter((l) => l.includes("sendPatch(t.id, 'title'")), []);
  const echoed = board.filter((l) => l.includes("commitPatch(t.id, 'title'"));
  assert.equal(echoed.length, 2, 'draft commitDraft and card commitTitle each commit via commitPatch');
});

test('sendPatch is only called from allowlisted, deliberately un-echoed sites', () => {
  // A new un-echoed patch site must be a deliberate line added here, never an accident. This
  // closes the loophole the first test leaves (a handler body spanning several lines, or one
  // registered through a helper rather than a literal addEventListener('change', …)).
  const allowed = [
    'function sendPatch(', // the definition
    'sendPatch(taskId, field, value, base, questionIndex);', // the single call inside commitPatch
    'renderFieldAttachmentsArea(t.feedback,', // Review-feedback attachment × callback (out of t-bbad scope)
  ];
  const offenders = board.filter((l) => l.includes('sendPatch(') && !allowed.some((a) => l.includes(a)));
  assert.deepEqual(offenders, []);
});

test('the same-field conflict toast is tagged on both sides', () => {
  // Renaming the discriminator on one side would silently disable the force-flush that snaps a
  // wrongly echoed select back to the on-disk value.
  const tag = "'sameFieldConflict'";
  assert.ok(controller.some((l) => l.includes(tag)), 'src/controller.ts must post the kind');
  assert.ok(board.some((l) => l.includes(tag)), 'media/board.js must react to the kind');
});
