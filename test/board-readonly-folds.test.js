'use strict';
// Read-only folds (t-c7e3): Delivered on a Review card and the four sections of an opened Done row
// fold like the story sections. media/board.js is a webview asset the Docker suite never loads, so
// — like test/board-section-folds.test.js — these invariants are asserted over the SOURCE TEXT.
// The rendered result is a VERIFICATION.md item.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'board.js'), 'utf8');
const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// Body of a top-level-in-IIFE `function <name>(...) { ... }`, up to its closing `  }` line.
function fnBody(name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'expected function ' + name + ' in media/board.js');
  const end = code.indexOf('\n  }\n', start);
  assert.ok(end > start, 'expected the end of function ' + name);
  return code.slice(start, end);
}

// The `if (folded) { ... }` branch of a function body, up to its closing `    }` line.
function foldedBranch(body) {
  const start = body.indexOf('if (folded) {');
  assert.ok(start >= 0, 'expected an `if (folded) {` branch');
  const end = body.indexOf('\n    }\n', start);
  assert.ok(end > start, 'expected the end of the folded branch');
  return body.slice(start, end);
}

test('renderReadOnlySection folds through isSectionCollapsed with a sectionToggle desc-head', () => {
  const body = fnBody('renderReadOnlySection');
  assert.ok(body.startsWith('function renderReadOnlySection(t, name, label, text)'), 'signature (t, name, label, text)');
  assert.ok(body.includes('const folded = isSectionCollapsed(t.id, name);'), 'reads its fold via isSectionCollapsed(t.id, name)');
  assert.match(body, /h\('div', \{ class: 'desc-head' \},\s*sectionToggle\(t\.id, name, label\.toLowerCase\(\)\),\s*h\('div', \{ class: 'section-title' \}, label\)\)/,
    'the head is a desc-head holding the sectionToggle chevron and the label');
  assert.ok(body.includes("h('div', { class: 'desc-wrap' })"), 'the fold is a desc-wrap like the story sections');
  // Read-only: no editor, no patch.
  assert.doesNotMatch(body, /textarea|commitPatch|sectionEditing|data-field/, 'no editor in a read-only fold');
});

test('folded, renderReadOnlySection appends only the head plus a descPreview preview, and never renders markdown', () => {
  const body = fnBody('renderReadOnlySection');
  const branch = foldedBranch(body);
  assert.ok(branch.includes('descPreview(text)'), 'the folded preview is descPreview of the text');
  assert.match(branch, /head\.append\(h\('div', \{ class: 'desc-preview', title: preview \}, preview\)\)/, 'preview is TEXT on the head');
  assert.match(branch, /wrap\.append\(head\);\s*return wrap;\s*$/, 'folded: the head alone goes into the wrap, then return');
  assert.doesNotMatch(branch, /mdToHtml|html:/, 'folded must not render markdown');
  // Nothing else reaches the wrap before the fold decision.
  const beforeFold = body.slice(0, body.indexOf('if (folded) {'));
  assert.doesNotMatch(beforeFold, /wrap\.append|mdToHtml/, 'nothing is appended or rendered before the fold check');
  // Open: the markdown body with the openLink wiring.
  const open = body.slice(body.indexOf('if (folded) {') + branch.length);
  assert.ok(open.includes("h('div', { class: 'done-detail-text', html: mdToHtml(text) })"), 'open renders the markdown body');
  assert.ok(open.includes("a[data-mdlink]") && open.includes("type: 'openLink'"), 'open wires links to openLink');
});

test("renderReview renders Delivered through renderReadOnlySection as 'delivered'", () => {
  const body = fnBody('renderReview');
  assert.ok(body.includes("renderReadOnlySection(t, 'delivered', 'Delivered', t.delivered)"));
  assert.ok(body.includes('if (!t.delivered) return null;'), 'no Delivered still renders no block');
  assert.doesNotMatch(body, /mdToHtml/, 'Delivered is no longer rendered open by renderReview itself');
});

test('renderDone renders its sections through renderReadOnlySection; doneDetailBlock is gone', () => {
  const body = fnBody('renderDone');
  assert.ok(body.includes('renderReadOnlySection(t, name, label, text)'), 'Done sections go through the read-only fold');
  for (const [name, label] of [['delivered', 'Delivered'], ['problem', 'Problem'], ['description', 'Description'], ['goals', 'Goals']]) {
    assert.ok(body.includes("['" + name + "', '" + label + "', t." + name + ']'), 'Done row carries ' + name);
  }
  // Order unchanged: Delivered first, then Problem → Description → Goals.
  const order = ['delivered', 'problem', 'description', 'goals'].map((n) => body.indexOf("['" + n + "',"));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'Delivered → Problem → Description → Goals');
  assert.ok(!src.includes('doneDetailBlock'), 'doneDetailBlock is neither defined nor called');
  // The row's own chevron stays transient and chevron-only.
  assert.ok(body.includes('u.doneOpen = !u.doneOpen'));
});
