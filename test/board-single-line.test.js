'use strict';
// The board's single-line editors and canonical held answers (t-c4d1, items 2a/2b), plus the
// draft card's composer copy (item 4). media/board.js is a webview asset the Docker suite never
// loads, so — like test/board-review-feedback.test.js — its structure is pinned as source text, and
// the self-contained pieces (the Enter branch of both keydown handlers, the paste fold, the hold
// decision in stageRow) are lifted out of the SOURCE and run in a vm against fakes; the landed
// compare (F3, F11) is run in test/refusal-rescue.test.js beside `splitHeldAnswers`, which holds it.
// Live behaviour: VERIFICATION.md "Multi-line text safety (t-c4d1)".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'media', 'board.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src', 'store.ts'), 'utf8');

// From `marker` to the brace that closes the first `{` at or after it. The blocks lifted here
// contain no unbalanced brace inside a string or regex, so plain depth counting is exact.
function extractBlock(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, 'expected to find: ' + marker);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('unbalanced braces after ' + marker);
}
const fn = (name) => extractBlock(source, 'function ' + name + '(');
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const draft = fn('renderDraft');
const questions = fn('renderQuestions');
const draftKeydown = extractBlock(draft, "ta.addEventListener('keydown', (e) => {");
const answerKeydown = extractBlock(questions, "ta.addEventListener('keydown', (e) => {");
const stageRow = extractBlock(questions, 'const stageRow = () => {');
const flushAnswers = extractBlock(questions, 'const flushAnswers = (raw) => {');
const split = fn('splitHeldAnswers'); // holds the landed test since t-5831 (PR #180)

// Run a keydown's Enter branch against a fake event; `commit` is the editor's commit function.
function enterBranch(keydown, commitName) {
  const branch = extractBlock(keydown, "if (e.key === 'Enter') {");
  return (ev) => {
    const calls = { commit: 0, prevented: 0 };
    const e = Object.assign({ key: 'Enter', shiftKey: false, isComposing: false }, ev, { preventDefault: () => { calls.prevented++; } });
    vm.runInNewContext('(function (e, ' + commitName + ') { ' + branch + ' })', {})(e, () => { calls.commit++; });
    return calls;
  };
}

test('[E1] DRAFT edit: Enter without Shift and not composing calls commitDraft', () => {
  const run = enterBranch(draftKeydown, 'commitDraft');
  assert.deepEqual(run({}), { commit: 1, prevented: 1 });
});

test('[E2] DRAFT edit: Shift+Enter is prevented and commits nothing', () => {
  const run = enterBranch(draftKeydown, 'commitDraft');
  assert.deepEqual(run({ shiftKey: true }), { commit: 0, prevented: 1 });
});

test('[E3] both editors: an Enter during IME composition returns before any commit or preventDefault', () => {
  assert.deepEqual(enterBranch(draftKeydown, 'commitDraft')({ isComposing: true }), { commit: 0, prevented: 0 });
  assert.deepEqual(enterBranch(answerKeydown, 'commitAnswer')({ isComposing: true }), { commit: 0, prevented: 0 });
  for (const kd of [draftKeydown, answerKeydown]) {
    const branch = code(extractBlock(kd, "if (e.key === 'Enter') {"));
    assert.ok(branch.indexOf('if (e.isComposing) return;') < branch.indexOf('preventDefault'), 'composing check first');
  }
});

// A fake textarea + clipboard for wireSingleLinePaste, run for real in a vm.
function paste({ text, files, value = 'ab', selectionStart = 1, selectionEnd = 1 }) {
  const ctx = { Array, Event: class { constructor(type) { this.type = type; } } };
  vm.runInNewContext(fn('wireSingleLinePaste'), ctx);
  let handler = null;
  const inputs = [];
  const ta = {
    value, selectionStart, selectionEnd,
    addEventListener: (type, f) => { if (type === 'paste') handler = f; },
    setRangeText(t, s, e) { this.value = this.value.slice(0, s) + t + this.value.slice(e); this.selectionStart = this.selectionEnd = s + t.length; },
    dispatchEvent: (ev) => inputs.push(ev.type),
  };
  ctx.wireSingleLinePaste(ta);
  let prevented = false;
  const items = (files ? [{ kind: 'file' }] : []).concat(text != null ? [{ kind: 'string' }] : []);
  handler({ clipboardData: { items, getData: (type) => (type === 'text/plain' ? text || '' : '') }, preventDefault: () => { prevented = true; } });
  return { value: ta.value, prevented, inputs, caret: ta.selectionStart };
}

test('[E4] DRAFT edit: a text paste lands at the caret with line breaks folded, replacing any selection', () => {
  assert.match(code(draft), /wireSingleLinePaste\(ta\);/, 'the DRAFT edit textarea wires the paste fold');
  const r = paste({ text: '1. x\n2. y\r\n\n3. z', value: 'DRAFT: [old]!', selectionStart: 7, selectionEnd: 12 });
  assert.equal(r.value, 'DRAFT: 1. x 2. y 3. z!', 'folded text replaces the selection');
  assert.equal(r.prevented, true);
  assert.deepEqual(r.inputs, ['input'], 'the editor hears an input event (draft + Save state)');
  assert.equal(r.caret, 'DRAFT: 1. x 2. y 3. z'.length, 'caret after the insert');
  const one = paste({ text: 'plain', value: 'ab' });
  assert.equal(one.prevented, false, 'a one-line paste stays native');
});

test('[E5] DRAFT edit: a paste carrying files returns untouched, so the card handler still stages it', () => {
  const r = paste({ text: 'caption\nline', files: true, value: 'ab' });
  assert.equal(r.prevented, false);
  assert.equal(r.value, 'ab');
  assert.deepEqual(r.inputs, []);
  const body = code(fn('wireSingleLinePaste'));
  assert.doesNotMatch(body, /stopPropagation/, 'the event still bubbles to the card');
});

test('[E6] DRAFT edit: commitDraft echoes the canonical value, Save compares canonical values, and a hint shows', () => {
  const commit = extractBlock(draft, 'const commitDraft = () => {');
  assert.match(commit, /const val = canonAnswer\(ta\.value\);/);
  assert.match(commit, /commitPatch\(t\.id, 'title', val, t\.title, t, 'title'\);/);
  assert.match(draft, /disabled: canonAnswer\(ta\.value\) === t\.title,/);
  assert.match(draft, /saveBtn\.disabled = canonAnswer\(ta\.value\) === t\.title;/);
  assert.doesNotMatch(code(draft), /ta\.value\.trim\(\) === t\.title/, 'no raw compare left');
  assert.match(draft, /h\('span', \{ class: 'qa-hint single-line-hint' \}, SINGLE_LINE_HINT\)/);
  assert.match(source, /const SINGLE_LINE_HINT = 'Enter saves · line breaks become spaces';/);
});

test('[E7] answer: Enter without Shift commits through commitAnswer; Shift+Enter is prevented and commits nothing', () => {
  const run = enterBranch(answerKeydown, 'commitAnswer');
  assert.deepEqual(run({}), { commit: 1, prevented: 1 });
  assert.deepEqual(run({ shiftKey: true }), { commit: 0, prevented: 1 });
  assert.match(questions, /const commitAnswer = \(\) => \{ stageRow\(\); maybeFlush\(\); \};/, 'the same path as Save and ⌘S');
});

test('[E8] answer: the textarea folds text pastes and leaves file pastes to wireFieldAttach', () => {
  const c = code(questions);
  assert.match(c, /wireSingleLinePaste\(ta\);/);
  assert.match(c, /const stageAnswer = wireFieldAttach\(ta, t\.id, 'answer', i,/, 'file pastes still stage through wireFieldAttach');
  // The fold itself is the shared wireSingleLinePaste, run for real in [E4]/[E5].
  const r = paste({ text: 'yes\nbut', value: '' , selectionStart: 0, selectionEnd: 0 });
  assert.equal(r.value, 'yes but');
});

test('[E9] answer: the single-line hint sits beside the ⌘V hint', () => {
  assert.match(questions, /h\('span', \{ class: 'qa-hint' \}, '⌘V pastes screenshots · ⌘S saves'\),\s+h\('span', \{ class: 'qa-hint single-line-hint' \}, SINGLE_LINE_HINT\), saveBtn\)/);
});

// [F3] and [F11] — the landed/keep compare and the changed-question branch — moved to
// test/refusal-rescue.test.js with the compare itself, which t-5831's PR #180 lifted out of
// pruneHeldAnswers into `splitHeldAnswers`.

test('[F4] stageRow holds, echoes and writes back ONE canonical value; flushAnswers and the landed test use canonAnswer', () => {
  const s = code(stageRow);
  assert.equal(s.split('canonAnswer(').length - 1, 1, 'computed once');
  assert.match(s, /const val = canonAnswer\(ta\.value\);\s+ta\.value = val;/);
  assert.match(s, /holdAnswer\(t\.id, i, q\.text, val\);/);
  assert.match(s, /summaryText\.textContent = val;/);
  assert.match(s, /refreshAnswerAttachments\(val\);/);
  const f = code(flushAnswers);
  assert.match(f, /const values = raw\.map\(canonAnswer\);/, 'the posted value');
  assert.match(f, /const value = values\.join\('\\n'\);/);
  assert.match(f, /q\.answer = values\[j\];/, 'the echo');
  assert.match(code(split), /else if \(q\.answer === canonAnswer\(held\[i\]\.text\)\) out\.landed\.push\(i\);/);
});

// The hold decision in stageRow, run for real against spies.
function stageDecision(val, diskAnswer) {
  const block = stageRow.slice(stageRow.indexOf('const isRetraction'), stageRow.indexOf('// Targeted in-place update'));
  const calls = [];
  const run = vm.runInNewContext('(function (val, q, t, i, dropHeld, commitPatch, holdAnswer) { ' + block + ' })', {});
  run(val, { text: 'Q?', answer: diskAnswer }, { id: 't-1' }, 0,
    (...a) => calls.push(['dropHeld', ...a]),
    (...a) => calls.push(['commitPatch', a[0], a[1], a[2], a[3], a[5], a[6]]),
    (...a) => calls.push(['holdAnswer', ...a]));
  return calls;
}

test('[F5] a canonical empty value on a row with no answer on disk drops the hold and holds nothing', () => {
  assert.deepEqual(stageDecision('', ''), [['dropHeld', 't-1', 0]]);
});

test('[F6] a canonical empty value on an answered row is a retraction patching `\'\'` through the single answer patch', () => {
  assert.deepEqual(stageDecision('', 'yes'), [['dropHeld', 't-1', 0], ['commitPatch', 't-1', 'answer', '', 'yes', 'answer', 0]]);
  assert.deepEqual(stageDecision('yes please', ''), [['holdAnswer', 't-1', 0, 'Q?', 'yes please']], 'a non-empty value is held');
});

test('[G9] createDraft writes the composer copy into the skeleton before serializing; renderDraft paints t.description', () => {
  const create = extractBlock(store, 'async createDraft(');
  const copy = create.indexOf('skeleton.description = draftDescription(text);');
  assert.ok(copy > 0, 'the copy is written into the skeleton');
  assert.ok(copy < create.indexOf('serializeTaskFile(skeleton, draft.title, draft.id)'), 'before serializeTaskFile');
  assert.match(store, /import \{ parseTaskFile, serializeTaskFile, draftDescription \} from '\.\/taskfile';/);
  const c = code(draft);
  assert.match(c, /if \(\(t\.description \|\| ''\)\.trim\(\)\) \{/);
  assert.match(c, /html: mdToHtml\(desc\)/);
  assert.match(c, /isCollapsedCard \? null : descEl,/, 'painted on the expanded draft card');
});
