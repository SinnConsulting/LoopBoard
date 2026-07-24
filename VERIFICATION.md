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

### Index parser/writer — `test/parser.test.js` (grammar v4)
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
  preserved + flagged (fixpoint holds); ⚠️ canonicalization (parser strips, writer re-adds once).

### Merge routing + patches — `test/merge.test.js`
- `patchTarget` routes title/model/groomer/answer → index, description/note/feedback → detail.
- `applyPatch` (index) and `applyDetailPatch` (detail) keep disk-wins conflict semantics; answer
  patch targets the right question; model `default (opus)` clears the field; unknown id → notfound.
- `note` edits the whole `## Notes` section: newline-split, empties dropped → `notes: string[]`;
  clearing empties the section.

### Gates — `test/gates.test.js`
- `promoteIndex` (phase→backlog, uncheck), `promoteDetail` (`promoted:` + worklog, no dup),
  `acceptDetail` (`completed:` + worklog), `acceptDoneEntry` (slim DONE entry, no questions).

### View — `test/view.test.js`
- `computeBadge` = new (incl DRAFTs) + unanswered-feedback + review; dependency marked met when
  its id is in `done: IndexEntry[]`; `hasDetailFile` flows through; `note` derives from `notes[]`;
  DONE cards render from the slim IndexEntry (no composed detail).

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
2. **Draft:** add a draft on the board → an index entry appears in `.loopboard/TODO.md`, no task
   file yet, the card hints "No detail file yet".
3. **First detail edit:** edit the description on a card → `.loopboard/tasks/<id>.md` is created
   with only a `## Description` section (H1 from the index title).
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

Pre-v2 board behaviors (read-only render + live refresh, edit/gates/merge toasts, sidebar badge,
loop spawn/recycle/stop, icon rendering in light/dark themes) still require the same F5 walkthrough
and likewise cannot be verified headless.
