# DONE

Accepted tasks, newest first.

- [x] Security: document that TODO.md is trusted input (prompt-injection trust boundary) in the README
  - id: t-3c8e
  - phase: done
  - owner: @claude
  - added: 2026-07-18
  - started: 2026-07-19
  - promoted: 2026-07-19
  - completed: 2026-07-19
  - worklog: 2026-07-19
  - link: https://github.com/SinnConsulting/LoopBoard/pull/1 (task/t-3c8e @ df030ae; pushed + PR opened 2026-07-19 once the SSH key was added)
  - description: From the 2026-07-18 repo security scan (finding 5, accepted-by-design — document,
    don't change behavior). The product's core loop pastes TODO.md content (the Automation fenced
    block via buildLoopCommand, src/loop.ts) into an autonomous `claude` session that may run with
    `--permission-mode bypassPermissions`. A TODO.md from an untrusted source (cloned repo, shared
    workspace) is therefore a prompt-injection vector with arbitrary-command-execution consequences
    — inherent to what LoopBoard does, not a bug. SCOPE: add a short "Security model" note to
    README.md (and a one-liner in PLAN.md if it has a security/assumptions section) stating that
    TODO.md and workspace settings must be treated as trusted input, that loops execute with the
    configured permission mode, and that users should review TODO.md's Automation block before
    starting loops in a repo they didn't author. Docs-only change: no `make check` impact beyond
    packaging picking up the README.
  - DELIVERED: task/t-3c8e @ df030ae — added a "## Security model" section to README.md (before
    License) stating that TODO.md and workspace settings are trusted input: the loop pastes the
    Automation block into an autonomous `claude` session running at the configured
    loopBoard.permissionMode (possibly bypassPermissions), so an untrusted TODO.md/.vscode is a
    prompt-injection → arbitrary-command-execution vector; users should review the Automation block
    and cap permissionMode before starting a loop in a repo they didn't author, and Workspace Trust
    ≠ vetting TODO.md. PLAN.md left untouched — it has no security/assumptions section (its headings
    are Decisions / format / architecture / UI / terminals / milestones / open items), so the task's
    conditional PLAN.md one-liner didn't apply. `make check` green (build + test 0 failures + package;
    README picked up in the .vsix at 6.55 KB). Delivery is local commit df030ae on task/t-3c8e; `git
    push` to origin was denied (no SSH key in this session), so no PR link — mirrors the commit-only
    delivery of the recent tasks under the current Rule 7.

- [x] Adopt the new LoopBoard logo: swap the activity-bar/panel icon to loopboard-activitybar.svg and wire loopboard-icon-128.png as the marketplace icon
  - id: t-027d
  - phase: done
  - owner: @claude
  - model: sonnet
  - groomer: fable
  - added: 2026-07-15
  - started: 2026-07-15
  - promoted: 2026-07-15
  - completed: 2026-07-18
  - worklog: 2026-07-15, 2026-07-18
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

- [x] Add a semantic-release CI pipeline (GitHub Actions) that versions, tags, and attaches the .vsix to GitHub Releases
  - id: t-9c4e
  - phase: done
  - owner: @claude
  - model: fable
  - added: 2026-07-14
  - started: 2026-07-14
  - promoted: 2026-07-14
  - completed: 2026-07-18
  - worklog: 2026-07-14, 2026-07-18
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
    CORRECTED 2026-07-18 (fable loop, step 6): the "NOT verified: an actual Actions run" gap is
    now CLOSED by reality — the pipeline is merged to main and has run for real: tags v1.0.0 and
    v1.0.1 exist, and main carries `chore(release): v1.0.1 [skip ci]` (58293fc) plus
    `fix(marketplace): ... sync package.json to the released version` (ce1d2c9, so package.json
    `version` is 1.0.1 — the "frozen/vestigial version" note above is superseded). The open
    reviewer decision resolved itself: no 0.x seed tag was pushed, first release went 1.0.0.
    Main also gained `.github/workflows/publish.yml` (cffe19f) — the manual Marketplace publish
    follow-up anticipated above (workflow_dispatch: downloads the release .vsix, `vsce publish
    --packagePath` with VSCE_PAT). Only the human acceptance tick remains.

- [x] Publish the extension to the VS Code Marketplace (add MIT LICENSE, fill manifest, set up publisher + PAT)
  - id: t-a37f
  - phase: done
  - owner: unassigned
  - model: fable
  - added: 2026-07-12
  - promoted: 2026-07-14
  - completed: 2026-07-18
  - worklog: 2026-07-12, 2026-07-13, 2026-07-14, 2026-07-15, 2026-07-18
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
    ACCEPTED 2026-07-18 (user: "This story is done", fable loop moved it here). Reality on main
    confirms every work item landed: MIT LICENSE with "Copyright (c) 2026 Marcel Sinn (Marcel
    Sinn Consulting)" (commit 74dcd3e), package.json publisher SinnConsulting / name
    loopboard-todo / version 1.0.1 with top-level icon + repository fields, and the publish flow
    shipped as `.github/workflows/publish.yml` (commit cffe19f, manual workflow_dispatch: downloads
    the release .vsix from the vX.Y.Z GitHub Release and runs `vsce publish --packagePath` with
    the VSCE_PAT secret) instead of a host-side `make publish` — CI runners aren't the host, so
    the Docker-only rule is satisfied.
  - question: ❓ What is the Marketplace PUBLISHER name/ID? "claude-todo" is a placeholder and (per t-8823) is slated to change on rebrand.
    - answer: `SinnConsulting` — the publisher already exists at marketplace.visualstudio.com/manage/publishers/SinnConsulting (user, 2026-07-14; supersedes the earlier `loopboard` plan). package.json `publisher` updated to SinnConsulting in the staged rename batch; work item 3 (create publisher) is DONE.
  - question: ❓ What COPYRIGHT HOLDER goes in the MIT LICENSE (personal name vs. org)?
    - answer: Marcel Sinn (Marcel Sinn Consulting) — answered 2026-07-14.
  - question: ❓ Publish NOW or AFTER the rename task t-8823? t-8823 changes both `name` and `publisher`; publishing first creates a throwaway marketplace identity (installs/reviews/counts don't carry over, existing installs won't auto-upgrade). Strong recommendation: land t-8823 first, then publish once.
    - answer: AFTER t-8823 (decided 2026-07-14): rename lands and history is squashed first, then t-pr01 creates the public `loopboard` repo, then publish once.

- [x] Fix description line-cropping: render single newlines as markdown soft wraps in the webview
  - id: t-4b7c
  - phase: done
  - owner: @claude
  - model: fable
  - added: 2026-07-14
  - started: 2026-07-14
  - completed: 2026-07-14
  - worklog: 2026-07-14
  - link: branch task/t-4b7c @ 29070c8, main @ ae4fcb3
  - description: User-reported (screenshot, 2026-07-14): card description lines broke far short of
    the card width. ROOT CAUSE: descriptions are hard-wrapped in TODO.md (4-space continuation
    lines) and `src/parser.ts` joins them with `\n`; `mdToHtml` in `media/board.js` turned every
    `\n` into `<br>`, so cards reproduced the source file's wrap points. FIX: treat a single
    newline as a markdown soft wrap (space) so text flows to the card width, and a blank line
    (`\n{2,}`) as a paragraph break (`<br><br>`). An earlier uncommitted attempt at this fix (from
    an opus session) used raw NUL bytes as a swap sentinel, which made board.js look binary to
    grep/git; rewritten without the sentinel — replacing `\n{2,}` first is order-safe since
    `<br><br>` contains no `\n`. Affects both live-card descriptions (`renderDescription`) and
    Done-row detail (`done-detail-text`), which share `mdToHtml`. Task created retroactively: the
    work was done at the user's direct request in-session, then tracked and committed per Rule 12.
    CORRECTED 2026-07-14: the fix has since LANDED ON MAIN @ ae4fcb3 — the earlier "left
    uncommitted in main's working tree" state no longer applies; main's board.js is clean and
    carries the fix.
  - DELIVERED: media/board.js mdToHtml — `\n{2,}` → `<br><br>`, then `\n` → space (was: every `\n` → `<br>`). Delivered per temp Rule 7 on branch task/t-4b7c @ 29070c8, and now landed on main @ ae4fcb3 (so the running extension picks it up on window reload — no cherry-pick needed on acceptance). `make check` green with this exact change (build + 28/28 tests + .vsix packaged). NOT F5-verified headlessly; verify by reloading the window and viewing any long hard-wrapped description (e.g. t-pr01's card).

- [x] Add a per-task groom-model selector alongside the existing execution-model select on New/draft cards
  - id: t-2c90
  - phase: done
  - owner: @claude
  - model: fable
  - added: 2026-07-13
  - started: 2026-07-13
  - promoted: 2026-07-13
  - completed: 2026-07-14
  - worklog: 2026-07-13, 2026-07-14
  - link: branch task/t-2c90 @ 5a65a5e, main @ 71fc3ac
  - description: You want New/draft stories to expose TWO model selectors: (1) which model should
    GROOM the task, and (2) which model should EXECUTE it once promoted. Both default to the
    default model (Rule 15, currently opus). Note "sonet" in the draft is your spelling of
    "sonnet" — the model id stays `sonnet`.
    CURRENT BEHAVIOR: The EXECUTION-model selector already exists. Every non-draft card renders a
    `model-select` dropdown in `renderCard` (`media/board.js` ~lines 297-308) with options
    `default (opus) | opus | sonnet | fable`; on change it calls `sendPatch(t.id, 'model', …)`,
    normalizing `'default (opus)'` → `''` (`normModel`, ~line 306) so an unchanged default never
    trips a false same-field conflict. That `model:` field parses in `src/parser.ts applySegment`
    (~line 110), serializes in `src/writer.ts serializeTask` (~line 41), threads to the webview via
    `WebTask.model` in `src/view.ts toWebTask` (~line 62), and patches through
    `src/merge.ts` (`PatchField` ~line 6, `parseModel`/get/set ~lines 24-57). It drives Rule 15
    task CLAIMING: each loop claims only tasks whose `model:` matches it (or unlabeled = default).
    GROOMING, by contrast, is HARDCODED to Opus — there is no per-task groom field. Rule 14
    (`TODO.md` ~lines 118-122) says "Explore New tasks (and drafts) with an Opus subagent", and the
    Automation `/loop` prompt (`TODO.md` ~line 425) instructs "For New tasks and DRAFTs, groom/expand
    them with an Opus subagent (Rule 14)". So today the groom model is fixed; only the execution model
    is user-selectable.
    Note also that draft cards (`renderDraft`, `media/board.js` ~lines 230-262) render NO model
    select at all — a draft only shows its editable text, a Draft badge, and a delete button — and the
    writer emits only `id:`/`added:` for a draft (`serializeTask` isDraft branch, ~lines 33-37), so any
    new field must be handled for the draft path too if the selector is to appear on drafts.
    PROPOSED DESIGN: Add a new optional grammar field — `groom model:` (values `opus | sonnet | fable`,
    absent = default model) — and a SECOND selector on New/draft cards that patches it, mirroring the
    existing execution-model select exactly (same options, same `'default (opus)'` → `''`
    normalization to avoid false conflicts). The loop's groomer and Rule 14 then honor the field:
    groom with the named model's subagent, falling back to the default (opus) when the field is empty.
    SCOPE (touch points, mirroring the existing `model:` plumbing):
    (1) `src/model.ts` — add `groomModel?: Model` to `Task`.
    (2) `src/parser.ts applySegment` — add a `'groom model'` case (validated against `KNOWN_MODELS`
    like `model`); place it in the fixed field order (right after `model`).
    (3) `src/writer.ts serializeTask` — emit `  - groom model: <v>` when set, next to the `model:`
    line; decide whether drafts carry it (the isDraft branch currently emits only id/added).
    (4) `src/view.ts` — add `groomModel` to `WebTask` and map it in `toWebTask`.
    (5) `src/merge.ts` — add `'groom model'` to `PatchField` and to `currentFieldValue`/`setFieldValue`
    (reuse `parseModel` for the `'default (opus)'` → undefined mapping).
    (6) `media/board.js` — render the second selector (label it e.g. "Groom" vs the execution
    "Model") on New/draft cards and wire its change to `sendPatch(t.id, 'groom model', …)` with the
    same `normModel`.
    (7) Rule 14 wording + the Automation `/loop` prompt — change "with an Opus subagent" to "with the
    task's `groom model:` (Opus subagent if unset)" so the groomer honors the field.
    WHAT STAYS: the existing execution `model:` field, its selector, and Rule 15 claim routing are
    unchanged (this only ADDS a groom-model field); `TODO.md` remains the source of truth; all IO
    through `src/store.ts`; the two human gates; DRAFT text-edit / delete affordances; the parser's
    tolerant round-trip of unknown lines.
    RISKS: (a) ROUND-TRIP is the core invariant — a new field must keep parse→write→parse a fixpoint
    and `serialize(parse(x))` idempotent; update the fixture suite (incl. the real v1 TODO.md) so the
    new field round-trips and isn't demoted to an unknown line. (b) FALSE-CONFLICT normalization: the
    groom selector must map `'default (opus)'` → `''` exactly like the execution select's `normModel`,
    or an unchanged default trips a spurious same-field-conflict toast. (c) SPELLING: the draft says
    "sonet"; the canonical id is `sonnet` — the selector option and grammar value stay `sonnet`. (d)
    Field ORDER: `groom model:` must land in a fixed position (proposed: right after `model:`) so the
    writer's canonical order is deterministic. (e) DRAFT path: if the selector should appear on drafts,
    the writer's isDraft branch and `renderDraft` both need the field — otherwise scope the selector to
    non-draft New cards only (see OQ).
    OPEN QUESTIONS (human must answer before executing): (1) Should the groom-model selector appear on
    DRAFT cards (which are what actually get groomed) and/or on all non-draft New cards — or on every
    phase's card like the execution-model select does? Grooming only happens in New, so New/draft-only
    seems right, but confirm. (2) When `groom model:` is empty, should Rule 14's "always Opus" stay the
    effective default (i.e. empty = opus), or should empty mean "the default model per Rule 15" (same
    thing today, but they'd diverge if the default model ever changes)? (3) Field name: `groom model:`
    vs `groom:` vs `groomer:` — pick the grammar keyword (affects parser case + docs).
    GROOMED 2026-07-13 by Opus subagent (Rule 14).
    2026-07-13 (opus): claimed from Backlog; the groom left three "human must answer before
    executing" decisions that change the implementation, so parked in Feedback with them as
    structured questions below rather than guess (Rule 6). Will resume once all are answered.
    2026-07-13 (opus): addressed your Review feedback "I don't see it. Why could that be?"
    (Rule 13) — moved back to In Progress, diagnosed, fixed, returned to Review. ROOT CAUSE:
    the deliverable was committed only to branch task/t-2c90 (temp Rule 7 branch delivery does
    NOT auto-land on main), so the running extension — built from main — never had it. SECOND
    reason it would still be invisible even once landed: per your own answer #1 the "Groom with"
    selector renders on DRAFT cards ONLY, and there are currently no DRAFT cards on the board,
    so create a draft (the board's draft affordance) to see it. FIX: cherry-picked 37f2747 onto
    main (clean auto-merge, no conflicts) as commit e444ca3; make check green (28/28 tests,
    .vsix packaged). Reload the Extension Development Host / reinstall the .vsix, then add a
    DRAFT card to see the "Groom with" selector.
    2026-07-14 (opus) addressed your Review feedback "How would the workflow for this look like?"
    (Rule 13) — moved to In Progress, answered, returned to Review. THE WORKFLOW: (1) Create a
    draft on the board's New tab (the draft affordance) — it appears as a `- [ ] DRAFT: <text>`
    card. (2) Pick who grooms it: the draft card now shows a "Groom with" dropdown
    (default (opus) | opus | sonnet | fable); selecting one patches the task's `groomer:` field
    via the normal save path, leaving it at default keeps the field empty = the default model
    (opus, Rule 15). (3) The loop grooms it: when ANY model's `/loop` pass sees a New task/DRAFT
    it delegates grooming to a subagent whose model IS the task's `groomer:` field (falling back
    to the default model when unset), per Rule 14 — the groomer expands the draft into a full
    story (title, description, scope) and records human decisions as structured `question:` /
    `answer:` sub-bullets. (4) You review & promote: the groomed New card surfaces its questions
    in the board's question UI; you answer/decide and tick `[x]` to promote it to Backlog. Note
    `groomer:` controls only WHO grooms; the separate execution `model:` field (set once
    promoted) controls who EXECUTES the task via Rule 15 claim routing — the two are independent.
    2026-07-14 (fable) addressed your Review feedback "It must appear directly when '+ New Story'
    in that menu to select groomer and worker model" (Rule 13) — moved to In Progress, implemented,
    returned to Review. The composer (renderComposer, media/board.js) now renders a "Groom with"
    and a "Model" (worker) selector under the story textarea; both default to default (opus) and
    are sent with the createDraft message. Plumbing: store.createDraft/controller accept
    groomer+model (validated via normalizeModel, now exported from src/merge.ts), and the writer's
    DRAFT branch emits `model:` (before `groomer:`) so a draft's worker model round-trips — the
    parser already accepted it. New fixpoint test for model+groomer on drafts. make check green
    (29/29 tests). Delivered on branch task/t-2c90 @ 5693824, cherry-picked to main @ c73a205,
    .vsix rebuilt and reinstalled — reload the window and click "+ New Story".
    2026-07-14 (fable) layout follow-up per your request: the two selectors moved inline into the
    composer actions row, right after Cancel (plus flex-wrap so narrow panes don't overflow) —
    branch @ 9bf9896, main @ 36ef263, .vsix reinstalled.
    2026-07-14 (fable) per your request bumped the extension to v0.1.1 and installed
    claude-todo-board-0.1.1.vsix (`code --install-extension --force`, verified
    claude-todo.claude-todo-board@0.1.1) so VSCode treats it as a real upgrade; a window reload
    still can't be forced from the CLI (no such `code` command; macOS blocks scripted keystrokes) —
    reload once via Cmd+Shift+P → "Developer: Reload Window". Branch @ 5a65a5e, main @ 71fc3ac.
  - question: ❓ Where should the new groom-model selector appear — on DRAFT cards and non-draft New cards only (grooming happens only in New; recommended), or on every phase's card like the execution-model select does?
    - answer: Draft Cards
  - question: ❓ When `groom model:` is empty, should that mean "the default model per Rule 15" (recommended — tracks the default if it ever changes) or hard-pinned to Opus (matching Rule 14's current "always Opus" wording)?
    - answer: Yes
  - question: ❓ Which grammar keyword for the field — `groom model:` (used throughout the groom; recommended), `groom:`, or `groomer:`? This fixes the parser case, writer line, and docs.
    - answer: groomer
  - DELIVERED: 2026-07-14 re-delivered after your "+ New Story" feedback: the composer now has inline "Groom with" and "Model" (worker) selectors, so both `groomer:` and `model:` are set at draft creation (branch task/t-2c90 @ 5693824, main @ c73a205, .vsix reinstalled — reload the window and click "+ New Story"; the draft card keeps its "Groom with" selector for later changes). Original delivery: landed on main (commit e444ca3) so it's visible in the running extension — appears on DRAFT cards only, so add a draft to see it. Per your three answers (Draft Cards / default-model-when-empty / keyword `groomer`). Added an optional `groomer:` grammar field (values opus|sonnet|fable; absent = default model per Rule 15) threaded through the whole stack: src/model.ts (Task.groomer), src/parser.ts (parse `groomer:`, invalid value → unknown line like `model:`), src/writer.ts (emit `- groomer:` — on the DRAFT path before `added:`, and on full tasks right after `model:`), src/view.ts (WebTask.groomer + toWebTask), src/merge.ts (PatchField `groomer` + get/set/normalize reusing normalizeModel). media/board.js: a "Groom with" selector on DRAFT cards only (per answer 1), mirroring the execution-model select incl. the `default (opus)` → `''` normalization, posting `sendPatch(id,'groomer',…)`. Docs wired so the field is honored (not inert): Rule 14, the Task-format v3 grammar, and the Automation `/loop` prompt now say "groom with the task's `groomer:` model subagent (default model if unset)". New round-trip test (test/parser.test.js) — patches `groomer` onto a draft, asserts it serializes before `added:`, round-trips, and clears on empty. `make check` GREEN (28/28 tests, .vsix packaged) with Docker up. Delivered per temp Rule 7 on branch task/t-2c90 @ 37f2747 (only the 7 code/test files committed; the live TODO.md doc edits are tracker changes on main). NOT F5-verified — reload the Extension Development Host and open a Draft card to see the "Groom with" selector.

- [x] Rename & rebrand the extension away from "Claude TODO" to an agent-agnostic name
  - id: t-8823
  - phase: done
  - owner: @claude
  - model: opus
  - added: 2026-07-11
  - started: 2026-07-14
  - promoted: 2026-07-14
  - completed: 2026-07-14
  - worklog: 2026-07-12, 2026-07-14
  - link: origin/main @ 8f479db (single "init: LoopBoard" commit, pushed to SinnConsulting/LoopBoard)
  - description: Rename-and-rebrand task only — no behavior/feature change. The tool is a VSCode
    extension that renders a workspace `TODO.md` as an interactive board, writes edits back to
    markdown, and spawns model loop terminals; it is currently branded "Claude TODO Board" but is
    being decoupled from "Claude" so it can later drive Cursor and other coding agents.
    NAME (DECIDED 2026-07-14, interactive grooming with user): **LoopBoard**. Display name
    "LoopBoard"; `package.json` `name` and `publisher` are lowercase `loopboard`; all machine-id
    prefixes are camelCase `loopBoard.*` (matches the existing `claudeTodo.*` convention). Verified
    2026-07-14: no marketplace clash for "Loopboard". Rejected candidates: Boardmd/MDBoard
    ("Markdown Board" already taken — iketiunn.md-board), Cadence (Cadence Design Systems / Uber
    Cadence), Loombook (Loom video tool), Taskweave (W&B "Weave" mindshare), Agentboard (LLM
    benchmark + Agent Kanban extension), Marklane (markdown-only metaphor; name should lead with
    the agent-loop identity per user).
    Scope of the rename (identifiers/strings that must change): `package.json` `name`
    (`claude-todo-board`→`loopboard`), `displayName` (→"LoopBoard"), `publisher`
    (`claude-todo`→`loopboard`), `description`; the `viewsContainers`/`views` container
    id + title (`claude-todo`→`loopBoard` / "Claude TODO"→"LoopBoard"); command ids
    `claudeTodo.openBoard|refresh|spawnLoop`→`loopBoard.*` + titles; the `claudeTodo.*` configuration
    keys (`permissionMode`, `defaultModel`, `loopInterval`, `autoRecycle`)→`loopBoard.*`;
    the sidebar view id `claudeTodo.sidebar`→`loopBoard.sidebar` and panel id
    `claudeTodo.board`→`loopBoard.board` in `src/panel.ts`/`src/sidebar.ts`; user-facing strings in
    `src/controller.ts`, `src/terminals.ts`, `src/extension.ts`, `src/model.ts`; the webview
    `media/*.{html,css,js}` and `media/todo-template.md`;
    and prose in `README.md`, `PLAN.md`, `DECISIONS.md`, `CLAUDE.md`, `VERIFICATION.md`. The `.vsix`
    artifact name changes automatically (derives from `package.json` name+version). What STAYS:
    `TODO.md`/`DONE.md` filenames and the `workspaceContains:TODO.md` activation event (product
    contract, not brand); the v2 markdown grammar; the terminal-spawn / loop mechanics; genuinely
    Claude-CLI-specific `Claude`/model references stay until multi-agent support is actually built
    (this task only removes the hard brand coupling, it does NOT add Cursor support) — DECIDED:
    terminal names stay "Claude <Model>" (they host the actual claude CLI; runtime truth, not brand).
    DECIDED: config-key migration is a clean break — no deprecated `claudeTodo.*` aliases, just a
    migration note in README (extension is unpublished at 0.1.x). DECIDED: delete the stale
    `claude-todo-board-vscode-extension/` duplicate directory (8 tracked files) as part of this task.
    SEQUENCING (DECIDED): land the rename, then squash git history to a single fresh
    "init: LoopBoard" commit; commit locally but do NOT push (no public remote yet — t-pr01 creates
    it later, and the public repo should be named `loopboard` from birth). NOTE: the squash
    supersedes t-pr01's "push the four task branches to preserve delivery history" intent — t-pr01
    needs a regroom to match. Feeds t-a37f: publisher ID is `loopboard`, publish only after this
    task lands (answers recorded there).
    RISKS: the `workspaceContains:TODO.md` activation event is name-independent (safe) but confirm
    no code path keys off the extension-id string; command-id churn breaks any keybindings/docs
    referencing `claudeTodo.*` (grep must cover `media/` webview JS); an incomplete sweep leaves a
    split brand — run a full case-insensitive sweep for claude/claudeTodo/claude-todo + `make check`
    after; the history squash is destructive — do it on a fresh clone/backup branch first.
    GROOMED 2026-07-12 by Opus subagent (Rule 14); re-groomed interactively with user 2026-07-14
    (name + all open decisions resolved); left in New for your promotion, model: fable.
    2026-07-14: rename EXECUTED in working tree (user-driven session): full sweep done, stale dir
    deleted, README migration note added, DECISIONS.md entry logged, `make check` green (29/29
    tests, loopboard-0.1.1.vsix, 27 files). All changes STAGED but NOT committed per user — the
    fresh "init: LoopBoard" squash commit awaits the user's go-ahead.
    CORRECTED 2026-07-14: the real Marketplace publisher is `SinnConsulting` (exists at
    marketplace.visualstudio.com/manage/publishers/SinnConsulting, per user) — NOT `loopboard` as
    decided above. package.json `publisher` was updated to SinnConsulting and restaged; `name`
    stays `loopboard` and all `loopBoard.*` ids are unaffected (publisher is marketplace identity
    only).
    2026-07-14 (opus loop): claimed the top Backlog opus task and moved it to In Progress to
    finish it — but the rename is ALREADY fully executed and staged in main's working tree
    (git status confirms: media/loopboard-*.{svg,png} added, src/* + package.json modified, the
    stale claude-todo-board-vscode-extension/ dir deleted). The only remaining step — commit +
    the DECIDED destructive history squash to a single "init: LoopBoard" commit — was explicitly
    gated by you ("awaits the user's go-ahead"), and there is now a naming/sequencing tension with
    the already-existing `origin` (github.com/SinnConsulting/LoopBoard, not `loopboard`). Rather
    than run a destructive squash or guess, parked in Feedback with the decisions below (Rule 6).
    2026-07-14 (opus, user request): pre-commit LEAK AUDIT of the tree the "init: LoopBoard"
    commit would contain — NO secrets (no token/PAT/key values; VSCE_PAT is name-only, lives in
    GitHub Actions secrets; only email-shaped match is the git@github.com SSH URL; no /Users/
    absolute paths). Shipping code (package.json, src/**, media/**) fully rebranded — zero
    old-brand leaks. Removed the stale tracked `TODO.md.bak` (git rm; 280-line pre-migration backup
    that would otherwise seed the fresh history — resolves t-pr01 OQ-b). NOTE: TODO.md/DONE.md/
    DECISIONS.md are internal working notes (git user, private repo URL, publisher SinnConsulting,
    sibling repo ClockClock) — harmless while the repo is PRIVATE, but revisit before making it
    public for the marketplace listing (t-a37f).
    2026-07-14 (opus): all three questions answered (commit + clean push, no history / Q2 Yes /
    Q3 Opus). Resumed and executed: built a single orphan "init: LoopBoard" commit (8f479db, no
    parents) as the new main and PUSHED it to origin (SinnConsulting/LoopBoard). The remote was
    empty, so this was a clean first push (no force needed) — remote main now holds exactly one
    commit, no previous history, and TODO.md.bak is absent. Old 33-commit history preserved LOCALLY
    on branch `backup-pre-loopboard` + tag `pre-loopboard-backup` (not pushed); local task/* branches
    also stay local. Moved to Review.
  - question: ❓ Go-ahead to COMMIT the staged rename now? And as a single squashed "init: LoopBoard" commit (destructive — I'll cut a backup branch first) or a normal commit that preserves the existing history?
    - answer: Yes go ahead and commit. Make sure its a clean push. No previous history.
  - question: ❓ `origin` already exists as the PRIVATE repo github.com/SinnConsulting/LoopBoard, but t-pr01 planned a repo named `loopboard` "from birth". Is SinnConsulting/LoopBoard the intended final repo (I'll adjust t-pr01), or should a separate `loopboard` repo still be created?
    - answer: Yes
  - question: ❓ The `model:` field reads `opus` but this task's prose repeatedly says "model: fable". Which model should EXECUTE/finish this task — opus (current field, which is why I claimed it) or fable?
    - answer: Use Opus for it - LGTM
  - DELIVERED: LoopBoard rename fully executed and PUSHED. The repo now begins from a single clean
    commit `origin/main @ 8f479db "init: LoopBoard"` (no previous history, no `TODO.md.bak`, stale
    `claude-todo-board-vscode-extension/` gone). Shipping code/manifest (package.json, src/**,
    media/**) is 100% rebranded (name `loopboard`, ids `loopBoard.*`, publisher `SinnConsulting`,
    display "LoopBoard"); remaining `claudeTodo`/`Claude` strings are intentional (terminal names
    host the real claude CLI) or historical tracker prose. Pre-push leak audit: no secrets. `make
    check` green (29/29, loopboard-0.1.1.vsix). Old history kept locally on `backup-pre-loopboard`.
    NOTE for follow-ups this unblocks: t-pr01 (Rules 7/12/9 + /loop revert to PR delivery — origin
    now exists), t-9c4e (no `.github/workflows/` yet — CI still to be added), t-a37f (marketplace).

- [x] Make Done cards expandable/collapsible to reveal their description & DELIVERED detail
  - id: t-0eaf
  - phase: done
  - owner: @claude
  - model: fable
  - added: 2026-07-13
  - started: 2026-07-13
  - promoted: 2026-07-13
  - completed: 2026-07-14
  - worklog: 2026-07-13, 2026-07-14
  - link: branch task/t-0eaf @ a44af52
  - description: The Done tab is a flat, read-only archive of accepted tasks pulled from DONE.md,
    but each row shows almost nothing. `renderDone` in `media/board.js` (~lines 204-217) renders
    one `.done-row-item` per task with only: a green check icon, the title (with any leading
    `[x] ` stripped), the `completed` date as a mono chip, and the first link. It discards the
    rich detail that DONE.md entries actually carry — the long `description:` block and the
    `DELIVERED:` text — even though that data is ALREADY on the client. `toWebTask` in
    `src/view.ts` (~lines 56-78) maps every field including `description`, `delivered`, `worklog`,
    `links` and `completed`, and `toWebviewBoard` (~line 112) runs done tasks through the exact
    same mapper (`board.done.slice(0, 50).map(...)`). `parseDone` in `src/parser.ts` (~line 314)
    reuses the same `parseSection` as live tasks, so a done task's `description`/`delivered` are
    fully populated. So the missing detail is purely a rendering omission in the webview.
    GOAL: let the human expand a Done card to read its full description and DELIVERED summary,
    collapsed by default so the archive stays a scannable list.
    PROPOSED APPROACH (webview-only): make each Done row a collapse/expand toggle that reuses the
    existing chevron idiom. Model it on the unparsed-lines toggle in `renderCard`
    (`media/board.js` ~lines 322-332): a button whose click flips a per-task boolean in the `ui`
    map and calls `render()`, with `icon(SVG.chevron)` as the affordance. Concretely: give each
    task its `ui` entry via `getUi(t.id)` (~line 63) and store e.g. `u.doneOpen` (default falsy =
    COLLAPSED). Collapsed shows exactly today's row (check, title, completed chip, link) plus the
    chevron; only show the chevron/make-it-clickable when the task actually HAS a `description`
    or `delivered` to reveal (skip the affordance otherwise so bare rows don't get a dead toggle).
    Expanded appends a detail block beneath the row rendering `t.delivered` (label it "Delivered",
    mirroring `renderReview` ~lines 451-454) and `t.description` via `mdToHtml` (~line 393) so the
    markdown renders consistently with live cards — but STATIC/read-only: no textarea, no
    click-to-edit, no `sendPatch`. The Done tab is an explicit read-only archive (PHASE_META
    explainer "Accepted work, read-only archive", `media/board.js` ~line 47), so add NO editing
    affordances. RECOMMENDATION: default COLLAPSED (the archive is a reference list scanned by
    title/date; expansion is opt-in per row) and gate the chevron on presence of detail. New CSS
    likely wanted for the expanded detail block (`media/board.css`) — reuse `.done-row-item` /
    `.section-title` styling where possible rather than inventing new classes.
    SCOPE: webview-only — `media/board.js` (rewrite `renderDone`) and minor `media/board.css`.
    Verified no parser/writer/store/model/view change is needed: the description & delivered
    fields already round-trip through `parseDone` and `toWebTask` and are present on the done
    WebTask objects the webview receives; nothing new needs to be parsed, serialized, or patched.
    RISKS: (a) per-row `ui` state (`u.doneOpen`) is keyed by task id like all other UI state, so
    it survives re-renders but resets if the id churns — acceptable for an archive. (b) Done rows
    render via `renderDone`, a separate path from `renderCard`, so the chevron rotation / open
    styling must be wired into the new done markup, not inherited from card CSS. (c) The "Showing
    last 50" footer (~line 215) and the 50-item slice stay as-is; expansion doesn't change paging.
    (d) DONE.md descriptions can be long — expanded blocks may be tall; that's expected and fine
    since they're collapsed by default. OPEN QUESTIONS: none blocking — collapsed-by-default and
    read-only detail are the sensible defaults; flag if you'd prefer expanded-by-default instead.
    GROOMED 2026-07-13 by Opus subagent (Rule 14); model: fable.
    2026-07-13 addressed your Review feedback "I don't see it. Why could that be?" (Rule 13).
    ROOT CAUSE: same as t-fc27 — the .vsix you run was packaged/installed at 10:18, but this
    feature's commit (0bfcfc1) was cherry-picked onto main at 10:20, AFTER packaging, so the
    installed media/board.{js,css} predated it. FIX: rebuilt from current main (`make check`
    green, 28/28 tests) and reinstalled via `code --install-extension --force`; verified the
    installed board.js now contains the chevron code. Reload the VSCode window, open the Done tab,
    and click a row's chevron (every current DONE.md entry has detail, so all rows get one).
    Returned to Review.
  - DELIVERED: 2026-07-13 re-delivered after "I don't see it": the installed .vsix predated the feature landing on main (packaged 10:18, cherry-pick 10:20) — rebuilt and reinstalled the extension; reload the VSCode window and expand a Done row's chevron. Original delivery: media/board.js renderDone — Done rows with a description and/or DELIVERED text now get a chevron toggle (right end of the row; rows without detail get no dead affordance). Clicking it flips per-task `u.doneOpen` (collapsed by default) and expands a read-only `.done-detail` block under the row: "Delivered" (plain text, mirroring renderReview) and "Description" rendered via mdToHtml with data-mdlink anchors wired to openLink. No editing affordances — the archive stays read-only; the 50-item slice and footer are unchanged. media/board.css — `.done-chevron` rotation + `.done-detail`/`.done-detail-text` styles reusing the section-title/code/link idioms. Delivered per temp Rule 7 on branch task/t-0eaf @ a44af52 (only the two media files committed; main checkout unchanged — cherry-pick or merge to see it). `make check` green (27/27 tests, .vsix packaged). NOT F5-verified. NOTE: while validating, the live-TODO.md round-trip test caught that multi-line `question:` continuation lines don't parse (5 unknown lines each on t-fc27 and t-2c90, written by the fable and opus loops today); both were mechanically re-joined to single-line questions, wording unchanged, to restore the zero-unknown-lines fixpoint.

- [x] Highlight groomer OPEN QUESTIONS on New cards with the same dedicated UI Feedback uses
  - id: t-fc27
  - phase: done
  - owner: @claude
  - model: fable
  - added: 2026-07-13
  - started: 2026-07-13
  - promoted: 2026-07-13
  - completed: 2026-07-13
  - worklog: 2026-07-13
  - link: branch task/t-fc27 @ 8c3fd46
  - description: When the Opus groomer (Rule 14) expands a New task it raises decisions the human
    must make, but those land as plain prose buried in the `description:` free text — every current
    New/groomed story writes them as an "OPEN QUESTIONS (human must answer ...)" paragraph (see
    t-pr01, t-a37f, t-4d2e in this file). On the board a New card renders ONLY its title, chips and
    description: `renderCard` in `media/board.js` (~line 264) appends `renderChips` then
    `renderDescription` (~line 335) and nothing else for `variant === 'new'`. The description is
    shown as inline-markdown body text (`renderDescription`, ~line 402 → `mdToHtml`), so the
    questions read as ordinary grey prose with no visual weight.
    By contrast a Feedback card gets a dedicated, high-contrast treatment: `renderCard` calls
    `renderQuestions` only when `variant === 'feedback'` (~line 343). `renderQuestions`
    (~lines 429-449) draws each `question:` as a ❓-prefixed block in a quoted panel (`.question`,
    `media/board.css` ~line 183) with an answer textarea beneath and a "N of M answered" progress
    line. That structured UI exists because Feedback tasks carry repeatable structured
    `question:`/`answer:` sub-bullets, whereas New tasks carry only description prose.
    GOAL: give the questions the groomer poses on a New card the same prominence the Feedback
    question block has, so the human can see at a glance what a New story needs decided before
    promotion.
    IMPORTANT ENABLER (already true — verified): the model is NOT phase-gated. In `src/parser.ts`
    `applySegment` parses `question:` (~line 147) and its `answer:` (~line 150) on ANY task
    regardless of phase, and `src/writer.ts serializeTask` (~lines 55-58) emits
    `- question: ❓ …` + `- answer: …` for any phase. So structured questions already round-trip
    on a New task through the store with no parser/writer change needed. Only the webview gates
    the UI to Feedback.
    APPROACHES:
    (A) STRUCTURED (recommended). Have the groomer emit real `question:`/`answer:` sub-bullets on
    New tasks instead of an "OPEN QUESTIONS" prose paragraph, and render them on New cards by
    reusing the existing question block. Smallest UI change: in `media/board.js renderCard`, also
    call `renderQuestions(t)` when `variant === 'new'` and the task has questions. Decide read-only
    vs answerable on New (see OQ-2). Pros: reuses proven, styled, accessible UI and the existing
    field-patch path (`answer` patches already work for any task); questions become first-class
    data, not prose the human has to hunt through. Cons: requires updating the grooming convention
    (the /loop groomer + this Rule-14 subagent must write `question:` lines on New tasks) and any
    already-groomed New tasks keep their prose questions until re-groomed (acceptable — forward
    convention, not a migration).
    (B) PROSE-DETECT. Keep questions in `description:` prose and teach `renderDescription` (or a new
    New-only renderer) to regex-detect an "OPEN QUESTIONS" section and restyle it into a
    ❓-highlighted callout. Pros: no change to grooming output or data model; retro-highlights every
    existing groomed card. Cons: brittle heuristic parsing of free text (formats vary: "OPEN
    QUESTIONS (human must answer before executing):", "OPEN QUESTIONS (groomer):", inline "(a)/(b)"
    vs numbered "(1)/(2)" items); purely cosmetic — the questions stay unstructured prose with no
    answer affordance; duplicates highlighting logic the Feedback block already solves.
    RECOMMENDATION: (A) — it converges New and Feedback on one structured question mechanism the
    parser/writer already support, and is a genuinely small webview edit. Scope it as: (1) render
    existing `question:` items on New cards (reuse `renderQuestions`, or a read-only variant per
    OQ-2); (2) update the groomer convention (the Automation `/loop` prompt's Rule-14 grooming step
    and Rule 14 / the subagent brief) to emit `question:` sub-bullets on New tasks rather than an
    OPEN QUESTIONS prose block. WHAT STAYS: parser.ts, writer.ts, model.ts (no grammar change —
    questions already parse/serialize on any phase); the Feedback rendering path; the New promote
    (Approve) gate; description free-text for everything that is genuinely narrative, not a decision.
    RISKS: (a) `renderQuestions` renders an editable answer textarea and a "worker resumes at M of M"
    progress line whose wording is Feedback-specific and misleading on a New card (nothing "resumes"
    — a New card is promoted, not answered-then-resumed); reusing it verbatim needs the progress/
    resume copy conditionalized or a New-specific variant. (b) The Feedback tab's attention dot keys
    off unanswered questions (`phaseAttention`, `media/board.js` ~line 90 — `feedback` branch checks
    `q.answered`); the New branch currently keys off `!t.isDraft`. If New tasks gain answerable
    questions, decide whether an unanswered question on a New card should raise a New-tab attention
    signal too, and ensure a groomed New task with open questions isn't mistaken for ready-to-promote.
    (c) Convention drift: until the groomer is updated to emit structured questions, New cards show
    nothing new; and prose "OPEN QUESTIONS" in older cards won't be highlighted under approach (A)
    (they render as description until re-groomed).
    OPEN QUESTIONS (human must answer before executing): (1) ANSWERED 2026-07-13 via your note
    "Proposal A" — go with Approach (A) STRUCTURED (groomer emits `question:`/`answer:` sub-bullets
    on New tasks; New cards render them with the existing question UI). (2) On a New card, should the human be able to ANSWER a groomer question inline (making New cards
    behave like Feedback — answers then feed the promotion decision), or is it READ-ONLY highlighting
    (the human reads the questions, decides, and promotes)? This determines whether to reuse
    `renderQuestions` as-is or build a read-only variant. (3) Should an unanswered question on a New
    card trigger the New tab's attention dot (like Feedback does), or stay silent so New attention
    keeps meaning "a non-draft awaits your promotion"?
    2026-07-13 note applied (Rule 16): your 'Proposal "A"' decided OQ-1 in favor of Approach A;
    OQ-2 (answerable vs read-only on New) and OQ-3 (attention dot) remain open.
    2026-07-13 claimed by fable; parked in Feedback (Rule 6) — OQ-2 and OQ-3 are marked "human
    must answer before executing" and were not covered by your note, so they are restated as the
    structured questions below. Work resumes once both answers are filled in (Rule 10).
    2026-07-13 both answers received (answerable inline; no attention-dot change) — resumed,
    implemented, and delivered to Review.
    2026-07-13 addressed your Review feedback "I don't see it. Why could that be?" (Rule 13).
    ROOT CAUSE: a stale install — the .vsix you run was packaged and installed at 10:18, but the
    feature commit (81b40a6) was cherry-picked onto main at 10:20, two minutes AFTER packaging, so
    the installed media/board.js predated the feature. FIX: rebuilt from current main
    (`make check` green, 28/28 tests) and reinstalled via `code --install-extension --force`;
    verified the installed copy now contains the feature. Reload the VSCode window to load it.
    SECOND reason you'd still see nothing: the question block only renders on New cards that carry
    structured `question:` sub-bullets, and until now NO New task had any (older cards use OPEN
    QUESTIONS prose — documented convention-drift risk (c)). To make it visible, t-a37f's three
    prose questions were converted to structured `question:`/`answer:` bullets — open the New tab
    on t-a37f to see the block. Returned to Review.
    GROOMED 2026-07-13 by Opus subagent (Rule 14); model: fable.
  - question: ❓ Should groomer questions on a New card be ANSWERABLE inline (Feedback-style answer textareas; your typed answers then steer the executor) or READ-ONLY highlighting (you read, decide, promote)? Recommend ANSWERABLE — reuses renderQuestions nearly as-is and gives one consistent place to answer instead of notes.
    - answer: It should be answerable as in the Feedback section typically handled.
  - question: ❓ Should an unanswered question on a New card light the New tab's attention dot? Recommend NO — the New dot already fires for any non-draft awaiting promotion; say YES if you want question-driven attention on New like Feedback has.
    - answer: No
  - DELIVERED: 2026-07-13 re-delivered after "I don't see it": the installed .vsix predated the feature landing on main (packaged 10:18, cherry-pick 10:20) — rebuilt and reinstalled the extension; reload the VSCode window. Also note the block only shows on New cards that HAVE structured questions; t-a37f's prose questions were converted so the New tab now shows one (check t-a37f). Original delivery: Approach A per your answers. media/board.js renderCard — New cards now render the same question block Feedback uses whenever the task carries `question:` items (Feedback path unchanged); renderQuestions is phase-aware: on New cards the answer textareas still patch answers inline (your OQ-2 "answerable"), but the Feedback-specific "worker resumes at M of M" copy and placeholder are replaced with New-appropriate wording ("guides how this story is groomed and executed"); phaseAttention untouched per your OQ-3 "No". Grooming convention updated: Rule 14 and the Automation /loop prompt now direct groomers to record human decisions as single-line `question:`/`answer:` sub-bullets instead of OPEN QUESTIONS prose, and the Task-format doc marks `question:` as "Feedback & New". Existing prose OPEN QUESTIONS on older cards stay as-is until re-groomed (forward convention, no migration). Delivered per temp Rule 7 on branch task/t-fc27 @ 8c3fd46 (media/board.js only; TODO.md rule/prompt wording edited in place in the tracker). `make check` green (27/27 tests, .vsix packaged). NOT F5-verified — open the New tab on a card with structured questions to see the block. NOTE: DELIVERED/question values must be single-line to parse; the fixpoint test enforces this.

- [x] Replace the Review-card accept checkbox with a bottom-right "Approve" button
  - id: t-4d2e
  - phase: done
  - owner: @claude
  - model: fable
  - added: 2026-07-11
  - started: 2026-07-13
  - promoted: 2026-07-13
  - completed: 2026-07-13
  - worklog: 2026-07-12, 2026-07-13
  - link: branch task/t-4d2e @ e76db4a
  - description: On Review cards the accept affordance is currently a checkbox at the top-left of the
    card head (`card-check` in `media/board.js renderCard`, `variant === 'review'`, ~line 277): ticking
    it sets `u.confirmAccept` and reveals an "Accept / Cancel" confirm row at the bottom of the card
    (~line 352, which posts `{type:'gate', taskId, action:'accept'}` to archive the task to DONE.md).
    Change the affordance to a single primary button labelled "Approve" anchored at the bottom-right of
    the card instead of the top-left checkbox. Remove the `card-check` checkbox from the review head and
    add a right-aligned button row at the card footer (reuse `.btn-sm primary`, e.g. an `.approve-row`
    with `justify-content: flex-end` in `media/board.css`). Preserve the human accept gate (Rule 1) — the
    button must still go through the same `gate/accept` post; do not auto-accept.
    OPEN QUESTIONS (groomer): (1) keep the two-step confirm (Approve → Accept/Cancel), or make "Approve"
    a single-click that posts the accept gate directly? A single button implies one click; recommend
    Approve = direct accept (the button label already states intent), dropping the separate confirm row.
    (2) confirm this applies only to Review cards, not the New-phase promote affordance.
    2026-07-12: your "Use fable." note in this description was converted to the `model: fable`
    field above.
    2026-07-13: implemented per the groomer's recommendation — Approve is a SINGLE-CLICK direct
    accept (the confirm row is gone); scope is Review cards only (the New-phase promote button is
    untouched). If you'd rather keep a two-step confirm, leave a `feedback:` line.
  - DELIVERED: media/board.js — removed the `card-check` checkbox from the review card head and the
    `confirm-row`/`u.confirmAccept` two-step flow; Review cards now end with a bottom-right
    `.approve-row` holding one `btn-sm primary` "Approve" button (check icon + label, same style as
    the New-phase promote button) that posts the unchanged `{type:'gate', taskId, action:'accept'}`
    — the human gate is preserved, nothing auto-accepts. media/board.css — dropped the now-unused
    `.card-check` rule, added `.approve-row { display:flex; justify-content:flex-end }`. Delivered
    per temp Rule 7 on branch task/t-4d2e @ e76db4a (only the two media files committed; main
    checkout unchanged — cherry-pick or merge to see it live). `make check` green (27/27 tests,
    .vsix packaged). NOT F5-verified.

- [x] Add opt-in "clear loop session after a finished task" (extension sends /clear to the terminal)
  - id: t-5619
  - phase: done
  - owner: @claude
  - added: 2026-07-10
  - started: 2026-07-10
  - promoted: 2026-07-10
  - completed: 2026-07-13
  - worklog: 2026-07-10, 2026-07-11, 2026-07-12, 2026-07-13
  - link: main @ 141d879, branch task/t-5619 @ 17e8616
  - description: Resumed from Feedback 2026-07-13 after your answer. ROOT CAUSE of "it's not there":
    the setting only existed on branch task/t-5619 @ b754514, never merged to main — so it never
    appeared in Settings on the extension you run. Now landed on main @ 141d879 (config +
    controller.maybeClearSession + TerminalManager.clearSession), same approach used for t-e611/t-fade.
    Per your request I ALSO added a "Settings" button below the Loops section in the sidebar.
    2026-07-13 addressed Review feedback: rewrote both setting descriptions in package.json to be
    simpler and parallel — Auto Recycle now says it "restarts the loop terminal (close it and open a
    new one)"; Clear Session After Task says it "sends /clear ... the terminal keeps running, only
    the conversation is cleared", and notes it's the lighter of the two. Returned to Review.
  - DELIVERED: (1) claudeTodo.clearSessionAfterTask setting (package.json) + behavior — after a model's last In-Progress task leaves, controller.maybeClearSession sends /clear to its loop terminal (TerminalManager.clearSession), after TODO.md is written; opt-in, skipped when autoRecycle is on. (2) A "Settings" button (⚙) in the sidebar directly below the Loops section (media/sidebar.js), posting a new openSettings message that controller.ts routes to workbench.action.openSettings filtered to `claudeTodo` — one click opens all extension settings including Clear-session-after-task. `make check` green (27 tests + packaged .vsix). Committed to main @ 141d879. NOT F5-verified — reload the Extension Development Host, click Settings under Loops to confirm it opens the claudeTodo settings, and verify the clearSessionAfterTask toggle now shows.

- [x] Task description field should span the full card width, not ~1/3
  - id: t-fw10
  - phase: done
  - owner: @claude
  - model: fable
  - added: 2026-07-12
  - started: 2026-07-12
  - promoted: 2026-07-12
  - completed: 2026-07-13
  - worklog: 2026-07-12, 2026-07-13
  - link: branch task/t-fw10 @ cb936c8
  - description: On a task card the description reads/edits far narrower than the card it sits in
    (~1/3 width) — see the user's screenshot of t-pr01. CSS/layout-only fix, no behavior change.
    Prime suspect (from an Opus grooming pass): in `renderDescription` (media/board.js ~L406) the
    edit textarea is built with `rows:'2'` but no width binding, so it can fall back to the browser
    intrinsic `cols=20` (~20 chars ≈ a third of a wide column); `.desc { width:100% }`
    (media/board.css ~L156) is meant to override this but the executor must confirm at runtime WHY
    it isn't winning (candidates: the negative `margin:-6px` wrap, `autoGrow` setting inline styles,
    a flex/inline-block parent that shrinks `.desc-wrap`, or the rendered `.desc-rendered` view
    vs the textarea resolving to different widths). FIX DIRECTION: make width authoritative on BOTH
    `.desc` (textarea) and `.desc-rendered` (read-only view) so they fill `.desc-wrap` → `.card`
    identically (`width:100%; box-sizing:border-box`, block display; add `min-width:100%` on the
    textarea only if the intrinsic `cols` still shows through). SCOPE/RISK: touch width only — never
    height (`autoGrow` sets `style.height`, don't break grow-on-input); keep it responsive
    (percentages, not fixed px); scope strictly to `.desc`/`.desc-rendered` and do NOT alter the
    shared `textarea.field` used by questions/answers/notes/review; preserve the `margin:-6px`
    focus hit-area and the `.desc:focus` outline. Verify: `make build` + F5 manual check of an
    editing textarea, a rendered description, and an empty "Add a description…" card at both narrow
    and wide pane widths. No parser/writer/store impact. GROOMED 2026-07-12 by Opus subagent
    (Rule 14); executor should confirm the exact constraint before editing.
    DIAGNOSIS CORRECTED 2026-07-12 (fable, static analysis): the groomer's "intrinsic cols=20"
    hypothesis is wrong — media/board.css already has `* { box-sizing: border-box }` and BOTH
    `.desc` and `.desc-rendered` (and every `.field` textarea) carry `width: 100%`, so the boxes
    ARE full card width. The real cause: src/parser.ts joins description continuation lines with
    `\n` (parser.ts ~L170), and mdToHtml (media/board.js ~L399) turns every `\n` into `<br>` —
    TODO.md descriptions are hard-wrapped at ~95 chars, so the rendered text force-breaks at each
    source line, which in a wide pane looks like a ~1/3-width column inside a full-width box. The
    textarea shows the same raw hard-wrapped lines. A width-only CSS fix cannot change this; the
    fix is markdown soft-wrap semantics in mdToHtml (single `\n` → space, blank line → paragraph
    break), i.e. a behavior change outside this task's stated CSS-only scope — hence Feedback.
    You answered "Do A" (2026-07-12); implemented option A and delivered on branch task/t-fw10.
  - DELIVERED: media/board.js mdToHtml — single newlines now render as soft wraps (space) and blank lines as paragraph breaks (`<br><br>`), so hard-wrapped TODO.md descriptions flow to the full card width in the rendered view; the raw edit textarea intentionally still shows the source's hard wraps. Comment above the markdown helpers updated to match. No CSS change needed (boxes were already full width). Delivered per temp Rule 7 on branch task/t-fw10 @ cb936c8 (only media/board.js committed; main checkout unchanged). `make check` green (27/27 tests, .vsix packaged). NOT F5-verified — to see it, check out the branch or cherry-pick cb936c8, then reload the Extension Development Host.

- [x] Sidebar "New Story" button: rename "Open Board" and open the board on the New phase
  - id: t-fade
  - phase: done
  - owner: @claude
  - added: 2026-07-10
  - started: 2026-07-11
  - promoted: 2026-07-10
  - completed: 2026-07-13
  - worklog: 2026-07-10, 2026-07-11, 2026-07-12, 2026-07-13
  - link: main @ ed32dac, branch task/t-fade @ 15e3cd7
  - description: The sidebar footer "Open Board" button (media/sidebar.js) is renamed to "New Story"
    and now opens the board on the New phase, per your clarified intent. LANDED ON MAIN 2026-07-12
    ("merge it to main"): media/sidebar.js was brought onto main (webview asset only; the stale
    branch parser/writer were NOT merged — same reason as t-e611). This addresses the ⚠️ "doesn't
    look in place" feedback: the rename was never on the main checkout you run. Reload the Extension
    Development Host and the footer button reads "New Story" and lands on the New tab.
  - DELIVERED: media/sidebar.js — the footer button label is now "New Story" and posts `{type:'reveal', phase:'new'}` instead of the bare `{type:'openBoard'}`. That routes through the existing `reveal` handler (controller `openBoard()` + `revealTask`), so it opens the board AND switches to the New tab — which also fixes the "nothing happens" symptom of the bare open when the board is already open. Now live on main @ ed32dac. `make check` green. NOT F5-verified.

- [x] Render task descriptions as formatted markdown, editable as raw text on focus
  - id: t-e611
  - phase: done
  - owner: @claude
  - added: 2026-07-10
  - started: 2026-07-11
  - promoted: 2026-07-11
  - completed: 2026-07-12
  - worklog: 2026-07-10, 2026-07-11, 2026-07-12
  - link: main @ f535924, branch task/t-e611 @ 99d7d77
  - description: `renderDescription` toggles between a read-only rendered view and the raw textarea
    editor. Scope: description-only; minimal markdown subset (bold/italic/inline-code/http(s)
    links/line-breaks), hand-rolled with no npm dependency. LANDED ON MAIN 2026-07-12 (you said
    "merge it to main"): media/board.js + media/board.css were brought onto main. A full branch
    merge was deliberately NOT done — the branch predated the flat-`## Tasks` migration and would
    have reverted src/parser.ts + src/writer.ts and clobbered the live tracker; only the two
    webview assets (unchanged on main since the branch point) were taken. This addresses the ⚠️
    "still see plain code with symbols" feedback: that was the code not being on the main checkout
    you run. Reload the Extension Development Host and descriptions render formatted instead of raw.
  - DELIVERED: media/board.js — XSS-clean `escapeHtml`/`renderInlineMd`/`mdToHtml` (all text HTML-escaped before the innerHTML sink; hrefs limited to http/https and opened via `openLink`; code spans protected) and `renderDescription` rewritten as a click/Enter-to-edit `.desc-rendered` view (blur patches, Escape cancels, placeholder when empty, honors `isEditing()`/`pendingBoard` deferral); media/board.css `.desc-rendered` styles. Now live on main @ f535924. `make check` green (27 tests). NOT F5-verified.

- [x] Track phase via a task field to avoid rewriting whole sections on every move
  - id: t-8d3d
  - phase: done
  - owner: @claude
  - added: 2026-07-10
  - started: 2026-07-11
  - promoted: 2026-07-10
  - completed: 2026-07-11
  - worklog: 2026-07-10, 2026-07-11
  - link: commit 07d93e5 (on main, per your "no separate branch")
  - description: New flat TODO.md grammar — every task carries a `- phase:` field and lives in one `## Tasks` section instead of under per-phase headings, so moving a task is a one-line in-place field edit (no delete-then-re-add across sections → a task can't be lost mid-move; diffs stay small). Implements your approved design.
  - DELIVERED: src/parser.ts + src/writer.ts — writer emits a single `## Tasks` section with a `- phase:` field per task (drafts stay minimal, default new); parser reads the `phase:` field and stays BACKWARD-COMPATIBLE with the legacy per-phase headings, and consolidates section extras (HTML templates) so the round-trip fixpoint stays green. gates.ts/merge.ts/view.ts already operate on the phase field — unchanged. `make check` green (27 tests + packaged .vsix). Committed to main @ 07d93e5. MIGRATED 2026-07-11: the live TODO.md was converted to the flat `## Tasks` format (backup kept at TODO.md.bak) and the preamble was updated to match — Task format (v3), Rule 4, and the Automation loop prompt now describe phase as an in-place field edit. Reload the extension host to load the new build; tick `[x]` once you've confirmed the board still renders correctly.

- [x] Allow editing New-phase stories in the board webview
  - id: t-2c1a
  - phase: done
  - owner: @claude
  - added: 2026-07-10
  - started: 2026-07-10
  - promoted: 2026-07-10
  - completed: 2026-07-11
  - worklog: 2026-07-10, 2026-07-11
  - link: commit cc939d2 (on main)
  - description: DRAFT cards on the board are now click-to-edit: the draft text becomes a textarea
    that patches the `title` field via the normal save path, keeping the `DRAFT:` prefix so the task
    stays a draft. You confirmed on 2026-07-11 that you want to KEEP it ("It looks good how its
    implemented. I like it.").
  - DELIVERED: `renderDraft` in media/board.js (click-to-edit `.draft-text-btn` ↔ `.draft-edit` textarea) + `.draft-text-btn`/`.draft-edit` styles in media/board.css, already committed on `main` in cc939d2. NOT F5-verified. The no-remote delivery question is moot (commit-based delivery per temp Rule 7 / t-pr01). You marked it LGTM — tick `[x]` to archive.

- [x] Fix broken shell quoting when seeding the /loop prompt into the claude CLI
  - id: t-3410
  - phase: done
  - owner: @claude
  - added: 2026-07-10
  - promoted: 2026-07-10
  - completed: 2026-07-11
  - worklog: 2026-07-10, 2026-07-11
  - description: Concern was that `terminals.ts spawn()` wrapped the multi-line loop prompt in a
    single-quoted shell argv (`${base} '${cmd.replace(…)}'`), which any embedded quote/backtick/
    newline could break.
  - DELIVERED: Verified already fixed in current `src/terminals.ts` (no new change): `spawn()` launches `claude` bare then PASTES the prompt via `terminal.sendText(cmd, false)` + a lone Enter — no shell quoting, so the whole bug class is gone; `--permission-mode` comes from the `claudeTodo.permissionMode` package.json enum. Honored + removed the human `note:`. You marked it LGTM — tick `[x]` to archive.
