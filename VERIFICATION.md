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
