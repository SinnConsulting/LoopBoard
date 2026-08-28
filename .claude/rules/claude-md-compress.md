---
description: CLAUDE.md loads into every Claude Code session in this repo, so its length is a fixed token cost paid before any work starts. Any compression of it must use the claude-md-compress skill, run in an Opus subagent, and stay lossless.
paths:
  - "CLAUDE.md"
---

# Rules for CLAUDE.md

* **Every edit pays its own way.** This file is loaded into EVERY Claude Code session in this
  repo — its length is a fixed token cost paid on every conversation, before any work starts, and
  it grows by default: each landed feature appends to Critical learnings and Conventions. Any
  change that GROWS it must strip an equivalent amount of no-longer-needed prose in the same
  change, or run a compression pass (below) before landing.
* **The line budget is the backstop.** `test/claude-md-budget.test.js` asserts a hard maximum line
  count for this file and runs under `make test` / `make check`, which must pass before any
  commit. It binds editors that never read this rule — CI cannot: `.github/workflows/build.yml`
  carries `paths-ignore: ['**/*.md']`, so doc-only pushes produce no build, and a delegated
  implementer subagent cannot invoke skills unless one is explicitly handed to it. Raising the
  budget requires a deliberate edit to that test and is a decision, not a formality: compress
  first, and only then raise it.
* **Compression route.** If the task is to shrink, tighten, or reduce the token count of this
  file, use the `claude-md-compress` skill rather than compressing ad hoc — it encodes the
  untouchable-elements list and the self-check that gates every write. The sibling
  `template-loop-compress` skill is scoped to `media/template-loop.md` and never engages here.
* **Always an Opus subagent.** The skill never runs inline in whatever model is current. Delegate
  the compression to a subagent (Agent tool) with `model: opus`, mirroring `.loopboard/LOOP.md`
  Rule 14's groomer-subagent routing.
* **Lossless only.** The automated pass is strictly meaning-preserving. Deleting content that has
  gone obsolete — a stale Critical learning, a superseded convention — is a SEPARATE,
  human-reviewed edit and never something a compression pass decides on its own.
* **Self-check gates the write.** A compression pass may write `CLAUDE.md` without chat-level
  approval, but only after the skill's self-check passes. Self-check fails → write nothing,
  report, stop. Delivery then follows LOOP.md Rule 7: commit to a `task/**` branch, never to
  `main`; a PR is optional.
* **Untouchable, verbatim:** the `@`-include lines (they pull in other instruction files —
  a dropped or reworded `@path` silently unloads a whole ruleset); the Non-negotiable list's
  numbering; the Commands fenced code block; every rule cross-reference ("Rules 1-17", "Rule 2",
  "Rule 14" — they point at `.loopboard/LOOP.md`'s numbering); and every normative MUST/NEVER/ONLY
  clause, count, literal path, filename, and identifier.
