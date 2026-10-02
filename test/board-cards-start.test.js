'use strict';
// Card start state setting (t-c8fd). `loopBoard.cardsStartCollapsed` travels host → webview on the
// board payload; media/board.js uses it as the fallback of a phase tab with no saved Collapse all /
// Expand all, and a CHANGE of it resets every phase tab. media/board.js is a webview asset the
// Docker suite never loads, so its two helpers are lifted out of the SOURCE TEXT into a bare vm
// (the test/single-line.test.js technique) and the plumbing is pinned as source text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const boardJs = read('media', 'board.js');
const controller = read('src', 'controller.ts');
const view = read('src', 'view.ts');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'must define ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

const PHASES = ['new', 'backlog', 'inprogress', 'feedback', 'review'];

// A sandbox holding the webview's state the helpers close over.
function sandbox(state) {
  const ctx = Object.assign({
    PHASE_META: PHASES.map((key) => ({ key })),
    board: null,
    phase: 'new',
    collapsedDefault: {},
    collapsed: {},
    sections: {},
    appliedCardsCollapsed: null,
  }, state);
  vm.createContext(ctx);
  vm.runInContext(extractFunction(boardJs, 'phaseDefaultCollapsed'), ctx);
  vm.runInContext(extractFunction(boardJs, 'applyCardsStartSetting'), ctx);
  return ctx;
}

test('a tab with no saved Collapse all / Expand all falls back to the board-supplied setting', () => {
  const ctx = sandbox({ board: { cardsStartCollapsed: true }, phase: 'backlog' });
  assert.equal(ctx.phaseDefaultCollapsed(), true);
  ctx.board = { cardsStartCollapsed: false };
  assert.equal(ctx.phaseDefaultCollapsed(), false);
  ctx.board = {}; // absent (older host) = the default, collapsed
  assert.equal(ctx.phaseDefaultCollapsed(), true);
  ctx.board = null; // no board yet = the default, collapsed
  assert.equal(ctx.phaseDefaultCollapsed(), true);
  // An explicit tab value wins over the setting, both ways.
  ctx.collapsedDefault = { backlog: false };
  ctx.board = { cardsStartCollapsed: true };
  assert.equal(ctx.phaseDefaultCollapsed(), false);
  ctx.collapsedDefault = { backlog: true };
  ctx.board = { cardsStartCollapsed: false };
  assert.equal(ctx.phaseDefaultCollapsed(), true);
});

test('story sections never read the tab default or the setting', () => {
  const body = extractFunction(boardJs, 'isSectionCollapsed');
  assert.ok(!body.includes('collapsedDefault'), 'isSectionCollapsed must not read collapsedDefault');
  assert.ok(!body.includes('phaseDefaultCollapsed'), 'isSectionCollapsed must not read the tab default');
  assert.ok(!body.includes('cardsStartCollapsed'), 'isSectionCollapsed must not read the setting');
  assert.ok(!body.includes('appliedCardsCollapsed'), 'isSectionCollapsed must not read the applied setting');
});

test('nothing applied yet: the first board only records the value and resets no tab', () => {
  const sections = { backlog: { 't-1': { problem: false } } };
  const ctx = sandbox({
    collapsedDefault: { backlog: false },
    collapsed: { review: { 't-2': true } },
    sections,
  });
  assert.equal(ctx.applyCardsStartSetting(true), true, 'recording is a change to persist');
  assert.equal(ctx.appliedCardsCollapsed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.collapsedDefault)), { backlog: false });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.collapsed)), { review: { 't-2': true } });
  assert.equal(ctx.sections, sections);
});

test('a changed setting resets every phase tab; sections are untouched', () => {
  const sections = { backlog: { 't-1': { problem: false } } };
  const ctx = sandbox({
    appliedCardsCollapsed: false,
    collapsedDefault: { backlog: false, review: false },
    collapsed: { backlog: { 't-1': false }, review: { 't-2': false } },
    sections,
  });
  assert.equal(ctx.applyCardsStartSetting(true), true);
  assert.equal(ctx.appliedCardsCollapsed, true);
  for (const p of PHASES) {
    assert.equal(ctx.collapsedDefault[p], true, p + ' default follows the new value');
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.collapsed[p])), {}, p + ' overrides cleared');
  }
  assert.equal(ctx.sections, sections);
  assert.deepEqual(JSON.parse(JSON.stringify(sections)), { backlog: { 't-1': { problem: false } } });
  // And back to expanded resets again, including a tab set by hand in between.
  ctx.collapsedDefault.review = true;
  assert.equal(ctx.applyCardsStartSetting(false), true);
  for (const p of PHASES) assert.equal(ctx.collapsedDefault[p], false);
});

test('an absent setting counts as the default, collapsed', () => {
  const ctx = sandbox({ appliedCardsCollapsed: true, collapsedDefault: { backlog: false } });
  assert.equal(ctx.applyCardsStartSetting(undefined), false, 'absent = collapsed = unchanged');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.collapsedDefault)), { backlog: false });
  const fresh = sandbox({});
  assert.equal(fresh.applyCardsStartSetting(undefined), true);
  assert.equal(fresh.appliedCardsCollapsed, true);
});

test('an unchanged setting leaves hand-set tabs alone', () => {
  const ctx = sandbox({
    appliedCardsCollapsed: true,
    collapsedDefault: { backlog: false },
    collapsed: { backlog: { 't-1': true } },
  });
  assert.equal(ctx.applyCardsStartSetting(true), false);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.collapsedDefault)), { backlog: false });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.collapsed)), { backlog: { 't-1': true } });
});

test('the last-applied value is persisted and restored through the setState blob', () => {
  const save = extractFunction(boardJs, 'saveState');
  assert.match(save, /vscode\.setState\(\{[^}]*\bappliedCardsCollapsed\b/);
  assert.match(boardJs, /let appliedCardsCollapsed = typeof saved\.appliedCardsCollapsed === 'boolean' \? saved\.appliedCardsCollapsed : null;/);
  // Applied on every board, and persisted when it changed anything.
  assert.ok(extractFunction(boardJs, 'applyBoard').includes('if (applyCardsStartSetting(incoming.cardsStartCollapsed)) saveState();'));
});

test('the setting reaches the webview payload', () => {
  assert.match(controller, /cardsStartCollapsed: c\.get<boolean>\('cardsStartCollapsed', true\)/);
  const start = controller.indexOf('private async buildWebBoard(');
  assert.ok(start >= 0, 'expected buildWebBoard in src/controller.ts');
  const build = controller.slice(start, controller.indexOf('\n  }\n', start));
  assert.match(build, /web\.cardsStartCollapsed = cfg\.cardsStartCollapsed;/);
  const webBoard = view.slice(view.indexOf('export interface WebBoard'));
  assert.match(webBoard.slice(0, webBoard.indexOf('\n}')), /cardsStartCollapsed\?: boolean;/);
});
