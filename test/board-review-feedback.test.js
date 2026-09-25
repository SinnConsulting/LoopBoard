'use strict';
// Editable Review feedback (t-2622). media/board.js is a webview asset the Docker suite never
// loads, so — like test/board-patch-echo.test.js — the behaviour of `renderReview` is pinned as
// source-text invariants, compiling nothing. Visual check: VERIFICATION.md item 48.
//
// The defect they pin down: saved feedback was render-only, and an always-present, always-empty
// textarea under it committed through the 'feedback' patch, whose value REPLACES every saved
// `feedback:` line (src/merge.ts) — so writing a second point silently discarded the first. The
// fix: one block with three exclusive states on `u.feedbackOpen`, the composer only while open,
// and `edit` seeding it with the full saved text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'media', 'board.js'), 'utf8');

// Body of `function <name>(` up to its matching closing brace (renderReview has no brace inside
// a string or comment, so plain depth counting is exact).
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

const review = extractFunction('renderReview');
// Code lines only, so prose comments neither fail a guard nor satisfy one.
const code = review.split('\n').filter((l) => !l.trim().startsWith('//'));

// The three branches of the feedback block, in source order.
const openAt = review.indexOf('if (u.feedbackOpen) {');
const savedAt = review.indexOf('} else if (t.feedback) {');
const emptyAt = review.indexOf('} else {', savedAt);
const composer = review.slice(openAt, savedAt);
const saved = review.slice(savedAt, emptyAt);
const empty = review.slice(emptyAt);

test('feedback is one block with three exclusive states keyed on u.feedbackOpen', () => {
  assert.ok(openAt >= 0, 'renderReview branches on u.feedbackOpen');
  assert.ok(savedAt > openAt, 'then the saved state');
  assert.ok(emptyAt > savedAt, 'then the empty state');
});

test('the feedback textarea is only built while u.feedbackOpen is set', () => {
  const textareas = code.filter((l) => l.includes("h('textarea'"));
  assert.equal(textareas.length, 1, 'renderReview builds exactly one textarea');
  assert.ok(textareas[0].includes("'data-field': 'feedback'"));
  assert.ok(composer.includes(textareas[0].trim()), 'and only inside the u.feedbackOpen branch');
  assert.doesNotMatch(saved, /h\('textarea'/, 'no empty textarea beneath the saved amber block');
  assert.doesNotMatch(empty, /h\('textarea'/, 'the empty state is a button only');
  assert.match(composer, /ta\.value = u\.feedbackDraft \|\| '';/, 'composer text comes from the draft');
});

test('the saved amber block carries edit and delete, and edit seeds the draft from t.feedback', () => {
  assert.match(saved, /class: 'amber-block'/);
  const edit = saved.split('\n').find((l) => l.includes("'edit')"));
  assert.ok(edit, 'saved block has an edit button');
  assert.match(edit, /class: 'qa-link-btn'/);
  assert.match(edit, /u\.feedbackDraft = t\.feedback;/, 'edit prefills the FULL saved value');
  assert.match(edit, /u\.feedbackOpen = true;/);
  assert.match(edit, /u\.feedbackNeedsFocus = true;/);
  const del = saved.split('\n').find((l) => l.includes("'delete')"));
  assert.ok(del, 'saved block has a delete button');
  assert.match(del, /class: 'qa-link-btn'/);
  assert.ok(del.includes("commitPatch(t.id, 'feedback', ''"), 'delete commits an empty feedback value');
  assert.match(del, /render\(\)/, 'and repaints at once');
  assert.match(saved, /renderFieldAttachmentsArea\(t\.feedback,/, 'attachment chips still render from the saved text');
});

test('the empty state is a button that opens the composer', () => {
  assert.match(empty, /class: 'qa-note-empty'/);
  assert.match(empty, /u\.feedbackOpen = true;/);
});

test('save commits through the echoing patch and closes; Escape closes without committing', () => {
  assert.ok(composer.includes("commitPatch(t.id, 'feedback', val, t.feedback || '', t, 'feedback');"));
  assert.match(composer, /u\.feedbackOpen = false;\s+render\(\);/, 'save collapses the block and repaints');
  const esc = composer.split('\n').find((l) => l.includes("e.key === 'Escape'"));
  assert.ok(esc, 'composer handles Escape');
  assert.match(esc, /exitFieldEdit\(\(\) => \{ u\.feedbackOpen = false; u\.feedbackDraft = ''; \}/);
  assert.doesNotMatch(esc, /commitPatch|sendPatch|commitFeedback/, 'Escape never commits');
  assert.match(composer, /wireFieldAttach\(ta, t\.id, 'feedback'/, 'paste/drop/＋ Attach still wire into the open editor');
});

test('renderReview adds no new un-echoed sendPatch site', () => {
  const sends = code.filter((l) => l.includes('sendPatch('));
  assert.equal(sends.length, 1, 'only the allowlisted attachment-chip callback');
  assert.ok(sends[0].includes('renderFieldAttachmentsArea(t.feedback,'));
});
