'use strict';
// Show some love (t-b6fa): the pure decision (first at 10, "Maybe later" once at +25, never again after
// a choice), the host-owned links, the debug lines, and — as source text, since the controller and the
// webview cannot load here — the counting, the command and the card's key-only messages. The live
// card is VERIFICATION.md item 63.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  LOVE_FIRST_AT, LOVE_LATER_GAP, LOVE_GITHUB_URL, LOVE_MARKETPLACE_URL, LOVE_REDDIT_URL,
  loveLinkUrl, isLoveChoice, loveCount, parseLoveState, serializeLoveState, decideLove, applyLoveChoice,
  loveView, loveCardOf, planLoveChoice, describeLove, describeLoveOpen, describeLoveChoice, describeLoveLink,
} = require('../out-test/love.js');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const FRESH = { kind: 'fresh' };
const LINKS = ['github', 'marketplace', 'reddit'];

// The state after a choice made on whatever card is showing at `count`.
function choose(state, choice, count) {
  const plan = planLoveChoice(loveCardOf(count, state, false), state, choice, count);
  return plan.write ?? state;
}

// ---- when the card shows ----

test('the first card shows at the 10th accept, at no count from 0 to 9, and stays until a choice', () => {
  assert.equal(LOVE_FIRST_AT, 10);
  for (let c = 0; c < 10; c++) {
    const d = decideLove(c, FRESH);
    assert.equal(d.show, false, `count ${c}`);
    assert.equal(d.kind, 'not-yet');
  }
  const at = decideLove(10, FRESH);
  assert.equal(at.show, true);
  assert.equal(at.kind, 'first');
  assert.equal(at.final, false);
  for (let c = 10; c <= 500; c++) {
    const d = decideLove(c, FRESH);
    assert.equal(d.show, true, `count ${c}`);
    assert.equal(d.final, false);
  }
});

test('No thanks and each of the three links end it: never shown again at any later count', () => {
  for (const choice of ['nothanks', ...LINKS]) {
    for (const at of [10, 11, 37]) {
      const next = choose(FRESH, choice, at);
      assert.deepEqual(next, { kind: 'ended' }, `${choice} at ${at}`);
      for (let c = at; c <= at + 500; c++) assert.equal(decideLove(c, next).show, false, `${choice} at ${at}, count ${c}`);
    }
  }
});

test('Maybe later at C snoozes until C + 25: hidden at C + 24, final at C + 25, then any choice ends it', () => {
  assert.equal(LOVE_LATER_GAP, 25);
  for (const C of [10, 13, 100]) {
    const snoozed = choose(FRESH, 'later', C);
    assert.deepEqual(snoozed, { kind: 'snoozed', until: C + 25 });
    for (let c = C; c <= C + 24; c++) assert.equal(decideLove(c, snoozed).show, false, `count ${c}`);
    const final = decideLove(C + 25, snoozed);
    assert.equal(final.show, true);
    assert.equal(final.final, true);
    assert.equal(final.kind, 'final');
    // Keeps showing (final) until a choice is recorded.
    assert.equal(decideLove(C + 60, snoozed).final, true);
    // Any choice on the final card — "later" included — ends it for good.
    for (const choice of ['later', 'nothanks', ...LINKS]) {
      const next = choose(snoozed, choice, C + 25);
      assert.deepEqual(next, { kind: 'ended' }, choice);
      for (let c = C + 25; c <= C + 600; c++) assert.equal(decideLove(c, next).show, false, `${choice}, count ${c}`);
    }
  }
  assert.deepEqual(applyLoveChoice({ kind: 'snoozed', until: 35 }, 'later', 35), { kind: 'ended' });
});

test('the view: the final card is marked final (so the sidebar offers no Maybe later), the automatic card wins over on demand', () => {
  assert.deepEqual(loveView(35, { kind: 'snoozed', until: 35 }, false), { count: 35, final: true, onDemand: false });
  assert.deepEqual(loveView(10, FRESH, true), { count: 10, final: false, onDemand: false });
  assert.deepEqual(loveView(3, FRESH, true), { count: 3, final: false, onDemand: true });
  assert.deepEqual(loveView(0, { kind: 'ended' }, true), { count: 0, final: false, onDemand: true });
  assert.equal(loveView(3, FRESH, false), null);
  assert.equal(loveView(50, { kind: 'ended' }, false), null);
  assert.equal(loveCardOf(20, { kind: 'snoozed', until: 35 }, false), 'none');
  assert.equal(loveCardOf(20, { kind: 'snoozed', until: 35 }, true), 'ondemand');
});

test('stored values: a bad counter reads 0, an unknown state shape reads fresh, fresh is stored as nothing', () => {
  for (const bad of [undefined, null, -1, 1.5, '12', NaN, Infinity, {}]) assert.equal(loveCount(bad), 0, String(bad));
  assert.equal(loveCount(42), 42);
  for (const bad of [undefined, null, 'ended', 5, {}, { kind: 'snoozed' }, { kind: 'snoozed', until: '35' }, { kind: 'snoozed', until: -1 }, { kind: 'x' }]) {
    assert.deepEqual(parseLoveState(bad), FRESH, JSON.stringify(bad));
  }
  assert.deepEqual(parseLoveState({ kind: 'ended' }), { kind: 'ended' });
  assert.deepEqual(parseLoveState({ kind: 'snoozed', until: 35 }), { kind: 'snoozed', until: 35 });
  assert.equal(serializeLoveState(FRESH), undefined);
  assert.deepEqual(serializeLoveState({ kind: 'snoozed', until: 35 }), { kind: 'snoozed', until: 35 });
});

// ---- choices on each card ----

test('the on-demand card (and a stale click with no card) writes no state; Close and links only hide it', () => {
  for (const state of [FRESH, { kind: 'snoozed', until: 40 }, { kind: 'ended' }]) {
    for (const card of ['ondemand', 'none']) {
      for (const choice of ['close', ...LINKS, 'later', 'nothanks']) {
        const plan = planLoveChoice(card, state, choice, 5);
        assert.equal(plan.write, undefined, `${card} ${choice}`);
      }
      assert.equal(planLoveChoice(card, state, 'close', 5).hide, true);
      for (const k of LINKS) assert.equal(planLoveChoice(card, state, k, 5).url, loveLinkUrl(k));
    }
  }
  // Close is not a button on the automatic card: it neither writes nor hides.
  const close = planLoveChoice('first', FRESH, 'close', 10);
  assert.equal(close.write, undefined);
  assert.equal(close.hide, false);
});

// ---- the links ----

test('the three links are the host\'s own constants; anything else maps to nothing', () => {
  assert.equal(LOVE_GITHUB_URL, 'https://github.com/SinnConsulting/LoopBoard');
  assert.equal(LOVE_MARKETPLACE_URL, 'https://marketplace.visualstudio.com/items?itemName=SinnConsulting.loopboard-todo&ssr=false#review-details');
  assert.equal(LOVE_REDDIT_URL, 'https://www.reddit.com/r/LoopBoard/');
  assert.equal(loveLinkUrl('github'), LOVE_GITHUB_URL);
  assert.equal(loveLinkUrl('marketplace'), LOVE_MARKETPLACE_URL);
  assert.equal(loveLinkUrl('reddit'), LOVE_REDDIT_URL);
  for (const bad of ['later', 'nothanks', 'close', 'GitHub', '', 'https://github.com/SinnConsulting/LoopBoard',
    'constructor', '__proto__', 'toString', 'hasOwnProperty', undefined, null, 1, {}]) {
    assert.equal(loveLinkUrl(bad), undefined, String(bad));
  }
  // An unknown key opens nothing and writes nothing.
  for (const bad of ['constructor', 'https://evil.example/', 42, undefined]) {
    assert.equal(isLoveChoice(bad), false);
    const plan = planLoveChoice('first', FRESH, bad, 10);
    assert.equal(plan.url, undefined);
    assert.equal(plan.write, undefined);
    assert.equal(plan.hide, false);
  }
});

// The body of `function <name>(` up to its matching brace. The functions lifted here hold no brace
// inside a string or comment, so plain depth counting is exact (as in test/sidebar-repaint.test.js).
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'missing function ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

const sidebarJs = read('media', 'sidebar.js');
const h = (tag, props, ...kids) => ({ tag, props: props || {}, kids: kids.flat(Infinity).filter((k) => k != null && k !== false) });
const buttons = (n) => (n.tag === 'button' ? [n] : (n.kids || []).flatMap((k) => (typeof k === 'object' ? buttons(k) : [])));
const text = (n) => (typeof n === 'string' ? n : (n.kids || []).map(text).join(''));

function renderCard(love) {
  const posted = [];
  const fn = vm.runInNewContext('(' + extractFunction(sidebarJs, 'loveCard') + ')', {
    h, vscode: { postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) },
  });
  const card = fn(love);
  return { card, posted };
}

test('the card posts only a choice key — never a URL — and does not use openLink', () => {
  const fn = extractFunction(sidebarJs, 'loveCard');
  assert.ok(!/openLink|https?:|\burl\b|helpUrl/.test(fn), 'loveCard must not carry or post a URL');
  const cases = [
    [{ count: 10, final: false, onDemand: false }, ['github', 'marketplace', 'reddit', 'later', 'nothanks'], ['Star on GitHub', 'Rate on the Marketplace', 'Say hi on r/LoopBoard', 'Maybe later', 'No thanks']],
    [{ count: 35, final: true, onDemand: false }, ['github', 'marketplace', 'reddit', 'nothanks'], ['Star on GitHub', 'Rate on the Marketplace', 'Say hi on r/LoopBoard', 'No thanks']],
    [{ count: 0, final: false, onDemand: true }, ['github', 'marketplace', 'reddit', 'close'], ['Star on GitHub', 'Rate on the Marketplace', 'Say hi on r/LoopBoard', 'Close']],
  ];
  for (const [love, choices, labels] of cases) {
    const { card, posted } = renderCard(love);
    const btns = buttons(card);
    assert.deepEqual(btns.map(text), labels);
    for (const b of btns) b.props.onclick();
    assert.deepEqual(posted, choices.map((choice) => ({ type: 'love', choice })));
    for (const m of posted) assert.deepEqual(Object.keys(m), ['type', 'choice']);
  }
});

test('the headline shows the count as painted, and drops it at 0', () => {
  assert.match(text(renderCard({ count: 10, final: false, onDemand: false }).card), /You've shipped 10 tasks with LoopBoard\./);
  assert.match(text(renderCard({ count: 1, final: false, onDemand: true }).card), /You've shipped 1 task with LoopBoard\./);
  const zero = text(renderCard({ count: 0, final: false, onDemand: true }).card);
  assert.match(zero, /^Thanks for using LoopBoard!/);
  assert.ok(!/0 task/.test(zero));
});

// ---- host wiring, pinned as source text ----

const ctl = read('src', 'controller.ts');
const between = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, 'missing ' + from);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, 'missing ' + to);
  return src.slice(a, b);
};

test('the counter increments only on an applied board accept', () => {
  const accept = between(ctl, "} else if (action === 'accept') {", "} else if (action === 'demote') {");
  assert.match(accept, /if \(r\.status === 'applied'\) \{[^}]*await this\.countLoveAccept\(\);\s*\} else /);
  // Exactly one call site in the whole controller: this branch.
  assert.equal(ctl.split('this.countLoveAccept()').length - 1, 1);
  const count = between(ctl, '  private async countLoveAccept(): Promise<void> {', '\n  }\n');
  assert.match(count, /loveCount\(this\.globalState\.get<unknown>\(LOVE_COUNT_KEY\)\) \+ 1/);
  assert.match(count, /this\.globalState\.update\(LOVE_COUNT_KEY, count\)/);
  assert.match(count, /debugLog\('info', 'love', describeLove\(count, decision, countError\)\)/);
  // Nothing else writes the counter.
  assert.equal(ctl.split('update(LOVE_COUNT_KEY').length - 1, 1);
});

test('the showLove command is registered and its path neither reads nor writes the counter or the state', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.contributes.commands.find((c) => c.command === 'loopBoard.showLove'),
    { command: 'loopBoard.showLove', title: 'LoopBoard: Show Some Love' });
  const ext = read('src', 'extension.ts');
  assert.match(ext, /registerCommand\('loopBoard\.showLove', \(\) => controller\.showLove\(\)\)/);
  const fn = between(ctl, '  showLove(): void {', '\n  }\n');
  assert.ok(!/globalState|LOVE_COUNT_KEY|LOVE_STATE_KEY/.test(fn), 'showLove must not touch the counter or state');
  assert.match(fn, /this\.loveOnDemand = true;/);
  assert.match(fn, /debugLog\('info', 'love-open', describeLoveOpen\(\)\)/);
  assert.match(fn, /executeCommand\(`\$\{SidebarProvider\.viewId\}\.focus`\)/);
  // The choice handler writes the state only from the pure plan, and opens only the plan's URL.
  const choice = between(ctl, '  private async onLoveChoice(choice: unknown): Promise<void> {', '\n  }\n');
  assert.match(choice, /if \(plan\.write\) \{[^]*update\(LOVE_STATE_KEY, serializeLoveState\(plan\.write\)\)/);
  assert.ok(!/update\(LOVE_COUNT_KEY/.test(choice), 'a choice never writes the counter');
  assert.match(choice, /openExternal\(vscode\.Uri\.parse\(url\)\)/);
  assert.match(ctl, /case 'love':\s*\/\/[^\n]*\n\s*return this\.onLoveChoice\(msg\.choice\);/);
  // globalState keys, per profile — never .loopboard/.
  assert.match(ctl, /const LOVE_COUNT_KEY = 'loopboard\.love\.accepted';/);
  assert.match(ctl, /const LOVE_STATE_KEY = 'loopboard\.love\.state';/);
});

// ---- debug lines ----

test('the love line gives the reason for every branch, holds not taken included', () => {
  const S = (until) => ({ kind: 'snoozed', until });
  assert.equal(describeLove(7, decideLove(7, FRESH)), 'accept counted (7) — 7/10, not yet');
  assert.equal(describeLove(10, decideLove(10, FRESH)), 'accept counted (10) — 10/10 reached — first card shown');
  assert.equal(describeLove(12, decideLove(12, FRESH)), 'accept counted (12) — 12/10 passed — first card still showing (no choice yet)');
  assert.equal(describeLove(20, decideLove(20, S(35))), 'accept counted (20) — snoozed until 35');
  assert.equal(describeLove(35, decideLove(35, S(35))), 'accept counted (35) — snoozed until 35, reached — final card shown');
  assert.equal(describeLove(40, decideLove(40, S(35))), 'accept counted (40) — snoozed until 35, passed — final card still showing (no choice yet)');
  assert.equal(describeLove(80, decideLove(80, { kind: 'ended' })), 'accept counted (80) — ended, not shown');
  assert.equal(describeLove(3, decideLove(3, FRESH), 'disk full'), 'could not record count 3 (disk full) — 3/10, not yet');
});

test('the love-open, love-choice and love-link lines', () => {
  assert.equal(describeLoveOpen(), 'on demand (command) — card shown; counter and state untouched');
  const line = (card, state, choice, count, err) => describeLoveChoice(planLoveChoice(card, state, choice, count), err);
  assert.equal(line('first', FRESH, 'later', 12), 'later on the first card — snoozed until 37');
  assert.equal(line('first', FRESH, 'nothanks', 10), 'nothanks on the first card — ended');
  assert.equal(line('first', FRESH, 'github', 10), 'github on the first card — ended');
  assert.equal(line('final', { kind: 'snoozed', until: 35 }, 'later', 35), 'later on the final card — ended (no second snooze)');
  assert.equal(line('final', { kind: 'snoozed', until: 35 }, 'reddit', 36), 'reddit on the final card — ended');
  assert.equal(line('first', FRESH, 'close', 10), 'close on the first card — not offered there, ignored');
  assert.equal(line('ondemand', FRESH, 'close', 3), 'close on the on-demand card — hidden; counter and state untouched');
  assert.equal(line('ondemand', FRESH, 'marketplace', 3), 'marketplace on the on-demand card — hidden; counter and state untouched');
  assert.equal(line('ondemand', FRESH, 'later', 3), 'later on the on-demand card — not offered there, ignored');
  assert.equal(line('none', FRESH, 'github', 3), 'github with no card showing — nothing to hide; counter and state untouched');
  assert.equal(line('first', FRESH, 'bogus', 10), 'unknown choice "bogus" on the first card — ignored, nothing opened');
  assert.equal(line('first', FRESH, 'nothanks', 10, 'disk full'), 'nothanks on the first card — ended; could not record it (disk full), so the card shows again');
  // A failed write is only named when something was written.
  assert.equal(line('ondemand', FRESH, 'close', 3, 'disk full'), 'close on the on-demand card — hidden; counter and state untouched');
  assert.equal(describeLoveLink(LOVE_GITHUB_URL, { opened: true }), `${LOVE_GITHUB_URL} — opened`);
  assert.equal(describeLoveLink(LOVE_REDDIT_URL, { opened: false }), `${LOVE_REDDIT_URL} — not opened (no handler took it)`);
  assert.equal(describeLoveLink(LOVE_MARKETPLACE_URL, { error: 'boom' }), `${LOVE_MARKETPLACE_URL} — failed — boom`);
});

// ---- the webview side: CSS and the one-shot burst ----

test('the card CSS uses theme variables only, and reduced motion turns the burst off', () => {
  const css = read('media', 'sidebar.css');
  const start = css.indexOf('/* ---- show some love (t-b6fa) ---- */');
  assert.ok(start >= 0, 'love section in sidebar.css');
  const love = css.slice(start);
  // Every colour sits inside a var(--vscode-*) as its fallback, never on its own.
  const stripped = love.replace(/var\(--vscode-[\w-]+(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(stripped), 'a colour outside var(--vscode-*)');
  assert.match(love, /@media \(prefers-reduced-motion: reduce\) \{ \.love-burst, \.love-bit \{ animation: none !important; display: none; \} \}/);
  assert.match(love, /\.love-bit \{[^}]*animation: love-burst [^}]* 1 both;/);
  // The three links stack in one column.
  assert.match(love, /\.love-links \{ display: flex; flex-direction: column;/);
});

test('the burst is keyed to a one-shot webview flag: a repaint or a count change never replays it', () => {
  const states = [];
  let stored;
  const take = vm.runInNewContext('(function () { let loveBurstFor = null; ' + extractFunction(sidebarJs, 'takeLoveBurst') + ' return takeLoveBurst; })()', {
    vscode: { getState: () => stored, setState: (s) => { stored = s; states.push(s); } },
  });
  const first = (count) => ({ count, final: false, onDemand: false });
  assert.equal(take(first(10)), true, 'a new showing plays it');
  assert.equal(take(first(10)), false, 'a repaint does not');
  assert.equal(take(first(11)), false, 'a count change does not');
  assert.equal(take(null), false, 'the card going away plays nothing');
  assert.equal(take({ count: 3, final: false, onDemand: true }), true, 'the next showing plays it again');
  assert.equal(take({ count: 4, final: false, onDemand: true }), false);
  assert.equal(take({ count: 35, final: true, onDemand: false }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), { loveBurstFor: 'final' }); // out of the vm realm
  assert.deepEqual(states.map((s) => s.loveBurstFor), ['first', null, 'ondemand', 'final']);

  // Wiring: render takes the flag once per paint and plays only when it says so; the burst lives on
  // <body>, outside #root, so paint() never touches it; the flag survives the view being re-created.
  const render = extractFunction(sidebarJs, 'render');
  assert.match(render, /const burst = takeLoveBurst\(board\.love\);/);
  assert.match(render, /if \(burst\) playLoveBurst\(\);/);
  assert.equal(sidebarJs.split('playLoveBurst();').length - 1, 1, 'playLoveBurst is called from one place');
  assert.equal(sidebarJs.split('takeLoveBurst(board.love)').length - 1, 1, 'takeLoveBurst is taken from one place');
  const play = extractFunction(sidebarJs, 'playLoveBurst');
  assert.match(play, /document\.body\.append\(box\);/);
  assert.match(play, /setTimeout\(\(\) => box\.remove\(\), LOVE_BURST_MS\)/);
  assert.match(sidebarJs, /let loveBurstFor = \(vscode\.getState\(\) \|\| \{\}\)\.loveBurstFor \|\| null;/);
});
