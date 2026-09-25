'use strict';
// Section folds (t-d5f2). media/board.js is a webview asset the Docker suite never loads, so
// — like test/board-patch-echo.test.js — these invariants are asserted over the SOURCE TEXT.
//
// What they pin down: every section fold — Problem / Description / Goals AND the Open questions
// panel — with no saved override starts FOLDED whatever Collapse all / Expand all last set, and
// those buttons no longer touch any section override. The questions panel used to follow the tab
// default and be reset by the buttons (t-aee3); the review feedback on t-d5f2 changed that
// requirement, so its case below pins the new rule rather than the old one.
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

test('story sections with no override fall back to folded, not to the tab default', () => {
  // Same fields the card renders as story sections, all folded through isSectionCollapsed.
  for (const f of ['problem', 'description', 'goals']) {
    assert.ok(code.includes("{ field: '" + f + "',"), 'DETAIL_SECTIONS should carry ' + f);
  }
  assert.ok(code.includes('isSectionCollapsed(t.id, field)'), 'story sections read their fold via isSectionCollapsed');
  const body = fnBody('isSectionCollapsed');
  assert.ok(/\n\s*return true;\s*$/.test(body), 'a section with no override must fall back to folded');
  assert.ok(!body.includes('collapsedDefault'), 'isSectionCollapsed must not read collapsedDefault');
  assert.ok(!body.includes('phaseDefaultCollapsed'), 'isSectionCollapsed must not read the tab default');
});

test('the Open questions panel starts folded too and ignores the tab default', () => {
  // Changed requirement (t-d5f2 review feedback): the panel no longer follows the tab default.
  // It reads the same isSectionCollapsed as the story sections, whose fallback is folded for
  // every name — no per-name branch that could send `questions` back to the tab default.
  assert.ok(code.includes("isSectionCollapsed(t.id, 'questions')"), 'the questions panel reads its fold via isSectionCollapsed');
  const body = fnBody('isSectionCollapsed');
  assert.ok(!/questions|STORY_SECTION_NAMES|\? true :/.test(body), 'no per-name fallback in isSectionCollapsed');
  // Folded, the head still carries the status: count, meter and re-groom badge are appended to
  // the head, and only the rows are dropped.
  const q = code.slice(code.indexOf('function renderQuestions('));
  assert.ok(q.includes('panel.append(head);\n    if (!qFolded) panel.append(list);'), 'folded panel keeps its head, drops its rows');
  assert.ok(/h\('span', \{ class: 'qa-title' \}, 'Open questions'\), countEl, pendingEl\)/.test(q), 'head shows the count and the re-groom badge');
});

test('Collapse all / Expand all no longer touch any section override', () => {
  const body = fnBody('setPhaseCollapsed');
  assert.ok(!/sections\b/.test(body), 'setPhaseCollapsed must not read or write sections');
  assert.ok(!/delete /.test(body), 'no section override is deleted by the buttons');
  // Cards keep the old behaviour.
  assert.ok(body.includes('collapsedDefault[phase] = value'));
  assert.ok(body.includes('collapsed[phase] = {}'));
});
