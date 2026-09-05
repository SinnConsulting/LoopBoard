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
  for (const f of ['title', 'model', 'groomer', 'answer', 'answers', 'note', 'feedback']) assert.equal(patchTarget(f), 'index', f);
  for (const f of ['description']) assert.equal(patchTarget(f), 'detail', f);
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

test('note is an index field: edits the whole set, split on newlines, drop empties', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const entry = doc.entries.find((e) => e.id === 't-bb01');
  // The webview joins notes with \n as the rendered base.
  const base = 'Rebase on main before opening the PR.\nAdd a metric for retry count.';
  assert.equal(currentFieldValue(entry, 'note'), base);
  const r = applyPatch(doc, { taskId: 't-bb01', field: 'note', value: 'first\n\n  \nsecond\n', base });
  assert.equal(r.status, 'applied');
  assert.deepEqual(doc.entries.find((e) => e.id === 't-bb01').notes, ['first', 'second']);
});

test('clearing note via empty value empties the set', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const base = 'Rebase on main before opening the PR.\nAdd a metric for retry count.';
  const r = applyPatch(doc, { taskId: 't-bb01', field: 'note', value: '', base });
  assert.equal(r.status, 'applied');
  assert.deepEqual(doc.entries.find((e) => e.id === 't-bb01').notes, []);
});

test('feedback is an index field: edits the whole set, split on newlines, drop empties', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const entry = doc.entries.find((e) => e.id === 't-ee01');
  const base = 'Redact the auth token from the request log fields.';
  assert.equal(currentFieldValue(entry, 'feedback'), base);
  const r = applyPatch(doc, { taskId: 't-ee01', field: 'feedback', value: 'first\n\n  \nsecond\n', base });
  assert.equal(r.status, 'applied');
  assert.deepEqual(doc.entries.find((e) => e.id === 't-ee01').feedback, ['first', 'second']);
});

test('clearing feedback via empty value empties the set (Rule 13: removed when addressed)', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const base = 'Redact the auth token from the request log fields.';
  const r = applyPatch(doc, { taskId: 't-ee01', field: 'feedback', value: '', base });
  assert.equal(r.status, 'applied');
  assert.deepEqual(doc.entries.find((e) => e.id === 't-ee01').feedback, []);
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
