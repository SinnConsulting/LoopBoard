# Verification

All toolchain commands ran inside Docker (`node:22`) via `make`; nothing was installed on the
host. Latest run (v2.0.0 storage split):

```
make build     -> tsc -> out/ (clean, no errors)
make test      -> 47 tests, 47 pass, 0 fail
make package   -> loopboard-todo-2.0.0.vsix (32 files, ~125 KB; templates ship, REFACTORING.md excluded)
```

## Automated (executed here, in Docker)

The pure layer is unit-tested per module; `make test` compiles `tsconfig.test.json` → `out-test/`
and runs `node --test`.

### Index parser/writer — `test/parser.test.js` (grammar v5)
Over `test/fixtures/index-full.md` (six entries incl. a DRAFT, a Feedback entry with two
questions, an HTML-comment template) and `index-unknown.md`:
- **Text idempotence** and **index fixpoint** (parse→write→parse deep-equal).
- Canonical fixture round-trips **byte-for-byte**.
- **Removed v4 keys** (owner/added/description/reviewer/…) land in `unknownLines`, preserved
  verbatim; `completed:` is canonical in DONE.md only (an unknown line in the TODO index).
- HTML-comment task-like lines are **not** parsed as entries; DRAFT serializes minimally (no
  `phase:`); model+groomer round-trip on drafts; ids assigned on write; DONE.md round-trips.
- **`rev:` change marker (t-9d5c):** parses as an integer, serializes after `model:`/`groomer:`,
  is **fixpoint-stable** (parse→write→parse) and round-trips its value; a missing `rev:` stays
  `undefined` and is never emitted; a non-integer `rev:` lands in `unknownLines`. `serializeEntry`
  differs ONLY in the `rev` line when `rev` changes (proving the store's rev-excluded fingerprint
  is a sound bump trigger).

### Task-file parser/writer — `test/taskfile.test.js` (§2.2)
- Parses every canonical section; **fixpoint** and byte-for-byte round-trip of a full fixture.
- Empty file → empty detail (serialize is just the H1); missing sections omitted on write; **H1
  rewritten from the index title**; Meta keys emit in canonical order; unknown headings/keys
  preserved + flagged (fixpoint holds); a legacy `## Feedback` section (feedback now lives in the
  index, not the task file) is preserved verbatim as unrecognized content, not parsed.

### Merge routing + patches — `test/merge.test.js`
- `patchTarget` routes title/model/groomer/answer/note/feedback → index, description → detail.
- `applyPatch` (index) and `applyDetailPatch` (detail) keep disk-wins conflict semantics; answer
  patch targets the right question; model `default (opus)` clears the field; unknown id → notfound.
- `note` and `feedback` each edit their whole set as one value: newline-split, empties dropped →
  `notes: string[]` / `feedback: string[]`; clearing either empties the set.

### Gates — `test/gates.test.js`
- `promoteIndex` (phase→backlog, uncheck), `promoteDetail` (`promoted:` + worklog, no dup),
  `acceptDetail` (`completed:` + worklog), `acceptDoneEntry` (slim DONE entry, no questions).

### View — `test/view.test.js`
- `computeBadge` = new (incl DRAFTs) + unanswered-feedback + review; dependency marked met when
  its id is in `done: IndexEntry[]`; `hasDetailFile` flows through; `note` derives from `notes[]`;
  `feedback` derives from `feedback[]`; DONE cards render from the slim IndexEntry (no composed
  detail).

### Loop command — `test/loop.test.js`
- `buildLoopCommand` from the shipped `template-loop.md` names model+interval, points at
  `.loopboard/LOOP.md`, is a single apostrophe-free line < 300 chars.
- Returns `undefined` with no `## Automation` section or no fence in it; an **earlier fence**
  (before `## Automation`) is not mis-picked. `template-todo.md` scaffold parses to zero entries
  and is a fixpoint.

### Loop-action schedule — `test/schedule.test.js` (t-77d1)
- `LOOP_ACTIONS` is exactly `start`/`restart`/`stop`, and `isLoopAction` rejects every other
  payload value (the webview's `action` is never trusted).
- `appliesTo` gates the fire path on the loop's CURRENT state: `start` applies only while stopped,
  `restart`/`stop` only while running — so a restart armed for a since-stopped loop is swallowed
  rather than silently starting it.
- `supportsForce` is false for `start` only; `armSchedule` coerces a start's `force` to false even
  when asked for it, and `mayFire` lets a start fire while its own model is In Progress (there is
  no worker to cut off) while a stop defers exactly like a restart.
- `describeSchedule` names the scheduled action (`start in 60m`, `stop in 60m · force`,
  `stop waiting for task · every 15m`).
- `parseMinutes` accepts a plain positive integer and rejects empty/`0`/negative/signed/decimal/
  unit-suffixed (`90m`, `2h`)/hex/exponent input, plus anything overflowing `setTimeout`'s
  signed-32-bit delay — so a value can never be silently reinterpreted or fire instantly.
- `mayFire` defers only while the schedule's OWN model is In Progress (another model being busy is
  irrelevant) and ignores In Progress entirely when `force` is on.
- `deferSchedule` is idempotent — at most one restart is ever pending per model, so a repeating
  schedule cannot stack deferred fires.
- `afterFire` disarms a one-shot and re-arms a repeating schedule from the moment it ACTUALLY fired,
  so a long deferral produces no burst of catch-up restarts.
- `delayUntilFire` counts down and floors at 0; `describeSchedule` renders the countdown, `repeat`,
  `force` and the "waiting for task" state.
- **Busy is a UNION now (t-sbag):** `mayFire`'s second argument is `busyModels` — In-Progress owners
  plus slots with a live subagent — and one added case pins that `force: true` fires while the list
  contains its model for the subagent reason ALONE, while the same schedule unforced defers and a
  scheduled `start` still never defers.

### Live subagents — `test/subagents.test.js` (t-sbag)
Captured fixtures of Claude Code's undocumented `subagents/` layout, so a CLI reshape fails here
rather than silently in the host (where the symptom is a restart that kills an agent mid-edit, or
one that never fires):
- **The async trap:** a `tool_result` on the meta's `toolUseId` whose text starts with
  `Async agent launched successfully` is the LAUNCH RECEIPT and is not a finish; any other
  `tool_result` on that id is a synchronous agent's real finish. `requestShape` is never used as the
  discriminator (metas without it are asynchronous too).
- **Notifications:** `<status>completed|failed|killed</status>` each finish the agent, and the two
  lines Claude Code writes per finish (the `queue-operation` enqueue and the `user` message) dedupe
  to ONE event; a non-terminal status is not a finish.
- **Resume:** a `SendMessage` with `input.to === <id>` re-opens a finished agent (latest marker
  wins), and its next notification finishes it again.
- **`stoppedByUser: true`** in the meta drops the agent — there is no finish marker for that case.
- **Staleness cutoff:** with NO finish marker either way, an agent transcript written 59 minutes ago
  stays live and one written 61 minutes ago is dropped AND reported as stale (`AGENT_STALE_MS` is
  60 min) — the backstop that stops a SIGKILLed session's leftovers holding every restart forever.
  The cut is on SILENCE, not on age: an agent 8 hours into its work stays live as long as it keeps
  writing, and a 45-minute quiet stretch (a Docker build, a slow suite) no longer drops it.
- **A resumed agent is timed from the RESUME**, not from its original spawn — it keeps its id and
  appends to the same transcript, so the first line still holds the spawn instant and the row used
  to include every idle gap since. The later of two resumes wins; an undated resume keeps the last
  dated one; a resume for another agent re-times nothing; an agent never resumed is unchanged.
- **Dedupe is by id, not by adjacency:** the two halves of one notification dedupe to a single
  event even with unrelated lines between them AND when the byte-delta cut lands between them
  (the carry holds the seen ids); a `SendMessage` resume clears that marker, so the resumed agent's
  NEXT finish is reported rather than swallowed as a duplicate.
- **Only markers naming a known agent count:** a `tool_result` for an ordinary tool call is ignored,
  which is what keeps the accumulated event list O(agents) instead of O(tool calls in a 10 MB file).
- A **truncated last line** is carried across two chunks instead of being lost; an unparseable meta,
  unparseable/irrelevant transcript lines and an empty `subagents/` directory all degrade to no rows.
- `describeAgent` renders `agentType · description` + a duration (`20s`/`1m`/`2h 5m`), drops the
  `· description` half when the meta has none, and renders no duration when the start is unknown.

## Manual — Extension Development Host (F5)

**PENDING — not executed in this environment** (headless agent session, no interactive VS Code
GUI). Run these in a desktop VS Code by opening a folder and pressing **F5**; a headless session
cannot verify them, so they are not claimed done.

New v2 checklist (from REFACTORING.md Phase 8):

1. **Init:** fresh empty workspace → `LoopBoard: Initialize Workspace` scaffolds `.loopboard/`
   (TODO.md + LOOP.md + empty `tasks/`, no DONE.md); the board opens empty. Running it again
   refuses without overwriting.
2. **Draft (t-6ab4, eager scaffold):** add a draft on the board → an index entry appears in
   `.loopboard/TODO.md` AND `.loopboard/tasks/<id>.md` is created immediately with just `## Meta`
   (`added: <today>`) and the H1 from the index title — no "No detail file yet" hint on the card.
3. **First detail edit:** edit the description on a card → `.loopboard/tasks/<id>.md` gains a
   `## Description` section (H1 stays from the index title).
3a. **Delete cleanup (t-6ab4, verify-only — already implemented, no source change):** delete a
    draft/New card (with an attachment staged) → the index entry, `.loopboard/tasks/<id>.md`, and
    `.loopboard/cache/<id>/` are all gone, no orphan files left. Repeat on a groomed (non-draft)
    task — same result.
4. **Concurrency:** external edit to a task file while its card field is focused → refresh is
   deferred (no clobber); a same-field concurrent edit → disk wins + amber toast.
5. **Promote gate:** tick a New task → `phase: backlog` in the index, `promoted:` in the task
   file's Meta.
6. **Accept gate:** tick a Review task → entry gone from `TODO.md`, prepended to `DONE.md`,
   `completed:` in the task file's Meta, and the task file still present under `tasks/`.
7. **Loop terminal:** spawn a loop → the command references `.loopboard/LOOP.md`, the seeded
   prompt submits after boot.
8. **Legacy ignored:** a root-level `TODO.md` present → ignored entirely (activation keys off
   `.loopboard/TODO.md`).
9. **Configurable models (t-c1a7):** with defaults, the sidebar Loops overview lists four rows
   (Opus, Sonnet, Fable, **Haiku**) and the board/composer/draft model selects offer all four.
   Set `loopBoard.models.haiku.enabled: false` → Haiku disappears from the Loops overview and the
   selects. Set `loopBoard.models.opus.model: "opus[1m]"` and spawn the Opus loop → the terminal
   command reads `claude … --model opus[1m]` while the seeded prompt still says "running as model
   opus" (so it claims `model: opus` tasks). Set an invalid override (e.g. `"opus; rm"`) → the loop
   refuses to start with a warning and no shell line is emitted. Confirm a `[1m]` override actually
   RUNS: the `--model` value is single-quoted, so zsh does not glob-expand `haiku[1m]` and abort with
   "no matches found".

10. **`rev:` bump (t-9d5c):** edit one task's title (or description) on the board → only THAT
    entry's `rev:` in `.loopboard/TODO.md` increments; every other entry's `rev:` is untouched.
    Editing a task's description (a `tasks/<id>.md` write) also bumps that entry's `rev:` in the
    index. Re-saving with no change (same value) does NOT bump. A task with no `rev:` yet gains
    `rev: 1` on its first content-changing save.
11. **Delivered/Feedback/Note render as markdown (t-7a94):** a Review card whose Delivered note
    contains `` `code` ``, `**bold**`, a bare `https://…` URL, and a `-`/`1.` list renders all of
    them formatted (code chip, emphasis, clickable link, list) — same in the DONE-archive expanded
    detail after acceptance. A Review feedback comment or a Note-to-worker instruction containing
    a staged-attachment `[name](.loopboard/cache/<id>/name)` link renders it clickable (opens via
    `openLink`), not as literal `[text](path)` — both keep their leading warning/clock codicon.
    Plain Description/question-text rendering is unchanged (no regression).
12. **Attachments, any file type (t-058e):** on each of the four surfaces — New Story composer,
    Description/answer fields, Review feedback field, note-to-worker field — drag-drop AND paste
    a non-image file (e.g. a `.pdf` or `.zip`) → it stages under `.loopboard/cache/<id>/` and a
    `[name](path)` link lands in that field's own text (feedback/note do NOT misfile into
    Description). A file over `loopBoard.maxAttachmentSizeMB` (default 10MB) is still rejected
    host-side with a toast; that is the only remaining gate — no type allowlist/denylist, an
    `.exe`/`.sh` attaches too (explicit human decision, t-058e).
13. **Notes-to-worker reskin (t-b149):** empty state shows the dashed "＋ Note to worker · or drop
    files here" drop-zone; clicking it (or dropping a file on it) opens the `.qa-note-composer`.
    Typing + Add note saves and renders the note as a `.qa-note` card (yellow rail, "NOTE" label,
    edit/delete links) in both a light AND a dark theme. Pasting a screenshot into the open
    composer stages it and inserts `[name](.loopboard/cache/<id>/name)` at the caret WITHOUT
    closing the composer (further edits/attachments still possible before Save); the saved note
    then shows an attachment chip (ext badge + clickable name → opens via `openLink`) below the
    body text, and its × removes the file AND strips the link from the note (re-fetch confirms
    no dangling link). "edit" reopens the composer prefilled with the current text; "delete"
    retracts the note entirely (existing behavior, unchanged).
14. **Two-layer filter: the typed filter survives navigation, view queries do not (t-2452 →
    t-3d42, amended by t-1cdb):** type a plain-text filter while on one phase tab, then click
    through New / Backlog / In Progress / Review / Feedback / Done via the board tab strip — the
    filter STAYS in the box and stays applied on every tab (a tab may legitimately show "No matches
    in this tab for …"; that is the user's own filter and `×` clears it in one click). Repeat via
    the sidebar PHASES rows — the typed filter survives those clicks too. Now, with that filter
    still typed, click a sidebar attention row that installs a query (e.g. "N unanswered
    questions") — the board lands on that phase showing EXACTLY that row's query and exactly its
    matching cards, the typed filter hidden underneath. From there click any phase tab — the row's
    query is gone and the previously typed filter is back in the box and applied. This is the core
    assertion; the row's query must never leak into a navigated-to tab (the t-3d42 repro:
    navigating to Review after a Feedback-row detour must never show "No matches in this tab for
    "is:unanswered"" while the sidebar reports tasks awaiting review). Reload the VS Code window
    (or switch away and back so the webview is recreated) with a view active — the same phase AND
    the same query on screen come back; a subsequent phase-tab click then drops to the typed filter
    underneath. Click "N tasks awaiting review" — it lands on Review with an EMPTY search box
    (an explicit empty view) showing exactly the N cards the row counts, even if a filter was
    typed. Click "N proposals to approve" — it lands on New with `is:proposal` in the search box,
    showing only groomed (non-DRAFT) proposals, card count matching the row; "N drafts will be
    groomed" (t-1cdb) still shows exactly the DRAFTs via `is:draft`; neither double-counts the
    other and the activity-bar badge total is unchanged. A dependency chip (`task:<id>`) still
    installs its query, still filters, and a phase-tab click afterwards restores the typed filter
    rather than clearing everything. A disk-wins conflict toast's "Review" action clears BOTH
    layers so the revealed task cannot be hidden. Typing into the box while a view is active takes
    over — the text becomes the user's own filter and the view is dropped. Opening the New Story
    composer, or clicking Cancel/Save Draft to close it, still clears the box entirely. The search
    bar shows a `×` clear button (aria-label "Clear filter") only while a query is active; clicking
    it empties BOTH layers and restores the full list. **Typing is debounced (t-1cdb feedback):** on
    the New tab (the busiest one), type a multi-word query at normal speed — every character appears
    in the box immediately with no trailing lag, and the card list plus the "N of M matches" counter
    settle once, shortly after you stop, rather than repainting per keystroke. The caret stays where
    you put it, including when editing in the middle of an existing query. Type a query and, without
    pausing, immediately click a phase tab or a card field — the click lands normally (no
    mid-repaint glitch) and the filter is not lost. Type a query and hit ⌘R / reload while the list
    is still settling — the query comes back after the reload.
15. **Loop-row reveal desync (t-2e35):** spawn a loop, click its sidebar row once to reveal the
    terminal panel, then hide the panel with native CMD+J (Toggle Panel) instead of clicking the
    row again. Click the same loop row ONE more time → the terminal panel re-opens immediately (no
    second click needed, no no-op). Normal same-row toggle (click to show, click again to hide)
    still works when the panel was never hidden externally.
16. **Attachment chip idiom unified (t-f51c):** a description, a draft, an answer, and Review
    feedback each with an attached image all render the SAME `.qa-attachment` chip (ext badge +
    link name + ×) as a note's attachment — no more bare-link description/draft lists. The
    new-story composer's pending-attachment list also renders as chips, but the name is static
    (not clickable — no cache file yet). Every one of these four fields (new-story composer,
    description edit, answer edit, Review feedback) shows a `＋ Attach` button next to its
    Save/paste hint; clicking it opens a file picker and stages the file exactly like a drop/
    paste would. Removing an answer or feedback attachment chip strips its link from that
    field's own text (re-fetch confirms no dangling link) rather than a separate detach call.
    No image thumbnails anywhere (unchanged from t-b149).
17. **Composer save shortcut (t-9b50):** with the New Story composer open and text typed, press
    Cmd/Ctrl+S → the draft saves (same as clicking Save Draft) and the composer closes. With the
    composer empty (or whitespace-only), the shortcut is a silent no-op (nothing saved, composer
    stays open), matching the disabled Save Draft button. Cmd/Ctrl+Enter does NOT save — a plain
    Enter (with or without Cmd/Ctrl) still just inserts a newline in the textarea.
18. **Depends-on chip filters instead of jumps (t-a524):** on a card with a `depends on <id>`
    chip, click it — for a Done target AND for an active (non-Done) target alike, the board
    switches to that target's own phase tab and the in-tab search box fills with `task:<id>`,
    filtering the tab down to just that one card (no more jump-and-scroll). This still works for
    a Done dependency accepted long enough ago to fall outside the newest-50 entries shown on the
    Done tab. A dependency id that exists nowhere on the board still shows the unchanged
    "<id> not found" warning toast. The chip's tooltip/aria-label reads "Filter to <id>".
19. **Composer attachment size cap (t-5f50):** with a small `loopBoard.maxAttachmentSizeMB` set
    (e.g. 1), drop/paste a file over the cap into the New Story composer → it is rejected
    immediately with an "Attachment is too large (max 1MB)." toast, is NOT added to the pending
    list, and no `[name](loopboard-pending:<n>)` placeholder lands in the draft text. An under-cap
    file still stages normally end to end (chip appears, Save Draft resolves it to a real
    `.loopboard/cache/<id>/` path). Existing-card surfaces (description/answer/note/whole-card)
    reject oversized files exactly as before — unchanged.
20. **Note composer drop-hint removal + auto-focus (t-5b29):** the empty note-to-worker button
    reads just "＋ Note to worker" (no "or drop files here" text) and no longer accepts a file
    drop directly on it (dragging a file over it does nothing — paste/＋ Attach inside the open
    composer still work). Click the empty button once → the composer opens AND the caret is
    already in the textarea, ready to type with no second click. Click "edit" on an existing note
    → same one-click-to-focused-caret behavior. Opening the composer via a background board
    refresh (not a click) does not steal focus into the textarea.
21. **`owner:` field removed (t-33cb):** no card's chip row shows a robot-icon owner chip or an
    "unassigned" chip anymore (both are gone). Move a task to In Progress → the working indicator
    reads "Worker is on it · last activity today" (no name/attribution). Attempt to delete a task
    that is In Progress → the confirmation modal still shows the stronger "A loop may be actively
    working this task…" warning (now keyed off `phase: inprogress` alone, no separate owner
    check). A pre-existing `.loopboard/tasks/<id>.md` with a stale `- owner: @claude` line does
    NOT grow an "N unparsed lines" chip on its card and the line is NOT relocated to the bottom of
    the file on its next save (dropped silently on parse, per `DROPPED_META_KEYS`).

22. **Two-case promote guard + re-groom-pending badge (t-6936):** on a New card with at least one
    BLANK answer, click Promote → the existing "This story has unanswered questions — promote
    anyway?" modal appears unchanged (no detail text); Cancel leaves the task in New with the card
    NOT stuck greyed out. On a New card whose questions are ALL answered but still present, click
    Promote → a DIFFERENT modal appears, "These answers haven't been folded into the story yet —
    promote anyway?", with detail text about the groomer still owing a re-groom; Cancel likewise
    restores the card, "Promote anyway" promotes exactly as before. On a New card with NO questions
    at all, Promote fires with no modal and the card fades optimistically. `.loopboard/debug.log`
    (with `loopBoard.debug: info`) shows both modals and both choices, the `popup-choice` lines
    distinguishable via `unanswered` vs `regroom-pending`. Card badge: a New card whose questions
    are all answered but still present shows a "RE-GROOM PENDING" badge beside the "N / N answered"
    count (the count stays); answering the LAST question makes the badge appear immediately with no
    board refresh, and un-answering a row hides it again. A Feedback card never shows the badge,
    however many of its answers are filled, and a New card with a blank answer never shows it.
23. **Topbar heading + last-synced slot (t-c3b7):** the board topbar heading reads just the
    workspace name — no `TODO — ` prefix anywhere. The `last synced Ns ago` text is gone from
    under the title and renders at the right of the topbar, immediately left of the New Story
    button, still ticking every second. Let the counter cross 9→10, 99→100 (and, with the board
    left open, 999→1000): the tabs, Collapse all and New Story stay put on every digit change.

24. **Scheduled loop actions (t-77d1):** LEFT-click still acts immediately on all three row
    buttons — ▶ spawns, ♻ disposes and respawns, ■ disposes — and opens no popover. RIGHT-click a
    button → a popover opens under that row scheduling THAT action, with preset minute buttons, a
    `Custom…` field, `Repeat`, and a `Force` checkbox on ♻/■ only (▶ shows none); nothing happens
    to the loop and the host's own context menu does not appear. Right-click ▶ while stopped →
    "Start <model>" with a `Schedule start` button; right-click ■ while running → "Stop <model>".
    Arming from one button while another action is armed replaces it (one schedule per loop), and
    re-opening a different button's popover starts from defaults rather than the armed values.
    **Right-click works on a greyed-out button too** — right-click ■ on a STOPPED loop and the stop
    popover still opens (left-click on it does nothing, as before); same for ♻ while stopped and ▶
    while running. **Swallowing:** schedule a 1-minute restart, then stop the loop by hand before it
    fires → nothing starts, the indicator clears (or the repeat re-arms), and `.loopboard/debug.log`
    carries a `restart-skip` line at `info`.
    Escape, a click outside, and Cancel all dismiss
    it leaving the loop untouched; right-clicking the same button again toggles it closed. Type a bad custom value
    (`abc`, `0`, `-5`, `1.5`, `90m`) and press Schedule → an in-popover message appears and nothing
    is armed. Schedule 1 minute with Repeat and Force off → the row shows "restart in 1m", and about
    a minute later the terminal is disposed and respawned once and the indicator disappears. With
    Repeat on, it keeps restarting on that interval; Stop on the loop clears the schedule (indicator
    gone, no further restarts). Right-click ♻ on a loop that already has a schedule → the popover shows
    its current settings and offers Clear, which removes it. **Deferral:** with Force OFF and a task
    of that model `phase: inprogress`, let the timer elapse → the terminal is NOT restarted, the row
    reads "restart waiting for task", and it stays that way indefinitely; move the task out of In
    Progress (edit `.loopboard/TODO.md`) → the restart fires on the next refresh. **Force:** tick
    Force and press Schedule → a native modal names the Rule 2 consequence; Cancel arms nothing;
    confirming arms it, and when it fires mid-task there is NO second prompt. Reload the window with
    a schedule armed → every indicator is gone (session-only) and nothing about it was written to
    disk. With `loopBoard.debug: info`, `.loopboard/debug.log` shows `restart-arm`, `restart-fire`,
    `restart-defer`, `restart-cancel`, and the force modal's `popup`/`popup-choice` pair.
25. **"Groom with: On hold" (t-65a2):** the New Story composer's and a draft card's **Groom with**
    select each offer `On hold` after the model ids (the **Work with** select does NOT). Picking it
    on a draft writes `- groomer: none` into that entry in `.loopboard/TODO.md` and the card shows
    an amber "on hold — not groomed" badge, with the draft hint changed to the on-hold wording;
    picking `default (<model>)` again removes the `groomer:` line entirely and the badge disappears.
    Creating a new draft with On hold selected in the composer writes `groomer: none` from the
    start. A New (non-draft) card whose entry has `groomer: none` shows the same badge in its chip
    row; a Backlog/In Progress/Review/Done card never shows it. With a real loop running, a held
    New task survives pass after pass ungroomed — its `## Description` and questions are untouched,
    including when one of its answers is filled.

26. **Workspace custom rules are hand-owned (t-4a04, redesigned):** `loopBoard.customRules` no
    longer exists — Settings → Extensions → LoopBoard shows no such row, and a leftover value in
    settings.json is ignored as an unknown key (no toast, no log line). Hand-add a
    `<!-- loopboard:custom:begin/end -->` section with free text to `.loopboard/LOOP.md` (shape in
    README's "Workspace custom rules"), then run **Synchronise Templates** → the section is
    byte-identical afterwards; reload the window → still untouched (the extension never reads or
    writes it, so no `custom-rules` events appear in `.loopboard/debug.log` at any level). In a
    fresh workspace, **LoopBoard: Initialize Workspace** scaffolds a LOOP.md whose tail already
    carries the empty custom section (it rides in the template, outside every sync marker), while
    Sync in an existing workspace without the section never adds it.

27. **Restructured settings (t-1f1e):** open Settings → Extensions → LoopBoard. **Models** reads as
    two defaults then three slot blocks (Opus/Sonnet/Fable, each *enabled → custom model → effort*);
    **Loop Behavior** reads interval, After Task, permission mode, pulse, custom rules, debug, max
    attachment size — no separate "Permissions" group, and no two rows fighting over the same
    position. `loopBoard.afterTask` renders as a dropdown with three described options; the two old
    booleans appear struck through with their deprecation notice. Migration: with `afterTask` UNSET
    and `loopBoard.autoRecycle` on, finishing a task still recycles that model's terminal; swap to
    `clearSessionAfterTask` and it sends `/clear` instead; then set `afterTask` explicitly and it
    wins over both. `.loopboard/debug.log` (`debug: verbose`) still shows the `config-read` line and
    `auto-recycle` / `clear-session` at `info` exactly as before.

28. **Instant echo on composer saves (t-ff54):** on a card with an existing note, click **edit**,
    change the text and press ⌘S — the card shows the NEW note in the same frame (previously the
    old, shorter one). Add a note to a card that has none → the note card appears instantly, not
    the `＋ Note to worker` button. Click the note's **delete** → the note disappears at once.
    Repeat each with a click-outside commit (⌘S replaced by clicking into another card field, so a
    field is focused when the confirming refresh lands): the saved text still stands, and does not
    revert to the old value while that field stays focused. Same for a description edit and, on a
    Review card, a feedback save (the amber "Your pending feedback" block appears immediately) and
    an answer save. Conflict path unchanged: edit the same field on disk between opening the editor
    and saving → the "changed on disk" toast still wins and the card shows the disk value.

Pre-v2 board behaviors (read-only render + live refresh, edit/gates/merge toasts, sidebar badge,
loop spawn/recycle/stop, icon rendering in light/dark themes) still require the same F5 walkthrough
and likewise cannot be verified headless.

29. **Context-usage bar + threshold restart (t-2b89):** with `loopBoard.contextLimit.percent` at its
    `0` default, start a loop from the sidebar ▶ and let it take a turn — within ~30 s its row grows
    a thin bar plus `ctx <n>k / <window>k · <n>%` under the label, and the number climbs as the
    conversation grows. Nothing restarts. Stop the loop → the bar disappears entirely (no "0%"
    row). BOTH numbers must match what that loop's own status line reports: a 5-series model reads
    `/ 1000k` with NO `[1m]` suffix configured, and the used figure tracks the loop's last turn
    rather than the one before it. Set `loopBoard.models.opus.model` to an older 200k model (e.g.
    `claude-sonnet-4-5`), restart that loop with ♻, and the label reads `/ 200k`. At the `0` default
    the bar has NO orange section. Set `loopBoard.contextLimit.percent` to e.g. `80` and the bar
    paints orange from the 80% mark to its right edge, hovering it reads `restart at 80%` (or
    `/clear at 80%` when `loopBoard.contextLimit.action` is `clear`); the blue fill paints OVER that
    zone as usage crosses into it, and the whole bar reverts to plain when the setting goes back to
    `0`. Then set `loopBoard.contextLimit.percent` to a value just under the running
    loop's current percentage: with NOTHING In Progress, that loop is restarted (or `/clear`ed when
    `loopBoard.contextLimit.action` is `clear`) within one poll, once — it must not restart again on
    the following polls. Repeat while that model owns the In-Progress task: the row instead reads
    `· restart waiting for task` and the terminal is left alone until the task leaves In Progress,
    at which point the restart fires. With `loopBoard.debug: info`, `.loopboard/debug.log` carries
    `context-trip`, then either `context-fire` or `context-defer` + a later `context-fire`, plus
    `context-clear` when you restart that loop by hand first. A workspace with no `claude` session
    running (or `CLAUDE_CONFIG_DIR` pointed at an empty directory) shows no bar and logs nothing but
    `verbose` reads — never an error popup.
30. **Batched answer saves (t-5e6d):** open a New story with three questions. Answer the first and
    Save → the row collapses with an amber rail and a `held` tag, the count reads `1 / 3 answered`
    with a tooltip saying answers are held until all three are filled, and `.loopboard/TODO.md` is
    UNCHANGED on disk (no `rev:` bump, and with `loopBoard.debug: verbose` no `patch` line and no
    nudge). Same for the second. Answer the third → exactly ONE `patch … answers … applied rev+`
    line appears, all three answers are in the index, and the groomer loop is nudged once. Repeat
    using **Save All** and using a suggestion's **Accept** — same result. Hide the panel and
    re-open it (and **Developer: Reload Webviews**) with two answers held: they are still shown as
    held; close the window and they are gone. Conflict path: hold two answers, edit one of that
    story's `answer:` lines directly in `TODO.md`, then answer the last question — the
    "changed on disk" toast fires, nothing partial is written, and the held answers stay in the
    card so you can save again. Re-groom path: hold an answer, then change that question's TEXT in
    `TODO.md` — the next refresh drops the held answer with an info toast naming the story. Repeat
    the first walkthrough on a **Feedback** card: identical batching, with the worker-resumes
    tooltip wording.

    Review round 2 (t-5e6d): on a story with one answer already on disk and one blank, **edit the
    answered question** and Save → the row stays held with the new text and, after the next board
    refresh, still shows YOUR text (it must not revert to the old on-disk answer). **Clear** an
    answered question to blank and Save → the blank is written straight through (`patch … answer
    … applied rev+`), the count drops and the retraction survives a refresh. On a fully answered
    story, edit two answers and press **Save All** → exactly ONE `answers` patch, carrying both new
    values (not one stale). Save an answer containing a **newline** as the last blank → the flush
    succeeds with the newline folded to a space; no "Task changed on disk" toast. Finally, save a
    row whose value equals what is already on disk as the last blank → no patch is posted and the
    `held` tag disappears immediately rather than sticking.

31. **Toasts hold while hovered or focused (t-7905):** trigger a board toast — arm a schedule from
    a sidebar row (success, 4 s) or force a "changed on disk" conflict by editing a field in
    `TODO.md` while editing the same field on the card (warning, 8 s). Leave the pointer OFF it →
    it still disappears at its usual 4 s / 8 s. Trigger another and **hover** it: it stays on
    screen for as long as you hover, well past 8 s (try ~30 s). Move the pointer away → it goes
    within ~1 s and does NOT sit for a further 4 s / 8 s. Trigger one and move the pointer away
    BEFORE its duration elapses → it still disappears at its original time, not later. **Tab**
    onto the toast's ✕ (or its action button, e.g. the conflict toast's) and hold focus there past
    the duration → it stays; Tab away or click elsewhere → it goes within ~1 s. While hovering a
    toast, cause a board refresh (edit `TODO.md` from the editor, or let a loop write) → the toast
    is not dismissed early by the repaint and is not stuck afterwards: releasing the hover still
    dismisses it within ~1 s. ✕ and the action button still work immediately during a hold.

    Review round 2 (t-7905). **Focus leaving the webview must release the hold:** Tab onto a
    toast's ✕, then click into an editor tab or a terminal WITHOUT tabbing away first (so the
    button is still `document.activeElement` in the blurred webview) → the toast dismisses within
    ~1 s of the click, it does NOT hang on screen indefinitely. Click back into the board and
    confirm no stale toast is left over. **Focus survives a refresh mid-hold:** Tab onto a toast's
    ✕ and, while holding focus there past the toast's 4 s / 8 s duration, cause a board refresh
    (edit `TODO.md` from the editor, or let a loop write) → the toast is still on screen, focus is
    still on its ✕ (Enter dismisses it), and it does not vanish on the next tick; Tab away
    afterwards → it goes within ~1 s. Repeat with focus on a conflict toast's **Review** action
    button — focus must land back on that button, not on the ✕.
32. **Stale-session guard after a restart (t-c7a2):** the pure decision (`isStaleSession`) is unit
    tested in `test/context.test.js`, but the controller wiring — the three remember paths and the
    `continue` in `pollContextOnce` — imports `vscode` and cannot reach the Docker suite, so it is
    verified here only. Set `loopBoard.debug: verbose` and watch `.loopboard/debug.log`.

    **Context-triggered restart, no In-Progress task:** set `loopBoard.contextLimit.percent` just
    under a running loop's current usage. Expect **exactly one** `context-fire` / `loop-recycle`
    pair — never the storm of consecutive `loop-recycle` lines this fixes. The `context-fire` line
    names the ended session (`— ended session <id>`). The polls that follow log `context-stale` for
    that same id, the sidebar row shows **no context bar at all** (not a stale number), and once
    the new session writes its file a fresh `context-read` appears with a **different** id and the
    bar restarts from that session's real, small number.

    **Manual ♻ while the slot owns the In-Progress task:** with the loop above the threshold, click
    ♻. Expect `context-clear … — ended session <id>` and **no** `context-defer`, no
    `restart waiting for task` on the row, and no bar until the new session reads. At the next idle
    edge the fresh session is **not** recycled.

    **Repeat with `loopBoard.contextLimit.action: clear`** — same expectations via
    `terminals.clearSession` (there is no terminal close/open event on this path, so it exercises
    the `fireContextRestart` remember step rather than `clearContextTrip`'s).

    **A loop that never tripped:** with the threshold well ABOVE a running loop's usage (e.g. 50
    with the loop at 41%), click ♻ → the row must show no bar until the new session reads. Before
    this change `clearContextTrip` returned early for an untripped loop and the 41% stayed on
    screen for a session that no longer existed.

    **Hysteresis unchanged:** a session that legitimately sits above the threshold still trips
    once, and re-arms when it comes back down past the band.
33. **Per-section collapse (t-aee3):** webview-only (`media/board.js` + `media/board.css`), so the
    Docker suite does not cover any of it — this checklist is the acceptance path, exactly as for
    t-col1 / t-7411 / t-7679. On a **New** card that has open questions:

    **Default:** with no saved section state (fresh board, or after Expand all), both the
    **Description** and **Open questions** sections show expanded, each with a chevron in its
    header.

    **Independent fold:** click the Description chevron → only that section folds; the questions
    panel and the card itself are untouched. Same in reverse for the Open questions chevron: its
    header (title, `N / M answered`, the progress meter, and the `re-groom pending` badge when it
    applies) stays visible, the rows and **Save All** go, and the header keeps no dangling divider.

    **Collapsed preview:** the folded Description header shows the first line of the description
    beside the label, on one ellipsised line with markdown markers stripped — a heading, list
    bullet or `[link](path)` renders as its plain text, never as markup. A card with an EMPTY
    description shows the header with no preview, and expanding it still offers
    `Add a description…`. Expanding removes the preview.

    **Collapse all / Expand all:** click **Collapse all** → every card in the tab folds. Expand one
    card by its own chevron → BOTH its sections come back folded. **Expand all** → every card and
    every section open. Switch tabs: the other tab is unaffected.

    **Persistence:** hand-fold one section, then (a) let a loop write to the tracker so the board
    refreshes, (b) switch to another view in the activity bar and back, and (c) reload the window —
    the fold survives all three. Then press Collapse all / Expand all in that tab: the hand-set
    override is wiped by it.

    **Commit on collapse:** click the description to open its editor, type without saving, then
    click the Description chevron → the edit is COMMITTED (the patch lands, and expanding the
    section shows the new text); nothing typed is lost. Separately, type an answer draft without
    saving, fold the questions panel and unfold it → the draft is still there.

34. **Card selects commit on pick (t-bbad):** the echo + repaint is webview-only
    (`media/board.js`), so alongside the source-text guard `test/board-patch-echo.test.js` this
    checklist is the acceptance path. On a `groomer: none` draft, pick a real groomer → the
    `on hold — not groomed` pill and the "on hold — pick a groomer…" line disappear in the same
    frame, before any outside click, and `TODO.md` shows the new `groomer:` with a `rev:` bump.
    Without clicking out, pick a THIRD value → it lands on disk with no "Task changed on disk"
    toast. Without clicking out, pick the ORIGINAL value back → disk returns to it. Without
    clicking out, collapse another card (forcing a full `render()`) → the select still shows the
    picked value and still has focus. Repeat the same four steps on the draft **Work with** select
    and on a full card's head **Model** select.

    **Keyboard:** focus a select and arrow through the options without opening it → every step
    lands and focus never leaves the select.

    **Open dropdown survives a loop write:** open a dropdown and leave it open while a loop writes
    `TODO.md` → the dropdown is NOT torn down.

    **Conflict snaps back without a click-out:** edit `model:` for that task in `TODO.md` by hand,
    then pick a different model on the card without clicking out → the "Task changed on disk"
    toast appears AND the card snaps back to the on-disk value immediately.

    **Title editors:** edit a card title and Save, and edit a draft's text and Save → the new text
    paints immediately, with no flash of the old title.

    **Unchanged surfaces:** New Story composer — pick a groomer and a worker model, Save Draft →
    the new draft carries both. Sidebar — right-click ▶/♻/■, click presets and toggle
    Repeat/Force → each reflects immediately.

35. **Delegated-work mode rides the spawn prompt (t-e3c3):** `buildLoopCommand` and the template
    clause are unit-tested; what only F5 can show is the real terminal line. With both delegation
    settings at their defaults, start a loop
    → the pasted `/loop` line reads `… with a subagent effort ceiling of <effort> and a grooming
    concurrency cap of <n>. Open .loopboard/LOOP.md, …` and ends there — no `Delegate work` text.
    Set `loopBoard.delegateWork` to `true`, restart the loop with ♻ → the line now ends with
    `Delegate work to subagents.`; additionally set `loopBoard.delegateReview` to `false` and
    ♻ again → it ends with `Delegate work to subagents without review.`. Flipping either setting
    WITHOUT ♻ changes nothing in the running terminal (spawn-frozen, like the interval). With
    `loopBoard.debug` at `info`, each spawn logs one `loop-spawn` line naming `delegate on|off,
    review on|off`. Run **LoopBoard: Sync Templates** on a workspace whose `LOOP.md` predates this
    change → its Automation fence gains the `DELEGATED-WORK MODE` clause and the custom-rules
    section is untouched.


36. **Unique per-spawn session `--name` (t-x1t1):** the suffix generator, the prefix match and the
    spawn line are unit-tested (`test/context.test.js`); what only F5 can show is a real terminal
    against the global `~/.claude/sessions/` registry. **Two windows:** open a second VSCode window
    on a different workspace that also runs LoopBoard, start the SAME slot's loop in both, then
    inspect both `~/.claude/sessions/<pid>.json` — each `name` reads `loopboard-<slot>-<4 hex>`,
    the two suffixes differ, and BOTH carry `nameSource: "user"` (never `"collision"`, and never a
    `<word>-<word>` tail). Both sidebar rows show their context bar; before this change the window
    that booted second had no bar for its whole session. **Recycle:** press ♻ on a running loop,
    wait past the boot delay → the new process's session file again has `nameSource: "user"` with a
    DIFFERENT suffix from the one it just replaced, and the bar reappears on the new session rather
    than staying dark. **Rescue path:** a session that did collide (an older build, or one started
    before this fix) is still resolved — its `loopboard-<slot>-<word>-<word>` name matches the same
    prefix, so its bar renders.

37. **LoopBoard's own settings page (t-sgrp):** the manifest→form model, the grid's validation and
    the manifest invariants are unit-tested (`test/settingsform.test.js`,
    `test/settingsgrid.test.js`, `test/manifest-settings.test.js`); what only F5 can show is the
    page itself, the config writes and the live listener.

    **Opens instead of the native editor:** click the sidebar's **Settings** row → a `LoopBoard
    Settings` editor tab opens (NOT VSCode's Settings editor). It shows four sections in order —
    *Models & Slots*, *Agent Setup*, *Board & Workspace*, *Beta* with an `experimental` chip — and
    the two deprecated keys (`loopBoard.autoRecycle`, `loopBoard.clearSessionAfterTask`) appear
    nowhere on it. Descriptions render as markdown: backticks are code chips, `**Beta —**` is bold,
    nothing shows raw markers. Compare against `docs/mockups/t-sgrp-settings-page.html` — structure
    and feel should match; the footer there lists the deliberate departures.

    **Light and dark:** switch the colour theme (e.g. Default Dark Modern → Default Light Modern)
    with the page open → every label, input, switch and radio stays legible; nothing is a dark-only
    hard-coded colour.

    **Topic list, width-gated (untested in Docker — `media/` has no coverage beyond the syntax
    gate):** only the section→anchor slugs are unit-tested (`test/settingsform.test.js`); the list
    itself is CSS and a webview click handler. With the page open, make the editor group WIDE
    (≥ 1180px — drag the sidebar closed / maximise the window): a **Sections** list appears on the
    left, its entries matching the page's headings one for one, in the same order, with the Beta
    entry carrying the same `experimental` chip. Click each entry → the page scrolls to that
    heading. Scroll down → the list stays put (sticky). Now NARROW the group (split the editor, or
    open the sidebar and Panel): below 1180px the list is GONE — no hamburger, no leftover gap, and
    the content column is centred exactly as it was before this was added. Do the whole check once
    in a dark theme and once in a light one: the list's text and hover are theme colours, so both
    must stay legible. There is deliberately NO active-section highlight — no entry is ever marked
    while you scroll.

    **Modified marker + reset:** change *Loop interval* to `2m` → a dot appears next to the label
    and **Reset** appears. Check `settings.json` (user, not workspace): `"loopBoard.loopInterval":
    "2m"` is in your USER settings file. Click **Reset** → the key disappears from user settings,
    the field returns to `5m`, the dot and Reset go away.

    **The grid:** all six columns edit in place. The two radio columns are headed on TWO LINES —
    a smaller `default` sitting directly above `worker` / `groomer` — because a radio there picks the
    *default* worker, not a slot that is *a* worker (untested in Docker: it is `media/settings.js` +
    `.css`). Check the layout held: the header row is one line taller, the six columns sit exactly
    where they did, `--model` is not squeezed, and the table does not scroll sideways — at a normal
    width, at >1180px with the topic list showing, and in a narrow side-by-side editor. With a screen
    reader, the radio still announces *"Opus is the default worker"*, matching the header. The caption
    reads *Which slots exist, who they spawn, and how hard they think — the radios pick who takes a
    task that names no model or groomer of its own.*
    Toggle *Fable* off → its row fades and it vanishes
    from the sidebar's Loops overview and the board's model selects. Click the *worker* radio on
    another row → the previous one clears (single choice). Now try to turn OFF the slot that is the
    default worker → the write is REFUSED with a reason naming it, and the toggle snaps back; same
    for the default groomer, and same in reverse (making an OFF slot the default worker is refused).
    Type `opus; rm -rf /` into a `--model` field → it turns red as you type and, on blur, is refused
    with the reason shown and the field restored. Type `opus[1m]` → accepted. Set *groomers* to `0`
    → it is clamped to `1`. The header hint reads `⟳ model · effort · groomers apply on the next loop
    start (▶) or restart (♻)` — confirm it is true: with a loop running, change its effort, then ♻,
    and check the pasted `/loop` line carries the NEW ceiling while the pre-♻ terminal did not.

    **The "applies on" marker (untested in Docker — the marker itself is `media/settings.js` + CSS;
    only the classification, the wording and the manifest sentence are unit-tested in
    `test/manifest-settings.test.js` / `test/settingsform.test.js`):** exactly FOUR generic rows
    carry a `⟳ Applies on the next loop start (▶) or restart (♻)` line directly under their
    description — *Permission mode*, *Loop interval*, and both Beta rows (*Delegate work*, *Delegate
    review*) — plus the model grid's header note, which says the same thing for `--model`,
    `effort` and `groomers`. EVERY other row has nothing there: *After a task*, *Context limit —
    percent/action*, *Nudge loops*, *Max attachment size MB*, *Pulse template sync*, *Debug* and the
    grid's `on` / `default worker` / `default groomer` columns show no marker at all, and there is no
    "applies immediately" chip anywhere. Read the marked rows and the grid note side by side: the
    wording must be identical, not two phrasings of the same fact. In a light and a dark theme the
    marker stays legible and stays QUIET — description colour, one size down, never a coloured badge.
    Then check the fact itself end to end: with a loop running, change *Permission mode*, look at the
    running terminal's command line (unchanged), press ♻, and confirm the new `--permission-mode`
    rides the fresh spawn. Finally open **Open in VSCode Settings**: the native editor cannot draw
    the marker, so those same settings must end their description with
    `Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned
    with.` — and no other setting may say anything of the kind.

    **The fact is stated ONCE per surface (untested in Docker — `stripAppliesSentence` and the
    "no drawn control repeats it" assertion are unit-tested in `test/settingsform.test.js`, but what
    is PAINTED is `media/settings.js`):** on LoopBoard's own page, read each of the four marked rows
    top to bottom. The description must END on its own last sentence and must NOT also read
    `… Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned
    with.` immediately above the `⟳` marker saying the same thing. Check *Delegate review*
    especially — before this fix it printed the fact twice, sentence then marker. The native editor
    is the opposite check and is above: there the sentence must still be present, because that
    surface cannot draw the marker. The grid's header note is one line and was already correct;
    confirm it has no duplicate sentence either.

    **The renamed Beta key (untested in Docker — only the manifest invariant is):** the review
    toggle is `loopBoard.delegateReview`, NOT `loopBoard.delegateWork.review`, which VSCode could
    never honour (it logged `Ignoring loopBoard.delegateWork.review as loopBoard.delegateWork is
    true` and used the default). Put BOTH keys in your user `settings.json` with
    `"loopBoard.delegateWork": true`, `"loopBoard.delegateReview": false` and
    `"loopBoard.delegateWork.review": true` → the VSCode log shows NO `Conflict in settings file`
    line for `loopBoard.delegateReview` (the stale third key is simply an unknown setting now), the
    page's *Delegate review* toggle reads OFF, and ♻ spawns a `/loop …` line ending in `Delegate
    work to subagents without review.` — i.e. the configured value actually reaches the prompt.
    Then turn *Delegate work* off on the page → the *Delegate review* row greys out (the dependency
    is declared in the manifest as `loopBoardDependsOn`, no longer inferred from the key name).

    **“Migrate Config” — stale settings (untested in Docker — only the PLAN is:
    `test/settingsmigrate.test.js` covers every rule, conflict, orphan and blind-removal case plus
    the per-row `actionWrites`; the button, the preview panel, the per-row buttons and the actual
    `update()` calls are `media/settings.js` + `controller.ts`, which have no Docker coverage).**
    Back up your user `settings.json` first — this writes to it. Throughout: **every listed row
    carries its own button** — there is no row that only tells you to go and fix something by hand.

    *Nothing to do:* with no stale keys set, click **Migrate Config** (left of *Open in VSCode
    Settings*) → a panel says **Nothing to migrate**, and `settings.json` is byte-identical
    afterwards. No dialog, no empty list, no write.

    *Deprecated pair:* put `"loopBoard.autoRecycle": true` and `"loopBoard.clearSessionAfterTask":
    true` in user settings, remove `loopBoard.afterTask`, click **Migrate Config** → the panel lists
    exactly two lines: `MIGRATE loopBoard.autoRecycle = true — set loopBoard.afterTask to "recycle",
    then remove this key.` and `REMOVE loopBoard.clearSessionAfterTask = true — … loopBoard.
    autoRecycle is what decides loopBoard.afterTask …`. **Nothing has changed yet** — check
    `settings.json` at this point and confirm it is untouched. Click **Cancel** → still untouched.
    Click **Migrate Config** again, then **Apply all 3 changes** → `settings.json` now has
    `"loopBoard.afterTask": "recycle"` and neither boolean, the page's *After a task* row reads
    `recycle` without a reload, and the panel reports `Applied 3 changes`. The behaviour must not
    have changed: finish a task with a loop running and confirm the terminal is recycled exactly as
    it was before the migration.

    *Destination already set → conflict:* set `"loopBoard.afterTask": "none"` AND
    `"loopBoard.autoRecycle": true` → the panel shows one `CONFLICT` line naming both and saying
    `left out of Apply — loopBoard.afterTask is already set to "none"`, with **no bulk Apply button**
    (a conflict contributes nothing to one, and one row does not earn a bulk button). `settings.json`
    is unchanged. This is the assertion that matters most: a hand-set key is never overwritten.
    The row does carry its own **Remove old** button — click it → `loopBoard.autoRecycle` is gone and
    `"loopBoard.afterTask": "none"` is **still there, unchanged**. That button must never overwrite
    the destination.

    *Orphan:* add `"loopBoard.customRules": ["x"]` (a real key this extension dropped in t-4a04) →
    it is listed as `REMOVE … LoopBoard has no setting by this name`. Apply → it is gone. Now add
    `"loopBoard.defaultModel": "sonnet"` (undeclared but still honoured by `readDefaultModel`) and
    `"loopBoard.models": {"opus": {"enabled": false}}` (the legacy container form) → **neither is
    listed**, and after an Apply of anything else both are still in `settings.json`. Removing either
    would silently change which model spawns.

    *Renamed key while it is readable:* with `loopBoard.delegateWork` NOT set, add
    `"loopBoard.delegateWork.review": false` → it is listed as `MIGRATE … set
    loopBoard.delegateReview to false`. Click the row's own **Migrate** button →
    `loopBoard.delegateReview: false` is in `settings.json`, the old key is gone, and the Beta
    *Delegate review* toggle reads OFF.

    *The key that cannot be read but CAN be removed — the blind removal (untested in Docker: the
    plan is, `test/settingsmigrate.test.js` pins that the sweep names the child key ALONE and that it
    never reaches `plan.writes`; the disclosure, its open state and the `update()` that carries it out
    are `media/settings.{js,css}` + `controller.ts`).* This is the step that proves VSCode's
    read/write asymmetry, so do it exactly:
    1. Put BOTH `"loopBoard.delegateWork": true` and `"loopBoard.delegateWork.review": true` in your
       user `settings.json` by hand. The VSCode log shows `Ignoring loopBoard.delegateWork.review as
       loopBoard.delegateWork is true` — the key is genuinely unreadable.
    2. Click **Migrate Config** → the panel says **Nothing to migrate** and *nothing else that reads
       as an outstanding item*: no `REMOVE?` row, no *Removed …, if it was there* sentence. The only
       other thing on it is a quiet, COLLAPSED disclosure reading *Legacy keys this page cannot read
       (1)*, description-coloured and normal weight. There must be NO advisory telling you to edit
       JSON yourself, and no *Mark as done*.
    3. Click the disclosure open → a short explanation, then one `REMOVE?` row for
       `loopBoard.delegateWork.review` with its own **Remove** button. Nothing has been written yet —
       check `settings.json` and confirm both keys are still there. **Opening the Migrate Config
       panel must never sweep on its own.**
    4. Click **Remove** → the confirmation `Removed loopBoard.delegateWork.review from your user
       settings, if it was there.` appears **inside the disclosure**, which stays OPEN, and the
       headline outside it still just reads *Nothing to migrate*. **Open `settings.json` and confirm:
       the `"loopBoard.delegateWork.review"` line is gone AND `"loopBoard.delegateWork": true` is
       still there, untouched.** That second half is the whole risk — a dotted key is one literal
       property name, never a path, so the removal must not reach into the parent.
    5. Close the panel and click **Migrate Config** again → the disclosure is back and COLLAPSED, and
       the default view is a bare *Nothing to migrate*. The row inside it is listed again; that is
       correct and no longer visible noise, because the API still cannot read the key. Pressing
       **Remove** on an already-clean config is a byte-identical no-op — confirm by copying
       `settings.json`, opening the disclosure, clicking **Remove**, and diffing. Identical, no
       reformat.
    6. Now remove `"loopBoard.delegateWork"` too → **Migrate Config** shows **Nothing to migrate**
       with *no disclosure at all* (nothing shadows the key any more).
    7. With a real finding present as well — add `"loopBoard.autoRecycle": true` — the review list
       shows ONLY the `MIGRATE` row and the button reads **Apply all 2 changes** (destination + its
       removal). The blind removal is NOT in that count and is NOT in that list; it is still down in
       the collapsed disclosure, independent of the findings above it.

    *The acknowledgement is gone:* an earlier build stored a `loopboard.settingsMigrate.acknowledged`
    key in the extension's `globalState`. Nothing reads it now, and activation deletes it. With
    `loopBoard.debug: info`, the FIRST window reload after installing this build writes one `info
    settings-migrate-ack-dropped` line to `.loopboard/debug.log` if you ever pressed the old *Mark as
    done*; every later reload writes none. There is no *Mark as done* button anywhere on the page.

    *Known read-only blind spots (check, but a miss here is expected, not a bug):* run the orphan
    step again on a NON-DEFAULT VSCode profile, and again in a Remote/WSL/Container window. In
    either case an orphan may not be listed — application-scoped settings are re-read through a
    scope-filtered model off the default profile, and a remote window parses local user settings
    under `LOCAL_MACHINE_SCOPES`; an unregistered key has no scope to survive that filter. The
    required outcome is that it is silently NOT listed. If it is ever listed with the wrong value,
    or anything is written that the preview did not name, that IS a bug.

    *Debug trace:* with `loopBoard.debug: verbose`, one **Migrate Config** click then an Apply
    writes to `.loopboard/debug.log`: a `verbose settings-migrate-scan` line listing each key and
    its planned kind, an `info settings-migrate-preview` line, an `info settings-migrate-choice`
    line, and one `info settings-migrate-write` line **per key** naming the key, whether it is a set
    or a remove, and the value. A per-row button logs the same `choice` + `write` pair for that one
    key, and a blind removal's write line reads `remove if present (unreadable here)` — it must NOT
    claim the key was there, because the host cannot know. With `loopBoard.debug: off` none appear.

    *Light and dark:* the panel's tags, list rules, the Apply button and the *Legacy keys* disclosure
    (collapsed summary, its hover state, its keyboard focus ring, and the rule above it when open)
    must be legible in both themes — it uses only `var(--vscode-*)` colours. Tab to the summary and
    press Enter: it must toggle with a visible focus ring.

    **Live sync, and the listener dying with the page:** with the page open, hand-edit
    `loopBoard.debug` in your user `settings.json` → the page repaints without a reload. Do the same
    while a text field is focused → the repaint is deferred until you blur (your caret is not
    stolen). Then click **Open in VSCode Settings** → the native `@ext:SinnConsulting.loopboard-todo`
    view opens; change a value there → LoopBoard's page repaints too. Close the LoopBoard Settings
    tab and hand-edit `settings.json` again → with `loopBoard.debug: verbose`, `.loopboard/debug.log`
    records NO `settings-config-change` line (the listener was disposed with the panel).

    **The sidebar follows a config change too (untested in Docker — `controller.ts` has no Docker
    coverage):** the config listener repaints the board and sidebar as well as the page
    (`refresh('config-change')`). With the LoopBoard Settings tab open side by side with the
    sidebar: in the grid, toggle an enabled slot (e.g. *Fable*) OFF → its row disappears from the
    sidebar's **Loops** overview IMMEDIATELY, with no click on the board, no `.loopboard/` edit and
    no terminal action in between; toggle it back on → the row returns. Click the *worker* radio on
    a different slot → the board's default-worker mark follows on the same beat. Then, still with
    the page open, hand-edit `loopBoard.defaultWorkerModel` in your user `settings.json` → the
    sidebar and board update without touching either surface. With `loopBoard.debug: verbose`,
    `.loopboard/debug.log` shows an `info settings-config-change` line followed by a
    `verbose refresh config-change` line for each of those changes. Closing the page disposes the
    listener, so after that a `settings.json` edit updates NEITHER surface until the next refresh —
    that is the documented no-permanent-listener design, not a regression.

    **Scope is enforced:** put `"loopBoard.permissionMode": "bypassPermissions"` into a workspace's
    `.vscode/settings.json` → VSCode marks it as not applicable in this scope, the settings page
    still shows the user value, and a spawned loop's `--permission-mode` is the USER value. This is
    the security-relevant assertion of the whole story.

    **`@tag:experimental` (unverified here):** the two Beta keys carry `tags: ["experimental"]`.
    Search `@tag:experimental` in VSCode's Settings editor and confirm extension-contributed keys
    are picked up. If they are NOT, the tag is inert rather than wrong — drop it and keep the
    section heading and the `**Beta —**` sentence, which carry the status on their own.

38. **Groomer select on New cards + labelled selects row (t-eb64):** webview-only (`media/board.js`),
    guarded by a source-text pin in `test/board-patch-echo.test.js`; this checklist is the acceptance
    path. On a groomed (non-draft) **New** card: directly below the chip row there is a labelled
    row `Groom with [select] Work with [select]`, the same idiom as a draft card, and the head row
    holds only the collapse chevron, type icon, title, Promote and delete — no select. Pick another
    groomer → `TODO.md` shows `- groomer: <model>` on that entry, only its `rev:` bumps, and the
    card repaints on pick (no click-out). Pick `On hold` → `groomer: none` and the `on hold — not
    groomed` chip appears; pick a real groomer → it clears. Pick `default (<model>)` in either
    select → that entry's `groomer:` / `model:` line disappears with no conflict toast. On a
    **Backlog**, **In Progress**, **Feedback** and **Review** card the row carries ONLY `Work with`
    + its select, and changing it writes `model:` exactly as before. Collapse a card of each phase
    → the whole row is gone and the card grows no rows (a collapsed card shows no model select at
    all — intended); expand → the row returns with the current values selected and focus stays on a
    select after a pick. Draft cards and the New Story composer are unchanged.

39. **Live subagents block a loop restart + the Agents section (t-sbag):** host + webview only
    (`src/contextreader.ts`, `src/controller.ts`, `media/sidebar.{js,css}`); the pure half is
    `test/subagents.test.js`, this checklist is the acceptance path. Set `loopBoard.debug: verbose`
    first — `.loopboard/debug.log` is where every assertion below is confirmed.

    **The section fills and empties:** start a loop and give it work that delegates (a grooming
    draft is the easy case — grooming never sets `phase: inprogress`, which is the whole point).
    Within one poll (30 s) an **Agents** section appears directly under **Loops**, hidden until
    then: one row per live subagent, `<slot> · <agentType> · <description>` with a ticking duration,
    the long label marquee-scrolling with the same animation the In-Progress title uses (and
    stopping under `prefers-reduced-motion`). Nested agents (`spawnDepth > 1`) appear as flat rows,
    never grouped. Nothing in a row is clickable. When the agents finish, the rows disappear and the
    whole section goes with them. `debug.log` shows an `agents-read <slot> N live: …` line per poll.

    **The duration is the CURRENT stretch** (human-observed defect, PR #157): while an agent runs,
    its row's duration tracks the elapsed time in that agent's own terminal status line. Then send
    that agent a follow-up message so it resumes (delegated-work mode does this constantly) → the
    row restarts from the resume, NOT from the original spawn; a row reading `14m` for an agent
    59 s into its resumed stretch is the bug this replaced. An agent that was never resumed still
    counts from its spawn.

    **A quiet agent is not dropped:** `AGENT_STALE_MS` is 60 minutes and the cut is on the agent
    transcript's mtime, so an agent blocked on one long operation (a Docker image build, a slow
    suite) is NOT dropped at 30 minutes and no held restart kills it mid-work. Past the hour the
    drop is deliberate and explicable: `debug.log` carries
    `agents-stale <slot> agent <id> — silent for over 60m (no finish marker, dropped for silence — a
    held restart may now fire)`, and the restart that follows is the documented backstop against a
    killed session's leftover metas, not a mystery.

    **The ♻ tooltip warns but the click still restarts:** while an agent is live, hover ♻ → the
    tooltip reads `Restart with fresh context — N subagents still running (right-click to
    schedule)` and names each agent on its own line. Click it → the loop restarts IMMEDIATELY, as
    before. The manual button never refuses.

    **A scheduled restart holds:** with a groom subagent running and NOTHING In Progress,
    right-click ♻ → schedule a 1-minute restart with `Force` OFF. At the minute the loop does NOT
    restart; the row shows `restart waiting for task` and `debug.log` records
    `restart-defer <slot> — 1 live subagent: <agentType> · <description>, waiting for idle`. Let the
    agent finish → the restart fires on the next poll after the section empties (`restart-fire`),
    with no `.loopboard/` write in between — a finishing subagent touches no tracker file, so this
    is the poll-driven idle edge, not a board refresh. Re-run with `Force` ON: the modal's detail
    now says subagents are killed too, and the restart fires on time over the live agent.

    **afterTask holds the same way:** set `loopBoard.afterTask` to `recycle`, let a worker finish a
    task while one of its subagents is still running → no recycle at the idle edge, an
    `aftertask-defer` line naming the agent, and the recycle fires once the agent is gone
    (`auto-recycle <slot> (held for a live subagent)`). Same with `clear`.

    **A hold never becomes a second restart, and never becomes a start** (PR #157 review). The
    decision itself is pure and covered by `resolveHeldAfterTask` in `test/model.test.js`; the
    wiring that feeds it is host-only, so check all four paths with `afterTask: recycle` and a hold
    recorded (worker finishes while one of its subagents is still running):
    - Click **■** → the loop stops and STAYS stopped. No terminal reappears 400 ms later, and
      `debug.log` shows `aftertask-cancel <slot> (loop stopped)` (or
      `(loop is not running)` from the next poll) and no `auto-recycle`.
    - Click **♻** → exactly ONE restart. `aftertask-cancel <slot> (manual restart)`, and no second
      `loop-recycle` in the log afterwards.
    - Let the loop claim another task and finish it with no agent live → exactly ONE recycle
      (`auto-recycle` followed by `aftertask-cancel <slot> (auto-recycle)`), not two.
    - Close the loop's terminal from VSCode's terminal panel while the hold is pending → the hold is
      swallowed, `aftertask-skip <slot> — loop is not running, nothing to restart` at worst; no loop
      is started. Repeat the same four with `afterTask: clear` — a `clear-session` line must never
      appear for a slot with no terminal.

    **Degradation:** stop the loop → the section's rows for that slot vanish at once. With no
    readable session (rename `~/.claude/sessions/` briefly) the log shows
    `agents-read <slot> — could not read this session's subagents` and NOTHING is held back — an
    unreadable path must never block a restart, and must never look like a confident "idle" either.
