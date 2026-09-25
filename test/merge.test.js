'use strict';
// Field-patch routing + apply/conflict semantics for index and detail files.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTodo } = require('../out-test/parser.js');
const { parseTaskFile } = require('../out-test/taskfile.js');
const {
  applyPatch,
  applyDetailPatch,
  patchTarget,
  currentFieldValue,
  normalizeModel,
  normalizeGroomer,
} = require('../out-test/merge.js');

const FIX = path.join(process.cwd(), 'test', 'fixtures');
function readFix(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8');
}

test('patchTarget routes fields to the right file', () => {
  for (const f of ['title', 'model', 'groomer', 'answer', 'answers', 'feedbackAdd', 'feedbackItem']) assert.equal(patchTarget(f), 'index', f);
  for (const f of ['description', 'problem', 'goals']) assert.equal(patchTarget(f), 'detail', f);
});

test('applyPatch applies an index field when no conflict', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, { taskId: 't-aa01', field: 'title', value: 'Renamed', base: 'Add rate limiting middleware to the public REST API' });
  assert.equal(r.status, 'applied');
  assert.equal(doc.entries.find((e) => e.id === 't-aa01').title, 'Renamed');
});

test('applyPatch detects a same-field index conflict (disk changed)', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, { taskId: 't-aa01', field: 'title', value: 'my edit', base: 'STALE BASE' });
  assert.equal(r.status, 'conflict');
});

test('applyPatch answer patch targets the right question', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, { taskId: 't-cc01', field: 'answer', value: 'Dead-letter to a DB table.', base: '', questionIndex: 1 });
  assert.equal(r.status, 'applied');
  assert.equal(doc.entries.find((e) => e.id === 't-cc01').questions[1].answer, 'Dead-letter to a DB table.');
});

test('applyPatch answer patch clears that question\'s suggestions (accept reuses the answer path)', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const before = doc.entries.find((e) => e.id === 't-cc01').questions[1];
  assert.deepEqual(before.suggestions, ['Dead-letter to a DB table.', 'Log and drop.']);
  const r = applyPatch(doc, { taskId: 't-cc01', field: 'answer', value: 'Dead-letter to a DB table. accepted', base: '', questionIndex: 1 });
  assert.equal(r.status, 'applied');
  assert.deepEqual(doc.entries.find((e) => e.id === 't-cc01').questions[1].suggestions, []);
});

test('applyPatch model normalization: default (opus) clears the field', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, { taskId: 't-bb01', field: 'model', value: 'default (opus)', base: 'opus' });
  assert.equal(r.status, 'applied');
  assert.equal(doc.entries.find((e) => e.id === 't-bb01').model, undefined);
});

test('applyPatch on unknown id -> notfound', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, { taskId: 't-zzzz', field: 'title', value: 'x', base: 'y' });
  assert.equal(r.status, 'notfound');
});

test('applyDetailPatch applies description when no conflict', () => {
  const detail = parseTaskFile(readFix('taskfile-full.md'));
  const r = applyDetailPatch(detail, { taskId: 't-cc01', field: 'description', value: 'New body', base: detail.description });
  assert.equal(r.status, 'applied');
  assert.equal(detail.description, 'New body');
});

test('applyDetailPatch detects a same-field detail conflict', () => {
  const detail = parseTaskFile(readFix('taskfile-full.md'));
  const r = applyDetailPatch(detail, { taskId: 't-cc01', field: 'description', value: 'x', base: 'STALE' });
  assert.equal(r.status, 'conflict');
});

test('applyDetailPatch applies problem and goals, and conflicts on a stale base (t-2191)', () => {
  for (const field of ['problem', 'goals']) {
    const detail = parseTaskFile(readFix('taskfile-full.md'));
    const applied = applyDetailPatch(detail, { taskId: 't-cc01', field, value: 'New text', base: detail[field] });
    assert.equal(applied.status, 'applied', field);
    assert.equal(detail[field], 'New text', field);

    const stale = parseTaskFile(readFix('taskfile-full.md'));
    const conflict = applyDetailPatch(stale, { taskId: 't-cc01', field, value: 'x', base: 'STALE' });
    assert.equal(conflict.status, 'conflict', field);
    assert.notEqual(stale[field], 'x', field + ' must be left on the disk value');
  }
});

test('a problem patch touches ONLY problem — description and goals are untouched (t-2191)', () => {
  const detail = parseTaskFile(readFix('taskfile-full.md'));
  const description = detail.description;
  const goals = detail.goals;
  const r = applyDetailPatch(detail, { taskId: 't-cc01', field: 'problem', value: 'Rewritten.', base: detail.problem });
  assert.equal(r.status, 'applied');
  assert.equal(detail.problem, 'Rewritten.');
  assert.equal(detail.description, description);
  assert.equal(detail.goals, goals);
});

test('clearing problem or goals to whitespace drops the section (same trim rule as description)', () => {
  const detail = parseTaskFile(readFix('taskfile-full.md'));
  applyDetailPatch(detail, { taskId: 't-cc01', field: 'goals', value: '   \n  ', base: detail.goals });
  assert.equal(detail.goals, undefined);
});

// ---- per-item feedback patches (t-ae10). The whole-set `note`/`feedback` value patches are gone:
// `feedbackAdd` appends with no base, `feedbackItem` edits/deletes ONE item by index + its own base.
const A = 'Rebase on main before opening the PR.';
const B = 'Add a metric for retry count.';
const fbOf = (doc, id) => doc.entries.find((e) => e.id === id).feedback;

test('the feedback patch kinds route to the index file', () => {
  for (const f of ['feedbackAdd', 'feedbackItem']) assert.equal(patchTarget(f), 'index', f);
});

test('feedbackAdd appends one item at the end, splitting line breaks and dropping empties', () => {
  const doc = parseTodo(readFix('index-full.md'));
  assert.deepEqual(fbOf(doc, 't-bb01'), [A, B]);
  const r = applyPatch(doc, { taskId: 't-bb01', field: 'feedbackAdd', value: 'third', base: '' });
  assert.equal(r.status, 'applied');
  assert.deepEqual(fbOf(doc, 't-bb01'), [A, B, 'third']);
  applyPatch(doc, { taskId: 't-bb01', field: 'feedbackAdd', value: 'x\n\n  \ny\n', base: '' });
  assert.deepEqual(fbOf(doc, 't-bb01'), [A, B, 'third', 'x', 'y']);
});

test('feedbackAdd is a pure append: an item the loop removed meanwhile is no conflict, both changes kept', () => {
  const doc = parseTodo(readFix('index-full.md'));
  fbOf(doc, 't-bb01').splice(0, 1); // the loop addressed and deleted item A on disk
  // The board's deferred refresh still shows [A, B]; the add carries no base that could go stale.
  const r = applyPatch(doc, { taskId: 't-bb01', field: 'feedbackAdd', value: 'new point', base: `${A}\n${B}` });
  assert.equal(r.status, 'applied');
  assert.deepEqual(fbOf(doc, 't-bb01'), [B, 'new point']);
});

test('feedbackAdd also works on a drafted/New entry with no feedback yet', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, { taskId: 't-aa02', field: 'feedbackAdd', value: 'fold this in', base: '' });
  assert.equal(r.status, 'applied');
  assert.deepEqual(fbOf(doc, 't-aa02'), ['fold this in']);
});

test('feedbackItem edit replaces only its target line, resolved by index + its own base', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, { taskId: 't-bb01', field: 'feedbackItem', value: 'B edited', base: B, itemIndex: 1 });
  assert.equal(r.status, 'applied');
  assert.equal(r.removed, B);
  assert.deepEqual(fbOf(doc, 't-bb01'), [A, 'B edited']);
});

test('feedbackItem delete removes only its target line', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, { taskId: 't-bb01', field: 'feedbackItem', value: '', base: A, itemIndex: 0 });
  assert.equal(r.status, 'applied');
  assert.equal(r.removed, A);
  assert.deepEqual(fbOf(doc, 't-bb01'), [B]);
});

test('feedbackItem falls back to a text match when earlier items were removed (indices shifted)', () => {
  const doc = parseTodo(readFix('index-full.md'));
  fbOf(doc, 't-bb01').splice(0, 1); // the loop removed A; B moved from index 1 to 0
  const edit = applyPatch(doc, { taskId: 't-bb01', field: 'feedbackItem', value: 'B edited', base: B, itemIndex: 1 });
  assert.equal(edit.status, 'applied');
  assert.deepEqual(fbOf(doc, 't-bb01'), ['B edited']);

  const doc2 = parseTodo(readFix('index-full.md'));
  fbOf(doc2, 't-bb01').unshift('loop-inserted'); // an index that now points at a DIFFERENT line
  const del = applyPatch(doc2, { taskId: 't-bb01', field: 'feedbackItem', value: '', base: A, itemIndex: 0 });
  assert.equal(del.status, 'applied');
  assert.deepEqual(fbOf(doc2, 't-bb01'), ['loop-inserted', B], 'the line at index 0 is not A, so A is found by text');
});

test('feedbackItem edit splits line breaks into several items at the edit position', () => {
  const doc = parseTodo(readFix('index-full.md'));
  applyPatch(doc, { taskId: 't-bb01', field: 'feedbackItem', value: 'a1\n\na2', base: A, itemIndex: 0 });
  assert.deepEqual(fbOf(doc, 't-bb01'), ['a1', 'a2', B]);
});

test('an edit whose base is gone is the disk-wins conflict; a delete whose base is gone is a noop', () => {
  const doc = parseTodo(readFix('index-full.md'));
  fbOf(doc, 't-bb01').splice(1, 1); // the loop addressed and removed B
  const edit = applyPatch(doc, { taskId: 't-bb01', field: 'feedbackItem', value: 'B edited', base: B, itemIndex: 1 });
  assert.equal(edit.status, 'conflict');
  assert.deepEqual(fbOf(doc, 't-bb01'), [A], 'disk wins — nothing written');
  const del = applyPatch(doc, { taskId: 't-bb01', field: 'feedbackItem', value: '', base: B, itemIndex: 1 });
  assert.equal(del.status, 'noop');
  assert.deepEqual(fbOf(doc, 't-bb01'), [A]);
});

test('changes to OTHER items never cause a conflict', () => {
  const doc = parseTodo(readFix('index-full.md'));
  fbOf(doc, 't-bb01')[0] = 'A rewritten by the loop';
  fbOf(doc, 't-bb01').push('C added by hand');
  const r = applyPatch(doc, { taskId: 't-bb01', field: 'feedbackItem', value: 'B edited', base: B, itemIndex: 1 });
  assert.equal(r.status, 'applied');
  assert.deepEqual(fbOf(doc, 't-bb01'), ['A rewritten by the loop', 'B edited', 'C added by hand']);
});

test('feedback patches on an unknown id are notfound', () => {
  const doc = parseTodo(readFix('index-full.md'));
  assert.equal(applyPatch(doc, { taskId: 't-none', field: 'feedbackAdd', value: 'x', base: '' }).status, 'notfound');
  assert.equal(applyPatch(doc, { taskId: 't-none', field: 'feedbackItem', value: '', base: 'x', itemIndex: 0 }).status, 'notfound');
});

test('normalizeModel', () => {
  assert.equal(normalizeModel('opus'), 'opus');
  assert.equal(normalizeModel('default (opus)'), undefined);
  assert.equal(normalizeModel(''), undefined);
  assert.equal(normalizeModel('none'), undefined, 'the hold sentinel is not a worker model');
});

// t-65a2: the groomer field additionally accepts the on-hold sentinel.
test('normalizeGroomer keeps none, otherwise normalizes like a model', () => {
  assert.equal(normalizeGroomer('none'), 'none');
  assert.equal(normalizeGroomer(' none '), 'none');
  assert.equal(normalizeGroomer('opus'), 'opus');
  assert.equal(normalizeGroomer('default (opus)'), undefined);
  assert.equal(normalizeGroomer(''), undefined);
});

test('a groomer patch writes the on-hold sentinel, and clearing it takes the task off hold', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const id = doc.entries[0].id;
  assert.equal(applyPatch(doc, { taskId: id, field: 'groomer', value: 'none', base: doc.entries[0].groomer || '' }).status, 'applied');
  assert.equal(doc.entries.find((e) => e.id === id).groomer, 'none');

  assert.equal(applyPatch(doc, { taskId: id, field: 'groomer', value: 'default (opus)', base: 'none' }).status, 'applied');
  assert.equal(doc.entries.find((e) => e.id === id).groomer, undefined);
});

// ---- batched answer set (t-5e6d) ----
// The board holds per-question saves off disk until every question is answered, then writes the
// whole set as ONE patch — so this field is positional and its line count is load-bearing.

const CC01_ANSWERS = 'Exponential with jitter, cap at 5 attempts.\n';

test('currentFieldValue(answers) is every answer, one line per question, in index order', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const entry = doc.entries.find((e) => e.id === 't-cc01');
  assert.equal(currentFieldValue(entry, 'answers'), CC01_ANSWERS);
});

test('an answers patch fills every question at once and clears their suggestions', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, {
    taskId: 't-cc01', field: 'answers',
    value: 'Exponential with jitter, cap at 5 attempts.\nDead-letter to a DB table.',
    base: CC01_ANSWERS,
  });
  assert.equal(r.status, 'applied');
  const qs = doc.entries.find((e) => e.id === 't-cc01').questions;
  assert.equal(qs[0].answer, 'Exponential with jitter, cap at 5 attempts.');
  assert.equal(qs[1].answer, 'Dead-letter to a DB table.');
  assert.deepEqual(qs[1].suggestions, [], 'an answered question keeps no suggestions');
});

test('an answers patch is rejected when the answers on disk moved under the board', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const r = applyPatch(doc, {
    taskId: 't-cc01', field: 'answers',
    value: 'a\nb',
    base: 'SOMETHING ELSE\n',
  });
  assert.equal(r.status, 'conflict');
  assert.equal(doc.entries.find((e) => e.id === 't-cc01').questions[1].answer, '', 'nothing partial was written');
});

test('an answers patch whose line count no longer matches the questions is a conflict', () => {
  const doc = parseTodo(readFix('index-full.md'));
  // A re-groom added or removed a question since the board rendered: applying positionally would
  // attach an answer to the wrong question, so disk wins instead.
  const r = applyPatch(doc, { taskId: 't-cc01', field: 'answers', value: 'only one line', base: CC01_ANSWERS });
  assert.equal(r.status, 'conflict');
  assert.equal(doc.entries.find((e) => e.id === 't-cc01').questions[0].answer, 'Exponential with jitter, cap at 5 attempts.');
});

test('an answers patch for an unknown task is notfound', () => {
  const doc = parseTodo(readFix('index-full.md'));
  assert.equal(applyPatch(doc, { taskId: 't-zzzz', field: 'answers', value: 'a', base: '' }).status, 'notfound');
});

// ---- unrecognised fields are refused as `unsupported`, never as a conflict (t-5831) ----
// The incident: a webview newer than the running host posted `feedbackAdd`; the host did not know
// it, routed it to the task file, found no current value and reported a disk-wins conflict — eight
// times in a row, although nothing on disk had changed.

test('applyPatch refuses an unrecognised field as unsupported, and writes nothing', () => {
  const text = readFix('index-full.md');
  const doc = parseTodo(text);
  const before = JSON.stringify(doc);
  const r = applyPatch(doc, { taskId: 't-aa01', field: 'noteAppend', value: 'typed text', base: '' });
  assert.equal(r.status, 'unsupported');
  assert.notEqual(r.status, 'conflict');
  assert.equal(JSON.stringify(doc), before, 'the doc is untouched');
});

test('an unrecognised field routes to detail, where applyDetailPatch refuses it as unsupported', () => {
  assert.equal(patchTarget('noteAppend'), 'detail', 'patchTarget still falls through to detail');
  const detail = parseTaskFile(readFix('taskfile-full.md'));
  const before = JSON.stringify(detail);
  for (const base of ['', 'anything', detail.description]) {
    const r = applyDetailPatch(detail, { taskId: 't-cc01', field: 'noteAppend', value: 'typed text', base });
    assert.equal(r.status, 'unsupported', 'base ' + JSON.stringify(base));
  }
  assert.equal(JSON.stringify(detail), before, 'the detail is untouched');
});

test('applyDetailPatch refuses an index field as unsupported rather than comparing it', () => {
  const detail = parseTaskFile(readFix('taskfile-full.md'));
  for (const field of ['feedbackAdd', 'feedbackItem', 'answers', 'title']) {
    assert.equal(applyDetailPatch(detail, { taskId: 't-cc01', field, value: 'x', base: '' }).status, 'unsupported', field);
  }
});

test('known fields keep their conflict semantics next to the new status', () => {
  const doc = parseTodo(readFix('index-full.md'));
  assert.equal(applyPatch(doc, { taskId: 't-aa01', field: 'title', value: 'x', base: 'STALE' }).status, 'conflict');
  const detail = parseTaskFile(readFix('taskfile-full.md'));
  for (const field of ['description', 'problem', 'goals']) {
    assert.equal(applyDetailPatch(detail, { taskId: 't-cc01', field, value: 'x', base: 'STALE' }).status, 'conflict', field);
  }
});
