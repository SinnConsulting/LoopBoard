---
description: media/template-loop.md is the upstream source LoopBoard syncs into every user's live .loopboard/LOOP.md (src/sync.ts). Any compression of it must use the template-loop-compress skill, run in an Opus subagent, and stay lossless.
paths:
  - "media/template-loop.md"
---

# Rules for media/template-loop.md

* **Every edit pays its own way.** This file is re-read by every loop worker on every pass, in
  every workspace, so its length is a per-pass token cost multiplied across all running loops —
  the most expensive prose in the product. Any change that GROWS it must strip an equivalent
  amount of no-longer-needed prose in the same change, or run a compression pass (below) before
  landing. This holds for ordinary feature edits — a new rule clause, a new grammar field, a new
  Automation clause — not only for tasks whose stated goal is compression.
* **The line budget is the backstop.** `test/template-budget.test.js` asserts a hard maximum line
  count for this file and runs under `make test` / `make check`, which must pass before any
  commit. It binds editors that never see this rule — CI cannot: `.github/workflows/build.yml`
  carries `paths-ignore: ['**/*.md']`, so doc-only pushes produce no build, and a delegated
  implementer subagent cannot invoke skills unless one is explicitly handed to it. Raising the
  budget requires a deliberate edit to that test and is a decision, not a formality: compress
  first, and only then raise it.
* **Compression route.** If the task is to shrink, tighten, or reduce the token count of this
  file, use the `template-loop-compress` skill rather than compressing ad hoc — it encodes the
  untouchable-elements list and the self-check that gates every write.
* **Always an Opus subagent.** The skill never runs inline in whatever model is current. Delegate
  the compression to a subagent (Agent tool) with `model: opus`, mirroring `.loopboard/LOOP.md`
  Rule 14's groomer-subagent routing.
* **Self-check gates the write.** A compression pass may write `media/template-loop.md` without
  chat-level approval, but only after the skill's self-check passes. Self-check fails → write
  nothing, report, stop. The self-check is a SOFT, pre-commit-style step: advisory, run before
  committing the change, enforced by no hook and no CI — but it is a hard gate on the skill's own
  write. Delivery then follows LOOP.md Rule 7: commit to a `task/**` branch, never to `main`; a PR
  is optional. Honest risk: the previously mandatory PR was the human review point precisely
  because this file propagates (see below). With the PR optional, the self-check is the only
  automated gate before the branch, and human review shifts to whenever the branch is reviewed or
  merged to `main`.
* **Untouchable, verbatim:** the six `<!-- loopboard:sync:<id>:begin/end -->` marker comments (in
  order); the `## Automation` heading and its first fenced code block (apostrophe-free — it rides
  as single-quoted shell argv); Rule numbering 1–17; the task-index-format and task-file-format
  fenced code blocks; every normative MUST/NEVER/ONLY clause, count, literal path, and filename.
* **Propagation.** This file is read by `src/controller.ts` and pushed into every user's live
  `.loopboard/LOOP.md` by `store.syncTemplates` / `store.autoHeal` via `src/sync.ts`. A change
  here is not local doc drift — it changes what autonomous loop workers execute next.
