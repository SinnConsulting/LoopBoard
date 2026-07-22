# REFACTORING.md — v2.0.0 storage split (`.loopboard/`)

Status: **planned, not started**. This document is the implementation spec. It was written to be
executed by an implementing model phase by phase; read Part 1 fully before touching code, then
work the phases in Part 3 in order. All repo rules in `CLAUDE.md` still apply (Docker-only
toolchain, zero runtime deps, pure modules never import `vscode`, `make check` green before any
commit).

---

## Part 1 — High level (read this first)

### What changes

Today one file, `TODO.md` at the workspace root, holds everything: workflow rules, the
Automation prompt for the loops, and every task with all of its fields (description, worklog,
delivered text, …). That file is large, every loop pass re-reads all of it, and every edit
contends on it.

v2 splits storage into a `.loopboard/` directory:

```
.loopboard/
  TODO.md          # slim task index: one entry per active task, minimum metadata
  DONE.md          # slim index of accepted tasks, newest first (absent until first accept)
  LOOP.md          # workflow rules + loop worker instructions (the old preamble + Automation)
  tasks/
    t-3f9a.md      # one file per task: description, meta, notes, worklog, feedback, delivered
```

- `TODO.md` entry = title, checkbox, `id`, `phase`, `model`, `groomer`, and
  `question:`/`answer:` pairs. **Nothing else.**
- Everything else about a task lives in `.loopboard/tasks/<id>.md` (path derived from id — no
  pointer line in the index).
- On acceptance the index entry moves to `.loopboard/DONE.md`; the task file **stays in place**
  in `tasks/` as browsable history.
- Rules + Automation prose move out of the index into `.loopboard/LOOP.md`; the loop bootstrap
  command points there instead of at TODO.md.
- The board UI keeps all current behavior: columns, field editing, and both human gates
  (tick New → Backlog, accept Review → DONE.md). It composes each card from the index entry
  plus its task file.

### What does NOT change

- The phase workflow (New → Backlog → In Progress → Review → Done, Feedback loop) and every
  Rule's meaning — only where the data lives.
- The store discipline: ALL markdown IO through `src/store.ts`, field-level patches,
  re-read → re-parse → apply one field → serialize → atomic write, same-field conflict → disk
  wins + toast. This now applies per file.
- Human gates stay the only two board-initiated moves; loops still do every other phase move
  by editing `phase:` in place.
- Parse→write→parse fixpoint; unparseable lines preserved verbatim and flagged.
- Zero runtime deps, vanilla webview, Docker-only toolchain.

### Breaking / no migration

This is **v2.0.0**, a breaking release. There is **no migration code and no backward
compatibility**: the extension only recognizes the `.loopboard/` layout. Existing workspaces
must be re-initialized (`LoopBoard: Initialize Workspace` command scaffolds `.loopboard/`);
users port old tasks by hand or discard them. A root `TODO.md` is ignored. Do not write any
"detect old format" code.

---

## Part 2 — Target formats (normative)

### 2.1 `.loopboard/TODO.md` — task index (grammar v4)

Same tolerant-parse / canonical-write model as today. Structure:

```markdown
# TODO

Task index. Detail per task lives in tasks/<id>.md. Rules and loop instructions: LOOP.md.
Completed tasks move to [DONE.md](DONE.md).

## Tasks

- [ ] <Title — single line>
  - id: t-3f9a                          (stable short id; writer assigns if missing)
  - phase: new | backlog | inprogress | feedback | review
  - model: opus | sonnet | fable        (optional; absent = default model)
  - groomer: opus | sonnet | fable      (optional; absent = default model)
  - question: ❓ <text>                   (repeatable, single line; Feedback & New)
    - answer: <text or blank>
```

Rules:

- Fixed key order exactly as above. One `key: value` per sub-bullet.
- **No other keys are canonical.** `owner`, dates, `worklog`, `link`, `depends on`,
  `description`, `note`, `feedback`, `DELIVERED` are NOT valid index keys in v4. If the parser
  meets them (e.g. a loop model wrote one out of habit) they land in `unknownLines`, are
  preserved verbatim, and the board flags the card — same treatment as any unparseable line.
- Draft form unchanged: `- [ ] DRAFT: <raw text>` + `id:` (+ optional `model:`/`groomer:`),
  no `phase:` line.
- Emoji canonicalization unchanged: parser strips leading ❓ from question text, writer
  re-adds it.
- `[x]` semantics unchanged: human-only; `[x]` on New = promote, `[x]` on Review = accept.
- Task file path is **derived**: `.loopboard/tasks/<id>.md`. Never store a path in the index.

### 2.2 `.loopboard/tasks/<id>.md` — task file

Pure content, no frontmatter (metadata authority for phase/model/groomer/title is the index).
Fixed headings, all optional except the H1; parser is tolerant, writer emits canonical order
and omits empty sections:

```markdown
# <Title> (t-3f9a)

## Meta
- owner: @claude | unassigned
- added: YYYY-MM-DD
- started: YYYY-MM-DD
- promoted: YYYY-MM-DD
- completed: YYYY-MM-DD
- link: <url>[, <url>]
- depends on: t-xxxx[, t-yyyy]

## Description
<free markdown, multi-line>

## Notes
- <human instruction to worker; each bullet = one note; worker applies then deletes the bullet>

## Worklog
- YYYY-MM-DD
- YYYY-MM-DD

## Feedback
⚠️ <single change-request text; Review only; removed when addressed>

## Delivered
<free markdown, multi-line; Review only>
```

Rules:

- `## Meta` is the only key:value section; same fixed key order as listed; unknown keys →
  preserved verbatim + flagged.
- H1 title is display-only convenience; the index title wins on divergence (writer rewrites
  the H1 from the index title on every task-file save).
- Unknown headings/content anywhere in the file are preserved verbatim and flagged.
- Fixpoint requirement applies to this format too: `serializeTaskFile(parseTaskFile(x))`
  idempotent as text.
- A missing task file is legal (e.g. a fresh DRAFT before grooming): store treats it as an
  empty task file; the writer creates it on the first patch that targets it. The board renders
  the card from index data alone and shows a "no detail file" hint.
- Feedback keeps the ⚠️ canonicalization (parser strips, writer re-adds).

### 2.3 `.loopboard/DONE.md` — accepted index

Newest-first, same entry shape as TODO.md minus phase/questions, plus `completed:`:

```markdown
# DONE

Accepted tasks, newest first. Detail remains in tasks/<id>.md.

## Tasks

- [x] <Title>
  - id: t-3f9a
  - model: sonnet
  - groomer: opus
  - completed: YYYY-MM-DD
```

- May be absent until the first acceptance; store treats missing as empty (unchanged).
- `completed:` is also written into the task file's `## Meta` at acceptance time.
- Read-only in the UI, as today.

### 2.4 `.loopboard/LOOP.md` — rules + loop instructions

Contains, adapted to the new layout: the workflow diagram and phase definitions, the Rules
list, the format documentation (index grammar + task-file format above), and the fenced
Automation instruction block. This file is what the loop bootstrap prompt points at. The
complete file content is normative and given verbatim in **Appendix A** — Phase 6 ships it
as-is; do not re-author or paraphrase it. For review context, its deltas vs today's TODO.md
prose:

- "TODO.md" → the `.loopboard/` layout; every rule that says "edit field X on the task" now
  names which file X lives in (index vs task file).
- Rule additions: workers create/maintain `tasks/<id>.md`; the accept move (`[x]` on Review)
  = remove entry from index, prepend entry to DONE.md, set `completed:` in the task file's
  Meta, leave the task file in place.
- The reconcile loop reads `LOOP.md` once, `TODO.md` every pass, and opens a `tasks/<id>.md`
  only for tasks it acts on — this is the efficiency win; state it explicitly in the
  instructions.

### 2.5 Scaffolding templates

`media/todo-template.md` is replaced by three templates shipped in `media/`:
`template-todo.md`, `template-loop.md` (task-file skeleton is generated by the writer, no
template needed; DONE.md is created lazily on first accept, no template needed). The known
drift hazard note in CLAUDE.md then applies to `template-loop.md` vs LOOP.md docs.

---

## Part 3 — Implementation phases

Work strictly in order; each phase ends with its verify step green (`make test` for pure
phases, `make check` before any commit). Record notable decisions as one-liners in
`DECISIONS.md` as you go.

### Phase 1 — Model + index parser/writer (pure)

- `src/model.ts`: split `Task` into `IndexEntry` (id, title, checked, isDraft, phase, model,
  groomer, questions, unknownLines, raw) and `TaskDetail` (owner, added, started, promoted,
  completed, worklog, links, dependsOn, description, notes: string[], feedback, delivered,
  unknownLines, raw). A composed `Task = IndexEntry & TaskDetail & { hasDetailFile: boolean }`
  view type keeps `view.ts`/webview shapes stable. `Board` gains `done: IndexEntry[]` and
  **drops `automation`** — loop instructions no longer live in the index (see Phases 3 and 6).
- `src/parser.ts` / `src/writer.ts`: rewrite for grammar v4 (index only). Delete handling of
  the removed keys as canonical fields (they become unknownLines). Preserve section
  heading/extras round-trip behavior for the slim preamble.
- Tests: rewrite `test/parser.test.js` fixtures for v4; keep the HTML-comment-template
  fixture case (task-like lines in comments must not parse); fixpoint + idempotence suite.
- Verify: `make test`.

### Phase 2 — Task-file parser/writer (pure)

- New `src/taskfile.ts` (pure; compiled by `tsconfig.test.json` too): `parseTaskFile(text):
  TaskDetail`, `serializeTaskFile(detail, title, id): string` per §2.2. Tolerant headings
  (case-insensitive match, unknown sections verbatim), canonical order on write, H1 rewritten
  from index title.
- Tests: new `test/taskfile.test.js` — fixpoint, empty file, missing sections, unknown
  sections preserved, meta key order, ⚠️ canonicalization, multi-line description/delivered.
- Verify: `make test`.

### Phase 3 — Store (multi-file IO)

- `src/store.ts` becomes the only module that knows paths: root = `<workspace>/.loopboard/`;
  `TODO.md`, `DONE.md`, `LOOP.md`, `tasks/<id>.md` under it. Missing `DONE.md` = empty
  (unchanged); missing task file = empty detail; missing `.loopboard/` = extension shows the
  init prompt (Phase 7) instead of a board.
- `load(): Board` composes: parse index, parse DONE, for each entry read+parse its task file
  (set `hasDetailFile`).
- Patch API routes by field:
  - index fields (title, phase, checked, model, groomer, question/answer) → patch cycle on
    `TODO.md`;
  - detail fields (owner, dates, links, dependsOn, description, notes, feedback, delivered)
    → patch cycle on `tasks/<id>.md` (create file if absent);
  - the accept gate is the one multi-file operation — see Phase 5.
  Each patch cycle is unchanged in shape: re-read that file from disk, re-parse, apply one
  field, serialize whole file, atomic write (temp + rename), same-field conflict → disk wins
  + toast.
- `src/merge.ts` remains the single home of merge logic and stays pure. Changes:
  - Split `PatchField` by destination: index fields = `title | model | groomer | answer`;
    detail fields = `description | note | feedback`. Export `patchTarget(field): 'index' |
    'detail'` so the store can route. Do not add newly board-editable fields — owner, dates,
    links, depends-on are loop-written only, same as today.
  - `applyPatch(board, patch)` keeps today's base/conflict semantics for the index fields
    (model normalization via `normalizeModel` unchanged). Add `applyDetailPatch(detail:
    TaskDetail, patch: FieldPatch)` with identical base/conflict semantics for detail fields,
    including a `currentDetailFieldValue` analogue of `currentFieldValue`.
  - `note` semantics change with the `## Notes` bullet-list format: the board's note textarea
    edits the whole section as one value, newline-separated. `currentDetailFieldValue('note')`
    joins `notes: string[]` with `\n`; `applyDetailPatch` splits the incoming value on
    newlines, drops empty lines, stores the rest as `notes`.
- Store reads `.loopboard/LOOP.md` raw on each load and exposes it as `store.loopText`
  (empty string if missing) — consumed by `buildLoopCommand` in Phase 6.
- File watcher: watch `.loopboard/**/*.md` (index, DONE, LOOP, task files) and refresh the
  board; keep the existing debounce/refresh-deferral behavior.
- Verify: `make test` (merge changes are pure and unit-tested — extend the existing merge
  tests with detail-patch and routing cases); `make build` compiles; store behavior itself is
  F5-manual (note in VERIFICATION.md, do not claim it done headless).

### Phase 4 — Gates

- `src/gates.ts`:
  - Promote (tick on New): index-only patch — `phase: backlog`, checkbox reset to `[ ]` —
    plus a detail patch setting `promoted: <today>` in the task file's Meta. Two independent
    single-field patches; index first, then detail; a conflict on either follows the normal
    disk-wins rule independently.
  - Accept (tick on Review): (1) detail patch: set `completed: <today>` in Meta; (2) index
    transaction on two files: remove the entry from `TODO.md`, prepend the slim DONE entry
    (§2.3) to `DONE.md`. Order: write DONE.md first, then remove from TODO.md, so a crash
    between the two leaves a duplicate (visible, human-fixable) rather than a lost task.
    Task file is not moved.
  - Delete (the board's existing `delete` gate action → `store.deleteTask`): remove the index
    entry AND delete `tasks/<id>.md` — the task was never accepted, nothing references the
    file. Accepted tasks are never deleted this way (Done is read-only in the UI).
- Store entry points keep their current names — `store.promote`, `store.acceptToDone`,
  `store.deleteTask` — so the `controller.ts` gate wiring stays unchanged apart from toast
  text.
- Tests: gates is pure today — keep it pure by having it return the patch list/descriptions
  and letting store execute them; unit-test the returned patches for both gates.
- Verify: `make test`.

### Phase 5 — View, controller, webview

- `src/view.ts`: build card view-models from composed `Task`; add `hasDetailFile` flag and
  the unknown-lines flags per source file. `computeBadge` keeps its semantics (new incl.
  drafts + unanswered-feedback + review) — questions come from the index entry, `feedback`
  from the composed detail. The dependency-met check now looks up ids in `done:
  IndexEntry[]`.
- `src/controller.ts`: map webview messages to the new store patch routes. Message names can
  stay; only routing changes. The two gate buttons call the Phase 4 gate flows.
- `media/board.js` / `board.html` / `board.css`: card detail (description, worklog, notes,
  delivered, meta) now comes from task-file data in the same board payload — the webview does
  no IO, so changes are limited to: which patch message each field emits (unchanged names,
  routing is host-side), the "no detail file" hint, and per-file flag badges. Keep the
  focused-field refresh deferral (`pendingBoard`) and the `default (opus)` → `''` model
  normalization exactly as they are.
- `media/sidebar.*`: unchanged except any label that names a path.
- Verify: `make check`; full behavior via the F5 manual checklist (Phase 8).

### Phase 6 — Loop command + LOOP.md content

- Create `media/template-loop.md` with EXACTLY the content of Appendix A (it is normative —
  copy it, do not re-author or paraphrase). Create `media/template-todo.md` with exactly the
  content of Appendix B. Delete `media/todo-template.md` (replaced; its scaffold hook is
  reworked in Phase 7).
- `src/loop.ts` (`buildLoopCommand`): signature becomes
  `buildLoopCommand(loopText: string, model: Model, interval: string): string | undefined`
  taking `store.loopText` (Phase 3) instead of `Board`. LOOP.md contains several fenced
  blocks (layout, workflow, grammars), so DO NOT reuse the current first-fence regex: first
  slice the text from the `## Automation` heading to the next `## ` heading or EOF, then
  require a fenced block inside that slice; no block → return `undefined` (caller warns,
  unchanged). The returned prompt is exactly:
  `/loop <interval> You are running as model <model>. Open .loopboard/LOOP.md, read the loop
  worker instructions in its Automation section, and follow them exactly for this and every
  pass.`
  It contains no apostrophes; the short-argv `'\''`-escaping constraint from CLAUDE.md's
  terminals learning still applies — do not grow the prompt.
- Tests: update `test/` loop-command expectations; add a case with a fenced block before
  `## Automation` proving the wrong fence is not picked.
- Verify: `make test`.

### Phase 7 — Activation, init command, packaging

- `package.json`: version `2.0.0`; activation `workspaceContains:.loopboard/TODO.md`; register
  command `loopboard.init` ("LoopBoard: Initialize Workspace").
- Rework the existing scaffold path instead of adding a parallel one:
  `Controller.onCreateFiles` (`src/controller.ts`) currently reads `media/todo-template.md`
  and calls `store.createInitialFiles(todoText, doneText)` to write root `TODO.md` +
  `DONE.md`. Change it to read `media/template-todo.md` + `media/template-loop.md` and call
  the reworked `store.createInitialFiles`, which now writes `.loopboard/TODO.md` +
  `.loopboard/LOOP.md` and creates the empty `.loopboard/tasks/` dir — no DONE.md (created
  lazily on first accept), no root files ever. If `.loopboard/` already exists it must refuse
  (return false, show a message) — never overwrite. Keep the webview `createFiles` message
  wired to this method (the board's `todoMissing` empty-state button), and have the
  `loopboard.init` command call the same method. Update the success toast text.
- Config reset: existing `loopBoard.*` settings keys keep their names unless a phase above
  forced a change; the breaking part is the storage layout, not settings. If any key must
  change, list it in README under "v2 breaking changes".
- `.vscodeignore`: unchanged scope (out/ + media/ + manifest/README); confirm templates ship.
- README: rewrite storage section; add a "v2 is breaking — re-initialize your workspace"
  callout.
- Verify: `make check` (includes `vsce package --no-dependencies`).

### Phase 8 — Docs + manual verification

- Update `CLAUDE.md` (paths, grammar version, template names), `DECISIONS.md` (one-liners for
  the §2 decisions), `VERIFICATION.md` (new F5 checklist below).
- F5 manual checklist additions (cannot be run headless — say so, never claim done):
  1. Fresh empty workspace → init command scaffolds `.loopboard/`, board opens empty.
  2. Add a draft on the board → index entry appears, no task file yet, card hints "no detail".
  3. Edit description on the card → `tasks/<id>.md` created with only Description.
  4. External edit to a task file while its card field is focused → deferred refresh, no
     clobber; same-field concurrent edit → disk wins + toast.
  5. Tick New → phase backlog in index, `promoted:` in task file.
  6. Tick Review → entry gone from TODO.md, on top of DONE.md, `completed:` in task file,
     task file still present.
  7. Spawn a loop terminal → command references `.loopboard/LOOP.md`, submits after boot.
  8. Root-level legacy `TODO.md` present → ignored entirely.

### Out of scope (do not build)

- Any migration/import of v3 root TODO.md files.
- Task-file frontmatter, per-task subdirectories, or non-markdown storage.
- Moving/deleting task files on acceptance.
- New board features beyond re-wiring existing ones to the split storage.

---

## Appendix A — `media/template-loop.md` (= scaffolded `.loopboard/LOOP.md`), verbatim

Everything between the outer four-backtick fence is the file content, byte for byte.

````markdown
# LOOP — LoopBoard workflow and loop worker instructions

All paths are relative to the workspace root. This file is the standing instructions for loop
workers; it is re-read every pass, so editing it changes every running loop's next pass — no
restart needed. This file is executable instructions: treat it as trusted input.

## Storage

```
.loopboard/
  TODO.md        # task index — one slim entry per active task (grammar below)
  DONE.md        # accepted tasks, newest first (may be absent until the first acceptance)
  LOOP.md        # this file
  tasks/<id>.md  # per-task detail: meta, description, notes, worklog, feedback, delivered
```

Read economy: read this file and `TODO.md` every pass; open a `tasks/<id>.md` only for tasks
you act on, and create it (canonical headings below) the first time you write to it.

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
- **Done** — accepted; index entry lives in `DONE.md`; task file stays in `tasks/`.

## Task index format (v4) — `.loopboard/TODO.md`

Entry = checkbox line + `key: value` sub-bullets, one per line, fixed order below, and NOTHING
else — all other task data belongs in the task file. Phase = the `phase:` field; move a task
by editing it in place — never cut/paste an entry (acceptance, Automation step 2, is the only
removal). The LoopBoard extension parses tolerantly, rewrites canonical form on save, and
preserves unrecognized lines verbatim (flagged).

```
- [ ] <Title — single line>
  - id: t-3f9a                          (stable short id; assigned if missing)
  - phase: new | backlog | inprogress | feedback | review
  - model: opus | sonnet | fable        (optional; absent = default model; Rule 15)
  - groomer: opus | sonnet | fable      (optional; absent = default model; Rule 14)
  - question: ❓ <text>                   (repeatable, single line; Feedback & New)
    - answer: <text or blank>
```

Draft = `- [ ] DRAFT: <raw text>` + `id:` (+ optional `model:`/`groomer:`; no `phase:` line —
drafts are implicitly new); the groomer expands it (Rule 14).

## Task file format — `.loopboard/tasks/<id>.md`

Fixed headings in the order below; every section optional; omit empty sections. `## Meta` is
the only `key: value` section (fixed key order as shown). The index owns title, phase,
`model:`, `groomer:` and questions — never duplicate them here.

```
# <Title> (t-3f9a)

## Meta
- owner: @claude | unassigned
- added: YYYY-MM-DD
- started: YYYY-MM-DD
- promoted: YYYY-MM-DD
- completed: YYYY-MM-DD
- link: <url>[, <url>]
- depends on: t-xxxx[, t-yyyy]

## Description
<free markdown; the groomed story lives here>

## Notes
- <human instruction to worker; apply then delete the bullet — Rule 16>

## Worklog
- YYYY-MM-DD

## Feedback
⚠️ <change request; Review only; removed when addressed — Rule 13>

## Delivered
<free markdown; Review only>
```

## Done index — `.loopboard/DONE.md`

Newest-first `## Tasks` list of `- [x] <Title>` entries with `id:`, `model:`, `groomer:`,
`completed:` sub-bullets only. Create the file (with `# DONE` heading + `## Tasks` section)
on first use. Detail remains in `tasks/<id>.md`.

## Rules

1. `[x]` belongs to the human only; a worker never ticks it. `[x]` on New = promote to
   Backlog. `[x]` on Review = accepted → DONE.md (procedure in the Automation block). Workers
   perform all other phase moves and propose.
2. One worker per task. `owner:` lives in the task file's Meta. Missing owner line or
   `owner: unassigned` → claim: set `owner: @you` + `started: <today>` in the task file and
   `phase: inprogress` in the index. Owned by another, or present in DONE.md → do not start a
   parallel copy.
3. Dates live in the task file's Meta: `added:` entered tracker; `started:` work began;
   `promoted:` New → Backlog; `completed:` acceptance. Append `<today>` to `## Worklog` each
   active day.
4. Index entries: one `key: value` per sub-bullet, fixed order, no extra keys — everything
   else belongs in the task file. Task files: fixed headings, canonical order. Move = edit
   `phase:` in place; never cut/paste.
5. Grooming ≠ approval: editing a New task's text is allowed; leaving New requires Rule 1.
6. Unsure → set `phase: feedback` and add `question: ❓ <text>` sub-bullets (each with its own
   `- answer:` beneath) on the INDEX entry — questions stay in the index so the board can
   surface them without opening task files. Stop working the task; resume gated by Rule 10.
7. All changes deliver via PR; never commit to `main`. Record the PR in the task file's
   `link:` before setting `phase: review`. A Review task without a PR link is incomplete.
8. Prefix `question:` with ❓ (index) and the `## Feedback` text with ⚠️ (task file).
9. git worktrees forbidden (they break pre-commit hooks assuming `.git` is a directory;
   `--no-verify` forbidden). Use the normal checkout: fetch latest `main`, branch off `main`,
   commit, open the PR from there (Rule 7).
10. Resume a Feedback task only when EVERY `question:` on its index entry has a filled
    `answer:`. Any blank answer → leave it parked; do none of its work.
11. Set `phase: inprogress` (index) plus `owner:`/`started:` (task file) BEFORE any work or
    research on a task — never investigate a task still in New/Backlog/Feedback.
12. No stranded work: every change from working a task ends in a PR (draft PR if unfinished)
    with its link in the task file before the session ends.
13. A Review task's `## Feedback` section = change request, not a gate. Unaddressed → move to
    In Progress, address, return to Review with `## Delivered` updated and the Feedback
    section removed. `[x]` on Review still = accepted → DONE.md.
14. New/DRAFT grooming is routed by `groomer:` (absent = default model): the loop whose model
    matches `groomer:` owns it and delegates to a subagent (Agent tool) of that groomer
    model — never inline in the main loop. The subagent expands the story into the task
    file's `## Description` (creating `tasks/<id>.md` if missing) and keeps the index title
    one short line. Human decisions = single-line `question: ❓` sub-bullets with blank
    `answer:` lines on the index entry (never an "OPEN QUESTIONS" prose paragraph) so the
    board can surface them. A New task with any filled `answer:` → re-groom via the same
    subagent: incorporate the answer, fold the decision into `## Description`, delete the
    resolved `question:`/`answer:` pair from the index (mirrors Rule 16). A still-present
    filled answer = not yet incorporated. `model:` never gates grooming.
15. Claim tasks by `model:` (Backlog onward; absent = default model). Never claim a task
    whose `model:` names a different model. New-phase routing uses `groomer:` instead
    (Rule 14).
16. Honor `## Notes` bullets (human instructions): apply, append `<today>` to `## Worklog`,
    delete the bullet. A lingering Notes bullet = not yet applied.

Legend: `[ ]` awaiting the human's gate · `[x]` human approved.

## Automation

Loop workers (Claude Code sessions in the workspace root) re-read this file and the index,
reconcile, and pick up work every pass. The extension spawns one loop terminal per model as a
single command — `claude --permission-mode auto --model opus '/loop 1m You are running as
model opus. Open .loopboard/LOOP.md, read the loop worker instructions in its Automation
section, and follow them exactly for this and every pass.'` — so the fenced block below IS
the standing instructions; editing it changes every running loop's next pass, no restart
needed (only the interval is fixed at spawn time).

```
Re-read .loopboard/TODO.md (the task index) and reconcile it against the Rules in .loopboard/LOOP.md. A task's phase is its `phase:` field in the index — edit it in place; never cut/paste an entry. Task detail lives in .loopboard/tasks/<id>.md; open a task file only for tasks you act on, and create it with the canonical headings on first write. (1) For each New task the user ticked [x]: set `phase: backlog` and reset to [ ] in the index; set `promoted: <today>` in the task file's Meta. (2) For each Review task the user ticked [x]: set `completed: <today>` in the task file's Meta, add a [x] entry at the TOP of .loopboard/DONE.md's task list with its id/model/groomer and `completed: <today>` (DONE.md is newest-first, matching the board's Accept button; create it with a `## Tasks` section if absent), then delete the entry from the index; the task file stays in tasks/. (3) Append <today> to the ## Worklog of every task you touch. (4) For each Feedback task where EVERY index question has an `answer:`: move it back to In Progress and continue it; leave any task with a blank answer untouched (Rule 10). (5) For each Review task you own whose task file has an unaddressed ## Feedback section: move it back to In Progress, address it, return it to Review with an updated ## Delivered and the Feedback section removed (Rule 13). (6) Apply and then delete any ## Notes bullet on a task you own (Rule 16). (7) If a referenced path/file/PR/dependency changed since a task was written, update the task file to match reality and log the correction in its Worklog. Then START WORKING: if nothing is In Progress for your model, claim the top Backlog task whose `model:` is yours — or has no `model:`, if you are the default model (Rule 15) — and whose `depends on:` (task file Meta) are satisfied: set `owner: @claude`, `started: <today>` and a worklog entry in its task file, set `phase: inprogress` in the index, and execute it; when finished, open a PR (Rule 7), record its link in the task file's Meta, write ## Delivered, and set `phase: review`. If unsure how to proceed, set `phase: feedback` with index `question:` sub-bullets and stop — never guess. New tasks and DRAFTs are routed by `groomer:`, NOT `model:` (Rule 14): if a New task's `groomer:` matches your model — or it has none and you are the default model — groom it with a subagent of that groomer model, expanding the story into the task file's ## Description and recording human decisions as single-line index `question:` sub-bullets with blank `answer:` lines (not OPEN QUESTIONS prose); when such a task has any filled `answer:`, re-groom it the same way, fold each incorporated decision into ## Description, and delete the resolved pair from the index — a still-present filled answer means not yet incorporated. Never touch a New task whose `groomer:` names a different model, never promote New tasks yourself (leaving New needs the human's [x], Rule 1). Respect one worker per task: never touch a task owned by someone else or (outside of New) one whose `model:` names a different model, and never tick [x] yourself. Report what changed and what you worked on, referring to every task by its full title — never by its bare id (add the id in parentheses only for disambiguation); if there is nothing to do, reply "no changes".
```

Notes:
- The interval comes from `loopBoard.loopInterval` (default 1m) and rides in the spawn
  command, so changing it means recycling the terminal — everything else above is re-read
  live each pass.
- Human gates hold: loops never promote New tasks or accept Review tasks (both need the
  human's `[x]`) and park uncertainty in Feedback. The extension's ▶ buttons start the
  per-model loops.
- Stop a loop via its status line, or cancel the scheduled task in the session.
````

## Appendix B — `media/template-todo.md` (= scaffolded `.loopboard/TODO.md`), verbatim

````markdown
# TODO

Task index. One slim entry per active task; detail lives in `tasks/<id>.md`. Rules, formats,
and loop worker instructions: [LOOP.md](LOOP.md). Accepted tasks move to [DONE.md](DONE.md).

Entry = checkbox line + `id:`/`phase:`/`model:`/`groomer:` (+ `question:`/`answer:`)
sub-bullets only — full grammar in LOOP.md. Legend: `[ ]` awaiting your gate · `[x]` you
approved.

## Tasks

_(none)_
````
