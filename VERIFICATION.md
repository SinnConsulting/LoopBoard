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
14. **Filter clears on navigation, survives reload (t-2452, reversed by t-3d42):** type a plain-text
    filter while on one phase tab, then click through New / Backlog / In Progress / Review /
    Feedback / Done via the board tab strip — each click lands on that tab's FULL, unfiltered card
    list with an empty search box (no more carrying the query across tabs). Reload the VS Code
    window (or switch away and back so the webview is recreated) with a query typed and NOT yet
    navigated away — the query and its phase are still there after reload (persistence is
    unchanged); the next phase-tab click then clears it as usual. Click a sidebar attention row
    that installs a query (e.g. "N unanswered questions") — it lands on that phase WITH that exact
    query in the search box, replacing any previous one. Click "N tasks awaiting review" or any
    sidebar PHASES row — it lands on that phase with an EMPTY search box, even if a filter was
    previously active (this was the actual persistence gap the earlier t-2452 fix targeted; it is
    now intentionally reversed). Click "N proposals to approve" — it lands on New with
    `is:proposal` in the search box, showing only groomed (non-DRAFT) proposals, card count
    matching the row; "N drafts will be groomed" (t-1cdb) still shows exactly the DRAFTs via
    `is:draft`. Revealing a specific task via a dependency chip (`task:<id>`) still installs that
    query since it's explicit. Opening the New Story composer, or clicking Cancel/Save Draft to
    close it, still clears the filter as before. The search bar shows a `×` clear button only while
    a query is active; clicking it empties the box and restores the full list.
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

Pre-v2 board behaviors (read-only render + live refresh, edit/gates/merge toasts, sidebar badge,
loop spawn/recycle/stop, icon rendering in light/dark themes) still require the same F5 walkthrough
and likewise cannot be verified headless.
