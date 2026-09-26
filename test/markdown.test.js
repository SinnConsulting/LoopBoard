'use strict';
// The shared webview markdown renderer (media/markdown.js, t-mkd1 / t-sgrp). It touches `window`
// only at load, so it runs here for real in a node:vm sandbox — no DOM needed.
//
// What this pins: one level of nested lists (t-c7e3 — a numbered list with indented bullets under
// an item used to restart at "1." after the bullets), and today's output for flat input, byte for
// byte, including the escape-first XSS invariant.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMarkdown() {
  const sandbox = { window: {} };
  const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'markdown.js'), 'utf8');
  vm.runInNewContext(src, sandbox, { filename: 'media/markdown.js' });
  return sandbox.window.LoopBoardMarkdown;
}
const { mdToHtml } = loadMarkdown();

const count = (s, needle) => s.split(needle).length - 1;

test('a numbered list with indented bullets under an item keeps counting (t-c7e3)', () => {
  const html = mdToHtml('1. a\n   - x\n   - y\n2. b\n3. c');
  assert.equal(html, '<ol><li>a<ul><li>x</li><li>y</li></ul></li><li>b</li><li>c</li></ol>');
  // Spelled out: exactly one <ol>, three top-level items, x and y nested in the first one.
  assert.equal(count(html, '<ol>'), 1);
  assert.equal(count(html, '<ul>'), 1);
  const top = html.slice('<ol>'.length, -'</ol>'.length);
  const firstLi = top.slice(0, top.indexOf('</ul></li>') + '</ul></li>'.length);
  assert.equal(firstLi, '<li>a<ul><li>x</li><li>y</li></ul></li>');
  assert.equal(top.slice(firstLi.length), '<li>b</li><li>c</li>');
});

test('t-2e7d-shaped Delivered: goals 1–4 in one list, bullets under goal 1', () => {
  const src = [
    'Goals:',
    '1. **Badge and section: met.**',
    '   - The badge is at README.md:7.',
    '   - `## Community` sits at README.md:419.',
    '2. **`make readme` reports no drift: met.**',
    '3. **New test: met.**',
    '4. **`make check` green: met.**',
  ].join('\n');
  const html = mdToHtml(src);
  assert.equal(count(html, '<ol>'), 1, 'one ordered list, so the browser numbers it 1–4');
  assert.equal(count(html, '<ul>'), 1);
  assert.equal(count(html.replace(/<ul>.*<\/ul>/, ''), '<li>'), 4, 'four top-level goals');
  assert.ok(html.includes('<li><strong>Badge and section: met.</strong><ul><li>The badge'), 'bullets nest under goal 1');
});

test('nesting is one level: deeper indents stay at the nested level; a same-level type change opens a sibling sub-list', () => {
  assert.equal(mdToHtml('- a\n  - b\n      - c\n- d'),
    '<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>');
  assert.equal(mdToHtml('- a\n  1. b\n  - c'),
    '<ul><li>a<ol><li>b</li></ol><ul><li>c</li></ul></li></ul>');
  // Nested text is escaped and inline-rendered like any other item.
  assert.equal(mdToHtml('1. a\n   - <b>**x**</b>'),
    '<ol><li>a<ul><li>&lt;b&gt;<strong>x</strong>&lt;/b&gt;</li></ul></li></ol>');
});

// ---- flat input: byte-for-byte what the flat-only renderer produced before t-c7e3 ----

test('flat - list', () => {
  assert.equal(mdToHtml('- a\n- b\n* c'), '<ul><li>a</li><li>b</li><li>c</li></ul>');
});

test('flat 1. list', () => {
  assert.equal(mdToHtml('1. one\n2. two\n10. ten'), '<ol><li>one</li><li>two</li><li>ten</li></ol>');
});

test('a type change at the same indent still starts a new list', () => {
  assert.equal(mdToHtml('- a\n1. b'), '<ul><li>a</li></ul><ol><li>b</li></ol>');
});

test('headings', () => {
  assert.equal(mdToHtml('# Title\n## Sub **b**'), '<h1>Title</h1><h2>Sub <strong>b</strong></h2>');
});

test('blank-line paragraphs soft-wrap and join with <br><br>', () => {
  assert.equal(mdToHtml('first line\nsame para\n\nsecond para'), 'first line same para<br><br>second para');
  assert.equal(mdToHtml('intro\n- a\n- b\n\nafter'), 'intro<ul><li>a</li><li>b</li></ul>after');
});

test('a <script> in list text is still escaped', () => {
  assert.equal(mdToHtml('- <script>alert(1)</script>'), '<ul><li>&lt;script&gt;alert(1)&lt;/script&gt;</li></ul>');
  assert.equal(mdToHtml('1. <script>alert("x")</script>'), '<ol><li>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</li></ol>');
});
