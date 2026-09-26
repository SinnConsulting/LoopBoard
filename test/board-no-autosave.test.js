'use strict';
// Where there is a Save button there is no auto-save (t-4877; reverses t-471a's click-outside
// commit and t-aee3's commit-on-collapse). media/board.js is a webview asset the Docker suite never
// loads, so — like test/board-patch-echo.test.js — the wiring is pinned as SOURCE-TEXT invariants.
// The live behaviour (click elsewhere, fold, refocus) is VERIFICATION.md item 61, UNTESTED.
//
// The five card editors with a Save button: the title (renderCard's commitTitle), the DRAFT text
// (renderDraft's commitDraft — not the New-story composer's own commitDraft), the three story
// sections (renderDetailSection's commitSection), the answer rows (renderQuestions' commitAnswer)
// and the feedback composer (renderFeedbackComposer's commitFeedback).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'media', 'board.js'), 'utf8');
// Code lines only, so prose comments neither fail a guard nor satisfy one.
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const src = code(source);

// From `marker` to the brace that closes the first `{` at or after it. Braces inside these blocks
// only appear balanced, so plain depth counting is exact.
function block(text, marker, from) {
  const start = text.indexOf(marker, from || 0);
  assert.ok(start >= 0, 'expected ' + JSON.stringify(marker) + ' in media/board.js');
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return { text: text.slice(start, i + 1), start, end: i + 1 };
  }
  throw new Error('unbalanced braces after ' + marker);
}
const fn = (name) => block(src, 'function ' + name + '(').text;

const EDITORS = [
  { fn: 'renderCard', commit: 'commitTitle' },
  { fn: 'renderDraft', commit: 'commitDraft' },
  { fn: 'renderDetailSection', commit: 'commitSection' },
  { fn: 'renderQuestions', commit: 'commitAnswer' },
  { fn: 'renderFeedbackComposer', commit: 'commitFeedback' },
];

// Every code line of `body` naming `id`, minus its own definition.
function uses(body, id) {
  const re = new RegExp('\\b' + id + '\\b');
  return body.split('\n').filter((l) => re.test(l) && !l.includes('const ' + id + ' = ')).map((l) => l.trim());
}

test('no click-outside path saves: the registry is gone and no commit rides a blur/focusout/outside hook', () => {
  assert.doesNotMatch(src, /\bsetActiveEditor\b|\bclearActiveEditor\b|\bactiveEditor\b/, 'the t-471a registry is gone');
  const docListeners = src.split('\n').filter((l) => /\bdocument\.addEventListener\(/.test(l));
  assert.ok(docListeners.length > 0, 'the guard is looking at real listeners');
  for (const l of docListeners) {
    assert.doesNotMatch(l, /'(pointerdown|mousedown|click|pointerup)'/, 'no document-level outside-click listener: ' + l.trim());
  }
  // The one document focusout listener only flushes a deferred board; it commits nothing.
  const focusout = block(src, "document.addEventListener('focusout'").text;
  assert.doesNotMatch(focusout, /commit|sendPatch|stageRow|maybeFlush/);
  const hook = /'(blur|focusout|focus|focusin|pointerdown|mousedown)'|\bon(blur|focusout|focus|pointerdown|mousedown)\b/;
  for (const e of EDITORS) {
    const body = fn(e.fn);
    for (const id of [e.commit].concat(e.commit === 'commitAnswer' ? ['stageRow', 'maybeFlush'] : [])) {
      const bad = uses(body, id).filter((l) => hook.test(l));
      assert.deepEqual(bad, [], e.fn + ': ' + id + ' is handed to a blur/focus/outside-click hook');
    }
    assert.doesNotMatch(body, /addEventListener\('(blur|focusout)'/, e.fn + ' registers no blur/focusout handler');
  }
});

test('each commit is called only from its Save, ⌘S, Enter, Accept, chip × and attach sites', () => {
  const expect = {
    commitTitle: [/^title: 'Save \(Cmd\/Ctrl\+S\)', 'aria-label': 'Save title', onclick: commitTitle,$/,
      /^if \(isSaveShortcut\(e\)\) \{ e\.preventDefault\(\); commitTitle\(\); \}$/],
    commitDraft: [/^title: 'Save \(Cmd\/Ctrl\+S\)', onclick: commitDraft,$/,
      /^if \(isSaveShortcut\(e\)\) \{ e\.preventDefault\(\); commitDraft\(\); return; \}$/,
      /^if \(!e\.shiftKey\) commitDraft\(\);$/],
    commitSection: [/^title: 'Save \(Cmd\/Ctrl\+S\)', onclick: commitSection,$/,
      /^if \(isSaveShortcut\(e\)\) \{ e\.preventDefault\(\); commitSection\(\); \}$/,
      /^commitSection\(\);$/],
    commitAnswer: [/^const area = renderFieldAttachmentsArea\(val, \(newVal\) => \{ ta\.value = newVal; commitAnswer\(\); \}, t\.id\);$/,
      /^title: 'Save \(Cmd\/Ctrl\+S\)', onclick: commitAnswer,$/,
      /^if \(isSaveShortcut\(e\)\) \{ e\.preventDefault\(\); commitAnswer\(\); return; \}$/,
      /^if \(!e\.shiftKey\) commitAnswer\(\);$/,
      /^commitAnswer\(\);$/,
      /^commits\.push\(\{ commit: commitAnswer, stage: stageRow, isDirty: /,
      /^const acceptSuggestion = \(\) => \{ ta\.value = s \+ ' accepted'; commitAnswer\(\); suggWrap\.remove\(\); \};$/],
    commitFeedback: [/^title: 'Save \(Cmd\/Ctrl\+S\)', onclick: commitFeedback,$/,
      /^if \(isSaveShortcut\(e\)\) \{ e\.preventDefault\(\); commitFeedback\(\); \}$/],
  };
  for (const e of EDITORS) {
    const got = uses(fn(e.fn), e.commit);
    assert.equal(got.length, expect[e.commit].length, e.fn + ': ' + e.commit + ' call sites\n' + got.join('\n'));
    got.forEach((l, i) => assert.match(l, expect[e.commit][i], e.fn + ': unexpected ' + e.commit + ' site'));
  }

  // Enter commits only the single-line answer and DRAFT, inside their Enter branch.
  for (const [name, id] of [['renderDraft', 'commitDraft'], ['renderQuestions', 'commitAnswer']]) {
    assert.match(block(fn(name), "if (e.key === 'Enter') {").text, new RegExp('if \\(!e\\.shiftKey\\) ' + id + '\\(\\);'));
  }
  // The bare commitSection() is the Description's attach callback only (section.attach), and the
  // bare commitAnswer() the answer's.
  const section = fn('renderDetailSection');
  const attach = block(section, 'if (section.attach) {').text;
  assert.match(block(attach, "wireFieldAttach(ta, t.id, field, undefined, (path, filename) => {").text, /commitSection\(\);/);
  assert.match(block(fn('renderQuestions'), "wireFieldAttach(ta, t.id, 'answer', i, (path, filename) => {").text, /commitAnswer\(\);/);
  // The Save All registry never calls a row's commit: it stages and flushes once.
  assert.doesNotMatch(fn('renderQuestions'), /\bc\.commit\(/);
  assert.match(fn('renderQuestions'), /onclick: \(\) => \{ commits\.filter\(\(c\) => c\.isDirty\(\)\)\.forEach\(\(c\) => c\.stage\(\)\); maybeFlush\(\); updateSaveAll\(\); \},/);
  // Suggestion Accept is reached only from its own button.
  assert.deepEqual(uses(fn('renderQuestions'), 'acceptSuggestion').length, 1);
  assert.match(uses(fn('renderQuestions'), 'acceptSuggestion')[0], /^\}, acceptSuggestion, s\)\);$/);
});

test('the Problem/Description/Goals chevron folds without saving and keeps the unsaved text', () => {
  assert.doesNotMatch(src, /\bcommitOpenEditor\b/, 'commitOpenEditor is gone');
  const toggle = fn('sectionToggle');
  assert.match(toggle, /^function sectionToggle\(taskId, name, label\) \{/, 'sectionToggle takes no commit hook');
  assert.match(toggle, /onclick: \(\) => toggleSection\(taskId, name\),/);
  assert.doesNotMatch(toggle, /commit|onBefore/);
  const section = fn('renderDetailSection');
  assert.match(section, /sectionToggle\(t\.id, field, section\.label\.toLowerCase\(\)\),/, 'no commit handed to the chevron');
  // Neither the fold itself nor the folded branch touches the editor state.
  const toggleSectionBody = fn('toggleSection');
  assert.doesNotMatch(toggleSectionBody, /sectionEditing|sectionDrafts|commit|sendPatch/);
  const folded = block(section, 'if (folded) {').text;
  assert.doesNotMatch(folded, /sectionEditing|sectionDrafts|commit/);
  // Unfolded, the still-open editor is reseeded from the unsaved draft with Save enabled against disk.
  assert.match(section, /if \(u\.sectionEditing\[field\]\) \{/);
  assert.match(section, /ta\.value = u\.sectionDrafts\[field\] != null \? u\.sectionDrafts\[field\] : current\(\);/);
  assert.match(section, /disabled: ta\.value === current\(\),/);
});

test('a click outside leaves every editor open: drafts and editing flags clear only in commit or Escape', () => {
  // Every line anywhere in media/board.js that CLEARS `name` must sit inside one of `allowed`.
  const clears = (name) => {
    const re = new RegExp('\\b' + name + '(\\[[^\\]]*\\])? = (null|false|\'\'|undefined)(?!\\w)|delete [\\w.]*\\b' + name + '\\[');
    const out = [];
    let at = 0;
    for (const l of src.split('\n')) {
      if (re.test(l)) out.push({ line: l.trim(), at: at + l.search(re) }); // offset of the clear itself
      at += l.length + 1;
    }
    return out;
  };
  const range = (marker, from) => block(src, marker, from);
  const within = (hit, ranges) => ranges.some((r) => hit.at >= r.start && hit.at < r.end);
  const check = (names, ranges, label) => {
    for (const n of names) {
      const hits = clears(n);
      assert.ok(hits.length > 0, label + ': expected ' + n + ' to be cleared somewhere');
      for (const h of hits) assert.ok(within(h, ranges), label + ': ' + n + ' cleared outside commit/Escape: ' + h.line);
    }
  };
  // The editor's own Escape branch: the first `if (e.key === 'Escape') {` after its commit, and it
  // must be the one that clears `needle` (so a different editor's Escape can never stand in).
  const escBranch = (commitMarker, fnName, needle) => {
    const r = range("if (e.key === 'Escape') {", range(commitMarker, src.indexOf('function ' + fnName + '(')).start);
    assert.ok(r.text.includes(needle), fnName + ': its Escape branch clears ' + needle);
    return r;
  };
  const commitOf = (marker, fnName) => range(marker, src.indexOf('function ' + fnName + '('));

  check(['titleDraft', 'editingTitle'],
    [commitOf('const commitTitle = () => {', 'renderCard'), escBranch('const commitTitle = () => {', 'renderCard', 'u.titleDraft = null')], 'title');
  check(['draftText', 'editingDraft'],
    [commitOf('const commitDraft = () => {', 'renderDraft'), escBranch('const commitDraft = () => {', 'renderDraft', 'u.draftText = null')], 'DRAFT');
  check(['sectionDrafts', 'sectionEditing'],
    [commitOf('const commitSection = () => {', 'renderDetailSection'),
      escBranch('const commitSection = () => {', 'renderDetailSection', 'u.sectionDrafts[field] = null')], 'section');
  // Answers: the row commit (stageRow) and the set write it leads to (flushAnswers, reached only via
  // maybeFlush — i.e. a Save, Save All, ⌘S, Enter, Accept, chip × or attach), plus Escape.
  check(['answerDrafts', 'qaEditOpen'],
    [commitOf('const stageRow = () => {', 'renderQuestions'), commitOf('const flushAnswers = (raw) => {', 'renderQuestions'),
      escBranch('const stageRow = () => {', 'renderQuestions', 'delete u.answerDrafts[i]')], 'answer');
  assert.deepEqual(uses(fn('renderQuestions'), 'flushAnswers'), ['if (values.every((v) => v.trim().length > 0)) flushAnswers(values);']);
  // The row's own edit/cancel link toggles its editor; that explicit click is the only other writer.
  const toggles = src.split('\n').filter((l) => /qaEditOpen\[i\] = !/.test(l)).map((l) => l.trim());
  assert.deepEqual(toggles, ["editBtn.addEventListener('click', () => { u.qaEditOpen[i] = !u.qaEditOpen[i]; setCollapsed(!u.qaEditOpen[i]); });"]);
  // Feedback: cleared only by closeFeedbackComposer, which only its commit and its Escape call.
  check(['feedbackDraft', 'feedbackOpen'], [range('function closeFeedbackComposer(')], 'feedback');
  const closers = src.split('\n').filter((l) => /closeFeedbackComposer\(u\)/.test(l) && !/function closeFeedbackComposer/.test(l));
  assert.equal(closers.length, 2, 'closeFeedbackComposer has exactly two callers');
  const fbRanges = [commitOf('const commitFeedback = () => {', 'renderFeedbackComposer'),
    escBranch('const commitFeedback = () => {', 'renderFeedbackComposer', 'closeFeedbackComposer(u)')];
  let at = 0;
  for (const l of src.split('\n')) {
    if (/closeFeedbackComposer\(u\)/.test(l) && !/function closeFeedbackComposer/.test(l)) {
      assert.ok(within({ at: at + l.indexOf('closeFeedbackComposer(u)') }, fbRanges), 'closeFeedbackComposer called outside commit/Escape: ' + l.trim());
    }
    at += l.length + 1;
  }
});

test('the title editor takes focus once, when it opens — not on every render', () => {
  const card = fn('renderCard');
  const focusLines = card.split('\n').filter((l) => l.includes('input.focus()')).map((l) => l.trim());
  assert.deepEqual(focusLines, ['if (u.titleNeedsFocus) { u.titleNeedsFocus = false; requestAnimationFrame(() => input.focus()); }'],
    'the only title focus is the one-shot');
  const arms = src.split('\n').filter((l) => /titleNeedsFocus = true/.test(l));
  assert.equal(arms.length, 1, 'armed in exactly one place');
  assert.match(arms[0], /class: 'card-title', type: 'button', onclick: \(\) => \{ u\.editingTitle = true; u\.titleDraft = t\.title; u\.titleNeedsFocus = true; render\(\); \}/,
    'armed where the title editor opens');
  // Same one-shot idiom as the DRAFT and section editors.
  assert.match(fn('renderDraft'), /if \(u\.draftNeedsFocus\) \{ u\.draftNeedsFocus = false; requestAnimationFrame\(\(\) => ta\.focus\(\)\); \}/);
  assert.match(fn('renderDetailSection'), /if \(u\.sectionNeedsFocus\[field\]\) \{ u\.sectionNeedsFocus\[field\] = false; requestAnimationFrame\(\(\) => ta\.focus\(\)\); \}/);
});
