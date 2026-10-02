'use strict';
// A click outside an UNCHANGED editor closes it; an edited one stays open (t-e347, amends t-4877's
// "a click outside does nothing" — still nothing saves on a click outside). media/board.js is a
// webview asset the Docker suite never loads, so — like test/board-no-autosave.test.js — the wiring
// is pinned as SOURCE-TEXT invariants, and the registry + its one listener are run for real in a
// vm against fake DOM nodes. The live clicks are VERIFICATION.md item 65, UNTESTED.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'media', 'board.js'), 'utf8');
// Code lines only, so prose comments neither fail a guard nor satisfy one.
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const src = code(source);

// From `marker` to the brace that closes the first `{` at or after it.
function block(text, marker, from) {
  const start = text.indexOf(marker, from || 0);
  assert.ok(start >= 0, 'expected ' + JSON.stringify(marker) + ' in media/board.js');
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return { text: text.slice(start, i + 1), start, end: i + 1 };
  }
  throw new Error('unbalanced braces after ' + marker);
}
const fn = (name) => block(src, 'function ' + name + '(').text;

// The one registerCleanClose call in `fnName`, split into its four arguments (each on its own line
// after the container + clean test): container, clean test, close, swap.
function registration(fnName) {
  const body = fn(fnName);
  const calls = body.split('registerCleanClose(').length - 1;
  assert.equal(calls, 1, fnName + ' registers exactly one clean close');
  const at = body.indexOf('registerCleanClose(');
  const text = body.slice(at, body.indexOf(');\n', at) + 2);
  const m = text.match(/^registerCleanClose\((\w+), \(\) => (.+),\n\s+\(\) => (\{[^\n]*\}),\n\s+\(\) => ([^\n]+)\);$/);
  assert.ok(m, fnName + ': registerCleanClose(container, () => clean, () => { close }, () => swap):\n' + text);
  return { body, text, container: m[1], clean: m[2], close: m[3], swap: m[4] };
}

const EDITORS = [
  { fn: 'renderCard', container: 'titleRow', clean: 'input.value.trim() === t.title',
    save: 'input.value.trim() === t.title',
    close: '{ u.editingTitle = false; u.titleDraft = null; }', swap: 'titleWrap.replaceChildren(titleView())' },
  { fn: 'renderDraft', container: 'draftEditor', clean: 'canonAnswer(ta.value) === t.title',
    save: 'canonAnswer(ta.value) === t.title',
    close: '{ u.editingDraft = false; u.draftText = null; }', swap: 'draftEditor.replaceWith(draftView())' },
  { fn: 'renderDetailSection', container: 'wrap', clean: 'ta.value === current()',
    save: 'ta.value === current()',
    close: '{ u.sectionEditing[field] = false; u.sectionDrafts[field] = null; }', swap: 'wrap.replaceWith(renderDetailSection(t, section))' },
  { fn: 'renderQuestions', container: 'item', clean: 'isGiven(i) && u.qaEditOpen[i] && ta.value === answerAt(i)',
    save: 'ta.value === answerAt(i)',
    close: '{ delete u.answerDrafts[i]; u.qaEditOpen[i] = false; }', swap: 'setCollapsed(true)' },
  { fn: 'renderFeedbackComposer', container: 'composer',
    clean: "!(u.feedbackDraft || '').trim() || (u.feedbackDraft || '').trim() === (u.feedbackEdit >= 0 ? u.feedbackBase : '')",
    close: '{ dropRescuedFeedback(t.id); closeFeedbackComposer(u); }',
    swap: "{ const fw = composer.closest('.feedback-wrap'); if (fw) fw.replaceWith(renderFeedback(t)); }" },
];

const COMMITS = /\bcommit\w*\(|\bcommitPatch\b|\bsendPatch\b|\bstageRow\b|\bmaybeFlush\b|\bflushAnswers\b|\bcommitFeedbackPatch\b|\bpost\(/;

test('all five editors register a click-outside close gated on their own clean test', () => {
  for (const e of EDITORS) {
    const r = registration(e.fn);
    assert.equal(r.container, e.container, e.fn + ': container');
    assert.equal(r.clean, e.clean, e.fn + ': gated on its own clean test');
    // "Clean" and "Save disabled" are the same expression, so they can never disagree. (The
    // composer's Save tests only for an empty draft; its clean test is openFeedbackComposer's.)
    if (e.save) {
      assert.ok(r.body.includes('disabled: ' + e.save + ','), e.fn + ': Save is disabled by ' + e.save);
      assert.ok(r.clean.endsWith(e.save), e.fn + ': the clean test is the Save-disabled test');
    }
  }
  // The answer row closes only when ANSWERED and open: an unanswered row's textarea is its view.
  assert.match(registration('renderQuestions').clean, /^isGiven\(i\) && u\.qaEditOpen\[i\] && /);
  // The feedback composer's test is the one openFeedbackComposer already uses to replace a composer
  // without loss.
  assert.match(fn('openFeedbackComposer'), /const pending = \(u\.feedbackDraft \|\| ''\)\.trim\(\);/);
  assert.match(fn('openFeedbackComposer'), /pending !== \(u\.feedbackEdit >= 0 \? u\.feedbackBase : ''\)/);
  // Each editor registers only while it is open: the call sits in its open branch.
  assert.ok(block(fn('renderCard'), 'if (u.editingTitle) {').text.includes('registerCleanClose('));
  assert.ok(block(fn('renderDraft'), 'if (u.editingDraft) {').text.includes('registerCleanClose('));
  assert.ok(block(fn('renderDetailSection'), 'if (u.sectionEditing[field]) {').text.includes('registerCleanClose('));
});

test('no close path commits: each only clears its own flag and draft, then repaints or collapses', () => {
  for (const e of EDITORS) {
    const r = registration(e.fn);
    assert.equal(r.close, e.close, e.fn + ': close clears exactly its own flag and draft');
    assert.equal(r.swap, e.swap, e.fn + ': swap repaints its view in place (or collapses the row)');
    assert.doesNotMatch(r.text, COMMITS, e.fn + ': the clean close calls no commit');
  }
  // The composer drops a rescued text BEFORE it closes, exactly as its Escape does.
  const fb = registration('renderFeedbackComposer').close;
  assert.ok(fb.indexOf('dropRescuedFeedback(t.id)') < fb.indexOf('closeFeedbackComposer(u)'));
  // The views a swap puts back are the renderers' own view builders, which open (never save).
  assert.match(fn('renderCard'), /const titleView = \(\) => h\('button', \{ class: 'card-title', type: 'button', onclick: \(\) => \{ u\.editingTitle = true; u\.titleDraft = t\.title; u\.titleNeedsFocus = true; render\(\); \} \}, t\.title\);/);
  assert.match(fn('renderDraft'), /onclick: \(\) => \{ u\.editingDraft = true; u\.draftText = t\.title; u\.draftNeedsFocus = true; render\(\); \} \}, t\.title\);/);
  // The shared machinery names no commit either.
  for (const name of ['registerCleanClose', 'runCleanSwaps']) assert.doesNotMatch(fn(name), COMMITS, name);
});

test('exactly one document-level capture-phase pointerdown listener, committing nothing; no blur/focusout close', () => {
  const lines = src.split('\n').filter((l) => /\bdocument\.addEventListener\('(pointerdown|mousedown|click|pointerup)'/.test(l));
  assert.deepEqual(lines.map((l) => l.trim()), ["document.addEventListener('pointerdown', (e) => {"]);
  const pd = block(src, "document.addEventListener('pointerdown'");
  assert.match(src.slice(pd.end), /^, true\);/, 'capture phase');
  assert.doesNotMatch(pd.text, COMMITS, 'the listener commits nothing');
  // A dirty editor, or one holding the target, is never closed.
  assert.match(pd.text, /const closing = cleanCloses\.filter\(\(ed\) => !ed\.container\.contains\(e\.target\) && ed\.isClean\(\)\);/);
  // The swap waits for the gesture's end; that one-shot only schedules the swaps.
  assert.match(pd.text, /window\.addEventListener\('pointerup', \(\) => setTimeout\(runCleanSwaps, 0\), \{ capture: true, once: true \}\);/);
  const windowPointer = src.split('\n').filter((l) => /\bwindow\.addEventListener\('(pointerdown|mousedown|click|pointerup)'/.test(l));
  assert.equal(windowPointer.length, 1, 'the pointerup one-shot is the only window pointer listener');
  assert.ok(pd.text.includes(windowPointer[0].trim()), 'and it is armed inside the pointerdown listener');
  // render() empties the registry before the renderers re-register.
  const render = fn('render');
  assert.ok(render.indexOf('cleanCloses = [];') >= 0 && render.indexOf('cleanCloses = [];') < render.indexOf("root.textContent = '';"));
  // No blur/focusout handler in the five renderers: Tab or a window switch closes nothing.
  for (const e of EDITORS) assert.doesNotMatch(fn(e.fn), /addEventListener\('(blur|focusout)'|\bon(blur|focusout)\b/, e.fn);
});

// The registry and its listener, run for real against fake nodes.
function harness() {
  const start = src.indexOf('let cleanCloses = [];');
  const pd = block(src, "document.addEventListener('pointerdown'");
  const snippet = src.slice(start, pd.end) + src.slice(pd.end, src.indexOf(';', pd.end) + 1);
  const docListeners = [];
  const winListeners = [];
  const timers = [];
  const ctx = {
    document: { activeElement: null, addEventListener: (type, f, opt) => docListeners.push({ type, f, opt }) },
    window: { addEventListener: (type, f, opt) => winListeners.push({ type, f, opt }) },
    setTimeout: (f) => timers.push(f),
  };
  vm.createContext(ctx);
  vm.runInContext(snippet, ctx);
  assert.equal(docListeners.length, 1);
  assert.equal(docListeners[0].type, 'pointerdown');
  assert.equal(docListeners[0].opt, true);
  const node = (name) => ({ name, isConnected: true, contains: (t) => t === name || (t && t.inside === name) });
  const log = [];
  const editor = (name, clean) => {
    const container = node(name);
    const ed = { container, clean };
    // A real swap replaces the editor's container with its view, detaching it.
    ctx.registerCleanClose(container, () => ed.clean, () => log.push('close ' + name), () => { log.push('swap ' + name); container.isConnected = false; });
    return ed;
  };
  const down = (target) => docListeners[0].f({ target });
  const up = () => {
    const once = winListeners.splice(0);
    once.forEach((l) => { assert.equal(l.type, 'pointerup'); assert.deepEqual({ ...l.opt }, { capture: true, once: true }); l.f(); });
    // The swap runs a task AFTER the pointerup, i.e. after the click the gesture dispatches.
    log.push('click');
    timers.splice(0).forEach((f) => f());
  };
  const focus = (inside) => { ctx.document.activeElement = { inside, blur: () => log.push('blur ' + inside) }; };
  return { editor, down, up, log, winListeners, focus };
}

test('a clean editor closes on an outside pointerdown and repaints after the click; an edited one stays', () => {
  const h = harness();
  h.editor('title', true);
  h.editor('section', false);
  h.down({ inside: 'elsewhere' });
  assert.deepEqual(h.log, ['close title'], 'state clears at pointerdown; the edited editor is untouched');
  assert.equal(h.winListeners.length, 1, 'one gesture end armed');
  h.up();
  assert.deepEqual(h.log, ['close title', 'click', 'swap title'], 'the view swap waits until after the click');
  h.log.length = 0;
  h.down({ inside: 'elsewhere' });
  assert.deepEqual(h.log, [], 'the edited editor stays open on every later click outside too');
});

test('a pointerdown inside an editor closes nothing there; a detached editor is never closed', () => {
  const h = harness();
  const a = h.editor('a', true);
  const b = h.editor('b', true);
  h.down({ inside: 'a' });
  assert.deepEqual(h.log, ['close b'], 'only the editor NOT holding the target closes');
  h.up();
  assert.deepEqual(h.log, ['close b', 'click', 'swap b']);
  // A card repaint detached both: neither is closed again.
  a.container.isConnected = false;
  b.container.isConnected = false;
  h.log.length = 0;
  h.down({ inside: 'elsewhere' });
  assert.deepEqual(h.log, []);
  assert.equal(h.winListeners.length, 0, 'nothing closed, no gesture end armed');
});

test('a swap whose container a repaint detached is skipped', () => {
  const h = harness();
  const ed = h.editor('d', true);
  h.down({ inside: 'elsewhere' });
  ed.container.isConnected = false; // e.g. the click's own handler called render()
  h.up();
  assert.deepEqual(h.log, ['close d', 'click']);
});

test('an editor edited and then undone back to its saved text counts as clean again', () => {
  const h = harness();
  const ed = h.editor('e', false);
  h.down({ inside: 'elsewhere' });
  assert.deepEqual(h.log, [], 'edited: stays open');
  ed.clean = true; // the clean test reads the LIVE text
  h.down({ inside: 'elsewhere' });
  assert.deepEqual(h.log, ['close e']);
});

test('a closing editor that holds focus is released, as its Escape does; focus elsewhere is left alone', () => {
  const h = harness();
  h.editor('f', true);
  h.focus('f');
  h.down({ inside: 'elsewhere' });
  assert.deepEqual(h.log, ['blur f', 'close f'], 'blurred before its state clears');
  const k = harness();
  k.editor('g', true);
  k.editor('dirty', false);
  k.focus('dirty');
  k.down({ inside: 'elsewhere' });
  assert.deepEqual(k.log, ['close g'], 'an edited editor keeps its focus');
});
