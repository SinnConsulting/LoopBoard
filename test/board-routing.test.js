'use strict';
// t-0e99: the board's routing selects and the sidebar's single Orchestrator row. media/*.js are
// webview assets the Docker suite never loads, so, like test/board-patch-echo.test.js, these pin the
// SOURCE TEXT; what the webviews actually draw is VERIFICATION.md item 71 (untested here).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const code = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const board = code(read('media', 'board.js'));
const sidebar = code(read('media', 'sidebar.js'));

function block(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, 'expected to find: ' + marker);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('unbalanced braces after ' + marker);
}

test('every model select offers auto after the enabled models; Groom with adds On hold last', () => {
  assert.match(board, /function modelOptions\(leadOpt\) \{ return \[leadOpt\]\.concat\(\(board && board\.models\) \|\| \[\], \[AUTO\]\); \}/);
  assert.match(board, /function groomerOptions\(leadOpt\) \{ return modelOptions\(leadOpt\)\.concat\(\[GROOMER_HOLD_OPT\]\); \}/);
  assert.match(board, /const AUTO = 'auto';/);
});

test('effort selects offer low..xhigh and auto, never max; Review with offers the models, auto and none', () => {
  assert.match(board, /const EFFORT_VALUES = \['low', 'medium', 'high', 'xhigh', AUTO\];/);
  assert.ok(!/EFFORT_VALUES = \[[^\]]*'max'/.test(board), 'max is never a per-task effort');
  assert.match(board, /function reviewerValues\(\) \{ return \(\(board && board\.models\) \|\| \[\]\)\.concat\(\[AUTO, NO_REVIEW\]\); \}/);
});

test('the routing selects commit through commitSelect with the patch field as data-field', () => {
  const sel = block(board, 'function routingSelect(');
  assert.match(sel, /'data-field': field/);
  assert.match(sel, /commitSelect\(t, field, normModelValue\(e\.target\.value, leadOpt\)\)/);
  assert.match(board, /routingSelect\(t, 'groomerEffort', 'Groom effort'/);
  assert.match(board, /routingSelect\(t, 'effort', 'Work effort'/);
  assert.match(board, /routingSelect\(t, 'reviewer', 'Review with'/);
});

test('the draft card shows both effort selects but no Review with; full cards show Review with', () => {
  const draft = block(board, 'function renderDraft(');
  assert.match(draft, /groomEffortSelect\(t\)/);
  assert.match(draft, /workEffortSelect\(t\)/);
  assert.ok(!draft.includes('reviewSelect('), 'Review with is for non-draft cards and the composer');
  const selects = board.slice(board.indexOf("const selectsRow = h('div', { class: 'card-selects'"));
  const row = selects.slice(0, selects.indexOf(');') + 2);
  assert.match(row, /groomSel \? groomEffortSelect\(t\) : null/, 'groom effort only where Groom with shows (New)');
  assert.match(row, /workEffortSelect\(t\)/);
  assert.match(row, /reviewSelect\(t\)/);
});

test('the composer offers all five routing picks and sends them with the draft', () => {
  const composer = block(board, 'function renderComposer(');
  for (const label of ["'Groom with'", "'Groom effort'", "'Work with'", "'Work effort'", "'Review with'"]) {
    assert.ok(composer.includes(label), label);
  }
  assert.match(composer, /post\(\{ type: 'createDraft', text: t, \.\.\.composerRouting\(\) \}\)/);
  assert.match(composer, /type: 'createDraftWithAttach', text: t, \.\.\.composerRouting\(\),/);
  assert.match(block(board, 'function composerRouting('), /groomer: composerGroomer, groomerEffort: composerGroomerEffort, model: composerModel, effort: composerEffort, reviewer: composerReviewer/);
});

test('the sidebar talks to the host in loop ids, never in model ids', () => {
  for (const type of ['revealTerminal', 'armRestart', 'clearRestart']) {
    assert.ok(new RegExp(`type: '${type}', loop: `).test(sidebar), type);
    assert.ok(!new RegExp(`type: '${type}', model: `).test(sidebar), type + ' still sends a model');
  }
  assert.match(sidebar, /vscode\.postMessage\(\{ type: message, loop: l\.id \}\)/, 'the ▶ ♻ ■ buttons');
});

test('In Progress rows lead with the worker model and effort; Agents rows with each subagent model', () => {
  assert.match(sidebar, /h\('span', \{ class: 'agent-model' \}, t\.model \+ ' · ' \+ t\.effort\)/);
  assert.match(sidebar, /h\('span', \{ class: 'agent-model' \}, a\.model \|\| l\.name\)/);
  // A loop is "working" whenever any task is In Progress: one orchestrator does all of them.
  assert.match(sidebar, /const owns = !!\(board\.concurrency && board\.concurrency\.inProgress\.length\);/);
});

test('the host validates every loop message against the loop-id allowlist', () => {
  const controller = read('src', 'controller.ts');
  for (const type of ['spawnLoop', 'revealTerminal', 'recycleLoop', 'stopLoop', 'clearRestart']) {
    const at = controller.indexOf(`case '${type}':`);
    assert.ok(at > 0, type);
    assert.match(controller.slice(at, at + 500), /isLoopId\(msg\.loop\)/, type);
  }
  assert.ok(!controller.includes('isKnownModel('), 'the model-id allowlist for loops is gone');
});
