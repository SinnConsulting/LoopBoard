'use strict';
// Story-section folds (t-d5f2). media/board.js is a webview asset the Docker suite never loads, so
// — like test/board-patch-echo.test.js — these invariants are asserted over the SOURCE TEXT.
//
// What they pin down: Problem / Description / Goals with no saved override start FOLDED whatever
// Collapse all / Expand all last set, and those buttons no longer wipe the story-section
// overrides. The Open questions panel keeps the t-aee3 behaviour: it falls back to the tab
// default and the buttons reset its per-card override.
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
  const names = code.match(/const STORY_SECTION_NAMES = \[([^\]]*)\];/);
  assert.ok(names, 'expected STORY_SECTION_NAMES in media/board.js');
  const list = names[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(list.sort(), ['description', 'goals', 'problem']);
  // Same fields the card renders as story sections.
  for (const f of ['problem', 'description', 'goals']) {
    assert.ok(code.includes("{ field: '" + f + "',"), 'DETAIL_SECTIONS should carry ' + f);
  }
  const body = fnBody('isSectionCollapsed');
  assert.ok(
    body.includes("STORY_SECTION_NAMES.includes(name) ? true : phaseDefaultCollapsed()"),
    'story sections must fall back to folded; only other sections may read phaseDefaultCollapsed()'
  );
  assert.ok(!body.includes('collapsedDefault'), 'isSectionCollapsed must not read collapsedDefault directly');
  // phaseDefaultCollapsed() appears once, on the non-story branch only.
  assert.equal(body.split('phaseDefaultCollapsed()').length - 1, 1);
});

test('the Open questions panel still falls back to the tab default', () => {
  assert.ok(!code.match(/STORY_SECTION_NAMES = \[[^\]]*questions/), 'questions must not be a story section');
  assert.ok(code.includes("isSectionCollapsed(t.id, 'questions')"), 'the questions panel reads its fold via isSectionCollapsed');
});

test('Collapse all / Expand all no longer reset the whole sections[phase]', () => {
  const body = fnBody('setPhaseCollapsed');
  assert.ok(!/sections\[phase\]\s*=/.test(body), 'setPhaseCollapsed must not reassign sections[phase]');
  assert.ok(/delete tabSections\[id\]\.questions/.test(body), 'setPhaseCollapsed still resets the questions override');
  assert.ok(!/delete [^;]*\.(problem|description|goals)/.test(body), 'story-section overrides must survive');
  // Cards keep the old behaviour.
  assert.ok(body.includes('collapsedDefault[phase] = value'));
  assert.ok(body.includes('collapsed[phase] = {}'));
});
