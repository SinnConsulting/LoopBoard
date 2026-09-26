'use strict';
// What's new after an update (t-f070): the pure decision and the release-notes link. The controller
// only reads/writes globalState, opens the tab and logs; everything it decides comes from here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RELEASES_URL, parseVersion, compareVersions, isOneStep, releaseNotesUrl, decideWhatsNew, describeWhatsNew,
  currentReleaseUrl, describeWhatsNewOnDemand,
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
    assert.equal(describeWhatsNew(d), 'first install — recorded 3.26.0');
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
  assert.equal(describeWhatsNew(d), `upgrade 3.25.0 → 3.26.0 — opened tab (${TAG('3.26.0')}); recorded 3.26.0`);
});

test('upgrade with the setting off: not shown, still recorded so a later opt-in never replays it', () => {
  const d = decideWhatsNew('3.25.0', '3.26.0', false);
  assert.equal(d.kind, 'upgrade');
  assert.equal(d.show, false);
  assert.equal(d.record, true);
  assert.equal(describeWhatsNew(d), 'upgrade 3.25.0 → 3.26.0 — setting off, not shown; recorded 3.26.0');
});

test('the whats-new line: one line per activation, and a failed record is named, never "recorded"', () => {
  assert.equal(describeWhatsNew(decideWhatsNew('3.26.0', '3.26.0', true)), 'same version 3.26.0');
  assert.equal(describeWhatsNew(decideWhatsNew('3.26.0', '3.25.1', true)), 'downgrade 3.26.0 → 3.25.1 — not shown; recorded 3.25.1');
  assert.match(describeWhatsNew(decideWhatsNew('junk', '3.26.0', true)), /^unparseable version \(last seen "junk", running "3\.26\.0"\) — not shown; recorded 3\.26\.0$/);

  const err = 'disk full';
  const cases = [
    [decideWhatsNew(undefined, '3.26.0', true), 'first install — not shown; could not record 3.26.0 (disk full)'],
    [decideWhatsNew('3.25.0', '3.26.0', true), `upgrade 3.25.0 → 3.26.0 — opened tab (${TAG('3.26.0')}); could not record 3.26.0 (disk full), so it opens again on the next load`],
    [decideWhatsNew('3.25.0', '3.26.0', false), 'upgrade 3.25.0 → 3.26.0 — setting off, not shown; could not record 3.26.0 (disk full)'],
    [decideWhatsNew('3.26.0', '3.25.1', true), 'downgrade 3.26.0 → 3.25.1 — not shown; could not record 3.25.1 (disk full)'],
  ];
  for (const [d, line] of cases) {
    const out = describeWhatsNew(d, err);
    assert.equal(out, line);
    assert.ok(!/\brecorded\b/.test(out), `a failed write must not claim "recorded": ${out}`);
  }
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

// ---- on demand: the sidebar's "What's new?" link and the command (t-f070 review) ----

test('on demand links the running version\'s own release page, the list when it cannot be placed', () => {
  assert.equal(currentReleaseUrl('3.28.0'), TAG('3.28.0'));
  assert.equal(currentReleaseUrl('3.10.2'), TAG('3.10.2'));
  for (const bad of [undefined, '', '3.28', '3.28.0-beta.1', 'v3.28.0', 3]) {
    assert.equal(currentReleaseUrl(bad), LIST, JSON.stringify(bad));
  }
});

test('the whats-new-open line names the source, the version and the url, and leaves last-seen alone', () => {
  assert.equal(describeWhatsNewOnDemand('sidebar', '3.28.0', TAG('3.28.0')),
    `on demand (sidebar) — running 3.28.0, opened tab (${TAG('3.28.0')}); last-seen version untouched`);
  assert.equal(describeWhatsNewOnDemand('command', undefined, LIST),
    `on demand (command) — running version unknown, opened tab (${LIST}); last-seen version untouched`);
});

// The source text between `open(` and its matching `)`, skipping quoted strings (the labels hold
// apostrophes and question marks).
function balanced(src, open) {
  const start = src.indexOf(open);
  assert.ok(start >= 0, `missing ${open}`);
  let depth = 0;
  let quote = null;
  for (let i = start + open.indexOf('('); i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '\'' || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${open}`);
}

test('sidebar: What\'s new? | Settings | Help sit on one line, in that order, each sending its message', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'media', 'sidebar.js'), 'utf8');
  const expr = balanced(source, "h('div', { class: 'sb-links' },");
  // Evaluate the row itself with a fake `h`, so the order, the classes and the click messages are
  // the real ones rather than a pattern match on the text.
  const posted = [];
  const h = (tag, props, ...kids) => ({ tag, props: props || {}, kids: kids.flat().filter((k) => k != null) });
  const row = vm.runInNewContext(expr, {
    h, board: { helpUrl: 'https://help.example/' }, vscode: { postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) }, // out of the vm realm
  });
  const buttons = row.kids.filter((k) => k.tag === 'button');
  assert.deepEqual(buttons.map((b) => b.kids.join('')), ["What's new?", 'Settings', 'Help']);
  const seps = row.kids.filter((k) => k.tag === 'span');
  assert.equal(seps.length, 2);
  for (const s of seps) {
    assert.deepEqual(s.kids, ['|']);
    assert.equal(s.props['aria-hidden'], 'true');
  }
  assert.deepEqual(row.kids.map((k) => k.tag), ['button', 'span', 'button', 'span', 'button']);
  for (const b of buttons) b.props.onclick();
  assert.deepEqual(posted, [
    { type: 'whatsNew' }, { type: 'openSettings' }, { type: 'openLink', url: 'https://help.example/' },
  ]);
  // Only Help and the bar before it carry the class the narrow-viewport rule hides.
  const help = row.kids.filter((k) => (k.props.class || '').split(' ').includes('sb-help'));
  assert.deepEqual(help, [row.kids[3], row.kids[4]]);
});

test('sidebar CSS: the links row never wraps, and a narrow sidebar hides Help', () => {
  const css = fs.readFileSync(path.join(root, 'media', 'sidebar.css'), 'utf8');
  const rule = /\.sb-links \{([^}]*)\}/.exec(css);
  assert.ok(rule, '.sb-links rule');
  assert.match(rule[1], /display: flex;/);
  assert.match(rule[1], /white-space: nowrap;/);
  const media = /@media \(max-width: (\d+)px\) \{ \.sb-links \.sb-help \{ display: none; \} \}/.exec(css);
  assert.ok(media, 'a max-width rule hiding .sb-help');
  // Wide enough that the three labels (~215 px with the sidebar padding) never clip before Help goes.
  assert.ok(Number(media[1]) >= 220, `breakpoint ${media[1]}px`);
});

test('sidebar CSS: the links row is centred, and a very narrow sidebar tightens it so Settings fits', () => {
  const css = fs.readFileSync(path.join(root, 'media', 'sidebar.css'), 'utf8');
  const rule = /\.sb-links \{([^}]*)\}/.exec(css);
  assert.ok(rule, '.sb-links rule');
  // `safe center`: centred while it fits, start-aligned (never clipped on the left) if it overflows.
  assert.match(rule[1], /justify-content: safe center;/);
  assert.match(rule[1], /white-space: nowrap;/);
  const hide = Number(/@media \(max-width: (\d+)px\) \{ \.sb-links \.sb-help \{ display: none; \} \}/.exec(css)[1]);
  const tight = /@media \(max-width: (\d+)px\) \{ \.open-wrap \{ padding-left: (\d+)px; padding-right: (\d+)px; \} \.sb-links \{ gap: (\d+)px; \} \}/.exec(css);
  assert.ok(tight, 'a max-width rule tightening .open-wrap padding and .sb-links gap');
  // Kicks in above VS Code's 170 px minimum sidebar width, and only once Help is already gone.
  assert.ok(Number(tight[1]) > 170 && Number(tight[1]) < hide, `tight breakpoint ${tight[1]}px`);
  assert.ok(Number(tight[2]) < 16 && Number(tight[3]) < 16 && Number(tight[4]) < 8);
});

test('host: the sidebar message and the command open the tab on demand, without touching last-seen', () => {
  const ctl = fs.readFileSync(path.join(root, 'src', 'controller.ts'), 'utf8');
  assert.match(ctl, /case 'whatsNew':[^]*?return this\.showWhatsNew\('sidebar'\);/);
  const fn = ctl.slice(ctl.indexOf('  showWhatsNew(source: WhatsNewSource): void {'), ctl.indexOf('  private openWhatsNew('));
  assert.match(fn, /currentReleaseUrl\(current\)/);
  assert.match(fn, /debugLog\('info', 'whats-new-open', describeWhatsNewOnDemand\(source, current, url\)\)/);
  assert.ok(!/globalState|WHATS_NEW_LAST_SEEN_KEY/.test(fn), 'an on-demand open must not read or write last-seen');
  // An already-open tab is repainted with the new content, not only revealed.
  const open = ctl.slice(ctl.indexOf('  private openWhatsNew('), ctl.indexOf('  private postWhatsNew('));
  assert.match(open, /this\.postWhatsNew\(\);/);

  const ext = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
  assert.match(ext, /registerCommand\('loopBoard\.whatsNew', \(\) => controller\.showWhatsNew\('command'\)\)/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.contributes.commands.find((c) => c.command === 'loopBoard.whatsNew'),
    { command: 'loopBoard.whatsNew', title: "LoopBoard: What's New" });
});
