---
description: media/template-loop.md is the upstream source LoopBoard syncs into every user's live .loopboard/LOOP.md (src/sync.ts). Any compression of it must use the template-loop-compress skill and stay lossless.
paths:
  - "media/template-loop.md"
---

# Rules for media/template-loop.md

* **Compression route.** If the task is to shrink, tighten, or reduce the token count of this
  file, use the `template-loop-compress` skill rather than compressing ad hoc — it encodes the
  untouchable-elements list and the propose-only rule below.
* **Propose-only.** Never write `media/template-loop.md` in place as part of a compression pass —
  not even with a backup copy. Emit the candidate text for human review; only a human commits it.
* **Untouchable, verbatim:** the six `<!-- loopboard:sync:<id>:begin/end -->` marker comments (in
  order); the `## Automation` heading and its first fenced code block (apostrophe-free — it rides
  as single-quoted shell argv); Rule numbering 1–17; the task-index-format and task-file-format
  fenced code blocks; every normative MUST/NEVER/ONLY clause, count, literal path, and filename.
* **Propagation.** This file is read by `src/controller.ts` and pushed into every user's live
  `.loopboard/LOOP.md` by `store.syncTemplates` / `store.autoHeal` via `src/sync.ts`. A change
  here is not local doc drift — it changes what autonomous loop workers execute next.
