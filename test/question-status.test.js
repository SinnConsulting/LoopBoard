'use strict';
// Question-status chip (t-4b75). media/board.js is a webview asset the Docker suite never loads as
// a module, so the ONE counting rule — `summarizeQuestions`, shared by the Open questions panel
// head and the chips-row chip — is lifted out of the SOURCE TEXT and evaluated in a bare vm
// context (it is deliberately self-contained). That covers its disk-state behaviour against the
// real function, not a copy; the webview wiring around it is pinned as source-text invariants
// (the test/board-patch-echo.test.js technique). Visual check: VERIFICATION.md item 44.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'media', 'board.js'), 'utf8');

// Body of `function <name>(` up to its matching closing brace. The functions pinned here contain
// no brace inside a string or comment, so plain depth counting is exact.
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'media/board.js must define ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

const summarizeQuestions = vm.runInNewContext('(' + extractFunction('summarizeQuestions') + ')');
const plain = (s) => JSON.parse(JSON.stringify(s)); // vm-realm arrays vs deepEqual's prototype check

test('summarizeQuestions: blank answers keep a card waiting, with the panel-head wording', () => {
  const s = plain(summarizeQuestions(['yes', '', '   '], 'feedback'));
  assert.deepEqual(s, { given: [true, false, false], answered: 1, total: 3, waiting: true, regroomPending: false, label: '1 / 3 answered' });
});

test('summarizeQuestions: a fully answered New story is re-groom pending (t-6936)', () => {
  const s = plain(summarizeQuestions(['a', 'b'], 'new'));
  assert.equal(s.label, '2 / 2 answered');
  assert.equal(s.waiting, false);
  assert.equal(s.regroomPending, true);
});

test('summarizeQuestions: a partly answered New story is waiting, not re-groom pending', () => {
  const s = plain(summarizeQuestions(['a', ''], 'new'));
  assert.equal(s.waiting, true);
  assert.equal(s.regroomPending, false);
  assert.equal(s.label, '1 / 2 answered');
});

test('summarizeQuestions: a fully answered Feedback card owes nothing', () => {
  const s = plain(summarizeQuestions(['a'], 'feedback'));
  assert.equal(s.waiting, false);
  assert.equal(s.regroomPending, false);
  assert.equal(s.label, '1 / 1 answered');
});

test('summarizeQuestions: no questions is neither waiting nor re-groom pending', () => {
  const s = plain(summarizeQuestions([], 'new'));
  assert.equal(s.total, 0);
  assert.equal(s.waiting, false);
  assert.equal(s.regroomPending, false);
});

test('summarizeQuestions: a null/undefined answer counts as blank', () => {
  assert.equal(summarizeQuestions([null, undefined, 'x'], 'feedback').answered, 1);
});

test('the held overlay (t-5e6d) feeds the shared rule: questionStatus reads effectiveAnswer', () => {
  assert.match(extractFunction('effectiveAnswer'), /heldAnswer\(t\.id, j\)/);
  assert.match(extractFunction('questionStatus'), /summarizeQuestions\(t\.questions\.map\(\(q, j\) => effectiveAnswer\(t, j\)\), t\.phase\)/);
});

test('the chip sits right after the id chip in the always-rendered chips row', () => {
  const chips = extractFunction('renderChips');
  const id = chips.indexOf('chips.append(idChip(t.id));');
  const q = chips.indexOf('const qChip = questionChip(t);');
  assert.ok(id >= 0 && q > id, 'questionChip is appended after idChip');
  assert.ok(q < chips.indexOf('holdBadge(t)'), 'and before the hold badge');
});

test('the chip is gated to question-bearing Feedback/New cards and reuses existing classes only', () => {
  const chip = extractFunction('questionChip');
  assert.match(chip, /t\.isDraft \|\| !t\.questions \|\| !t\.questions\.length/);
  assert.match(chip, /t\.phase !== 'feedback' && t\.phase !== 'new'/);
  const classes = [...chip.matchAll(/class: '([^']*)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(classes, ['chip', 'qa-pending', 'qa-pending'], 'no new CSS class — amber .qa-pending and neutral .chip');
  assert.match(chip, /'re-groom pending'/);
  assert.match(chip, /s\.label/);
});

test('the panel head has no private count and refreshes the chip in place from the same status', () => {
  const panel = extractFunction('renderQuestions');
  assert.doesNotMatch(panel, /answered\+\+|answered \+=/, 'no second copy of the counting rule');
  assert.match(panel, /const isGiven = \(j\) => questionStatus\(t\)\.given\[j\];/);
  const head = panel.slice(panel.indexOf('const updateHead = () => {'));
  const body = head.slice(0, head.indexOf('\n    };'));
  assert.match(body, /const s = questionStatus\(t\);/);
  assert.match(body, /countEl\.textContent = s\.label;/);
  assert.match(body, /pendingEl\.hidden = !s\.regroomPending;/);
  assert.match(body, /querySelector\('\.chips \[data-qchip\]'\)/);
  assert.match(body, /oldChip\.replaceWith\(newChip\)/);
});

test('renderDraft never renders the question chip', () => {
  assert.doesNotMatch(extractFunction('renderDraft'), /questionChip|renderChips/);
});
