'use strict';
// Sidebar reveal timing (t-7440): post the reveal now only into an already-visible board; a new
// panel or a hidden one (its webview is rebuilt by the reveal) defers to the webview's `ready`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { revealTiming, describeRevealTiming } = require('../out-test/reveal');

test('a new panel defers the reveal to ready', () => {
  assert.deepEqual(revealTiming(true, false), { postNow: false, reason: 'new panel' });
});

test('an existing hidden panel defers the reveal to ready', () => {
  assert.deepEqual(revealTiming(false, false), { postNow: false, reason: 'hidden panel' });
});

test('an existing visible panel gets the reveal right away', () => {
  assert.deepEqual(revealTiming(false, true), { postNow: true, reason: 'visible panel' });
});

test('the board-reveal debug line names the decision and its reason', () => {
  assert.equal(describeRevealTiming(revealTiming(true, false)), 'deferred to ready (new panel)');
  assert.equal(describeRevealTiming(revealTiming(false, false)), 'deferred to ready (hidden panel)');
  assert.equal(describeRevealTiming(revealTiming(false, true)), 'posted now (visible panel)');
});

test('controller routes the reveal through the helper and logs board-reveal at verbose', () => {
  const ctl = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.ts'), 'utf8');
  assert.match(ctl, /return revealTiming\(created, wasVisible\);/);
  assert.match(ctl, /debugLog\('verbose', 'board-reveal', describeRevealTiming\(timing\)\)/);
  assert.match(ctl, /if \(timing\.postNow\) this\.flushReveal\(\);/);
  const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel.ts'), 'utf8');
  // Visibility must be read before reveal() makes the panel visible.
  assert.ok(panel.indexOf('const wasVisible = BoardPanel.current.panel.visible;') <
    panel.indexOf('BoardPanel.current.panel.reveal('));
});
