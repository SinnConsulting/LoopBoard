'use strict';
// makeGateButton commits on the PRIMARY button only (t-39e2). Before, its pointerdown called commit()
// for any mouse button, so a right-click on Review Approve accepted the task and one on a feedback
// "delete" deleted it — and Promote could not take a right-click to arm an automatic promote. The
// webview is vanilla JS the Docker suite never loads as a module, so the helper is lifted out of the
// SOURCE TEXT and run in a bare vm context (the test/sidebar-repaint.test.js technique), with a fake
// `h` that hands back the props it was built from. The live right-click is VERIFICATION.md item 54.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'media', 'board.js'), 'utf8');

// Body of `function <name>(` up to its matching closing brace (no brace inside a string or comment).
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'media/board.js must define ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

function build() {
  const ctx = { h: (tag, props) => ({ tag, props }) };
  vm.createContext(ctx);
  vm.runInContext(extractFunction('makeGateButton'), ctx);
  let commits = 0;
  const btn = ctx.makeGateButton({ class: 'x' }, () => { commits++; });
  return { props: btn.props, commits: () => commits };
}

function pointer(button) {
  const e = { button, prevented: false, preventDefault() { this.prevented = true; } };
  return e;
}

test('makeGateButton: a right-click pointerdown does not commit (and leaves the event alone)', () => {
  const b = build();
  const e = pointer(2);
  b.props.onpointerdown(e);
  assert.equal(b.commits(), 0);
  assert.equal(e.prevented, false, 'no preventDefault, so the contextmenu event still fires');
  const middle = pointer(1);
  b.props.onpointerdown(middle);
  assert.equal(b.commits(), 0, 'middle button neither');
});

test('makeGateButton: a primary pointerdown commits once, the trailing click is swallowed', () => {
  const b = build();
  const e = pointer(0);
  b.props.onpointerdown(e);
  assert.equal(b.commits(), 1);
  assert.equal(e.prevented, true);
  b.props.onclick();
  assert.equal(b.commits(), 1, 'the same mouse activation\'s click does not double-fire');
  b.props.onclick();
  assert.equal(b.commits(), 2, 'a keyboard activation (click with no pointerdown) still commits');
});

test('makeGateButton: a right-click does not arm the double-fire guard against a later keyboard click', () => {
  const b = build();
  b.props.onpointerdown(pointer(2));
  b.props.onclick();
  assert.equal(b.commits(), 1);
});
