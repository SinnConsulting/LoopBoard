'use strict';
// media/template-loop.md is re-read by every loop worker on every pass, in every workspace, and
// its marked sections are pushed into each live .loopboard/LOOP.md by syncMarkedSections
// (src/sync.ts). Its length is therefore a per-pass token cost multiplied across every running
// loop — the most expensive prose in the product, and a file that only ever grows unless
// something stops it.
//
// This budget is that stop. It is the ONLY enforcement that binds an editor who never reads
// .claude/rules/template-loop-compress.md: build.yml carries paths-ignore ['**/*.md'] so a
// doc-only push produces no CI at all, and a delegated implementer subagent cannot invoke the
// template-loop-compress skill unless one is explicitly handed to it. `make check` is mandatory
// before any commit, so this test is the backstop no agent can skip.
//
// The number: 228 lines = the 2026-08-28 compressed baseline (207 lines, from the
// template-loop-compress skill's gated pass under t-1cc8) plus ~10% headroom, so an ordinary
// feature edit can add a clause without a ceremony, while sustained growth cannot pass
// unnoticed. Lines, not bytes or tokens: dependency-free, stable across editors, and readable in
// a failure message.
//
// Raising it is a decision, not a formality. Compress first (the skill), and only raise the
// budget if the file legitimately needs to be longer after that pass.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAX_LINES = 228;

test('media/template-loop.md stays within its line budget', () => {
  const text = fs.readFileSync(path.join(process.cwd(), 'media', 'template-loop.md'), 'utf8');
  const lines = text.split('\n').length;
  assert.ok(
    lines <= MAX_LINES,
    'media/template-loop.md is ' + lines + ' lines, over its budget of ' + MAX_LINES + '. Every ' +
    'loop worker re-reads this file on every pass — strip an equivalent amount of no-longer-needed ' +
    'prose in this same change, or run the template-loop-compress skill, before raising the budget.',
  );
});
