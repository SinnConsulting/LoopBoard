'use strict';
// CLAUDE.md is loaded into EVERY Claude Code session in this repo, before any work starts, so its
// length is a fixed token cost paid on every conversation — and it grows by default: each landed
// feature appends to Critical learnings and Conventions.
//
// This budget is what stops that. It is the ONLY enforcement that binds an editor who never reads
// .claude/rules/claude-md-compress.md: build.yml carries paths-ignore ['**/*.md'] so a doc-only
// push produces no CI at all, and a delegated implementer subagent cannot invoke the
// claude-md-compress skill unless one is explicitly handed to it. `make check` is mandatory before
// any commit, so this test is the backstop no agent can skip.
//
// The number: 173 lines = the 2026-08-28 compressed baseline (157 lines, from the
// claude-md-compress skill's gated pass under t-cmp1) plus ~10% headroom, mirroring
// test/template-budget.test.js. Lines, not bytes or tokens: dependency-free, stable across
// editors, readable in a failure message.
//
// Raising it is a decision, not a formality — and for THIS file a second compression pass will not
// buy the room back. The baseline pass reported the prose slack as spent: CLAUDE.md is dominated
// by inline code spans, literal paths and normative clauses, all of which the skill's untouchable
// list forbids it to touch. The honest options when this test fails are to delete content that has
// genuinely gone obsolete (a human-reviewed edit, never an automated pass) or to raise the budget
// deliberately here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAX_LINES = 173;

test('CLAUDE.md stays within its line budget', () => {
  const text = fs.readFileSync(path.join(process.cwd(), 'CLAUDE.md'), 'utf8');
  const lines = text.split('\n').length;
  assert.ok(
    lines <= MAX_LINES,
    'CLAUDE.md is ' + lines + ' lines, over its budget of ' + MAX_LINES + '. It loads into every ' +
    'session in this repo — strip an equivalent amount of no-longer-needed prose in this same ' +
    'change, or delete genuinely obsolete content (a human-reviewed edit), before raising the budget.',
  );
});
