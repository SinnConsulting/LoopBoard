'use strict';
// What's new after an update (t-f070): the pure decision and the release-notes link. The controller
// only reads/writes globalState, opens the tab and logs; everything it decides comes from here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RELEASES_URL, parseVersion, compareVersions, isOneStep, releaseNotesUrl, decideWhatsNew,
} = require('../out-test/whatsnew.js');

const root = path.resolve(__dirname, '..');
const TAG = (v) => `https://github.com/SinnConsulting/LoopBoard/releases/tag/v${v}`;
const LIST = 'https://github.com/SinnConsulting/LoopBoard/releases';

// ---- the decision ----

test('first install: nothing shown, the running version recorded', () => {
  for (const on of [true, false]) {
    const d = decideWhatsNew(undefined, '3.26.0', on);
    assert.equal(d.kind, 'first-install');
    assert.equal(d.show, false);
    assert.equal(d.record, true);
    assert.match(d.reason, /first install — recorded 3\.26\.0/);
  }
});

test('same version: nothing shown, nothing written', () => {
  for (const on of [true, false]) {
    const d = decideWhatsNew('3.26.0', '3.26.0', on);
    assert.equal(d.kind, 'same');
    assert.equal(d.show, false);
    assert.equal(d.record, false);
  }
});

test('upgrade with the setting on: shown and recorded', () => {
  const d = decideWhatsNew('3.25.0', '3.26.0', true);
  assert.equal(d.kind, 'upgrade');
  assert.equal(d.show, true);
  assert.equal(d.record, true);
  assert.equal(d.url, TAG('3.26.0'));
  assert.match(d.reason, /upgrade 3\.25\.0 → 3\.26\.0/);
});

test('upgrade with the setting off: not shown, still recorded so a later opt-in never replays it', () => {
  const d = decideWhatsNew('3.25.0', '3.26.0', false);
  assert.equal(d.kind, 'upgrade');
  assert.equal(d.show, false);
  assert.equal(d.record, true);
  assert.match(d.reason, /setting off, not shown/);
});

test('downgrade: not shown, recorded', () => {
  for (const on of [true, false]) {
    const d = decideWhatsNew('3.26.0', '3.25.1', on);
    assert.equal(d.kind, 'downgrade');
    assert.equal(d.show, false);
    assert.equal(d.record, true);
  }
});

test('unparseable version (stored or running): not shown, recorded', () => {
  for (const [lastSeen, current] of [
    ['garbage', '3.26.0'], [42, '3.26.0'], [null, '3.26.0'], ['3.26', '3.26.1'],
    ['3.25.0', '3.26.0-beta.1'],
  ]) {
    const d = decideWhatsNew(lastSeen, current, true);
    assert.equal(d.kind, 'unparseable', `${JSON.stringify(lastSeen)} -> ${current}`);
    assert.equal(d.show, false);
    assert.equal(d.record, true);
  }
});

test('versions compare numerically per part: 3.10.0 is newer than 3.9.0', () => {
  assert.ok(compareVersions(parseVersion('3.10.0'), parseVersion('3.9.0')) > 0);
  assert.ok(compareVersions(parseVersion('3.9.9'), parseVersion('3.10.0')) < 0);
  assert.ok(compareVersions(parseVersion('10.0.0'), parseVersion('9.99.99')) > 0);
  const up = decideWhatsNew('3.9.0', '3.10.0', true);
  assert.equal(up.kind, 'upgrade');
  assert.equal(up.show, true);
  const down = decideWhatsNew('3.10.0', '3.9.0', true);
  assert.equal(down.kind, 'downgrade');
  assert.equal(down.show, false);
});

test('parseVersion accepts only major.minor.patch digits', () => {
  assert.deepEqual(parseVersion('3.26.0'), [3, 26, 0]);
  for (const bad of ['3.26', '3.26.0.1', 'v3.26.0', '3.26.0-beta', '', undefined, 3]) {
    assert.equal(parseVersion(bad), undefined, JSON.stringify(bad));
  }
});

// ---- the link ----

test('a one-version step links the tag release page', () => {
  assert.equal(RELEASES_URL, LIST);
  for (const [from, to] of [['3.25.0', '3.25.1'], ['3.25.3', '3.26.0'], ['3.26.2', '4.0.0']]) {
    assert.ok(isOneStep(parseVersion(from), parseVersion(to)), `${from} -> ${to}`);
    assert.equal(releaseNotesUrl(from, to), TAG(to), `${from} -> ${to}`);
    assert.equal(decideWhatsNew(from, to, true).url, TAG(to));
  }
});

test('a skip of several versions links the releases list', () => {
  for (const [from, to] of [['3.22.0', '3.26.0'], ['3.25.0', '3.25.2'], ['3.25.0', '3.26.1'], ['3.26.0', '4.0.1'], ['2.9.0', '4.0.0'], ['3.26.0', '4.1.0']]) {
    assert.ok(!isOneStep(parseVersion(from), parseVersion(to)), `${from} -> ${to}`);
    assert.equal(releaseNotesUrl(from, to), LIST, `${from} -> ${to}`);
    assert.equal(decideWhatsNew(from, to, true).url, LIST);
  }
});

// ---- no network call ----

test('nothing in src/ calls fetch, and the page CSP stays default-src none with no connect-src', () => {
  for (const file of fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(root, 'src', file), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(src), `src/${file} calls fetch`);
    assert.ok(!/XMLHttpRequest|WebSocket/.test(src), `src/${file} opens a network channel`);
  }
  const webview = fs.readFileSync(path.join(root, 'src', 'webview.ts'), 'utf8');
  assert.match(webview, /`default-src 'none'`/);
  assert.ok(!/connect-src|frame-src|child-src/.test(webview), 'the shared CSP must not open a network or frame source');
  // The What's New page is rendered by that one shared policy — not a CSP of its own.
  const panel = fs.readFileSync(path.join(root, 'src', 'whatsnewpanel.ts'), 'utf8');
  assert.match(panel, /renderHtml\([^)]*'whatsnew'\s*\)/);
  const html = fs.readFileSync(path.join(root, 'media', 'whatsnew.html'), 'utf8');
  assert.match(html, /content="\{\{csp\}\}"/);
  const js = fs.readFileSync(path.join(root, 'media', 'whatsnew.js'), 'utf8');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(js), 'media/whatsnew.js must not reach the network');
});

test('the What\'s New page is styled from VS Code theme variables only — no hard palette', () => {
  const css = fs.readFileSync(path.join(root, 'media', 'whatsnew.css'), 'utf8');
  // Every colour sits inside a var(--vscode-*) as its fallback, never on its own.
  const stripped = css.replace(/var\(--vscode-[\w-]+(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(stripped), 'a colour outside var(--vscode-*)');
});
