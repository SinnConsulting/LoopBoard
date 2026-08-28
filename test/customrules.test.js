const test = require('node:test');
const assert = require('node:assert');
const {
  reconcileCustomRules, ruleId, normalizeRule,
  BLOCK_BEGIN, BLOCK_END, CUSTOM_HEADING,
} = require('../out-test/customrules');

// A minimal stand-in for `.loopboard/LOOP.md`: what matters to the reconciler is that it carries
// at least one `loopboard:sync:` marker pair (the guard) and that those pairs come out untouched.
const LOOP = [
  '<!-- loopboard:sync:loop-intro:begin -->',
  '# LOOP',
  '<!-- loopboard:sync:loop-intro:end -->',
  '',
  '<!-- loopboard:sync:rules:begin -->',
  '## Rules',
  '',
  '1. `[x]` belongs to the human only.',
  '17. `rev:` is a per-task change marker.',
  '<!-- loopboard:sync:rules:end -->',
  '',
].join('\n');

const PR_RULE = 'There must be a PR after a task has been completed';

function blockOf(text) {
  const lines = text.split('\n');
  const b = lines.findIndex((l) => l.trim() === BLOCK_BEGIN);
  const e = lines.findIndex((l) => l.trim() === BLOCK_END);
  return b === -1 || e === -1 ? null : lines.slice(b, e + 1);
}
// The rendered rule lines, in order, with their markers stripped.
function ruleTexts(text) {
  const block = blockOf(text) || [];
  return block
    .filter((l) => /^\d+\.\s/.test(l))
    .map((l) => l.replace(/^\d+\.\s+/, '').replace(/\s*<!--.*?-->\s*$/, '').trim());
}
function numbers(text) {
  return (blockOf(text) || []).filter((l) => /^\d+\.\s/.test(l)).map((l) => Number(l.match(/^(\d+)\./)[1]));
}

test('normalizeRule trims and collapses internal whitespace', () => {
  assert.strictEqual(normalizeRule('  a   b\tc '), 'a b c');
  assert.strictEqual(ruleId('a b c'), ruleId('  a   b   c  '), 'id is stable across spacing');
  assert.notStrictEqual(ruleId('a b'), ruleId('a c'));
});

test('a LOOP.md with no sync markers is left untouched (legacy full-replace guard)', () => {
  const legacy = '# LOOP\n\n## Rules\n\n1. Something.\n';
  const r = reconcileCustomRules(legacy, [PR_RULE]);
  assert.strictEqual(r.text, legacy);
  assert.deepStrictEqual([r.added, r.removed, r.adopted], [[], [], []]);
});

test('an empty setting on a file with no block creates nothing', () => {
  const r = reconcileCustomRules(LOOP, []);
  assert.strictEqual(r.text, LOOP);
  assert.strictEqual(blockOf(r.text), null);
});

test('block creation renders heading, lead-in, precedence sentence and a numbered rule', () => {
  const r = reconcileCustomRules(LOOP, [PR_RULE]);
  assert.deepStrictEqual(r.added, [PR_RULE]);
  const block = blockOf(r.text).join('\n');
  assert.ok(block.includes(CUSTOM_HEADING));
  assert.ok(block.includes('"Custom Rule 1"'), 'lead-in names the Custom Rule namespace');
  assert.ok(block.includes('"Rule 1" … "Rule 17"'), 'lead-in names the predefined namespace');
  // The settled precedence decision, asserted verbatim: it is the whole override mechanism.
  assert.ok(
    block.includes('Where a Custom Rule contradicts a predefined Rule, the Custom Rule takes')
      && block.includes('precedence in this workspace; predefined Rules otherwise apply unchanged.'),
    'lead-in carries the precedence sentence'
  );
  assert.match(block, new RegExp('1\\. ' + PR_RULE + ' <!-- loopboard:custom-rule:[0-9a-z]+ -->'));
  // The block goes after the last sync section, and every sync pair survives byte-identical.
  assert.ok(r.text.indexOf(BLOCK_BEGIN) > r.text.indexOf('<!-- loopboard:sync:rules:end -->'));
  assert.ok(r.text.includes(LOOP.split('<!-- loopboard:sync:rules:end -->')[0]));
});

test('the predefined Rules block is never touched', () => {
  const r = reconcileCustomRules(LOOP, [PR_RULE, 'Second rule']);
  const rules = r.text.split('<!-- loopboard:sync:rules:begin -->')[1].split('<!-- loopboard:sync:rules:end -->')[0];
  assert.strictEqual(rules, '\n## Rules\n\n1. `[x]` belongs to the human only.\n17. `rev:` is a per-task change marker.\n');
});

test('reconcile is a fixpoint — an unchanged setting rewrites nothing', () => {
  const once = reconcileCustomRules(LOOP, [PR_RULE, 'Second rule']).text;
  const twice = reconcileCustomRules(once, [PR_RULE, 'Second rule']);
  assert.strictEqual(twice.text, once, 'byte-identical, so the caller performs no write');
  assert.deepStrictEqual([twice.added, twice.removed, twice.adopted], [[], [], []]);
  // Also a fixpoint for the empty setting, once the marked lines are gone.
  const cleared = reconcileCustomRules(once, []).text;
  assert.strictEqual(reconcileCustomRules(cleared, []).text, cleared);
});

test('removing an entry deletes exactly its line and renumbers contiguously', () => {
  const three = reconcileCustomRules(LOOP, ['A rule', 'B rule', 'C rule']).text;
  assert.deepStrictEqual(numbers(three), [1, 2, 3]);
  const r = reconcileCustomRules(three, ['A rule', 'C rule']);
  assert.deepStrictEqual(r.removed, ['B rule']);
  assert.deepStrictEqual(ruleTexts(r.text), ['A rule', 'C rule']);
  assert.deepStrictEqual(numbers(r.text), [1, 2], 'renumbered from 1, no gap');
});

test('clearing the setting removes every marked line but keeps the block and its prose', () => {
  const two = reconcileCustomRules(LOOP, ['A rule', 'B rule']).text;
  const r = reconcileCustomRules(two, []);
  assert.deepStrictEqual(r.removed.sort(), ['A rule', 'B rule']);
  assert.deepStrictEqual(ruleTexts(r.text), []);
  const block = blockOf(r.text).join('\n');
  assert.ok(block.includes(CUSTOM_HEADING), 'the block survives an empty setting');
  assert.ok(block.includes('precedence in this workspace'), 'the lead-in survives');
});

test('hand-added unmarked lines and hand-edited prose survive verbatim, in place', () => {
  const seeded = reconcileCustomRules(LOOP, ['A rule']).text;
  // The human edits the lead-in and adds their own rule ahead of the extension's.
  const edited = seeded
    .replace(CUSTOM_HEADING, CUSTOM_HEADING + '\n\nMy own note about this workspace.')
    .replace(/^1\. A rule/m, '1. My hand-written rule\n2. A rule');
  const r = reconcileCustomRules(edited, ['A rule']);
  const block = blockOf(r.text).join('\n');
  assert.ok(block.includes('My own note about this workspace.'), 'hand-edited prose kept');
  assert.deepStrictEqual(ruleTexts(r.text), ['My hand-written rule', 'A rule'], 'order preserved');
  // ...and it is still there after a reconcile that removes every setting-owned rule.
  const cleared = reconcileCustomRules(r.text, []);
  assert.deepStrictEqual(ruleTexts(cleared.text), ['My hand-written rule']);
  assert.ok(blockOf(cleared.text).join('\n').includes('My own note about this workspace.'));
});

test('a hand-reworded marked line is adopted, not deleted, and the setting text reappears', () => {
  const seeded = reconcileCustomRules(LOOP, [PR_RULE]).text;
  const reworded = seeded.replace(PR_RULE, 'There must be a PR, always');
  const r = reconcileCustomRules(reworded, [PR_RULE]);
  assert.deepStrictEqual(r.adopted, ['There must be a PR, always']);
  assert.deepStrictEqual(r.added, [PR_RULE], "the setting's own wording is re-appended");
  assert.deepStrictEqual(ruleTexts(r.text), ['There must be a PR, always', PR_RULE]);
  // The adopted line lost its marker, so it is now the human's and survives clearing the setting.
  const block = blockOf(r.text);
  const adoptedLine = block.find((l) => l.includes('There must be a PR, always'));
  assert.ok(!adoptedLine.includes('loopboard:custom-rule:'), 'marker stripped on adoption');
  assert.deepStrictEqual(ruleTexts(reconcileCustomRules(r.text, []).text), ['There must be a PR, always']);
});

test('blank and whitespace-only setting entries are ignored', () => {
  const r = reconcileCustomRules(LOOP, ['', '   ', 'A rule']);
  assert.deepStrictEqual(r.added, ['A rule']);
  assert.deepStrictEqual(ruleTexts(r.text), ['A rule']);
});

test('a duplicate setting entry renders once', () => {
  const r = reconcileCustomRules(LOOP, ['A rule', 'A  rule ']);
  assert.deepStrictEqual(ruleTexts(r.text), ['A rule'], 'normalized to the same id');
});
