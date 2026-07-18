# TODO

Single task tracker. Completed tasks are moved to [DONE.md](DONE.md).

## Workflow

```
New → Backlog → In Progress → Review → Done (DONE.md)
                     ↕
                  Feedback
```

- **New** — freshly proposed. Groom in place; promote only on approval.
- **Backlog** — validated, ready to pick up.
- **In Progress** — actively worked. Exactly one owner.
- **Feedback** — worker is unsure how to proceed and has paused for your input. Branches off
  In Progress; returns there once you answer.
- **Review** — work finished, awaiting acceptance.
- **Done** — accepted; cut from here and appended to `DONE.md`.

## Task format (v3)

Every task lives in a single `## Tasks` section — there are **no per-phase headings**. Each task's
phase is its own `- phase:` field, so moving a task between phases is a one-line, in-place field
edit (never cut a task out of one section and paste it into another — that risked losing a task
mid-move). Each task is a checkbox line plus indented `key: value` sub-bullets, **one key per line,
in this fixed order**. The Claude TODO Board extension parses this file tolerantly and rewrites it
in canonical form on every save; unrecognized lines are preserved verbatim and flagged.

```
- [ ] <Title — single line>
  - id: t-3f9a                          (stable short id; the writer assigns one if missing)
  - phase: new | backlog | inprogress | feedback | review   (which column the task is in)
  - owner: @claude | unassigned
  - model: opus | sonnet | fable        (optional; absent = the default model, see Rule 15)
  - groomer: opus | sonnet | fable      (optional; which model grooms it, absent = default model; see Rule 14)
  - added: YYYY-MM-DD
  - started: YYYY-MM-DD                  (optional; set when moving to In Progress)
  - promoted: YYYY-MM-DD                 (optional; set when New → Backlog)
  - worklog: YYYY-MM-DD, YYYY-MM-DD      (optional; append a date each active day)
  - link: <url>[, <url>]                 (optional; PR links live here)
  - depends on: t-xxxx[, t-yyyy]         (optional)
  - description: <free text; may wrap onto further 4-space-indented lines>
  - note: <human instruction to the worker>   (optional; see Rule 16)
  - question: ❓ <text>                   (repeatable, single line; Feedback & New)
    - answer: <text or blank>
  - feedback: ⚠️ <text>                   (Review only; see Rule 13)
  - DELIVERED: <text; may wrap onto further 4-space-indented lines>   (Review only)
```

- **`id:`** is the identity anchor — titles may be edited freely without breaking tracking.
- **`phase:`** is the source of truth for which column a task is in — change it to move the task.
- **`description:`** carries the detail; the title stays a single short line.
- A **draft** created from the board is just `- [ ] DRAFT: <raw text>` with `id:` and `added:`
  (phase defaults to New); the loop's groomer (Rule 14) expands it into a full story.

## Rules

1. **The checkbox is your approval, and only yours.** A worker never ticks `[x]`.
   - `[x]` on a **New** task = promote it to **Backlog**.
   - `[x]` on a **Review** task = it is **Done** (move it to `DONE.md`).
   - Workers move tasks between the other columns and propose the tick; you make it.
2. **One worker per task.** Check the `owner:` field before starting.
   - `owner: unassigned` → claim it (`owner: @you`, `started: <today>`), move to **In Progress**.
   - Owned by someone else, or already in `DONE.md` → don't start a parallel copy; coordinate.
3. **Track dates.** Every task carries its history so you can see when it was worked:
   - `added:` — date it entered the tracker.
   - `started:` — date work began (set when moving to In Progress).
   - `promoted:` — date it moved New → Backlog.
   - `worklog:` — append `<today>` each day the task is actively touched (comma-separated).
   - `completed:` — date you accepted it (recorded in `DONE.md`).
4. **Metadata lives on the task's sub-bullets**, one `key: value` per line, in the fixed order
   documented under *Task format (v3)* above. A task's **phase is the `phase:` field** — to move a
   task between columns, edit that field in place (do not cut/paste the task between sections).
5. **Grooming ≠ approval.** Editing a New task's text is fine; moving it out of New needs Rule 1.
6. **When unsure, ask — don't guess.** If a worker hits a decision that is yours to make, it
   moves the task to **Feedback** with a `question:` line and stops working it. Directly beneath
   each `question:` line, place its own `answer:` sub-bullet for you to fill in:

   ```
   - question: ❓ SOMETHING
     - answer:
   ```

   You reply by filling in the `answer:` under each question; the worker then moves the task back
   to **In Progress** and continues — but only once **every** open question has an answer (Rule 10).
   Feedback is a pause, not a checkbox gate — no `[x]` needed.
7. **TEMPORARY (no remote yet): deliver by COMMIT, not PR.** This repo currently has no git
   remote, so PRs are impossible. Until that is fixed (see New task t-pr01), any task that
   produces changes is delivered by committing ONLY that task's files to a task branch off
   `main` (`git switch -c task/<id>`, never commit to `main` directly), then recording the
   branch name and commit SHA in the task's `link:` metadata before moving it to **Review**.
   A Review task with no commit reference is incomplete. Restore the PR requirement once a
   remote exists (t-pr01).
8. **Mark questions and warnings with emoji.** Prefix a `question:` line with ❓ and a `feedback:`
   line with ⚠️ so they stand out. (e.g. `question: ❓ …`, `feedback: ⚠️ …`.)
9. **MUST NOT use git worktrees — work in the normal checkout.** Worktrees break repo pre-commit
   hooks that assume `.git` is a directory (in a worktree `.git` is a gitfile, so hooks doing e.g.
   `touch .git/…` fail, and `--no-verify` is forbidden). So never use `git worktree` for tasks.
   Instead, in the normal checkout: `git pull` / fetch latest `main`, create the task branch off
   `main`, then commit and open the PR from that checkout (per Rule 7).
10. **Resume a Feedback task only when ALL its open questions are answered.** If a task has multiple
    `question:` items, it stays in **Feedback** until every one has a filled-in `answer:`. A single
    answered question is not enough — do not move it back to In Progress or start any of its work
    while any question remains blank.
11. **Move a task to In Progress BEFORE working or researching it.** The moment you begin any work
    or investigation on a task, it must already be in **In Progress** (set `owner:`, `started:`).
    Never research or edit for a task while it still sits in New/Backlog/Feedback — the board must
    always show, at a glance, exactly what is being worked right now.
12. **Never leave work stranded — always COMMIT (TEMPORARY: no PR while there's no remote).**
    Any change from working a task must be committed to that task's branch and its SHA recorded on
    the task. Do not end a working session with uncommitted local changes; if you can't finish,
    still commit what you have so nothing is lost. (Reverts to PR delivery once t-pr01 lands.)
13. **Review stories accept your feedback — it's a change request, not a checkbox.** A story in
    **Review** may carry a `feedback:` line where you write review comments or requested changes
    (mark it ⚠️ per Rule 8). When a Review story has an unaddressed `feedback:` line, the worker
    moves it back to **In Progress**, addresses it, and returns it to Review — never tick `[x]` on
    the worker's behalf. `[x]` on a Review story still means accepted → Done (`DONE.md`).
14. **Explore New tasks (and drafts) with a subagent, not the main process.** When
    grooming/investigating a **New** task — including expanding a `DRAFT:` into a full story
    (title, `description:`, scope) — delegate the exploration to a subagent (Agent tool) whose
    `model:` is the task's `groomer:` field (default model, currently opus, when `groomer:` is
    absent), and record its findings on the task. Don't run New-task exploration inline in
    the main loop — keep the main process for reconciliation and execution. Decisions the human
    must make go on the task as structured single-line `question:` sub-bullets (each with its
    `- answer:` beneath, Rule 6 format) — NOT as an "OPEN QUESTIONS" prose paragraph inside
    `description:` — so New cards surface them in the board's question UI for inline answering.
15. **Claim tasks by `model:`.** Each loop runs as a specific model. Claim only tasks whose
    `model:` matches yours; a task with **no `model:` field belongs to the default model**
    (currently **opus**). Never claim a task whose `model:` names a different model than the one
    you are running as.
16. **Honor `note:` lines, then remove them.** A `note:` is a human instruction added from the
    board for the worker's next pass. Apply the instruction, append `<today>` to the worklog, then
    **delete the `note:` line**. A lingering `note:` means it has not been applied yet.

Legend: `[ ]` awaiting your gate · `[x]` you approved.

---

## Tasks

- [ ] Restore PR-based delivery once a git remote exists (revert the temporary commit-only rule)
  - id: t-pr01
  - phase: new
  - added: 2026-07-11
  - worklog: 2026-07-12, 2026-07-13, 2026-07-14, 2026-07-15
  - description: The remote now exists, so the temporary "deliver by commit, not PR" measure can be
    reverted. HISTORY: the commit-only rule was introduced 2026-07-11 (commit c823d5a) because the
    repo had no git remote; the remote + single-commit squash + push landed 2026-07-14 via t-8823,
    so `origin` = git@github.com:SinnConsulting/LoopBoard.git (private) and origin/main = 8f479db
    "init: LoopBoard". All the earlier branch-push / remote-creation / secret-scan steps are DONE or
    moot and have been dropped from this task (regroom 2026-07-15).
    REMAINING ACTIONABLE SCOPE — revert the delivery policy from commit-only back to PR-based:
    (1) Rule 7: replace the "TEMPORARY (no remote yet): deliver by COMMIT, not PR" text with the
    original PR requirement — "You MUST ALWAYS add a PR ... never commit to main directly ... A
    Review task with no PR link is incomplete."
    (2) Rule 12: replace the "Never leave work stranded — always COMMIT (TEMPORARY: no PR ...)" text
    with the original — "If you started working and have code to commit, ALWAYS open a PR — never
    leave work stranded."
    (3) Rule 9: reconcile its delivery clause so it consistently says "commit and open the PR from
    that checkout (per Rule 7)" with no commit-only carve-out (its worktree prohibition stays as-is).
    (4) Task-format `link:` comment (the `link: <url>` sub-bullet doc): ensure it reads as PR links,
    not commit/branch references.
    (5) Automation /loop prompt at the bottom: ensure its finish step reads "open a PR (Rule 7),
    record its link, and move it to Review" with no commit-only wording anywhere in the block.
    Note: several of (3)/(4)/(5) may already read PR-first (they were only half-migrated) — the job
    is to make delivery language consistently PR-based across all five spots and remove any lingering
    "TEMPORARY"/commit-only phrasing.
    This unblocks t-a37f (marketplace publish) sequencing, which waits on this policy revert plus a
    pushed repo.
    REGROOMED 2026-07-15 by Opus subagent (Rule 14); left in New for your promotion.
  - question: ❓ Delete the local-only backup branches (task/* delivery branches and backup-pre-loopboard, which hold the pre-squash 33-commit history) now that main is squashed and pushed, or keep them as an offline safety net?
    - answer:

- [ ] Publish the extension to the VS Code Marketplace (add MIT LICENSE, fill manifest, set up publisher + PAT)
  - id: t-a37f
  - phase: backlog
  - owner: unassigned
  - model: fable
  - added: 2026-07-12
  - promoted: 2026-07-14
  - worklog: 2026-07-12, 2026-07-13, 2026-07-14, 2026-07-15
  - depends on: t-pr01
  - description: Get this extension publishable to the VS Code Marketplace. WORK ITEMS:
    (1) Add a top-level MIT LICENSE file — package.json already declares "license": "MIT" but no
    LICENSE file exists and vsce warns without one. Use the standard MIT text; the copyright holder
    name is a DECISION for the user (see OPEN QUESTIONS) — do not guess it. (2) Fill the marketplace
    fields in package.json that are missing or placeholder: add a "repository" object
    ({type:"git", url:...}) pointing at the public remote, add "keywords" and a real "icon"
    (top-level, a 128x128 PNG — the existing media/icon.svg is only the activity-bar icon and is not
    a valid listing icon), consider tightening "categories" beyond ["Other"], and optionally
    "bugs"/"homepage". The README already serves as the listing page. (3) Create a Marketplace
    PUBLISHER: needs an Azure DevOps organization and a Personal Access Token (PAT) with
    Marketplace > Manage scope, then a publisher created at marketplace.visualstudio.com/manage
    (vsce create-publisher is deprecated). The publisher ID MUST equal package.json "publisher"
    (currently the placeholder "claude-todo"). (4) Publish flow — MUST run through Docker per the
    repo's no-host-tooling rule (never npm/vsce on the host). Add a `make publish` target wrapping
    `docker run ... npx --yes @vscode/vsce publish --no-dependencies` with the PAT passed via env
    (VSCE_PAT), mirroring the existing `make package`. Alternatively, upload the already-built
    .vsix manually via the Marketplace management UI (no PAT flow needed for a one-off). The
    --no-dependencies flag is required (zero runtime deps) and is already used by `make package`.
    DEPENDENCY: publishing wants a public git remote for the repository URL and generally a public
    repo — this repo has NO remote yet (git remote -v is empty). Blocked on / do after t-pr01
    (add remote + push main).
    2026-07-13: the three "OPEN QUESTIONS (human must answer before executing)" were converted
    from prose into the structured `question:`/`answer:` sub-bullets below (t-fc27 convention,
    Rule 14) — wording preserved, no new content; answer them there.
    RISKS: publishing under the placeholder "claude-todo" publisher/name is effectively
    unrecoverable branding (locked identity, orphaned on rebrand); a missing/oversized icon or
    absent repository URL yields a poor or rejected listing; the PAT is a secret — must never be
    committed or logged, pass via env only; version 0.1.0 signals pre-release, confirm that's
    intended for a first public listing.
    GROOMED 2026-07-12 by Opus subagent (Rule 14) from your DRAFT; left in New for your promotion,
    model: fable per the draft's "Use Fable".
    2026-07-14: LOGO ASSETS DELIVERED by the user (from "LoopBoard logo design.zip") and staged
    into media/ alongside the rename batch: media/loopboard-icon-128.png (128x128 RGBA PNG — the
    marketplace listing icon work item 2 calls for; wire it as package.json "icon"),
    media/loopboard-icon.svg (vector master), media/loopboard-activitybar.svg (candidate
    replacement for the current media/icon.svg activity-bar icon — swap is the executor's call).
    2026-07-14: repaired a mangled block — the first question line below lost its text during a
    concurrent rewrite (its answer survived as an orphan); restored verbatim.
    2026-07-14 (later): the GIT REMOTE NOW EXISTS — user created the private repo
    github.com/SinnConsulting/LoopBoard and origin is set (do NOT push yet per user). The staged
    batch now also carries: package.json "repository" = https://github.com/SinnConsulting/LoopBoard.git
    (work item 2, needed so vsce accepts the relative README images) and a rewritten README.md
    intro embedding media/loopboard-icon-128.png (vsce rejects SVGs in READMEs, so the README uses
    the PNG only). `make check` green — loopboard-0.1.1.vsix, 30 files. PAT storage decided:
    GitHub repo Settings → Secrets and variables → Actions → Repository SECRET named `VSCE_PAT`
    (matches the planned `make publish` env var and t-9c4e's later marketplace-publish follow-up).
    CORRECTED 2026-07-14 (fable loop, user): `VSCE_PAT` is now a GLOBAL secret (not environment
    -scoped), confirmed set for release use — see t-9c4e.
    CORRECTED 2026-07-15 (fable, user decision on t-027d): the top-level package.json "icon"
    (media/loopboard-icon-128.png) is now OWNED by t-027d (the logo task) — work item 2 here
    shrinks to VERIFYING the field exists, not adding it.
    KNOWN-COSMETIC 2026-07-15 (fable, user report — NOT a bug, do not chase): the README logo
    banner shows as a broken image on the local extension details page. Cause: vsce rewrites the
    README's relative image path to https://github.com/SinnConsulting/LoopBoard/raw/HEAD/media/
    loopboard-icon-128.png (against the "repository" field), and that repo is PRIVATE → 404. The
    PNG IS inside the .vsix and the package.json "icon" tile renders fine. Self-heals when the
    repo goes public in the t-pr01/publish sequence; verify the banner renders as part of the
    pre-publish check. No packaging change needed (a data: URI would render locally but the
    Marketplace strips data: URIs).
  - question: ❓ What is the Marketplace PUBLISHER name/ID? "claude-todo" is a placeholder and (per t-8823) is slated to change on rebrand.
    - answer: `SinnConsulting` — the publisher already exists at marketplace.visualstudio.com/manage/publishers/SinnConsulting (user, 2026-07-14; supersedes the earlier `loopboard` plan). package.json `publisher` updated to SinnConsulting in the staged rename batch; work item 3 (create publisher) is DONE.
  - question: ❓ What COPYRIGHT HOLDER goes in the MIT LICENSE (personal name vs. org)?
    - answer: Marcel Sinn (Marcel Sinn Consulting) — answered 2026-07-14.
  - question: ❓ Publish NOW or AFTER the rename task t-8823? t-8823 changes both `name` and `publisher`; publishing first creates a throwaway marketplace identity (installs/reviews/counts don't carry over, existing installs won't auto-upgrade). Strong recommendation: land t-8823 first, then publish once.
    - answer: AFTER t-8823 (decided 2026-07-14): rename lands and history is squashed first, then t-pr01 creates the public `loopboard` repo, then publish once.

- [ ] Add a semantic-release CI pipeline (GitHub Actions) that versions, tags, and attaches the .vsix to GitHub Releases
  - id: t-9c4e
  - phase: review
  - owner: @claude
  - model: fable
  - added: 2026-07-14
  - started: 2026-07-14
  - promoted: 2026-07-14
  - worklog: 2026-07-14
  - link: task/t-9c4e @ 253011b (no PR — temporary Rule 7 commit-only delivery)
  - description: Port the release approach from the sibling ClockClock repo (its
    `.github/workflows/release.yml` + `.releaserc.json` are the reference): semantic-release runs
    on every push to `main`, derives the next version from conventional-commit messages, tags
    `vX.Y.Z`, and creates a GitHub release with generated notes; a second job, gated on
    `new_release_published == 'true'`, builds the artifact. WORK ITEMS: (1) `.releaserc.json` with
    `branches: ["main"]` and plugins `@semantic-release/commit-analyzer`,
    `@semantic-release/release-notes-generator`, `@semantic-release/github` — same trio as
    ClockClock, no npm/git plugins. (2) `.github/workflows/release.yml`: job "release" =
    `actions/checkout@v4` (fetch-depth: 0) + `cycjimmy/semantic-release-action@v4` with
    `GITHUB_TOKEN`, exposing `published`/`version` outputs; job "vsix" (replaces ClockClock's
    docker job) = checkout + `npx --yes @vscode/vsce package ${version} --no-dependencies`
    + upload `loopboard-${version}.vsix` to the release (e.g. `gh release upload v${version}` or
    `softprops/action-gh-release`). DECIDED (2026-07-14, user): artifact target is the GitHub
    Release asset ONLY — Marketplace auto-publish (`vsce publish` + VSCE_PAT) is a later follow-up
    once t-a37f creates the publisher; do not block on it. DECIDED: version is injected at package
    time (`vsce package <version>` rewrites the manifest inside the vsix) — package.json's
    `version` field in git stays frozen/vestigial, NO bot bump commits (mirrors ClockClock, which
    also never writes the version back). NOTES: the repo's Docker-only rule governs the HOST — CI
    runners are not the host, so the workflow may run node/npx directly (vsce needs no
    node_modules given zero runtime deps; `npx --yes @vscode/vsce` suffices; if tests should gate
    the release, replicate `make build`/`make test` steps with plain tsc + node --test instead of
    the Docker-wrapped Makefile). Commit style already follows conventional commits (feat:/fix:/
    chore:), so commit-analyzer works unchanged; note `chore:`/`docs:` produce NO release — that
    is correct behavior, not a pipeline failure. DEPENDENCY: blocked on t-pr01 (no git remote yet;
    Actions only run on a pushed GitHub repo). First release after the t-8823 history squash will
    have no prior tag — semantic-release then releases 1.0.0 by default from a feat/fix commit;
    if 1.0.0 is unwanted for a first cut, seed a `v0.1.1` tag on the init commit so the next
    release continues 0.x.
    RISKS: version drift — the frozen package.json `version` (0.1.1) no longer reflects releases,
    which confuses local `make package` output vs published tags (document in README or CLAUDE.md);
    `cycjimmy/semantic-release-action` pins semantic-release majors — check the action's current
    default before assuming plugin compatibility; GITHUB_TOKEN-created releases do NOT trigger
    other workflows (fine today, matters if a publish workflow later listens on release events —
    ClockClock avoids this by keeping jobs in one workflow, do the same); ClockClock's
    `environment: All` is repo-specific config — omit it here unless an environment with that name
    is set up.
    2026-07-14: VSCE_PAT is stored as a REPOSITORY secret (screenshot confirmed; the user first
    created it as an environment secret in `build`, then re-added it repo-level) — so
    `secrets.VSCE_PAT` is available to any job with no `environment:` declaration needed. If the
    `build` environment copy still exists it's redundant; the later marketplace-publish follow-up
    just reads the repo secret. The release/vsix jobs in THIS task use only GITHUB_TOKEN.
    CORRECTED 2026-07-14 (fable loop, user): VSCE_PAT is now set as a GLOBAL secret (available to
    all workflows, not scoped to one environment) so the release pipeline can use it —
    `secrets.VSCE_PAT` works in any job of release.yml without an `environment:` declaration.
    Release/vsix jobs here still need only GITHUB_TOKEN; VSCE_PAT matters for the marketplace
    -publish follow-up.
    CORRECTED 2026-07-14 (fable loop, Rule 6/step 6): DROPPED `depends on: t-pr01` — its stated
    reason ("no git remote yet; Actions only run on a pushed GitHub repo") is stale: verified
    `origin` = git@github.com:SinnConsulting/LoopBoard.git and origin/main = 8f479db (pushed).
    t-pr01's remaining scope (revert Rules 7/12/9 to PR delivery) is tracker policy, not a
    technical blocker for adding CI files. Claimed by fable loop, moved to In Progress.
    GROOMED 2026-07-14 interactively with user (artifact + version-sync decisions resolved above);
    left in New for your promotion.
  - DELIVERED: task/t-9c4e @ 253011b — `.releaserc.json` (ClockClock's plugin trio, branches:
    ["main"]) + `.github/workflows/release.yml`: job "release" (checkout fetch-depth 0 +
    cycjimmy/semantic-release-action@v4 with GITHUB_TOKEN, outputs published/version) and job
    "vsix" (gated on published == 'true'; Node 22 + npm ci + tsc build + node --test, then
    `vsce package <version> --no-dependencies --no-git-tag-version --no-update-package-json`,
    upload via `gh release upload v<version>`). `environment: All` omitted per groom. Included a
    test gate (cheap, replicates make build/test with plain tsc + node --test as the NOTES
    anticipated). Also added `.github/**` + `.releaserc.json` to `.vscodeignore` — they leaked
    into the vsix (30→32 files); back to 30 after. Verified: YAML/JSON parse clean; smoke-tested
    the vsce flags in Docker (`vsce package 9.9.9 ...` → loopboard-9.9.9.vsix with package.json
    left at 0.1.1); `make check` green. NOT verified: an actual Actions run (needs the branch
    merged + pushed to main). REVIEWER DECISION left open (from groom): first release with no
    prior tag defaults to 1.0.0 — if you want to stay 0.x, push a `v0.1.1` tag on 8f479db before
    merging the first feat/fix commit. Note this `ci:` commit itself triggers no release (correct
    per commit-analyzer defaults).

- [ ] Adopt the new LoopBoard logo: swap the activity-bar/panel icon to loopboard-activitybar.svg and wire loopboard-icon-128.png as the marketplace icon
  - id: t-027d
  - phase: review
  - owner: @claude
  - model: sonnet
  - groomer: fable
  - added: 2026-07-15
  - started: 2026-07-15
  - promoted: 2026-07-15
  - worklog: 2026-07-15
  - link: task/t-027d @ c650fe3 (no PR — temporary Rule 7 commit-only delivery)
  - description: Expanded from the DRAFT "Use the new logo in media as our extension logo."
    FINDINGS (verified 2026-07-15): the new assets exist in media/ — loopboard-icon-128.png
    (128x128 RGBA PNG), loopboard-icon.svg (711 B vector master), loopboard-activitybar.svg
    (638 B, 24x24 viewBox, all `currentColor` — theme-safe, same convention as the old icon).
    The old media/icon.svg (clipboard/checklist glyph) is referenced in exactly TWO places:
    package.json line 28 (`contributes.viewsContainers.activitybar[0].icon`) and src/panel.ts
    line 24 (`this.panel.iconPath = ... 'media', 'icon.svg'` — the board panel's tab icon).
    package.json has NO top-level "icon" field today. .vscodeignore does not exclude media/,
    so all three new assets already ship in the .vsix (file count grows past the documented
    27/30 — update the packaging note if asserted). README.md line 3 already embeds the PNG.
    WORK ITEMS: (1) point the activity-bar icon at the new artwork — either edit the
    package.json path to media/loopboard-activitybar.svg or overwrite media/icon.svg's content
    (path edit is cleaner; overwrite avoids touching src/panel.ts). (2) If the path changes,
    update src/panel.ts:24 to the same file. (3) Optionally add top-level
    "icon": "media/loopboard-icon-128.png" to package.json — OWNERSHIP overlaps t-a37f work
    item 2, see question below. (4) Delete or keep the old media/icon.svg per the question
    below. (5) Decide whether the unreferenced vector master media/loopboard-icon.svg gets
    .vscodeignore'd out of the .vsix. (6) `make check` must pass (src/** touched if panel.ts
    changes); icon rendering in light/dark themes needs a manual F5 check — add to
    VERIFICATION.md's manual list, a headless loop cannot verify visuals.
    WHAT STAYS: README's PNG embed, all other media assets, and the inline `icon()` SVG
    helpers in media/board.js / media/sidebar.js (button glyphs, unrelated to the logo).
    RISKS: activity-bar contrast/legibility at 24px only confirmable via F5; double-edit
    collision with t-a37f on package.json "icon" (if both add it — noisy; if neither —
    marketplace listing has no icon); deleting icon.svg leaves t-a37f's "media/icon.svg is
    only the activity-bar icon" prose slightly stale (cosmetic).
    GROOMED 2026-07-15 by Fable subagent (Rule 14, per `groomer: fable`); left in New for
    your promotion.
    2026-07-15 (sonnet loop): claimed from Backlog, but the groom left three implementation
    -determining decisions unanswered below (icon-field ownership vs t-a37f, delete-vs-keep
    old icon.svg, .vscodeignore for the unused vector master) — parked in Feedback per Rule 6
    rather than guess. Will resume once all three answers are filled in (Rule 10).
  - question: ❓ Should this task own adding the top-level package.json "icon" (loopboard-icon-128.png), or leave that to t-a37f's manifest work item (2)?
    - answer: This task
  - question: ❓ Delete the old media/icon.svg, or keep it and just repoint references to loopboard-activitybar.svg (alternative: overwrite icon.svg's content so no path/src changes are needed)?
    - answer: Overwrite the old one
  - question: ❓ Should the unreferenced vector master media/loopboard-icon.svg be added to .vscodeignore so it stays in the repo but out of the .vsix?
    - answer: Yes
  - DELIVERED: Overwrote media/icon.svg with loopboard-activitybar.svg's content (no path/src
    changes — package.json's activitybar icon and src/panel.ts already point at media/icon.svg).
    Added top-level package.json "icon": "media/loopboard-icon-128.png" (work item 3, per the
    ownership decision above). Added media/loopboard-icon.svg to .vscodeignore (work item 5) —
    vsix file count 30→29. Noted the light/dark F5 contrast check in VERIFICATION.md (work item 6).
    `make check` green (29/29 tests, build + package clean). NOT F5-verified: activity-bar/panel
    icon rendering and README image resolution need a real VS Code window — you reported both
    still show the old state, which is expected until the running extension is reloaded/reinstalled
    from this build (see reply in-session).
    2026-07-15 (later): after reinstall, the activity-bar/sidebar/marketplace-header icon (all
    driven by package.json's top-level "icon" field) render correctly — confirms the reinstall
    picked up this build. The README's embedded logo (`<img src="media/loopboard-icon-128.png">`)
    still showed broken in the Extension Details pane: VS Code's readme renderer only rewrites
    image paths for markdown `![]()` syntax, not raw HTML `<img>` tags, so the relative src never
    resolved inside the webview. FIX: replaced the raw `<img>` with `![LoopBoard logo](media/
    loopboard-icon-128.png)` in README.md (width/height attrs dropped — the PNG is already
    128x128 native size, so no visual change). Also had to port an unrelated pre-existing parser
    bugfix (multi-line DELIVERED continuation, see src/parser.ts/writer.ts) onto this branch since
    it was blocking `make check` here. `make check` green again (29/29).

- [ ] Fix first-click reveal race: sidebar phase click opens the board on New instead of the clicked phase
  - id: t-b4d1
  - phase: new
  - groomer: fable
  - added: 2026-07-15
  - worklog: 2026-07-15
  - description: User-reported: clicking a phase in the sidebar's phase overview (e.g. "Review")
    while the board panel is CLOSED opens the board on the New tab; the second click works.
    DIAGNOSIS (fable, 2026-07-15, verified in source): PRIMARY CAUSE — the reveal is posted
    before the webview exists, then forgotten. In src/controller.ts:152-156 the `reveal` case
    runs synchronously: store `pendingReveal`, call `openBoard()`, then `flushReveal()`. On the
    first click the panel is only just created — `BoardPanel.current` is set immediately, but
    the webview's HTML/script haven't loaded, so its `window.addEventListener('message', …)`
    isn't attached yet. `flushReveal()` (controller.ts:68-73) sees `BoardPanel.current` and
    `this.lastBoard` both set (the sidebar keeps lastBoard fresh), posts the reveal into the
    void, and CLEARS `pendingReveal`. When the webview later sends `ready`, the handler calls
    `flushReveal()` again (controller.ts:122) — the mechanism meant for exactly this case — but
    the pending reveal was already consumed, so nothing is re-sent and the board renders its
    default tab (New). SECONDARY GUARD — the webview drops early reveals too: `revealTask` in
    media/board.js:628 starts with `if (!board) return;`, so a reveal arriving before the first
    board payload is also silently discarded. On the second click the panel is open and live,
    so the immediate flush is delivered — matching the "first time only" symptom.
    FIX DIRECTION: flush inline only when the panel ALREADY existed, otherwise leave
    `pendingReveal` for the `ready` handler — e.g. have `BoardPanel.show` report whether it
    created a fresh panel, or make `flushReveal` a no-op until the webview has signalled
    `ready`. Belt-and-braces option for the secondary guard: in board.js, stash an early
    reveal's phase/taskId and apply it when the first board payload arrives (only needed if
    a reveal can still beat the first `board` message after the primary fix).
    SCOPE: src/controller.ts (+ possibly src/panel.ts for a created-vs-existing signal from
    `BoardPanel.show`); media/board.js only if the secondary guard is addressed. VERIFY:
    controller/panel are VSCode-touching modules (not unit-testable here) — `make check` must
    pass, and the fix needs a manual F5 check: close the board panel, click "Review" in the
    sidebar phase overview, board must open ON the Review tab on the FIRST click (repeat for
    an attention row, e.g. the ❓-unanswered row targeting Feedback).
    GROOMED 2026-07-15 by fable (diagnosis done inline at the user's request in-session);
    left in New for your promotion.

- [ ] Thread question answers like Reddit comments: repeatable, author-attributed replies instead of one flat answer blob
  - id: t-b2c1
  - phase: new
  - added: 2026-07-15
  - description: Today each `question:` carries exactly ONE `answer:` line, so any back-and-forth
    (user gives a short direction, groomer elaborates, user corrects) gets mashed into a single
    prose blob with authorship and dates buried inside it — see t-027d's icon-ownership answer:
    "THIS task owns it (elaborated 2026-07-15 by the fable groomer at the user's direction...)".
    You can't tell at a glance who said what, when, or in what order. Replace the single answer
    with a REPLY THREAD per question — rendered in the board like a Reddit comment thread: each
    reply shows its author (user vs. agent/model) and date, indented under the question, newest
    appended at the bottom, with an input box to add the next reply rather than editing one blob.
    GRAMMAR (v3 extension, backward compatible): under a `question:` sub-bullet, allow repeatable
    `- reply (<author>, <YYYY-MM-DD>): <text>` sub-sub-bullets in file order, where <author> is
    `user` or a model name (`opus`/`sonnet`/`fable`). The existing `- answer:` line stays parseable:
    a non-blank `answer:` is treated as a single user reply (undated); a blank `answer:` = no
    replies yet. DECIDE whether the writer canonicalizes an old `answer:` into a `reply (user)` line
    or keeps emitting `answer:` until a thread exists (migration question below). Document the
    grammar change in the *Task format* block at the top of TODO.md and reconcile Rules 6 and 10
    wording ("filled-in answer" → "a reply thread whose LAST reply is from the user" — an agent
    asking a follow-up must NOT count as answered, that's the whole point of threading).
    WORK ITEMS: (1) model.ts: `Question { text, replies: Reply[] }` with
    `Reply { author, date, text }`; derive `answered` = replies non-empty AND last reply author is
    `user`. (2) parser.ts: parse `reply (...)` sub-sub-bullets (tolerant on spacing/case, like the
    existing `answer:` match at src/parser.ts:183); keep accepting legacy `answer:`. (3) writer.ts:
    emit the canonical thread form; round-trip fixpoint + idempotence fixtures for mixed
    legacy/threaded files (the core invariant — parse→write→parse must stay a fixpoint). (4)
    board.js `renderQuestions` (media/board.js:485): render the thread Reddit-style — author chip
    (color-code user vs. agent via VSCode theme variables), date, replies indented under the ❓
    question, then a reply box; replies are APPEND-ONLY from the board (posting sends a new-reply
    patch, never rewrites prior replies — appends can't same-field-conflict with a concurrently
    writing loop the way the current whole-answer overwrite can; keep the `pendingBoard`
    focus-deferral working for the reply box). Board-posted replies get `author: user` and today's
    date automatically. (5) store.ts patch plumbing: a `reply` patch appends to question i's
    thread (field-level patch per CLAUDE.md rule 4); update the questions-answered counter and
    the Feedback-column badge to the new `answered` definition. (6) Update the Automation /loop
    prompt + Rules 6/10 text so loop workers write `reply (<model>, <date>):` lines instead of
    overwriting `answer:`, and resume only when the LAST reply on every question is the user's.
    (7) `make check` green; manual F5 pass for the thread UI added to VERIFICATION.md's checklist.
    RISKS: this touches the round-trip core (parser+writer) — the existing fixture suite must
    stay green, incl. the v1 TODO.md HTML-comment fixtures; Rule 10's resume gate changes meaning,
    so an un-updated loop prompt could resume on an agent's own follow-up reply (ship the prompt
    edit in the same change as the parser); multi-line replies need the same 4-space-continuation
    handling as `description:` or long replies will land in unknownLines.
  - question: ❓ Migrate legacy `answer:` lines on save (writer canonicalizes them into `reply (user)` — clean, but rewrites history with a guessed author/date), or keep emitting `answer:` for single-reply questions and only switch to the thread form once a second reply exists?
    - answer:
  - question: ❓ Author attribution for agent replies: the model name (opus/sonnet/fable — matches the loop terminals) or a role label like `groomer`/`worker` (matches WHY it replied)? The screenshot's blob used both ("fable groomer").
    - answer:

- [ ] Add a "Sync template" board button that copies media/todo-template.md to disk and steers a Claude Code session to migrate the workspace's TODO.md onto the current format
  - id: t-c91a
  - phase: new
  - groomer: fable
  - added: 2026-07-15
  - description: Motivated by 2026-07-15: `media/todo-template.md` (the file `onCreateFiles` in
    `src/controller.ts` writes only when a workspace has no `TODO.md` yet) had silently drifted
    out of sync with the live grammar — it was still v2 (per-phase headings, "always PR" delivery
    rules) while `TODO.md`'s own Workflow/Task-format/Rules/Automation text had moved to v3 (flat
    `## Tasks` section + `phase:` field). Nothing catches this drift automatically: `make test`
    only checks the template parses to zero tasks and round-trips as a fixpoint, not that its
    prose matches the current grammar (see the "MUST NOT FORGET" note added to `VERIFICATION.md`
    the same day). This story is about giving the user a way to pull an *existing* workspace's
    `TODO.md` back onto the current template without a human manually diffing the two files.
    Scope: add a button (board toolbar or sidebar — TBD, see question below) that, when clicked:
    (1) copies the extension's current `media/todo-template.md` onto disk in the workspace (exact
    target path/name TBD — could overwrite `TODO.md` directly, or drop a sibling reference file
    for comparison, since `TODO.md`'s actual tasks must be preserved, not clobbered); (2) then
    kicks off (or primes) a Claude Code session/prompt instructing it to diff the workspace
    `TODO.md`'s Workflow/Task-format/Rules/Automation sections against the fresh template and
    migrate the structural/prose parts (headings, rule text, phase-field grammar) to match, while
    leaving every actual task's content, `id:`, `phase:`, and metadata untouched. This is
    distinct from `onCreateFiles` (which only fires for a workspace with no `TODO.md` at all) —
    here the file already exists and has real tasks in it, so it's a migrate, not a scaffold.
  - question: ❓ Where should the "Sync template" button live — the board toolbar (`media/board.*`), the sidebar (`media/sidebar.*`), or a command-palette command? And should it require a confirmation step before touching `TODO.md`, given it's the source of truth for in-flight work?
    - answer:
  - question: ❓ How should it invoke Claude Code to do the migration — reuse the existing `terminals.ts` pattern (spawn a terminal, paste a prompt, per the TUI-paste caveats already documented in CLAUDE.md), or some other mechanism? And should the copied template land as `TODO.md` directly, a temp/reference file the prompt is told to diff against, or something else — the actual tasks currently in `TODO.md` must survive the sync verbatim.
    - answer:

- [ ] DRAFT: Also add the extension to https://open-vsx.org/ to be findable and accessible easily without the propritery Microsoft VSCode .
  - id: t-49f4
  - model: sonnet
  - groomer: fable
  - added: 2026-07-15

<!-- Format when a worker parks a task here:
- [ ] <task>
  - id: t-xxxx
  - owner: @claude
  - started: <date>
  - worklog: <dates>
  - question: ❓ <what the worker needs decided, and the options it sees>
    - answer:
-->
<!-- Format for a story awaiting your review here (leave `feedback:` to request changes):
- [ ] <task>
  - id: t-xxxx
  - owner: @claude
  - added: <date>
  - started: <date>
  - worklog: <dates>
  - link: <PR url(s)>
  - DELIVERED: <what shipped>
  - feedback: ⚠️ <your review comments / change requests — the worker moves the story back to
    In Progress, addresses them, and returns it here. Tick `[x]` only when you accept.>
-->

---

## Automation

Watch this file, reconcile it, **and pick up work** every minute (from a Claude Code session in
the workspace root). The Claude TODO Board extension spawns one loop terminal per model and injects
the block below with `{MODEL}` substituted for that terminal's model (`opus` / `sonnet` / `fable`):

```
/loop 1m You are running as model {MODEL}. Re-read TODO.md and reconcile it against the Rules at the top. Every task lives in the single `## Tasks` section and carries a `- phase:` field — to "move" a task to another phase, edit its `phase:` field in place (never cut/paste a task between sections). (1) For each New task the user ticked [x], move it to Backlog (set `phase: backlog`), reset it to [ ], and note `promoted: <today>`. (2) For each Review task the user ticked [x], cut it and append it to DONE.md as [x] with its worklog and `completed: <today>`. (3) Append <today> to the worklog of every task you touch. (4) For each Feedback task where EVERY question has an `answer:`, move it back to In Progress and continue it; leave any task with a blank answer untouched. (5) Apply any `note:` line on a task you own — do what it says, record it in the worklog, then delete the note (Rule 16). (6) Keep the tracker current: if a referenced path / file / PR / dependency changed since a task was written, update the task's text and metadata to match reality and note the correction in its worklog. Then START WORKING: if nothing is In Progress for {MODEL}, claim the top Backlog task whose `model:` is {MODEL} — or has no `model:` field, if {MODEL} is the default model per Rule 15 — and whose `depends on:` are satisfied; set owner: @claude, started: <today>, worklog: <today>, move it to In Progress, and begin executing it; when finished, open a PR (Rule 7), record its link, and move it to Review. If you become unsure how to proceed, move the task to Feedback with a `question:` and stop — never guess. For New tasks and DRAFTs, groom/expand them with a subagent whose model is the task's `groomer:` field (default model if unset) per Rule 14, recording human decisions as single-line `question:` sub-bullets with blank `answer:` lines (not OPEN QUESTIONS prose); never promote them yourself. Respect one worker per task: never touch a task owned by someone else or one whose `model:` names a different model, and never tick [x] yourself. Report what changed and what you worked on, referring to every task by its full title — never by its bare id (ids like t-3f9a mean nothing to the reader; add the id in parentheses only if disambiguation is needed); if there is nothing to do, reply "no changes".
```

Notes:
- `/loop` defaults to a 10m interval; `1m` polls every minute. Omit the interval for the default.
- The loop picks up and executes work automatically, but still stops at the human gates — it
  cannot promote New tasks or accept Review tasks (those need your `[x]`), and it parks any task
  it's unsure about in **Feedback** rather than guessing.
- Model routing: each loop only claims tasks whose `model:` matches it (or unlabeled tasks, if it
  is the default model). The extension's ▶ buttons start these per-model loops for you.
- It keeps tasks accurate: when a referenced path/PR/dependency changes, it rewrites the affected
  task to match current reality (recording the correction in the worklog).
- It skips Backlog tasks with unmet `depends on:`, Feedback tasks with any blank answer, and won't
  start a second task while one is In Progress for its model.
- Tasks are a flat list in `## Tasks`; a task's phase is its `phase:` field, so moving a task is a
  one-line in-place edit (no section cut/paste — nothing can be lost mid-move).
- Stop it via the loop's status line, or by cancelling the scheduled task in the session.
