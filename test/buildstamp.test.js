'use strict';
// Host/webview build-mismatch check (t-5831). The compare is the pure `stampsDiffer` in
// src/buildstamp.ts, run for real; the host wiring (src/controller.ts, src/extension.ts) imports
// vscode, so it is pinned as source text. Live path: VERIFICATION.md item 53.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { WEBVIEW_ASSETS, stampsDiffer, describeStamp } = require('../out-test/buildstamp.js');

function stamp(overrides) {
  const s = {};
  WEBVIEW_ASSETS.forEach((name, i) => { s[name] = { size: 1000 + i, mtime: 1727290000000 + i }; });
  return Object.assign(s, overrides || {});
}

test('the stamp covers the board and sidebar webview assets', () => {
  for (const name of ['board.html', 'board.css', 'board.js', 'sidebar.html', 'sidebar.css', 'sidebar.js']) {
    assert.ok(WEBVIEW_ASSETS.includes(name), name);
    assert.ok(fs.existsSync(path.resolve(__dirname, '..', 'media', name)), name + ' exists in media/');
  }
});

test('an equal stamp is no mismatch', () => {
  assert.equal(stampsDiffer(stamp(), stamp()), false);
});

test('a size or an mtime change on any listed asset is a mismatch', () => {
  for (const name of WEBVIEW_ASSETS) {
    const base = stamp()[name];
    assert.equal(stampsDiffer(stamp(), stamp({ [name]: { size: base.size + 1, mtime: base.mtime } })), true, name + ' size');
    assert.equal(stampsDiffer(stamp(), stamp({ [name]: { size: base.size, mtime: base.mtime + 1 } })), true, name + ' mtime');
  }
});

test('a missing file on either side is a mismatch', () => {
  for (const name of WEBVIEW_ASSETS) {
    assert.equal(stampsDiffer(stamp({ [name]: null }), stamp()), true, name + ' missing at activation');
    assert.equal(stampsDiffer(stamp(), stamp({ [name]: null })), true, name + ' missing now');
    const absent = stamp();
    delete absent[name];
    assert.equal(stampsDiffer(absent, stamp()), true, name + ' absent from the stamp');
  }
});

test('describeStamp names every asset with its size@mtime, or missing', () => {
  const text = describeStamp(stamp({ 'sidebar.js': null }));
  assert.match(text, /board\.js 1002@1727290000002/);
  assert.match(text, /sidebar\.js missing/);
});

// ---- host wiring (source text) ----

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const controller = code(read('src', 'controller.ts'));
const extension = code(read('src', 'extension.ts'));

function method(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, 'expected ' + signature);
  let depth = 0;
  for (let i = src.indexOf('{', start + signature.length - 1); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + signature);
}

test('the stamp is taken at activation and again on every board ready', () => {
  assert.match(extension, /controller\.stampBuild\(\);/, 'activate stamps');
  assert.match(method(controller, 'stampBuild(): void {'), /this\.activationStamp = this\.takeBuildStamp\(\)/);
  const take = method(controller, 'private async takeBuildStamp(): Promise<BuildStamp> {');
  assert.match(take, /for \(const name of WEBVIEW_ASSETS\)/);
  assert.match(take, /vscode\.workspace\.fs\.stat\(vscode\.Uri\.joinPath\(this\.extensionUri, 'media', name\)\)/);
  assert.match(take, /stamp\[name\] = \{ size: st\.size, mtime: st\.mtime \};/);
  assert.match(take, /stamp\[name\] = null;/, 'a stat failure is recorded as missing');
  const ready = controller.slice(controller.indexOf("case 'ready':"), controller.indexOf("case 'patch':"));
  assert.match(ready, /void this\.checkBuildStamp\(\);/);
  const check = method(controller, 'private async checkBuildStamp(): Promise<void> {');
  assert.match(check, /this\.takeBuildStamp\(\)/, 'a fresh stamp on ready');
  assert.match(check, /if \(!stampsDiffer\(then, now\)\)/, 'the pure compare decides');
});

test('one Reload Window warning per window session, native, running workbench.action.reloadWindow', () => {
  const check = method(controller, 'private async checkBuildStamp(): Promise<void> {');
  const warns = check.split('\n').filter((l) => l.includes('showWarningMessage('));
  assert.equal(warns.length, 1, 'exactly one warning call');
  assert.doesNotMatch(warns[0], /modal/, 'non-modal');
  assert.match(check, /const reload = 'Reload Window';/);
  assert.match(check, /showWarningMessage\(message, reload\)/);
  assert.match(check, /if \(choice === reload\) await vscode\.commands\.executeCommand\('workbench\.action\.reloadWindow'\);/);
  assert.match(check, /if \(this\.buildMismatchWarned\) \{/, 'once per session');
  assert.ok(check.indexOf('this.buildMismatchWarned = true;') < check.indexOf('showWarningMessage('), 'armed before the popup awaits');
});

test('the mismatch, the popup and the user\'s choice are logged at info', () => {
  const check = method(controller, 'private async checkBuildStamp(): Promise<void> {');
  assert.match(check, /this\.store\.debugLog\('info', 'build-mismatch', detail\);/);
  assert.match(check, /const detail = `activation: \$\{describeStamp\(then\)\} \| now: \$\{describeStamp\(now\)\}`;/, 'both stamps');
  assert.match(check, /this\.store\.debugLog\('info', 'popup', `warning — \$\{message\}`\);/);
  assert.match(check, /this\.store\.debugLog\('info', 'popup-choice', `build-mismatch -> \$\{choice === reload \? 'reload' : 'dismissed'\}`\);/);
  assert.match(check, /this\.store\.debugLog\('info', 'build-mismatch', `\$\{detail\} — already warned this session, no popup`\);/, 'the suppressed popup is logged too');
});
