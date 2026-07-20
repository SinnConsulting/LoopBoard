'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTodo, parseDone } = require('../out-test/parser.js');
const { serializeTodo, serializeDone } = require('../out-test/writer.js');
const { applyPatch } = require('../out-test/merge.js');
const { promote, accept } = require('../out-test/gates.js');
const { computeBadge, toWebviewBoard } = require('../out-test/view.js');
const { buildLoopCommand } = require('../out-test/loop.js');

const FIX = path.join(process.cwd(), 'test', 'fixtures');
function readFix(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8');
}

function taskShape(t) {
  const { raw, ...rest } = t;
  return rest;
}
function boardShape(text) {
  return parseTodo(text).tasks.map(taskShape);
}

const FIXTURES = ['real-todo-v1.md', 'v2-full.md', 'unknown-lines.md'];

for (const name of FIXTURES) {
  test(`text idempotence after normalization: ${name}`, () => {
    const src = readFix(name);
    const once = serializeTodo(parseTodo(src));
    const twice = serializeTodo(parseTodo(once));
    assert.equal(twice, once, 'second serialization must equal the first');
  });

  test(`board fixpoint (parse->write->parse): ${name}`, () => {
    const src = readFix(name);
    const written = serializeTodo(parseTodo(src));
    const a = boardShape(written);
    const b = boardShape(serializeTodo(parseTodo(written)));
    assert.deepEqual(b, a);
  });
}

test('real v1 file: nothing lost, structure preserved', () => {
  const out = serializeTodo(parseTodo(readFix('real-todo-v1.md')));
  assert.ok(out.includes('The checkbox is your approval'), 'rules preserved');
  assert.ok(out.includes('/loop 1m'), 'automation loop preserved');
  assert.ok(out.includes('Format when a worker parks a task here'), 'feedback comment preserved');
  assert.ok(out.includes('Format for a story awaiting your review'), 'review comment preserved');
});

test('unknown lines preserved and flagged', () => {
  const board = parseTodo(readFix('unknown-lines.md'));
  const t = board.tasks.find((x) => x.id === 't-ff01');
  assert.ok(t, 'task found');
  assert.deepEqual(t.unknownLines, [
    '  - priority: high',
    '  - some free-form note without a key',
    '  - reviewer: @someone',
  ]);
  const out = serializeTodo(board);
  assert.ok(out.includes('- priority: high'));
  assert.ok(out.includes('- reviewer: @someone'));
});

test('HTML comment after a task is not parsed as a task', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const fb = board.tasks.filter((t) => t.phase === 'feedback');
  assert.equal(fb.length, 1, 'only the real feedback task, not the comment template');
  assert.ok(serializeTodo(board).includes('Format when a worker parks a task here'), 'comment preserved');
});

test('task with two questions, one answered', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const t = board.tasks.find((x) => x.id === 't-cc01');
  assert.ok(t);
  assert.equal(t.questions.length, 2);
  assert.ok(t.questions[0].answer.length > 0, 'first answered');
  assert.equal(t.questions[1].answer, '', 'second blank');
});

test('ids assigned to id-less tasks on write', () => {
  const src = ['# TODO', '', '## New (proposed)', '', '- [ ] A task with no id', '  - added: 2026-07-10', '', '## Automation', '', 'x'].join('\n');
  const board = parseTodo(src);
  assert.equal(board.tasks[0].id, '');
  assert.match(serializeTodo(board), /- id: t-[0-9a-f]{4}/);
});

test('DRAFT tasks serialize minimally', () => {
  const board = parseTodo(readFix('v2-full.md'));
  assert.ok(board.tasks.find((x) => x.isDraft));
  const lines = serializeTodo(board).split('\n');
  const idx = lines.findIndex((l) => l.startsWith('- [ ] DRAFT:'));
  assert.ok(idx >= 0);
  assert.match(lines[idx + 1], /- id:/);
  assert.match(lines[idx + 2], /- added:/);
});

test('groomer field patches, serializes on drafts, and round-trips', () => {
  const board = parseTodo(readFix('v2-full.md'));
  // Patch a groom model onto the DRAFT task.
  const r = applyPatch(board, { taskId: 't-aa02', field: 'groomer', value: 'fable', base: '' });
  assert.equal(r.status, 'applied');
  assert.equal(board.tasks.find((t) => t.id === 't-aa02').groomer, 'fable');

  const text = serializeTodo(board);
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('- [ ] DRAFT:'));
  assert.match(lines[idx + 1], /- id:/);
  assert.match(lines[idx + 2], /- groomer: fable/); // groomer emitted before added on drafts

  // Round-trip: parse the serialized text back and the groomer survives.
  const board2 = parseTodo(text);
  assert.equal(board2.tasks.find((t) => t.id === 't-aa02').groomer, 'fable');

  // Empty value clears the field (default model).
  const r2 = applyPatch(board2, { taskId: 't-aa02', field: 'groomer', value: 'default (opus)', base: 'fable' });
  assert.equal(r2.status, 'applied');
  assert.equal(board2.tasks.find((t) => t.id === 't-aa02').groomer, undefined);
});

test('model field serializes on drafts (before groomer) and round-trips', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const draft = board.tasks.find((t) => t.isDraft);
  draft.model = 'sonnet';
  draft.groomer = 'fable';

  const text = serializeTodo(board);
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('- [ ] DRAFT:'));
  assert.match(lines[idx + 1], /- id:/);
  assert.match(lines[idx + 2], /- model: sonnet/);
  assert.match(lines[idx + 3], /- groomer: fable/);
  assert.match(lines[idx + 4], /- added:/);

  // Round-trip: both fields survive and serialize is a fixpoint.
  const board2 = parseTodo(text);
  const d2 = board2.tasks.find((t) => t.isDraft);
  assert.equal(d2.model, 'sonnet');
  assert.equal(d2.groomer, 'fable');
  assert.equal(serializeTodo(board2), text);
});

test('applyPatch applies a field when no conflict', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const r = applyPatch(board, {
    taskId: 't-aa01',
    field: 'description',
    value: 'A new description',
    base: 'Protect the public API from abuse with a token-bucket limiter.',
  });
  assert.equal(r.status, 'applied');
  assert.equal(board.tasks.find((t) => t.id === 't-aa01').description, 'A new description');
});

test('applyPatch detects same-field conflict (disk changed)', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const r = applyPatch(board, {
    taskId: 't-aa01',
    field: 'description',
    value: 'my edit',
    base: 'STALE BASE THE WEBVIEW RENDERED',
  });
  assert.equal(r.status, 'conflict');
});

test('applyPatch answer patch targets the right question', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const r = applyPatch(board, { taskId: 't-cc01', field: 'answer', value: 'Dead-letter to a DB table.', base: '', questionIndex: 1 });
  assert.equal(r.status, 'applied');
  assert.equal(board.tasks.find((t) => t.id === 't-cc01').questions[1].answer, 'Dead-letter to a DB table.');
});

test('applyPatch on unknown task id -> notfound', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const r = applyPatch(board, { taskId: 't-zzzz', field: 'title', value: 'x', base: 'y' });
  assert.equal(r.status, 'notfound');
});

test('migrated repo TODO.md parses with zero unknown lines and is a fixpoint', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'TODO.md'), 'utf8');
  const board = parseTodo(src);
  for (const t of board.tasks) {
    assert.equal(t.unknownLines.length, 0, `unknown lines on ${t.id || t.title}`);
  }
  const once = serializeTodo(parseTodo(src));
  const twice = serializeTodo(parseTodo(once));
  assert.equal(twice, once);
  // v2 additions are documented.
  assert.ok(!board.automation.includes('{MODEL}'), 'automation instructions are model-agnostic (bootstrap prompt names the model)');
  assert.ok(/Claim tasks by `model:`/.test(src), 'model routing rule present');
  assert.ok(/Honor `note:` lines/.test(src), 'note handling rule present');
});

test('scaffold template (media/todo-template.md) parses empty, no unknown content, fixpoint', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'media', 'todo-template.md'), 'utf8');
  const board = parseTodo(src);
  assert.equal(board.tasks.length, 0, 'template starts with no tasks');
  const once = serializeTodo(board);
  const twice = serializeTodo(parseTodo(once));
  assert.equal(twice, once);
  assert.ok(!src.includes('{MODEL}'), 'automation instructions are model-agnostic (bootstrap prompt names the model)');
  assert.ok(buildLoopCommand(parseTodo(src), 'opus', '1m'), 'automation block yields a loop command');
});

test('promote moves New -> Backlog with promoted date, resets checkbox', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const ok = promote(board, 't-aa01', '2026-07-11');
  assert.equal(ok, true);
  const t = board.tasks.find((x) => x.id === 't-aa01');
  assert.equal(t.phase, 'backlog');
  assert.equal(t.promoted, '2026-07-11');
  assert.equal(t.checked, false);
  assert.ok(t.worklog.includes('2026-07-11'));
});

test('accept removes Review task and returns a completed done entry', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const before = board.tasks.length;
  const done = accept(board, 't-ee01', '2026-07-11');
  assert.ok(done);
  assert.equal(done.completed, '2026-07-11');
  assert.equal(done.checked, true);
  assert.equal(board.tasks.length, before - 1);
  assert.ok(!board.tasks.find((x) => x.id === 't-ee01'), 'cut from TODO.md');
  // Serialized done block is a valid [x] entry.
  assert.ok(serializeDone([done]).includes('- [x]'));
});

test('field patch leaves other tasks (a concurrent disk change) untouched', () => {
  // Board represents disk AFTER a loop wrote a new worklog date onto task B.
  const board = parseTodo(readFix('v2-full.md'));
  const b = board.tasks.find((x) => x.id === 't-bb01');
  b.worklog.push('2026-07-11'); // the loop's write
  const r = applyPatch(board, { taskId: 't-aa01', field: 'title', value: 'Renamed', base: 'Add rate limiting middleware to the public REST API' });
  assert.equal(r.status, 'applied');
  assert.equal(board.tasks.find((x) => x.id === 't-aa01').title, 'Renamed');
  assert.ok(board.tasks.find((x) => x.id === 't-bb01').worklog.includes('2026-07-11'), "B's concurrent change survives");
});

test('badge = new (incl DRAFTs) + unanswered feedback + review', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const badge = computeBadge(board);
  // v2-full: New has 1 task + 1 DRAFT = 2; Feedback 1 with a blank answer = 1; Review 1.
  assert.equal(badge.newCount, 2);
  assert.equal(badge.feedbackUnanswered, 1);
  assert.equal(badge.reviewCount, 1);
  assert.equal(badge.count, 4);
});

test('answering the last question clears the feedback badge contribution', () => {
  const board = parseTodo(readFix('v2-full.md'));
  const t = board.tasks.find((x) => x.id === 't-cc01');
  t.questions[1].answer = 'Dead-letter to a DB table.';
  assert.equal(computeBadge(board).feedbackUnanswered, 0);
});

test('toWebviewBoard marks dependency met when the dep id is in DONE', () => {
  const board = parseTodo(readFix('v2-full.md'));
  board.done = parseDone('- [x] dep\n  - id: t-9c2e\n  - completed: 2026-07-01');
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  const bl = web.phases.backlog.find((t) => t.dependsOn.length);
  assert.equal(bl.dependsOn[0].met, true);
});

test('buildLoopCommand emits the bootstrap prompt naming model and interval', () => {
  const board = parseTodo(fs.readFileSync(path.join(process.cwd(), 'TODO.md'), 'utf8'));
  const cmd = buildLoopCommand(board, 'sonnet', '5m');
  assert.ok(cmd, 'a loop command was built');
  assert.ok(cmd.includes('running as model sonnet'), 'model injected');
  assert.match(cmd, /^\/loop 5m /, 'interval honored');
  assert.ok(cmd.includes('## Automation section'), 'points the worker at the Automation instructions');
  assert.ok(cmd.length < 300, 'bootstrap prompt stays tiny');
  assert.ok(!cmd.includes('\n'), 'single line for the TUI paste');
});

test('buildLoopCommand returns undefined when no fenced block', () => {
  const board = parseTodo('# TODO\n\n## Automation\n\nNo code block here.\n');
  assert.equal(buildLoopCommand(board, 'opus', '1m'), undefined);
});

test('DONE.md round-trips', () => {
  const done = parseDone(['# DONE', '', '- [x] Upgrade TypeScript to 5.6', '  - id: t-135', '  - completed: 2026-07-07', '  - link: https://example.com/pr/135'].join('\n'));
  assert.equal(done.length, 1);
  assert.equal(done[0].completed, '2026-07-07');
  const out = serializeDone(done);
  assert.ok(out.includes('- completed: 2026-07-07'));
  assert.ok(out.includes('- [x] Upgrade TypeScript to 5.6'));
});
