'use strict';
// Sidebar in-place repaint (t-9a29 review feedback: "the hover worked once and then not anymore").
// media/sidebar.js rebuilt #root from scratch on every `board` message — and the host posts one on
// every store change and every context poll that moved, i.e. every few seconds while a loop works —
// so the hovered In Progress / Agents row was replaced under the pointer, taking its native tooltip,
// its `:hover` pause and its running marquee with it. The webview is vanilla JS the Docker suite
// never loads as a module, so the reconciler (`paint` + helpers) is lifted out of the SOURCE TEXT
// and run in a bare vm context against a minimal fake DOM (the test/question-status.test.js
// technique). The live hover itself is VERIFICATION.md item 49 (F5 only).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'media', 'sidebar.js'), 'utf8');

// Body of `function <name>(` up to its matching closing brace. The functions lifted here contain no
// brace inside a string or comment, so plain depth counting is exact.
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'media/sidebar.js must define ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

// ---- minimal fake DOM: exactly the surface paint/sign/morph/morphChildren/on touch ----
class FakeNode {
  constructor() { this.parentNode = null; }
  remove() {
    const p = this.parentNode;
    if (!p) return;
    p.childNodes.splice(p.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceWith(n) {
    const p = this.parentNode;
    n.remove();
    p.childNodes[p.childNodes.indexOf(this)] = n;
    n.parentNode = p;
    this.parentNode = null;
  }
}
class FakeText extends FakeNode {
  constructor(data) { super(); this.nodeType = 3; this.data = data; }
  get outerHTML() { return this.data; }
}
class FakeElement extends FakeNode {
  constructor(tag) { super(); this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.childNodes = []; this.listeners = 0; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  hasAttribute(n) { return this.attrs.has(n); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  addEventListener() { this.listeners++; }
  append(...kids) {
    for (let k of kids) {
      if (typeof k === 'string') k = new FakeText(k);
      k.remove();
      this.childNodes.push(k);
      k.parentNode = this;
    }
  }
  get outerHTML() {
    const t = this.tagName.toLowerCase();
    const a = [...this.attrs].map(([n, v]) => ' ' + n + '="' + v + '"').join('');
    return '<' + t + a + '>' + this.childNodes.map((c) => c.outerHTML).join('') + '</' + t + '>';
  }
}

function load() {
  const ctx = {
    wired: new WeakSet(), keep: new WeakSet(), wiredBelow: new WeakSet(), sigs: new WeakMap(),
    document: { createElement: (tag) => new FakeElement(tag) },
  };
  vm.createContext(ctx);
  for (const name of ['on', 'paint', 'sign', 'morph', 'morphChildren']) vm.runInContext(extractFunction(name), ctx);
  return ctx;
}

// A tiny h(): attributes, optional handler (through the real on()), optional keep flag.
function builder(ctx) {
  return function el(tag, attrs, ...kids) {
    const e = new FakeElement(tag);
    for (const k in attrs || {}) {
      if (k === 'onclick') ctx.on(e, 'click', attrs[k]);
      else if (k === 'keep') { if (attrs[k]) ctx.keep.add(e); }
      else e.setAttribute(k, attrs[k]);
    }
    e.append(...kids);
    return e;
  };
}

// A sidebar-shaped tree: a loop row with a wired button and a context label, an In Progress row
// (wired + keep, like media/sidebar.js marks it) and an Agents row (handler-free).
function sidebar(el, o) {
  return el('div', { class: 'sb' },
    el('div', { class: 'sb-section' },
      el('button', { class: 'icon-btn', title: 'Stop loop', onclick: () => {} }),
      el('span', { class: 'ctx-label' }, o.ctx)),
    el('div', { class: 'sb-section' },
      ...o.inProgress.map((t) => el('button', { class: 'sb-row agent click', title: t + ' (t-1)\nClick to open on the board', onclick: () => {}, keep: true },
        el('div', { class: 'loop-marquee' }, el('span', { class: 'loop-marquee-inner' }, t))))),
    el('div', { class: 'sb-section' },
      el('div', { class: 'sb-row agent', title: 'Opus · general-purpose · Implement' },
        el('div', { class: 'loop-marquee' }, el('span', { class: 'loop-marquee-inner' }, 'general-purpose · Implement')),
        el('span', { class: 'agent-duration' }, o.duration))));
}

const q = (root, sel) => {
  const found = [];
  (function walk(n) { if (n.nodeType === 1) { if ((n.getAttribute('class') || '').split(' ').includes(sel)) found.push(n); n.childNodes.forEach(walk); } })(root);
  return found;
};

test('an unchanged In Progress row is the SAME node after a repaint that changed its neighbours', () => {
  const ctx = load();
  const el = builder(ctx);
  const root = new FakeElement('div');
  ctx.paint(root, sidebar(el, { ctx: '18%', inProgress: ['Long title'], duration: '2m' }));
  const row = q(root, 'click')[0];
  const box = q(row, 'loop-marquee')[0];
  box.setAttribute('class', 'loop-marquee scrolling'); // what setupMarquees adds after paint
  ctx.paint(root, sidebar(el, { ctx: '19%', inProgress: ['Long title'], duration: '3m' }));
  assert.equal(q(root, 'click')[0], row, 'the hovered row must not be replaced (tooltip + :hover live on it)');
  assert.equal(q(row, 'loop-marquee')[0].getAttribute('class'), 'loop-marquee scrolling', 'its running marquee is untouched');
  assert.equal(q(root, 'ctx-label')[0].childNodes[0].data, '19%', 'the changed neighbour still repaints');
});

test('an Agents row whose duration ticked keeps its node and its marquee, only the text changes', () => {
  const ctx = load();
  const el = builder(ctx);
  const root = new FakeElement('div');
  ctx.paint(root, sidebar(el, { ctx: '18%', inProgress: [], duration: '2m' }));
  const row = q(root, 'agent')[0];
  const box = q(row, 'loop-marquee')[0];
  box.setAttribute('class', 'loop-marquee scrolling');
  ctx.paint(root, sidebar(el, { ctx: '18%', inProgress: [], duration: '3m' }));
  assert.equal(q(root, 'agent')[0], row);
  assert.equal(q(row, 'loop-marquee')[0], box);
  assert.equal(box.getAttribute('class'), 'loop-marquee scrolling');
  assert.equal(q(row, 'agent-duration')[0].childNodes[0].data, '3m');
});

test('an unchanged wired element NOT marked keep is still rebuilt, so no handler goes stale', () => {
  const ctx = load();
  const el = builder(ctx);
  const root = new FakeElement('div');
  ctx.paint(root, sidebar(el, { ctx: '18%', inProgress: [], duration: '2m' }));
  const btn = q(root, 'icon-btn')[0];
  ctx.paint(root, sidebar(el, { ctx: '18%', inProgress: [], duration: '2m' }));
  assert.notEqual(q(root, 'icon-btn')[0], btn);
  assert.equal(q(root, 'icon-btn')[0].listeners, 1);
});

test('a keep row whose content changed is replaced, and rows come and go', () => {
  const ctx = load();
  const el = builder(ctx);
  const root = new FakeElement('div');
  ctx.paint(root, sidebar(el, { ctx: '18%', inProgress: ['Old title'], duration: '2m' }));
  const row = q(root, 'click')[0];
  ctx.paint(root, sidebar(el, { ctx: '18%', inProgress: ['New title', 'Second'], duration: '2m' }));
  assert.notEqual(q(root, 'click')[0], row, 'a changed title means a changed row');
  assert.equal(q(root, 'click').length, 2);
  ctx.paint(root, sidebar(el, { ctx: '18%', inProgress: [], duration: '2m' }));
  assert.equal(q(root, 'click').length, 0);
});

test('after any sequence of repaints the live markup equals what was last built', () => {
  const ctx = load();
  const el = builder(ctx);
  const root = new FakeElement('div');
  const states = [
    { ctx: '1%', inProgress: [], duration: '1m' },
    { ctx: '2%', inProgress: ['A', 'B'], duration: '1m' },
    { ctx: '2%', inProgress: ['B'], duration: '4m' },
    { ctx: '9%', inProgress: ['B', 'C', 'D'], duration: '5m' },
  ];
  for (const s of states) {
    ctx.paint(root, sidebar(el, s));
    const expected = new FakeElement('div');
    expected.append(sidebar(el, s));
    assert.equal(root.outerHTML, expected.outerHTML);
  }
  // Loading → board swap (different first child) reconciles too.
  const fresh = new FakeElement('div');
  ctx.paint(fresh, el('div', { class: 'sb-section' }, 'Loading…'));
  ctx.paint(fresh, sidebar(el, states[1]));
  const expected = new FakeElement('div');
  expected.append(sidebar(el, states[1]));
  assert.equal(fresh.outerHTML, expected.outerHTML);
});

// ---- wiring around the reconciler, pinned as source text ----
const code = source.split('\n').filter((l) => !l.trim().startsWith('//'));

test('render() paints in place and never clears #root', () => {
  const render = extractFunction('render');
  assert.doesNotMatch(render, /textContent\s*=/);
  assert.match(render, /paint\(root, sb\);/);
  assert.match(render, /paint\(root, h\('div', \{ class: 'sb-section' \}, 'Loading…'\)\)/);
});

test('every element listener goes through on(), so the reconciler knows which nodes are wired', () => {
  const offenders = code.filter((l) => l.includes('.addEventListener(')
    && !/^\s*(window|document)\.addEventListener\(/.test(l)
    && !l.includes('el.addEventListener(type, fn);'));
  assert.deepEqual(offenders, []);
});

test('the In Progress row is the one wired row kept across repaints', () => {
  assert.deepEqual(code.filter((l) => l.includes('keep.add(')), ['          keep.add(ipRow);']);
});
