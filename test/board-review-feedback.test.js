'use strict';
// One feedback input on every card (t-2622 → t-ae10). media/board.js is a webview asset the Docker
// suite never loads, so — like test/board-patch-echo.test.js — the structure of the unified
// feedback component is pinned as source-text invariants; the one pure helper
// (`stripAttachmentLinks`) is run for real via vm extraction. Live behaviour: VERIFICATION.md
// items 13 and 48.
//
// t-2622's defect still pinned here: an always-present, always-empty textarea under the saved
// feedback committed a value that REPLACED every saved line, so writing a second point silently
// discarded the first. Its invariants carry over to the unified component, now per item: the
// composer exists only while open, and `edit` seeds it with that item's full saved text. t-ae10
// adds: one block on every card, drafts included, one row per `feedback:` line, an always-visible
// "＋ Feedback" add button, per-item patches instead of a whole-set value, and no note anywhere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const media = path.resolve(__dirname, '..', 'media');
const source = fs.readFileSync(path.join(media, 'board.js'), 'utf8');
const css = fs.readFileSync(path.join(media, 'board.css'), 'utf8');

// Body of `function <name>(` up to its matching closing brace. Braces inside the functions below
// only appear balanced in strings/regexes, so plain depth counting is exact.
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
// Code lines only, so prose comments neither fail a guard nor satisfy one.
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const block = extractFunction('renderFeedback');
const composer = extractFunction('renderFeedbackComposer');
const row = extractFunction('renderFeedbackRow');
const open = extractFunction('openFeedbackComposer');
const commit = extractFunction('commitFeedbackPatch');
const card = extractFunction('renderCard');
const draft = extractFunction('renderDraft');

test('every card renders the one feedback block: all non-draft phases and drafts', () => {
  assert.match(code(card), /card\.append\(renderFeedback\(t\)\);/, 'renderCard appends it unconditionally (every phase)');
  assert.doesNotMatch(code(card), /variant === '\w+'[^\n]*renderFeedback/, 'not gated on a phase');
  assert.match(code(draft), /isCollapsedCard \? null : renderFeedback\(t\),/, 'renderDraft renders it too');
  assert.doesNotMatch(code(extractFunction('renderReview')), /feedback/i, 'renderReview keeps only Delivered');
});

test('no note surface is left in media/', () => {
  for (const file of fs.readdirSync(media).filter((f) => /\.(js|css|html)$/.test(f))) {
    const text = fs.readFileSync(path.join(media, file), 'utf8');
    assert.doesNotMatch(text, /renderNote|u\.note|noteOpen|noteDraft|Note to worker|Review feedback'|qa-note|note-wrap/, file);
  }
  assert.doesNotMatch(code(source), /'Review feedback'|'＋ Review feedback'/);
  assert.doesNotMatch(css, /\.qa-note|\.note-wrap/, 'no note-only CSS rule survives');
});

test('one label and one look: "＋ Feedback" add button, amber rows, one hint', () => {
  const adds = code(block).split('\n').filter((l) => l.includes("'＋ Feedback'"));
  assert.equal(adds.length, 1, 'exactly one add button');
  assert.match(adds[0], /makeGateButton\(\{ class: 'feedback-add'/);
  assert.match(adds[0], /openFeedbackComposer\(u, -1, ''\)/, 'the add button opens an EMPTY add composer');
  assert.match(row, /class: 'amber-block feedback-row'/);
  assert.match(css, /\.feedback-add \{/);
  assert.match(composer, /'⌘V pastes screenshots · ⌘S saves'/);
  assert.match(composer, /\}, 'Save'\);/);
  assert.match(composer, /autoGrow\(ta\)/, 'the composer auto-grows');
});

test('saved feedback renders one row per item, and the add button stays below the list at all times', () => {
  const c = code(block);
  assert.match(c, /items\.forEach\(\(text, i\) => wrap\.append\(i === editAt \? renderFeedbackComposer\(t, u\) : renderFeedbackRow\(t, u, text, i\)\)\);/);
  const addAt = c.indexOf("'＋ Feedback'");
  assert.ok(addAt > c.indexOf('items.forEach('), 'add button after the rows');
  assert.ok(addAt > c.lastIndexOf('renderFeedbackComposer('), 'and after the add composer');
  // The add button is not inside any branch: its line is at the block's top indentation.
  const addLine = c.split('\n').find((l) => l.includes("'＋ Feedback'"));
  assert.match(addLine, /^    wrap\.append\(makeGateButton/, 'always appended, never conditional');
});

test('each row has its own chips, edit and delete; the chip × detaches through the store', () => {
  assert.match(row, /const attachments = extractAttachments\(text, t\.id\);/, 'chips from THIS item\'s line only');
  assert.match(row, /attachmentChip\(a, \(\) => detachAttachment\(t\.id, a\.path\)\)/, 'chip × = detach (deletes the file)');
  assert.doesNotMatch(row, /renderFieldAttachmentsArea/, 'no text-only strip that orphans the file');
  const edit = row.split('\n').find((l) => l.includes("'edit')"));
  assert.ok(edit, 'row has an edit button');
  assert.match(edit, /openFeedbackComposer\(u, i, text\)/, 'edit seeds the composer with THIS item\'s full saved text');
  const del = row.split('\n').find((l) => l.includes("'delete')"));
  assert.ok(del, 'row has a delete button');
  assert.match(del, /commitFeedbackPatch\(t, 'feedbackItem', '', text, i\); render\(\);/, 'delete = empty per-item patch, repaint at once');
  assert.match(row, /stripAttachmentLinks\(text, attachments\.map\(\(a\) => a\.path\)\)/, 'body strip is path-keyed');
});

test('the composer textarea only exists while open, and its text comes from the draft', () => {
  const textareas = code(source).split('\n').filter((l) => l.includes("'data-field': 'feedback'"));
  assert.equal(textareas.length, 1, 'exactly one feedback textarea in media/board.js');
  assert.ok(composer.includes(textareas[0].trim()), 'and it lives in renderFeedbackComposer');
  assert.doesNotMatch(row, /h\('textarea'/, 'no textarea beneath a saved row');
  assert.match(composer, /ta\.value = u\.feedbackDraft \|\| '';/);
  // renderFeedbackComposer is only reached through an open composer.
  const calls = code(block).split('\n').filter((l) => l.includes('renderFeedbackComposer('));
  assert.equal(calls.length, 2);
  assert.match(calls[0], /i === editAt \?/, 'the edit composer replaces exactly its own row');
  assert.match(calls[1], /if \(u\.feedbackOpen && editAt < 0\)/, 'the add composer only while open');
  assert.match(block, /editAt = items\[u\.feedbackEdit\] === u\.feedbackBase \? u\.feedbackEdit : items\.indexOf\(u\.feedbackBase\);/,
    'an open edit follows its item by text when earlier items were removed');
  assert.match(open, /u\.feedbackDraft = text;/, 'opening seeds the draft (empty for add, the item for edit)');
});

test('at most one composer per card: an open one with unsaved text is kept, never discarded', () => {
  assert.match(open, /if \(u\.feedbackOpen && pending && pending !== \(u\.feedbackEdit >= 0 \? u\.feedbackBase : ''\)\) \{/);
  const kept = open.slice(open.indexOf('if (u.feedbackOpen && pending'), open.indexOf('return;'));
  assert.doesNotMatch(kept, /feedbackDraft = |feedbackEdit = /, 'the kept composer\'s state is untouched');
  assert.match(composer, /ta\.addEventListener\('focus', \(\) => setActiveEditor\(composer, commitFeedback\)\);/, 'click-outside commits it');
});

test('save adds or edits exactly one item through the per-item patches; Escape never commits', () => {
  assert.match(composer, /if \(isEdit\) commitFeedbackPatch\(t, 'feedbackItem', val, u\.feedbackBase, u\.feedbackEdit\);/);
  assert.match(composer, /else commitFeedbackPatch\(t, 'feedbackAdd', val, ''\);/);
  assert.match(composer, /closeFeedbackComposer\(u\);\s+render\(\);/, 'save closes the composer and repaints');
  const esc = composer.split('\n').find((l) => l.includes("e.key === 'Escape'"));
  assert.ok(esc, 'composer handles Escape');
  assert.match(esc, /exitFieldEdit\(\(\) => closeFeedbackComposer\(u\), composer\)/);
  assert.doesNotMatch(esc, /commitFeedbackPatch|sendPatch|commitFeedback\(/, 'Escape never commits');
  // The echo and the post happen together; the add carries no base, the item patch its own base + index.
  assert.match(commit, /post\(\{ type: 'patch', patch: \{ taskId: t\.id, field, value, base, itemIndex: at >= 0 \? at : itemIndex \} \}\);/);
  assert.match(commit, /t\.feedback = list\.concat\(lines\);/, 'an add echoes as an append');
  assert.doesNotMatch(code(source), /'feedback', val|field: 'feedback'|commitPatch\(t\.id, 'feedback'|sendPatch\(t\.id, 'feedback'/, 'no whole-set feedback patch is left');
});

test('paste, drop and ＋ Attach stage into the composer without saving', () => {
  const staged = composer.slice(composer.indexOf("wireFieldAttach(ta, t.id, 'feedback'"), composer.indexOf('const attachBtn'));
  assert.ok(staged.length > 0, 'the composer wires field-scoped attach');
  assert.match(staged, /insertLinkAtCursor\(live, /);
  assert.doesNotMatch(staged, /commitFeedback\(|commitFeedbackPatch|post\(\{ type: 'patch'/, 'staging never commits');
  assert.match(composer, /stage\(input\.files\[0\]\)/, '＋ Attach goes through the same stage');
});

test('stripAttachmentLinks is path-keyed and label-agnostic (vm)', () => {
  const strip = vm.runInNewContext('(' + extractFunction('stripAttachmentLinks') + ')');
  const C = '.loopboard/cache/t-1a2b/';
  // Two screenshots both pasted as image.png: the second was dedupe-renamed on disk.
  const text = `fix the header [image.png](${C}image.png) and the footer [image.png](${C}image-2.png)`;
  assert.equal(strip(text, [`${C}image.png`, `${C}image-2.png`]), 'fix the header and the footer');
  // A basename-keyed strip (`[image-2.png](…/image-2.png)`) would have left the renamed link in.
  assert.equal(strip(`[image.png](${C}image-2.png)`, [`${C}image-2.png`]), '');
  assert.equal(strip(`keep [doc](https://x.test/a.png)`, [`${C}a.png`]), 'keep [doc](https://x.test/a.png)');
  assert.equal(strip('a (b) [c].d*e', [`${C}a+b(c).png`]), 'a (b) [c].d*e', 'regex metacharacters in a path are escaped');
});
