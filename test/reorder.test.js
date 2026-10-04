'use strict';
// Drag reorder (t-81a0): the pure index move the store runs under its write lock. TODO.md order is
// the loops' pick order (grooming takes New top down, a worker claims the top Backlog task), so
// only New and Backlog reorder, other phases keep their place, and nothing else about the file moves.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTodo, getTasksHeading, getTasksExtras } = require('../out-test/parser.js');
const { serializeTodo, serializeEntry } = require('../out-test/writer.js');
const { moveEntry } = require('../out-test/gates.js');

const FIX = path.join(process.cwd(), 'test', 'fixtures');

function entry(id, phase) {
  return { id, title: 'Task ' + id, phase, checked: false, isDraft: false, questions: [], feedback: [], unknownLines: [], raw: '' };
}
// n = new, b = backlog, i = inprogress, f = feedback, r = review
const PHASE = { n: 'new', b: 'backlog', i: 'inprogress', f: 'feedback', r: 'review' };
function doc(spec) {
  return { preamble: '', entries: spec.split(' ').map((s) => entry(s, PHASE[s[0]])) };
}
const ids = (d) => d.entries.map((e) => e.id).join(' ');

test('moveEntry: a same-phase beforeId puts the entry directly before the anchor; every other entry keeps its order', () => {
  const d = doc('n1 b1 n2 i1 b2 n3 f1 b3');
  assert.equal(moveEntry(d, 'n3', 'new', 'n1'), 'applied');
  assert.equal(ids(d), 'n3 n1 b1 n2 i1 b2 f1 b3');

  const e = doc('b1 n1 b2 i1 b3 r1');
  assert.equal(moveEntry(e, 'b1', 'backlog', 'b3'), 'applied');
  assert.equal(ids(e), 'n1 b2 i1 b1 b3 r1', 'other phases, interleaved between, keep their relative order');
});

test('moveEntry: beforeId null puts the entry directly after the last entry of its phase, even with other phases after it', () => {
  const d = doc('b1 n1 b2 i1 b3 r1 f1');
  assert.equal(moveEntry(d, 'b1', 'backlog', null), 'applied');
  assert.equal(ids(d), 'n1 b2 i1 b3 b1 r1 f1');

  const e = doc('n1 n2 b1 i1');
  assert.equal(moveEntry(e, 'n1', 'new', null), 'applied');
  assert.equal(ids(e), 'n2 n1 b1 i1');
});

test('moveEntry: unsupported for any phase but new/backlog, entries untouched', () => {
  for (const phase of ['inprogress', 'feedback', 'review', 'done', '', 'bogus']) {
    const d = doc('i1 f1 r1 f2 r2 n1 b1');
    const before = d.entries.slice();
    const id = { inprogress: 'i1', feedback: 'f2', review: 'r2' }[phase] || 'n1';
    assert.equal(moveEntry(d, id, phase, null), 'unsupported', phase);
    assert.deepEqual(d.entries, before, phase);
    assert.ok(d.entries.every((e, i) => e === before[i]), phase + ': same objects in the same order');
  }
});

test('moveEntry: conflict when the entry or the anchor has left the rendered phase; notfound for an unknown id; untouched either way', () => {
  const cases = [
    ['b1', 'new', 'n1', 'conflict', 'moved entry is no longer New (a loop changed it on disk)'],
    ['n2', 'new', 'b1', 'conflict', 'anchor is in another phase'],
    ['n2', 'new', 'i1', 'conflict', 'anchor was claimed'],
    ['n2', 'new', 't-gone', 'conflict', 'anchor no longer on disk'],
    ['t-gone', 'new', 'n1', 'notfound', 'unknown id'],
    ['t-gone', 'backlog', null, 'notfound', 'unknown id, end drop'],
  ];
  for (const [id, phase, beforeId, want, why] of cases) {
    const d = doc('n1 b1 n2 i1 b2');
    const before = d.entries.slice();
    assert.equal(moveEntry(d, id, phase, beforeId), want, why);
    assert.ok(d.entries.length === before.length && d.entries.every((e, i) => e === before[i]), why + ': untouched');
  }
});

test('moveEntry: noop when the same-phase position would not change, entries untouched', () => {
  const cases = [
    ['n1', 'new', 'n2', 'already directly before the anchor'],
    ['n1', 'new', 'n1', 'dropped before itself'],
    ['n3', 'new', null, 'already last of its phase, other phases after it'],
    ['n2', 'new', 'n3', 'other-phase entries in between do not count'],
    ['b1', 'backlog', null, 'the only entry of its phase'],
  ];
  for (const [id, phase, beforeId, why] of cases) {
    const d = doc('n1 i1 n2 f1 n3 b1 r1');
    const before = d.entries.slice();
    assert.equal(moveEntry(d, id, phase, beforeId), 'noop', why);
    assert.ok(d.entries.every((e, i) => e === before[i]), why + ': untouched');
  }
});

test('moveEntry + serializeTodo: fixpoint on the HTML-comment fixture; preamble, heading, extras verbatim; entry lines byte-identical, only moved', () => {
  const src = fs.readFileSync(path.join(FIX, 'index-full.md'), 'utf8');
  const d = parseTodo(src);
  const blocksBefore = d.entries.map((e) => serializeEntry(e).join('\n'));
  const order = d.entries.map((e) => e.id);
  assert.deepEqual(order.slice(0, 2), ['t-aa01', 't-aa02'], 'fixture: two New entries on top');

  assert.equal(moveEntry(d, 't-aa02', 'new', 't-aa01'), 'applied');
  const out = serializeTodo(d);
  assert.notEqual(out, src);

  const re = parseTodo(out);
  assert.equal(serializeTodo(re), out, 'parse -> write is a fixpoint after the move');
  assert.equal(re.preamble, parseTodo(src).preamble);
  assert.equal(getTasksHeading(re), getTasksHeading(parseTodo(src)));
  assert.equal(getTasksExtras(re), getTasksExtras(parseTodo(src)));
  assert.match(getTasksExtras(re), /^<!-- Format when a worker parks a task here:/, 'the comment template stays extras, not entries');
  assert.equal(out.slice(0, out.indexOf('## Tasks')), src.slice(0, src.indexOf('## Tasks')), 'preamble bytes identical');
  assert.equal(out.slice(out.indexOf('<!--')), src.slice(src.indexOf('<!--')), 'extras bytes identical');

  assert.deepEqual(re.entries.map((e) => e.id), ['t-aa02', 't-aa01', ...order.slice(2)]);
  const blocksAfter = re.entries.map((e) => serializeEntry(e).join('\n'));
  for (const b of blocksBefore) assert.ok(out.includes(b + '\n'), 'entry lines unchanged:\n' + b);
  assert.deepEqual(blocksAfter.slice().sort(), blocksBefore.slice().sort(), 'same entry blocks, byte for byte');
  assert.deepEqual(blocksAfter, [blocksBefore[1], blocksBefore[0], ...blocksBefore.slice(2)]);
});

test('docs name drag reorder as the fourth human action and index order as the loops\' pick order', () => {
  const read = (f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
  const rule1 = read('media/template-loop.md').match(/^1\. [\s\S]*?(?=^2\. )/m)[0];
  assert.match(rule1, /drag\s+reorder/);
  assert.match(rule1, /fourth\s+human-only/);
  assert.match(rule1, /pick order/);
  assert.match(rule1, /never demote or reorder/);
  const nn5 = read('CLAUDE.md').match(/^5\. [\s\S]*?(?=^## )/m)[0];
  assert.match(nn5, /ONLY four human actions/);
  assert.match(nn5, /pick order; workers never reorder/);
  const readme = read('README.md');
  assert.match(readme, /\*\*Four human actions:\*\* promote, accept, demote, reorder/);
  assert.match(readme, /pick order: they take the top task and never reorder/);
});
