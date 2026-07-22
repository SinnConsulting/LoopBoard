'use strict';
// buildLoopCommand slices the ## Automation section out of LOOP.md and requires a fenced block
// THERE (not the first fence in the file — LOOP.md has several earlier fences).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildLoopCommand } = require('../out-test/loop.js');
const { parseTodo } = require('../out-test/parser.js');
const { serializeTodo } = require('../out-test/writer.js');

function readMedia(name) {
  return fs.readFileSync(path.join(process.cwd(), 'media', name), 'utf8');
}

test('buildLoopCommand: bootstrap prompt names model + interval, points at .loopboard/LOOP.md', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), 'sonnet', '5m');
  assert.ok(cmd, 'a loop command was built from the shipped LOOP.md template');
  assert.match(cmd, /^\/loop 5m /, 'interval honored');
  assert.ok(cmd.includes('running as model sonnet'), 'model injected');
  assert.ok(cmd.includes('.loopboard/LOOP.md'), 'points at LOOP.md');
  assert.ok(cmd.includes('Automation section'), 'directs the worker to the Automation section');
  assert.ok(!cmd.includes("'"), 'no apostrophes (short-argv escaping constraint)');
  assert.ok(!cmd.includes('\n'), 'single line for the TUI paste');
  assert.ok(cmd.length < 300, 'bootstrap prompt stays tiny');
});

test('buildLoopCommand: undefined when there is no ## Automation section', () => {
  assert.equal(buildLoopCommand('# LOOP\n\n## Rules\n\n```\nsome fence\n```\n', 'opus', '1m'), undefined);
});

test('buildLoopCommand: undefined when Automation has no fenced block', () => {
  assert.equal(buildLoopCommand('# LOOP\n\n## Automation\n\nNo code block here.\n', 'opus', '1m'), undefined);
});

test('buildLoopCommand: an earlier fence (before ## Automation) is NOT picked', () => {
  // The Storage/Workflow fences come first; Automation itself has no fence -> undefined.
  const text = [
    '# LOOP', '', '## Storage', '', '```', 'layout', '```', '',
    '## Automation', '', 'Prose only, no fenced block.', '',
  ].join('\n');
  assert.equal(buildLoopCommand(text, 'opus', '1m'), undefined);
});

test('template-todo.md scaffold parses to zero entries and is a fixpoint', () => {
  const src = readMedia('template-todo.md');
  const doc = parseTodo(src);
  assert.equal(doc.entries.length, 0, 'scaffold starts with no tasks');
  const once = serializeTodo(doc);
  const twice = serializeTodo(parseTodo(once));
  assert.equal(twice, once, 'fixpoint');
});
