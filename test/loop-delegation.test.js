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
  assert.match(r, /EVERY Agent-tool spawn MUST pass `model` and `effort`/);
  assert.match(r, /Groomer, implementer, reviewer: `general-purpose`, `model` = your own slot model/);
  assert.match(r, /2\.1\.292\+/);
  assert.match(r, /else `medium`, the default/);
  assert.match(r, /Your own `--effort` governs only you/, 'the slot effort governs only the loop master');
});

test('template: subagent titles are <effort>-<task id>: and haiku-<task id>:', () => {
  const r = subagentsRule();
  assert.match(r, /`<effort>-<task id>: <2-4 word headline>`/);
  assert.match(r, /`high-t-4589: Swing sheet`/);
  assert.match(r, /`haiku-<task id>: <headline>`/);
});

test('template: Haiku never grooms, implements or reviews', () => {
  const r = subagentsRule();
  assert.match(r, /Haiku NEVER grooms, implements or reviews/);
  assert.match(r, /task models are never `haiku`/);
  assert.match(r, /helper never writes `\.loopboard\/`, commits, pushes or branches/);
});

test('template: the four effort signals, each with its defining phrase', () => {
  const r = subagentsRule();
  assert.match(r, /\*\*S\*\* spans 3\+ separately running or shipped parts/);
  assert.match(r, /tests and docs never count/);
  assert.match(r, /\*\*N\*\* a Goal states a threshold, timing, size, budget or count the worker must measure or pin down/);
  assert.match(r, /\*\*D\*\* the story amends or reverses a recorded decision/);
  assert.match(r, /\*\*U\*\* the approach is open \(2\+ options, none picked\), a bug's root cause is unknown, or a Goal says investigate or measure before deciding/);
});

test('template: levels, tie-break and the effort brief line', () => {
  const r = subagentsRule();
  assert.match(r, /`high` = at least one of S\/N\/D/);
  assert.match(r, /`xhigh` = at least two of S\/N\/D AND U/);
  assert.match(r, /`low` = no signal AND every Goal names the exact file and exact text or value AND no new logic branch/);
  assert.match(r, /Tie-break: a signal the story leaves unclear counts as absent — the lower level wins/);
  assert.match(r, /`effort: <level> \(<signals that held>\)`/);
  assert.match(r, /`effort: high \(D\)`/);
  assert.match(r, /re-spawned one level up \(max `xhigh`\), never pushed on/);
  assert.match(r, /A resume \(SendMessage\) keeps its spawn effort: re-spawn to change it/);
});

test('template: never fork, never max, review at the implementer\'s final effort', () => {
  const r = subagentsRule();
  assert.match(r, /Never `subagent_type: fork`/);
  assert.match(r, /never effort `max`/);
  assert.match(r, /the review runs at the implementer's final effort/);
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
  assert.equal(count(/It writes only `tasks\/<id>\.md` and its own index entry/g), 1, 'GROOM write-list once');
  assert.equal(count(/names overlapping tasks by full title/g), 1);
  assert.equal(count(/returns the title, key facts and every question filed/g), 1, 'GROOM return report once');
  assert.equal(count(/commits only its own files by explicit path/g), 1, 'WORK staging once');
  assert.equal(count(/a per-goal account, deviations and anything unverified/g), 1, 'WORK return report once');
  assert.equal(count(/Neither the implementer nor the review subagent writes any `\.loopboard\/` file/g), 1, 'WORK writes nothing under .loopboard/');
  assert.doesNotMatch(all, /Interval \(`loopBoard\.loopInterval`\), effort,/, 'the old "effort rides the spawn command" note is gone');
  assert.match(all, /your own `--effort`, grooming cap and delegated-work mode ride the spawn command/);
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

test('package.json: no slot effort description claims every subagent runs at the same effort', () => {
  const pkg = JSON.parse(read('package.json'));
  const props = {};
  for (const block of [].concat(pkg.contributes.configuration)) Object.assign(props, block.properties);
  const slots = Object.keys(props).filter((k) => /^loopBoard\.models\.[a-z]+\.effort$/.test(k));
  assert.deepEqual(slots.sort(), ['loopBoard.models.fable.effort', 'loopBoard.models.opus.effort', 'loopBoard.models.sonnet.effort']);
  for (const key of slots) {
    const d = props[key].markdownDescription;
    assert.doesNotMatch(d, /same effort|every subagent/i, `${key} still says subagents share the loop effort`);
    assert.match(d, /subagents get their effort per spawn/, `${key} names per-spawn effort`);
  }
});
