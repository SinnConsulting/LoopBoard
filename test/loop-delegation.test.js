'use strict';
// t-716f: every loop subagent spawn passes `model` and `effort` (Agent tool, Claude Code 2.1.292+),
// picked by the template's signal rubric. Replaces test/loop-agents.test.js, whose subjects — the
// `.claude/agents/loop-*.md` effort agents and the README's "effort-based delegation" custom rule —
// were removed by owner decision. No code picks an effort, so only the wording can be pinned here;
// whether two loops agree on a level is a manual check (VERIFICATION.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

function subagentsRule() {
  const tpl = read('media/template-loop.md');
  const start = tpl.indexOf('**Subagents**');
  assert.ok(start !== -1, 'the Subagents rule is in the template');
  const end = tpl.indexOf('\nLegend:', start);
  assert.ok(end > start, 'the Subagents rule sits inside the rules section, before the Legend');
  const rules = tpl.slice(tpl.indexOf('<!-- loopboard:sync:rules:begin -->'), tpl.indexOf('<!-- loopboard:sync:rules:end -->'));
  assert.ok(rules.includes('**Subagents**'), 'inside the sync-marked rules section, so Sync ships it');
  return flat(tpl.slice(start, end));
}

test('no LoopBoard agent definition ships with the repo', () => {
  const dir = path.join(root, '.claude', 'agents');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  assert.deepEqual(files.filter((f) => /^loop-/.test(f)), []);
});

test('template: every spawn passes model and effort, as general-purpose, on Claude Code 2.1.292+', () => {
  const r = subagentsRule();
  assert.match(r, /EVERY Agent-tool spawn MUST pass `model` and `effort`, NEVER picked or estimated by you/);
  // t-0e99: every groom, implementation and review is a subagent on the TASK's own model and effort,
  // else the configured default (owner decision 2026-10-14: nothing picks one on the user's behalf).
  assert.match(r, /You never edit code: EVERY groom, implementation and review is a `general-purpose` subagent/);
  assert.match(r, /`model` = the task's `groomer:`\/`model:`\/`reviewer:`, effort = its `groomer-effort:`\/`effort:` \(a review: the task's worker effort\); an absent field = the default your bootstrap prompt names/);
  assert.match(r, /A model it lists as `<model> <min>-<max>` clamps that effort into the range/, 'the per-model floor and ceiling (FB7)');
  assert.match(r, /2\.1\.292\+/);
  assert.match(r, /Your own `--effort` governs only you/, 'the orchestrator effort governs only the loop itself');
});

test('template: subagent titles carry the full <mode> <model>-<effort>-<task id>: prefix before the story title (t-0e99 FB1/FB5/FB6)', () => {
  const r = subagentsRule();
  assert.match(r, /Title \(Agent `description`; ignore its 3-5 word hint, the full prefix MUST come before the title\): `<groom\|work\|review> <model>-<effort>-<task id>: <task title>`/);
  assert.match(r, /`work opus-high-t-4589: Swing sheet export`/);
  assert.match(r, /title `<mode> haiku-low-<id>: <headline>`/);
});

test('template: Haiku is a full task model (t-0e99); the helper still never commits', () => {
  const r = subagentsRule();
  assert.doesNotMatch(r, /Haiku NEVER grooms, implements or reviews/);
  assert.doesNotMatch(r, /task models are never `haiku`/);
  assert.match(r, /Helper never commits, pushes or branches/);
});

test('template: no auto table, no derived effort, no re-spawn one level up (owner decision 2026-10-14)', () => {
  const r = subagentsRule();
  for (const gone of [/`auto`/, /auto table/i, /Derived effort/, /one step higher on Haiku/, /re-spawned one level up/, /bigger than briefed/, /rubric/i, /never effort `max`/]) {
    assert.doesNotMatch(r, gone);
  }
});

test('template: complexity is a record (four signals, levels, the report line and the two Meta keys), never routing', () => {
  const r = subagentsRule();
  assert.match(r, /Complexity is a RECORD, never routing/);
  assert.match(r, /a GROOM subagent ends its report with `complexity: <level> \(<signals>\)` judged from the groomed story, an implementer judged from what the work took/);
  assert.match(r, /`-` = no signal: `high \(D\)`, `medium \(-\)`/);
  assert.match(r, /you write it to Meta as `complexity-groomer:` with the groomed story \(a re-groom overwrites it\) or `complexity-worker:` with `## Delivered`/);
  assert.match(r, /\*\*S\*\* spans 3\+ separately running or shipped parts \(tests and docs never count\)/);
  assert.match(r, /\*\*N\*\* a Goal states a threshold, timing, size, budget or count to measure or pin down/);
  assert.match(r, /\*\*D\*\* the story amends or reverses a recorded decision/);
  assert.match(r, /\*\*U\*\* the approach is open, a root cause is unknown, or a Goal says investigate first/);
  assert.match(r, /`low` = no signal AND every Goal names the exact file and exact text or value AND no new logic branch; `high` = at least one of S\/N\/D; `xhigh` = two of S\/N\/D AND U; else `medium`/);
  assert.match(r, /A signal the story leaves unclear counts as absent/);
  assert.match(r, /Brief names mode \(GROOM\/WORK\/REVIEW\), task id and `effort: <level>`/);
  assert.match(r, /a resume \(SendMessage\) keeps its spawn effort/);
  assert.match(r, /Never `subagent_type: fork`/);
});

test('template: the Haiku helper test — kind, determined, checkable, worth it; doubt keeps the task model', () => {
  const r = subagentsRule();
  assert.match(r, /`model: haiku`, `effort: low`/);
  assert.match(r, /ONLY if ALL hold — kind: search or inventory across many files/);
  assert.match(r, /determined: the brief fixes the result/);
  assert.match(r, /checkable: the caller verifies the output before use/);
  assert.match(r, /worth it: more than one or two of the caller's own tool calls/);
  assert.match(r, /A condition in doubt counts as failed: the step stays on the task model/);
});

test('template: the GROOM/WORK limits of the old agent bodies appear once, and effort no longer rides the spawn for subagents', () => {
  const tpl = read('media/template-loop.md');
  const all = flat(tpl);
  const count = (re) => (all.match(re) || []).length;
  assert.doesNotMatch(all, /its own index entry/, 'the GROOM write-list left with Rule 16 (subagents are board-blind)');
  assert.match(all, /grounds claims in latest `main` with file:line/);
  assert.equal(count(/names overlapping tasks by full title/g), 1);
  assert.equal(count(/A GROOM subagent returns its report: title, `## Problem`, `## Description`, `## Goals`, and every human decision with its concrete options \(max 3, recommended first\) and the reason for the recommendation/g), 1, 'GROOM return report once');
  assert.equal(count(/commits only its own files by explicit path/g), 1, 'WORK staging once');
  assert.equal(count(/a per-goal account, deviations, anything unverified and its `complexity:` line/g), 1, 'WORK return report once');
  assert.equal(count(/Neither the implementer nor the review subagent reads or writes any `\.loopboard\/` file \(Rule 16\)/g), 1, 'WORK neither reads nor writes .loopboard/');
  assert.doesNotMatch(all, /Interval \(`loopBoard\.loopInterval`\), effort,/, 'the old "effort rides the spawn command" note is gone');
  assert.match(all, /your own `--model`\/`--effort`, grooming cap, task models with effort ranges, defaults and model ids ride the spawn/);
});

// The removed "Optional: effort-based delegation" section and every loop-agent reference it held
// must stay gone from both READMEs; the showcase page is the source of README.md's showcase region.
for (const file of ['README.md', 'docs/showcase/README.md']) {
  test(`${file}: Claude Code 2.1.292 minimum, no loop-agent reference`, () => {
    const text = read(file);
    assert.ok(text.includes('2.1.292'), 'names the 2.1.292 minimum');
    assert.ok(!text.includes('CLI 2.1.0+'), 'the old 2.1.0 minimum is gone');
    const lower = text.toLowerCase();
    for (const needle of ['loop-medium', 'loop-high', 'loop-xhigh', 'loop-*', '.claude/agents', 'agent file', 'agent type', 'effort only comes from', 'effort-based delegation']) {
      assert.ok(!lower.includes(needle), `${file} still mentions "${needle}"`);
    }
  });
}

test('package.json: the orchestrator effort sets the loop only; subagents get theirs per spawn (t-0e99)', () => {
  const pkg = JSON.parse(read('package.json'));
  const props = {};
  for (const block of [].concat(pkg.contributes.configuration)) Object.assign(props, block.properties);
  assert.deepEqual(Object.keys(props).filter((k) => /\.effort$/.test(k)), ['loopBoard.orchestrator.effort'], 'no per-slot effort keys remain');
  assert.match(props['loopBoard.models.haiku.minEffort'].markdownDescription, /lowest effort any subagent on Haiku runs at/, 'the per-model floor (FB7)');
  const d = props['loopBoard.orchestrator.effort'].markdownDescription;
  assert.doesNotMatch(d, /same effort|every subagent/i, 'the orchestrator effort must not claim subagents share it');
  assert.match(d, /subagents get their effort per spawn/);
  assert.match(d, /over-split review work into many subagents/, 'the max-effort caveat is stated');
});

// t-716f review feedback: Rule 16 makes every subagent board-blind and the loop the board's only
// writer, with a /tmp report the loop recovers from when a groom came back but was never written.
function rule16() {
  const tpl = read('media/template-loop.md');
  const start = tpl.indexOf('\n16. ');
  assert.ok(start !== -1, 'Rule 16 is in the template');
  const rules = tpl.slice(tpl.indexOf('<!-- loopboard:sync:rules:begin -->'), tpl.indexOf('<!-- loopboard:sync:rules:end -->'));
  assert.ok(rules.includes('\n16. '), 'inside the sync-marked rules section');
  return flat(tpl.slice(start, tpl.indexOf('\n**Subagents**', start)));
}

test('template Rule 16: subagents are board-blind, the loop is the ONLY writer', () => {
  const r = rule16();
  assert.match(r, /^ 16\. Subagents are board-blind; the loop is the board's ONLY writer\./);
  assert.match(r, /No subagent \(groomer, implementer, reviewer, helper\) reads or writes anything under `\.loopboard\/`/);
  assert.match(r, /concurrent groomers never race on `TODO\.md`/);
  // A board-blind groomer still names overlapping tasks (Rule 14), so its brief lists the other titles.
  assert.match(r, /the loop puts what one needs \(story, Goals, answers, `feedback:`, other index titles with phase\) in its brief/);
  assert.match(r, /The loop then does every board write itself: the task file \(with the `<today>` Worklog line\), then the index entry \(title, `phase: new` on a DRAFT, `question:` with a blank `answer:`, its `suggestion:` lines\), and deleting folded `question:`\/`answer:` pairs and folded `feedback:`/);
});

test('template Rule 16: the groom report lands in /tmp, and an unwritten one is recovered, not re-groomed', () => {
  const r = rule16();
  assert.match(r, /Before returning, it also writes that report to `\/tmp\/loopboard\/<workspace>\/<id>\/groom\.md`/);
  assert.match(r, /Every pass, before spawning any groomer: a New task or DRAFT whose `groom\.md` is newer than its `tasks\/<id>\.md` \(or that has no task file\)/);
  assert.match(r, /apply it as above, note "recovered" in its Worklog, and do not re-groom it/);
});

test('template Rule 16: each suggestion reads as a complete answer, no option letter', () => {
  assert.match(rule16(), /Each `suggestion:` reads as the complete answer on its own: what the human gets, with its number and consequence, and no option letter/);
});

test('template: Rule 14 and the Automation fence route grooming writes through the loop (Rule 16)', () => {
  const tpl = read('media/template-loop.md');
  const rule14 = flat(tpl.slice(tpl.indexOf('\n14. '), tpl.indexOf('\n15. ')));
  assert.doesNotMatch(rule14, /Subagent expands the story into/, 'the subagent no longer writes the task file');
  assert.match(rule14, /returns it all \(Rule 16\); the loop writes it/);
  assert.match(rule14, /then the loop deletes it/);
  const tail = tpl.slice(tpl.indexOf('## Automation'));
  const fence = tail.slice(tail.indexOf('```') + 3, tail.indexOf('```', tail.indexOf('```') + 3));
  assert.match(fence, /board-blind: you write its returned report to the board yourself, and first apply any recovered groom\.md, Rule 16/);
  assert.match(fence, /review the PR against the ## Goals you put in its brief/);
});
