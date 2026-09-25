'use strict';
// Typed text given back when the board refuses a save (t-5831). media/board.js is a webview asset
// the Docker suite never loads as a module, so its two decision functions — `rescueTarget` and
// `splitHeldAnswers`, both deliberately self-contained — are lifted out of the SOURCE TEXT and run
// in a bare vm context (the test/question-status.test.js technique); the wiring around them is
// pinned as source-text invariants. Live behaviour: VERIFICATION.md items 51 and 52.
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
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const plain = (v) => JSON.parse(JSON.stringify(v)); // vm-realm objects vs deepEqual's prototype check

const rescueTarget = vm.runInNewContext('(' + extractFunction('rescueTarget') + ')');
const splitHeldAnswers = vm.runInNewContext('(' + extractFunction('splitHeldAnswers') + ')');

// ---- rescueTarget ----

test('rescueTarget: a refused feedbackAdd goes back into the add composer', () => {
  const r = plain(rescueTarget({ taskId: 't-1', field: 'feedbackAdd', value: 'please retry', base: '' }, ['old item']));
  assert.deepEqual(r, { kind: 'feedback', edit: -1, base: '', text: 'please retry' });
});

test('rescueTarget: a refused feedbackItem edit whose item still exists goes into that item\'s edit composer', () => {
  const patch = { taskId: 't-1', field: 'feedbackItem', value: 'edited', base: 'second', itemIndex: 1 };
  assert.deepEqual(plain(rescueTarget(patch, ['first', 'second'])), { kind: 'feedback', edit: 1, base: 'second', text: 'edited' });
  // An earlier item was removed and indices shifted: found by its text, like merge.ts resolves it.
  assert.deepEqual(plain(rescueTarget(patch, ['second'])), { kind: 'feedback', edit: 0, base: 'second', text: 'edited' });
});

test('rescueTarget: a refused feedbackItem edit whose item is gone goes into the add composer', () => {
  const patch = { taskId: 't-1', field: 'feedbackItem', value: 'edited', base: 'second', itemIndex: 1 };
  assert.deepEqual(plain(rescueTarget(patch, ['first'])), { kind: 'feedback', edit: -1, base: '', text: 'edited' });
  assert.deepEqual(plain(rescueTarget(patch, [])), { kind: 'feedback', edit: -1, base: '', text: 'edited' });
  assert.deepEqual(plain(rescueTarget(patch, undefined)), { kind: 'feedback', edit: -1, base: '', text: 'edited' });
});

test('rescueTarget: a refused feedback delete has no typed text to give back', () => {
  assert.equal(rescueTarget({ taskId: 't-1', field: 'feedbackItem', value: '', base: 'x', itemIndex: 0 }, ['x']), null);
});

test('rescueTarget: a refused answer retraction reopens that row, blank', () => {
  const r = plain(rescueTarget({ taskId: 't-1', field: 'answer', value: '', base: 'yes', questionIndex: 2 }, []));
  assert.deepEqual(r, { kind: 'answer', index: 2, text: '' });
});

test('rescueTarget: any field outside answers and feedback gets no rescue', () => {
  for (const field of ['answers', 'title', 'model', 'groomer', 'description', 'problem', 'goals', 'someFutureField']) {
    assert.equal(rescueTarget({ taskId: 't-1', field, value: 'typed', base: 'old' }, ['typed']), null, field);
  }
});

// ---- splitHeldAnswers ----

const questions = [
  { text: 'Q one?', answer: '' },
  { text: 'Q two?', answer: 'on disk' },
];

test('splitHeldAnswers: same question text with a differing disk answer is keep', () => {
  assert.deepEqual(plain(splitHeldAnswers({ 0: { q: 'Q one?', text: 'mine' }, 1: { q: 'Q two?', text: 'my edit' } }, questions)),
    { keep: ['0', '1'], landed: [], rescued: [] });
});

test('splitHeldAnswers: a disk answer equal to the held text is landed', () => {
  assert.deepEqual(plain(splitHeldAnswers({ 1: { q: 'Q two?', text: 'on disk' } }, questions)), { keep: [], landed: ['1'], rescued: [] });
});

test('splitHeldAnswers: a rewritten question text is rescued', () => {
  assert.deepEqual(plain(splitHeldAnswers({ 0: { q: 'Q one, before the re-groom?', text: 'mine' } }, questions)),
    { keep: [], landed: [], rescued: ['0'] });
  // Even when the new question's disk answer happens to equal the held text: it answered a different question.
  assert.deepEqual(plain(splitHeldAnswers({ 1: { q: 'Old Q two?', text: 'on disk' } }, questions)), { keep: [], landed: [], rescued: ['1'] });
});

test('splitHeldAnswers: a removed question is rescued', () => {
  assert.deepEqual(plain(splitHeldAnswers({ 2: { q: 'Q three?', text: 'mine' } }, questions)), { keep: [], landed: [], rescued: ['2'] });
  assert.deepEqual(plain(splitHeldAnswers({ 0: { q: 'Q one?', text: 'mine' } }, [])), { keep: [], landed: [], rescued: ['0'] });
});

// ---- wiring (source text) ----

const prune = code(extractFunction('pruneHeldAnswers'));

test('pruneHeldAnswers routes rescued entries into rescuedAnswers instead of deleting them', () => {
  assert.match(prune, /const split = splitHeldAnswers\(held, t\.questions\);/, 'the split decides');
  const rescuedLoop = prune.slice(prune.indexOf('for (const i of split.rescued)'), prune.indexOf('for (const i of split.landed)'));
  assert.ok(rescuedLoop.length > 0);
  assert.match(rescuedLoop, /rescuedAnswers\[taskId\]\.push\(\{ q: held\[i\]\.q, text: held\[i\]\.text \}\);/, 'moved with the question it was written for');
  assert.match(prune, /for \(const i of split\.landed\) delete held\[i\];/, 'only landed ones are simply dropped');
  assert.doesNotMatch(prune, /were dropped/, 'the old "dropped" toast is gone');
  assert.match(prune, /were kept on the card — its questions changed\./);
  assert.match(prune, /saveState\(\);/);
});

test('rescuedAnswers and rescuedFeedback ride the persisted setState blob', () => {
  const save = extractFunction('saveState');
  assert.match(save, /heldAnswers, rescuedAnswers, rescuedFeedback \}\);/);
  assert.match(source, /let rescuedAnswers = saved\.rescuedAnswers && typeof saved\.rescuedAnswers === 'object' \? saved\.rescuedAnswers : \{\};/);
  assert.match(source, /let rescuedFeedback = saved\.rescuedFeedback && typeof saved\.rescuedFeedback === 'object' \? saved\.rescuedFeedback : \{\};/);
});

test('rescued answers live only while their task is New or Feedback', () => {
  assert.match(prune, /if \(!openQuestionTask\(incoming, taskId\) \|\| !rescuedAnswers\[taskId\]\.length\) delete rescuedAnswers\[taskId\];/);
  assert.match(extractFunction('openQuestionTask'), /\['new', 'feedback'\]/);
});

test('the rescued-answer block: use on question N seeds, opens and focuses that row; × dismisses', () => {
  const block = code(extractFunction('renderRescuedAnswers'));
  assert.match(block, /'Written for a question that has changed'/);
  assert.match(block, /t\.questions\.map\(\(q, n\) => makeGateButton\(/, 'one action per current question');
  assert.match(block, /'use on question ' \+ \(n \+ 1\)/);
  const use = block.slice(block.indexOf('t.questions.map('), block.indexOf('const dismiss'));
  assert.match(use, /u\.answerDrafts\[n\] = r\.text;/);
  assert.match(use, /u\.qaEditOpen\[n\] = true;/);
  assert.match(use, /u\.qaFocus = n;/);
  assert.match(use, /dropRescuedAnswer\(t\.id, k\);/);
  assert.doesNotMatch(block, /sendPatch|commitPatch|post\(\{ type: 'patch'/, 'nothing reaches the host from here');
  assert.match(block.slice(block.indexOf('const dismiss')), /dropRescuedAnswer\(t\.id, k\); render\(\);/);
  const panel = code(extractFunction('renderQuestions'));
  assert.match(panel, /const rescued = renderRescuedAnswers\(t, u\);/, 'inside the Open questions panel');
  assert.match(panel, /setCollapsed\(isGiven\(i\) && !u\.qaEditOpen\[i\]\);/, 'an opened row stays open across the repaint');
});

test('flushAnswers resets drafts and open editors only for the rows it wrote', () => {
  const panel = code(extractFunction('renderQuestions'));
  const flush = panel.slice(panel.indexOf('const flushAnswers = (raw) => {'), panel.indexOf('const maybeFlush = () => {'));
  assert.ok(flush.length > 0);
  assert.doesNotMatch(flush, /answerDrafts = \{\}|qaEditOpen = \{\}/, 'no blanket reset');
  assert.match(flush, /const written = t\.questions\.map\(\(q, j\) => values\[j\] !== q\.answer\);/);
  assert.ok(flush.indexOf('const written') < flush.indexOf('t.questions.forEach((q, j) => { q.answer = values[j];'), 'taken before the echo overwrites disk values');
  assert.match(flush, /written\.forEach\(\(w, j\) => \{ if \(w\) \{ delete u2\.answerDrafts\[j\]; delete u2\.qaEditOpen\[j\]; \} \}\);/);
});

test('a refusal is rescued against the board that follows it, and feedback rescue clears on Save or Escape', () => {
  const apply = code(extractFunction('applyBoard'));
  assert.ok(apply.indexOf('applyRescues(incoming);') > apply.indexOf('pruneHeldAnswers(incoming);'));
  assert.ok(apply.indexOf('applyRescues(incoming);') < apply.indexOf('board = incoming;'));
  const rescues = code(extractFunction('applyRescues'));
  assert.match(rescues, /const target = rescueTarget\(patch, t\.feedback\);/, 'decided against disk\'s feedback list');
  assert.match(rescues, /rescuedFeedback\[t\.id\] = \{ field: patch\.field, value: patch\.value, base: patch\.base, itemIndex: patch\.itemIndex \};/);
  assert.match(rescues, /u\.answerDrafts\[target\.index\] = target\.text;/);
  assert.match(rescues, /u\.qaEditOpen\[target\.index\] = true;/);
  const fb = code(extractFunction('renderFeedback'));
  assert.match(fb, /rescuedFeedback\[t\.id\] && !u\.feedbackOpen \? rescueTarget\(rescuedFeedback\[t\.id\], items\) : null;/, 'reopened from the persisted copy, re-decided against current items');
  assert.match(fb, /u\.feedbackDraft = rescued\.text;/);
  const composer = code(extractFunction('renderFeedbackComposer'));
  const save = composer.slice(composer.indexOf('const commitFeedback = () => {'), composer.indexOf('const saveBtn'));
  assert.match(save, /dropRescuedFeedback\(t\.id\);/, 'Save clears it');
  const esc = composer.split('\n').find((l) => l.includes("e.key === 'Escape'"));
  assert.match(esc, /dropRescuedFeedback\(t\.id\);/, 'Escape clears it');
  assert.match(composer, /keepRescuedFeedback\(t\.id, ta\.value\);/, 'typing keeps the persisted copy current');
});
