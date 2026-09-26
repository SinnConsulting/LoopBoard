'use strict';
// Pure gate transforms (promote New->Backlog, accept Review->Done). The gates mutate the in-memory
// index entry / task detail; the store orchestrates the per-file writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTodo } = require('../out-test/parser.js');
const { parseTaskFile } = require('../out-test/taskfile.js');
const { promoteIndex, promoteDetail, demoteIndex, demoteDetail, acceptDetail, acceptDoneEntry } = require('../out-test/gates.js');

const FIX = path.join(process.cwd(), 'test', 'fixtures');
function readFix(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8');
}

test('promoteIndex: phase -> backlog, checkbox reset', () => {
  const entry = parseTodo(readFix('index-full.md')).entries.find((e) => e.id === 't-aa01');
  entry.checked = true;
  promoteIndex(entry);
  assert.equal(entry.phase, 'backlog');
  assert.equal(entry.checked, false);
});

test('promoteDetail: sets promoted + logs the day (no duplicate)', () => {
  const detail = parseTaskFile('# X (t-1)\n\n## Worklog\n- 2026-07-11\n');
  promoteDetail(detail, '2026-07-11');
  assert.equal(detail.promoted, '2026-07-11');
  assert.deepEqual(detail.worklog, ['2026-07-11'], 'existing day not duplicated');
  promoteDetail(detail, '2026-07-12');
  assert.deepEqual(detail.worklog, ['2026-07-11', '2026-07-12']);
});

test('demoteIndex: phase -> new, checkbox reset (inverse of promoteIndex)', () => {
  const entry = parseTodo(readFix('index-full.md')).entries.find((e) => e.id === 't-aa01');
  entry.phase = 'backlog';
  entry.checked = true;
  demoteIndex(entry);
  assert.equal(entry.phase, 'new');
  assert.equal(entry.checked, false);
});

test('demoteDetail: clears promoted + logs the day (no duplicate)', () => {
  const detail = parseTaskFile('# X (t-1)\n\n## Meta\n- promoted: 2026-07-11\n\n## Worklog\n- 2026-07-11\n');
  assert.equal(detail.promoted, '2026-07-11');
  demoteDetail(detail, '2026-07-11');
  assert.equal(detail.promoted, undefined);
  assert.deepEqual(detail.worklog, ['2026-07-11'], 'existing day not duplicated');
  demoteDetail(detail, '2026-07-12');
  assert.deepEqual(detail.worklog, ['2026-07-11', '2026-07-12']);
});

test('acceptDetail: sets completed + logs the day', () => {
  const detail = parseTaskFile('# X (t-1)\n');
  acceptDetail(detail, '2026-07-11');
  assert.equal(detail.completed, '2026-07-11');
  assert.deepEqual(detail.worklog, ['2026-07-11']);
});

test('acceptDoneEntry: slim DONE entry with id/model/groomer/completed, no questions', () => {
  const entry = parseTodo(readFix('index-full.md')).entries.find((e) => e.id === 't-ee01');
  const done = acceptDoneEntry(entry, '2026-07-11');
  assert.equal(done.id, 't-ee01');
  assert.equal(done.title, 'Add structured logging (pino) to the worker processes');
  assert.equal(done.model, 'opus');
  assert.equal(done.phase, 'done');
  assert.equal(done.checked, true);
  assert.equal(done.completed, '2026-07-11');
  assert.deepEqual(done.questions, []);
});

// t-39e2: the armed auto-promote's fire path re-checks the FRESH entry under the store's write lock.
test('promoteIndexIfReady: refuses (entry unchanged, conflict) unless still ready; otherwise promotes like promoteIndex', () => {
  const { promoteIndexIfReady } = require('../out-test/gates.js');
  const base = () => ({
    id: 't-1', title: 'T', phase: 'new', checked: false, isDraft: false,
    questions: [], feedback: [], unknownLines: [], raw: '- [ ] T\n  - id: t-1\n  - phase: new',
  });
  const refusals = {
    'out of New': { phase: 'backlog' },
    'a DRAFT': { isDraft: true },
    'a blank question': { questions: [{ text: 'q', answer: '', suggestions: [] }] },
    'an answered, unfolded question': { questions: [{ text: 'q', answer: 'yes', suggestions: [] }] },
    'feedback': { feedback: ['fold this in'] },
  };
  for (const [name, over] of Object.entries(refusals)) {
    const entry = Object.assign(base(), over);
    const before = structuredClone(entry);
    assert.equal(promoteIndexIfReady(entry), 'conflict', name);
    assert.deepEqual(entry, before, name + ': entry untouched');
  }
  const ready = base();
  ready.checked = true;
  const expected = structuredClone(ready);
  promoteIndex(expected);
  assert.equal(promoteIndexIfReady(ready), 'applied');
  assert.deepEqual(ready, expected, 'same result as promoteIndex');
  assert.equal(ready.phase, 'backlog');
});

// t-39e2 x t-c4d1 (merge): the auto-promote guard reads the entry the parser hands it, so a value the
// single-line fold or the comment-opener rule keeps in the entry must still hold the arm.
test('promoteIndexIfReady: a feedback: item or answer containing <!-- still refuses, and a folded multi-line DRAFT title stays a DRAFT', () => {
  const { promoteIndexIfReady } = require('../out-test/gates.js');
  const { applyPatch } = require('../out-test/merge.js');
  const { serializeTodo } = require('../out-test/writer.js');
  const index = (body) => ['# TODO', '', '## Tasks', '', ...body, '', '- [ ] Later', '  - id: t-9', '  - phase: new', ''].join('\n');
  const fb = parseTodo(index(['- [ ] Story', '  - id: t-2', '  - phase: new', '  - feedback: keep the <!-- marker']))
    .entries.find((e) => e.id === 't-2');
  assert.deepEqual(fb.feedback, ['keep the <!-- marker']);
  assert.equal(promoteIndexIfReady(fb), 'conflict', 'feedback with the opener still holds');
  const qa = parseTodo(index(['- [ ] Story', '  - id: t-2', '  - phase: new', '  - question: Q?', '    - answer: use <!-- this']))
    .entries.find((e) => e.id === 't-2');
  assert.equal(qa.questions.length, 1);
  assert.equal(promoteIndexIfReady(qa), 'conflict', 'an unfolded answer with the opener still holds');
  const doc = parseTodo(readFix('index-full.md'));
  const draft = doc.entries.find((e) => e.id === 't-aa02');
  assert.equal(applyPatch(doc, { taskId: 't-aa02', field: 'title', value: 'DRAFT:\n- [ ] phantom', base: draft.title }).status, 'applied');
  const back = parseTodo(serializeTodo(doc)).entries.find((e) => e.id === 't-aa02');
  assert.equal(back.isDraft, true);
  assert.equal(promoteIndexIfReady(back), 'conflict', 'a folded DRAFT is still held');
});
