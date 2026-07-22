'use strict';
// Pure gate transforms (promote New->Backlog, accept Review->Done). The gates mutate the in-memory
// index entry / task detail; the store orchestrates the per-file writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTodo } = require('../out-test/parser.js');
const { parseTaskFile } = require('../out-test/taskfile.js');
const { promoteIndex, promoteDetail, acceptDetail, acceptDoneEntry } = require('../out-test/gates.js');

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
