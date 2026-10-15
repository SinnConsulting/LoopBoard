'use strict';
// t-0b10: the standing instructions every loop re-reads carry the tag rules. Budget (228 lines) and
// sync behaviour are asserted by test/template-budget.test.js and test/sync.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = fs.readFileSync(path.join(process.cwd(), 'media', 'template-loop.md'), 'utf8');

test('the task-file-format block lists `- tags:` after `depends on` in the Meta lines', () => {
  const block = text.slice(text.indexOf('loopboard:sync:task-file-format:begin'), text.indexOf('loopboard:sync:task-file-format:end'));
  assert.ok(block.includes('- depends on: t-xxxx[, t-yyyy]\n- tags: <tag>[, <tag>]\n'));
});

test('Rule 14 tells the groomer how to assign tags', () => {
  const start = text.indexOf('14. New/DRAFT grooming');
  const rule = text.slice(start, text.indexOf('\n15. ', start)).replace(/\s+/g, ' ');
  assert.ok(rule.includes('`- tags:` in `## Meta`'));
  assert.ok(rule.includes('pick from the catalogue (`.loopboard/tags.md` + tags in use)'));
  assert.ok(rule.includes('coin a new name only when none fits'));
  assert.ok(rule.includes("a DRAFT's leading `#word` becomes tag `word`, out of the title"));
  assert.ok(rule.includes('the loop appends it as a bare `- <name>` line to `.loopboard/tags.md`'));
  assert.ok(rule.includes('never editing or removing an existing line there'));
});

// t-0e99: an implementer that finished but whose orchestrator reset before finishing must not
// strand the task on `phase: inprogress`.
test('Rule 16 names delivered.md as the implementer\'s only .loopboard/ write', () => {
  const start = text.indexOf('16. Subagents are board-blind');
  const rule = text.slice(start, text.indexOf('**Subagents**', start)).replace(/\s+/g, ' ');
  assert.ok(rule.includes('`.loopboard/tasks/<id>/delivered.md`'));
  assert.ok(rule.includes('never TODO.md, the task file or a phase'));
  assert.ok(rule.includes("anything under `.loopboard/` except delivered.md (below)"));
  assert.ok(rule.indexOf('no option letter.') < rule.indexOf('an implementer\'s LAST action'), 'exception follows the groom paragraph');
});

test('Automation runs a recovery step (0) for delivered.md and orphaned In Progress tasks', () => {
  const auto = text.slice(text.indexOf('## Automation'));
  assert.ok(auto.includes('(0) RECOVERY, before (1)'));
  assert.ok(auto.includes('delete delivered.md only after that'));
  assert.ok(auto.includes('SendMessage that worker first'));
  assert.ok(auto.includes('record `worker: <agent-id> @ <timestamp>`'));
  assert.ok(!auto.includes('leaves the task `phase: inprogress` with no worker'));
});

test('Rule 2 resumes an orphaned In Progress task and Meta lists `worker:`', () => {
  assert.ok(text.replace(/\s+/g, ' ').includes('is orphaned: the orchestrator RESUMES it (not a parallel start)'));
  assert.ok(text.replace(/\s+/g, ' ').includes('(none recorded counts as none live)'));
  assert.ok(text.includes('- complexity-worker: <level> (<signals>)\n- worker: <agent-id> @ <timestamp>'));
});
