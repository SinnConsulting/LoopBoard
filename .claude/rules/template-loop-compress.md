---
description: media/template-loop.md is the upstream source LoopBoard syncs into every user's live .loopboard/LOOP.md (src/sync.ts). Any compression of it must use the template-loop-compress skill, run in an Opus subagent, and stay lossless.
paths:
  - "media/template-loop.md"
---

# Rules for media/template-loop.md

* **Compression route.** If the task is to shrink, tighten, or reduce the token count of this
  file, use the `template-loop-compress` skill rather than compressing ad hoc — it encodes the
  untouchable-elements list and the self-check that gates every write.
* **Always an Opus subagent.** The skill never runs inline in whatever model is current. Delegate
  the compression to a subagent (Agent tool) with `model: opus`, mirroring `.loopboard/LOOP.md`
  Rule 14's groomer-subagent routing.
* **Self-check gates the write.** A compression pass may write `media/template-loop.md` and open a
  PR without chat-level approval, but only after the skill's self-check passes. Self-check fails →
  write nothing, report, stop. The PR is the review point (LOOP.md Rule 7: all changes via PR,
  never commit to `main`).
* **Untouchable, verbatim:** the six `<!-- loopboard:sync:<id>:begin/end -->` marker comments (in
  order); the `## Automation` heading and its first fenced code block (apostrophe-free — it rides
  as single-quoted shell argv); Rule numbering 1–17; the task-index-format and task-file-format
  fenced code blocks; every normative MUST/NEVER/ONLY clause, count, literal path, and filename.
* **Propagation.** This file is read by `src/controller.ts` and pushed into every user's live
  `.loopboard/LOOP.md` by `store.syncTemplates` / `store.autoHeal` via `src/sync.ts`. A change
  here is not local doc drift — it changes what autonomous loop workers execute next.
