---
name: readme-regen
description: Regenerate README.md's machine-owned settings region from package.json's contributes.configuration, then run a feature-coverage check that flags drift between the hand-written feature prose and the extension's real contribution points. Use whenever README.md or a `contributes.*` entry in package.json changes. Never rewrites feature prose — it only reports.
---

# readme-regen

`README.md` has two halves that need opposite treatment, and this skill is the line between them.

- The **settings region** is machine-owned. It sits between `<!-- loopboard:settings:begin -->` and
  `<!-- loopboard:settings:end -->`, and is re-derived from `package.json` on every run, so it can
  never drift. Never hand-edit inside the sentinels — the next run overwrites it.
- The **feature prose** ("Why LoopBoard?", "Small on purpose", the board/sidebar walkthrough) is
  hand-written and stays that way. The tool validates its COVERAGE against the real contribution
  points and FLAGS drift. It never rewrites a sentence. Auto-derived feature prose is out of scope.

## Run it

Docker only — never `node` on the host (CLAUDE.md non-negotiable 1). From the repo root:

```
docker run --rm -v "$(pwd)":/app -w /app node:22 node .claude/skills/readme-regen/readme-tool.js generate
docker run --rm -v "$(pwd)":/app -w /app node:22 node .claude/skills/readme-regen/readme-tool.js check
```

`generate` is idempotent: running it twice is a no-op, so the README stays fixpoint-stable exactly
like the `loopboard:sync:*` blocks. `check` exits non-zero and lists every problem it found.

The same logic is asserted by `test/readme-settings.test.js` under `make test` / `make check`, which
is the real backstop: a stale settings region or an undocumented command fails the build for an
editor who never read this file.

## When to run it

- Any change to `contributes.configuration` in `package.json` — a setting added, removed, renamed,
  re-defaulted, re-ordered, deprecated, or its `markdownDescription` reworded.
- Any change to `contributes.commands` or `contributes.views`.
- Any edit to `README.md`, to confirm you did not break coverage.

## What `check` enforces

1. **Settings region is current** — byte-equal to what `generate` would write.
2. **Every command is documented** — each `contributes.commands[].title` appears somewhere in the
   README.
3. **Every view is documented** — the activity-bar container title and each view name appear.
4. **Documented behaviours still have prose** — the `DOCUMENTED_BEHAVIOURS` list in
   `readme-tool.js` (three human actions, markdown source of truth, groom/work loops, multi-model
   slots, loop terminals, `.loopboard/cache/` attachments, sidebar, `DONE.md` archival, atomic
   field-level saves, zero runtime dependencies).

A failure is a prompt to WRITE prose, not a prompt to loosen the check. Only edit
`DOCUMENTED_BEHAVIOURS` when a behaviour genuinely stops existing.

## Boundaries

- Dependency-free plain Node. No new runtime deps, no new devDependencies, no bundler.
- Never imports `vscode`, and is not compiled into `out/` or `out-test/`.
- Never ships: `.vscodeignore` excludes `.claude/**`, and `make package` asserts no `.claude/`
  entry is in the `.vsix`. Keep it that way — do not add it to the packaged file set.
- Facts stated in the README must be true of the repo. When adding prose, verify against the
  source (`CLAUDE.md`, `.loopboard/LOOP.md`, the `Makefile`, `package.json`) rather than the
  README's own earlier wording, which is what drifts.
