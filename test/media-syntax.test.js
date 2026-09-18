'use strict';
// Webview script syntax gate (t-sgrp).
//
// `make check` compiles src/ with tsc and never looks at media/*.js — the webview scripts are
// vanilla JS with no build step, so a syntax error in one of them reaches the user's editor as a
// silently dead panel. The regression that motivated this: media/markdown.js's header comment
// contained the phrase `*italic*/_italic_`, whose `*/` closed the block comment 12 lines early.
// Everything after it parsed as code, markdown.js never ran, `window.LoopBoardMarkdown` was never
// assigned — and BOTH media/board.js and media/settings.js destructure that global at load, so the
// whole board died, not just the page the comment was written for.
//
// Parsing (not running) is the whole test: these scripts are classic browser scripts that touch
// `window`/`document`/`acquireVsCodeApi` at load, none of which exist here. `new vm.Script(...)`
// compiles the source and throws SyntaxError without executing a line of it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mediaDir = path.resolve(__dirname, '..', 'media');

// Enumerated, never hard-coded: a webview script added later is covered the day it lands.
const scripts = fs.readdirSync(mediaDir).filter((f) => f.endsWith('.js')).sort();

test('media/ holds the webview scripts this gate is meant to cover', () => {
  assert.ok(scripts.length > 0, 'no media/*.js found — the enumeration must be broken.');
});

for (const file of scripts) {
  test(`media/${file} is syntactically valid JavaScript`, () => {
    const source = fs.readFileSync(path.join(mediaDir, file), 'utf8');
    try {
      new vm.Script(source, { filename: `media/${file}` });
    } catch (err) {
      assert.fail(`media/${file} does not parse: ${err.message}`);
    }
  });
}
