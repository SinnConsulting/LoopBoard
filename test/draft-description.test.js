'use strict';
// The New Story composer's copy into a fresh draft's ## Description (t-c4d1, item 4). The index title
// stays the flattened `DRAFT:` one-liner (store.createDraft); `draftDescription` (src/taskfile.ts,
// pure) builds the verbatim multi-line copy the eager-scaffolded task file also gets. The store's
// wiring and the draft card's paint are pinned in test/board-single-line.test.js [G9].
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { draftDescription, parseTaskFile, serializeTaskFile } = require('../out-test/taskfile.js');
const { parseTodo } = require('../out-test/parser.js');

const store = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'store.ts'), 'utf8');

// createDraft's title expression, taken from the source so the test cannot drift from it.
const TITLE_EXPR = "'DRAFT: ' + text.trim().replace(/\\s+/g, ' ')";
assert.ok(store.includes('title: ' + TITLE_EXPR + ','), 'store.createDraft builds the title with this expression');
const draftTitle = (text) => 'DRAFT: ' + text.trim().replace(/\s+/g, ' ');

// The skeleton createDraft writes, carrying the copy; returns the first written text.
function scaffold(text) {
  const skeleton = parseTaskFile('');
  skeleton.added = '2026-09-26';
  skeleton.description = draftDescription(text);
  return serializeTaskFile(skeleton, draftTitle(text), 't-1');
}
function assertFixpoint(out, text) {
  assert.equal(serializeTaskFile(parseTaskFile(out), draftTitle(text), 't-1'), out, 'the first write is a fixpoint');
}

test('[G1] a numbered list is copied verbatim; the skeleton round-trips; the title stays one line', () => {
  const text = '1. a\n2. b';
  assert.equal(draftDescription(text), text);
  const out = scaffold(text);
  assertFixpoint(out, text);
  assert.equal(parseTaskFile(out).description, text);
  assert.equal(draftTitle(text), 'DRAFT: 1. a 2. b');
});

test('[G2] a one-line text gets no copy (it is the title already)', () => {
  assert.equal(draftDescription('fix the thing'), undefined);
  assert.equal(parseTaskFile(scaffold('fix the thing')).description, undefined);
});

test('[G3] every loopboard-pending placeholder is removed from the copy', () => {
  const copy = draftDescription('see\n[img.png](loopboard-pending:1)\nand [b.png](loopboard-pending:2) here');
  assert.equal(copy, 'see\n\nand here');
  assert.doesNotMatch(copy, /loopboard-pending/);
});

test('[G4] a .loopboard/cache link is removed from the copy (it stays in the title, one chip)', () => {
  const copy = draftDescription('look\n[x.png](.loopboard/cache/t-1/x.png)\nat this [x.png](.loopboard/cache/t-1/x.png)');
  assert.equal(copy, 'look\n\nat this');
  assert.doesNotMatch(copy, /\.loopboard\/cache/);
});

test('[G5] blank edge lines are trimmed; the inner blank line and indentation stay', () => {
  assert.equal(draftDescription('\n\n  a\n\n  b\n\n'), '  a\n\n  b');
});

test('[G6] a `## Foo` line is kept in the copy and the task file round-trips it on the first write', () => {
  const text = 'intro\n## Foo\nmore';
  assert.equal(draftDescription(text), text);
  const out = scaffold(text);
  const back = parseTaskFile(out);
  assert.equal(back.description, text, 'still in Description');
  assert.deepEqual(back.unknownLines, []);
  assertFixpoint(out, text);
});

test('[G7] a `- [ ] x` line is kept in the copy, and the title is one line', () => {
  const text = 'todo:\n- [ ] x';
  assert.equal(draftDescription(text), text);
  const title = draftTitle(text);
  assert.equal(title, 'DRAFT: todo: - [ ] x');
  const doc = parseTodo('## Tasks\n\n- [ ] ' + title + '\n  - id: t-1\n');
  assert.equal(doc.entries.length, 1, 'the index still holds one entry');
});

test('[G8] only placeholders and whitespace: no copy', () => {
  assert.equal(draftDescription('[a.png](loopboard-pending:1)\n  \n[b.png](loopboard-pending:2)\n'), undefined);
  assert.equal(draftDescription('  \n\t\n'), undefined);
});
