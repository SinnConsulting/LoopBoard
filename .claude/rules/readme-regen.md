---
description: README.md is half machine-owned. The settings region is generated from package.json and must never be hand-edited; the feature prose is hand-written and coverage-checked. Both go through the readme-regen skill.
paths:
  - "README.md"
  - "package.json"
---

# Rules for README.md

* **Never hand-edit inside the settings sentinels.** Everything between
  `<!-- loopboard:settings:begin -->` and `<!-- loopboard:settings:end -->` is generated from
  `contributes.configuration` in `package.json`. Change the manifest's `default`,
  `markdownDescription`, `order` or `markdownDeprecationMessage`, then regenerate — an edit made
  directly in the README is silently discarded on the next run.
* **A `contributes.*` change is a README change.** Adding, removing, renaming or re-describing a
  setting, command or view means running the `readme-regen` skill in the same change. `make test`
  fails otherwise.
* **The feature prose stays hand-written.** "Why LoopBoard?", "Small on purpose" and the board
  walkthrough are never machine-generated. The tool only checks coverage and flags drift; a
  failure means write the missing sentence, not loosen the check.
* **The line budget backstop.** `test/readme-settings.test.js` asserts the settings region is
  byte-equal to the generator's output and that every command/view/documented behaviour still has
  prose. It runs under `make check`, which must pass before any commit — it binds an editor who
  never reads this rule, which CI cannot: `.github/workflows/build.yml` carries
  `paths-ignore: ['**/*.md']`, so doc-only pushes produce no build.
* **Docker only.** The generator runs via `docker run node:22`, never host `node`/`npm`
  (CLAUDE.md non-negotiable 1).
* **Never ships.** The skill and its script live under `.claude/skills/readme-regen/`, excluded by
  `.vscodeignore` and asserted absent from the `.vsix` by `make package`. Do not move them into the
  packaged file set.
* **Facts must be verifiable.** Every claim added to the README is checked against `CLAUDE.md`,
  `.loopboard/LOOP.md`, the `Makefile` and `package.json` — not against the README's own earlier
  wording, which is exactly what drifts (it carried "two human gates" for months while the board
  had three).
