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
  assert.ok(rule.includes('Append a coined tag as a bare `- <name>` line to `.loopboard/tags.md`'));
  assert.ok(rule.includes('never edit or remove an existing line there'));
});
