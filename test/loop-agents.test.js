'use strict';
// The three effort agents (`.claude/agents/loop-*.md`) behind the optional effort-based
// delegation rule documented in README "Workspace custom rules". They must carry no model (the
// loop passes one on every spawn, from the task's `groomer:`/`model:`), their effort must match
// their name, and the README must keep documenting the rule that uses them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const EFFORTS = ['medium', 'high', 'xhigh'];

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'missing frontmatter');
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

for (const effort of EFFORTS) {
  test(`loop-${effort} agent: name and effort match, no model`, () => {
    const text = fs.readFileSync(path.join(root, '.claude', 'agents', `loop-${effort}.md`), 'utf8');
    const fm = frontmatter(text);
    assert.equal(fm.name, `loop-${effort}`);
    assert.equal(fm.effort, effort);
    assert.ok(!('model' in fm), 'an effort agent must not name a model');
    assert.ok(text.includes('# GROOM mode') && text.includes('# WORK mode'));
  });
}

test('README documents the optional effort-based delegation rule', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.ok(readme.includes('### Optional: effort-based delegation'));
  for (const effort of EFFORTS) assert.ok(readme.includes(`loop-${effort}`));
});

// t-0b10: a groomer that coins a tag appends its bare name to `.loopboard/tags.md`, so the GROOM
// write set names that file as an allowed append-only write — in all three agents and in the README.
for (const effort of EFFORTS) {
  test(`loop-${effort} agent: GROOM may append a coined tag to .loopboard/tags.md, nothing else new`, () => {
    const text = fs.readFileSync(path.join(root, '.claude', 'agents', `loop-${effort}.md`), 'utf8').replace(/\s+/g, ' ');
    const groom = text.slice(text.indexOf('# GROOM mode'), text.indexOf('# WORK mode'));
    assert.ok(groom.includes('`.loopboard/tasks/<id>.md`'));
    assert.ok(groom.includes("your own task's entry in `.loopboard/TODO.md`"));
    assert.ok(groom.includes('only when you coin a tag, one bare `- <name>` line appended to `.loopboard/tags.md`'));
    assert.ok(groom.includes('never edit or remove an existing line there'));
  });
}

test('README custom-rule text names the tags.md append in the GROOM write set', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(readme.includes('they write only the task file, their own index entry and, to coin a tag, one bare `- <name>` line appended to `.loopboard/tags.md` (Rule 14)'));
});
