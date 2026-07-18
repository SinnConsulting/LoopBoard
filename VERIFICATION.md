# Verification

All toolchain commands ran inside Docker (`node:22`) via `make`; nothing was installed on the
host. Clean-checkout run from `make clean`:

```
make install   -> added 2 packages (typescript, @types/vscode) — 0 vulnerabilities
make build     -> tsc -> out/ (clean, no errors)
make test      -> 26 tests, 26 pass, 0 fail
make package   -> loopboard-0.1.1.vsix (27 files, 47.34 KB)
```

## Automated (executed here, in Docker)

### M1 — Parser + writer (round-trip / fixpoint)
`make test` (`node --test`) covers, over three fixtures (`real-todo-v1.md`, `v2-full.md`,
`unknown-lines.md`):
- **Text idempotence:** `serialize(parse(serialize(parse(x)))) === serialize(parse(x))`.
- **Board fixpoint:** parse→write→parse yields a deep-equal task list.
- **Nothing lost on the real v1 file:** Rules text, the `/loop` block, and both HTML-comment
  templates (which contain task-like `- [ ]` lines) survive verbatim.
- **Unknown lines** preserved verbatim and flagged (`t-ff01`: 3 unknown sub-bullets).
- **Two questions, one answered** parsed correctly; **ids assigned** to id-less tasks on write;
  **DRAFT** tasks serialize to id + added only; **DONE.md** round-trips.
- Regression: an HTML comment following a real task is not mis-parsed as a task.

**MUST NOT FORGET:** `media/todo-template.md` (the file `onCreateFiles` in `src/controller.ts`
writes as a fresh workspace's initial `TODO.md`) encodes the same grammar — Workflow, Task format,
Rules, and the Automation `/loop` block — but with an empty `## Tasks` section. Any change to the
task grammar/phase structure in `TODO.md`'s own docs (e.g. the v2→v3 move to a flat `## Tasks`
section with a `phase:` field, replacing per-phase headings) must be mirrored here too, or new
workspaces get scaffolded with a stale format. `test/parser.test.js` only checks the template
parses to zero tasks and round-trips as a fixpoint — it does NOT check the template's prose is
current, so this has to be done by hand on every structural change.

### M2 — Migration
`TODO.md` was rewritten to v2 (Rules documenting id/description/note/model routing; Automation
holding the `{MODEL}` fenced loop with note handling). Test asserts the migrated `TODO.md` parses
with **zero unknown lines** and is a serialization fixpoint, and that `{MODEL}`, the model-routing
rule, and the note-handling rule are present.

### M4 — Gates + merge (pure logic)
- `applyPatch`: applies a field with no conflict; **same-field conflict** (disk ≠ rendered base)
  is rejected; answer patch targets the right question; unknown id → notfound.
- **Concurrent-write survival:** a patch to task A leaves a loop's concurrent worklog change on
  task B intact (because every save re-reads and re-parses disk before applying the one field).
- `promote` moves New→Backlog with `promoted:` + worklog and resets the checkbox; `accept` cuts
  the Review task and returns a completed `[x]` entry for DONE.md.

### M5 — Badge
`computeBadge` = new (incl DRAFTs) + unanswered-feedback + review; answering the last question
drops the feedback contribution; `toWebviewBoard` marks a dependency met when its id is in DONE.

### M6 — Loop command
`buildLoopCommand` extracts the Automation fenced block, substitutes `{MODEL}`, and rewrites the
leading `/loop <interval>` to the configured interval; returns `undefined` when no fenced block.

### Data-pipeline smoke (parse → webview payload)
`parse(v2-full.md)` → `toWebviewBoard` produced: `new=2 inprogress=1 feedback=2… ` (correct after
the comment-parsing fix: `feedback=1`), `badge={count:4,new:2,feedbackUnanswered:1,review:1}`,
questions `[answered,unanswered]`, review DELIVERED + pending feedback, unmet dependency chip,
and the DRAFT card — confirming the extension→webview contract is well-formed.

## Manual — Extension Development Host (F5)

**Not executed in this environment** (this is a headless agent session with no interactive VS Code
GUI). The steps below are the intended walkthrough; run them in a desktop VS Code by opening this
folder and pressing **F5**. To see a populated board, temporarily copy a fixture over the (empty)
tracker: `cp test/fixtures/v2-full.md TODO.md` (revert with git afterward).

- **M3 — Read-only render + live refresh:** Open the board (activity-bar clipboard → **Open
  Board**, or `LoopBoard: Open Board`). Expect the left rail with all six phases + counts +
  amber attention dots on New/Feedback/Review, the Loops section, and task cards per phase; the
  Done phase renders read-only rows from `DONE.md`. Edit `TODO.md` in a text editor and save →
  the board refreshes within ~1 s (changed cards flash).
- **M4 — Edit + gates + merge:** Type an answer under a Feedback question and blur → it lands in
  the file's `answer:` line (border flashes "saved"). Tick a **New** task → it moves to Backlog
  with a `promoted:` date. Tick a **Review** task → inline "Accept and archive to DONE.md?" →
  Accept → the task is cut from `TODO.md` and appended to `DONE.md`. To see the conflict toast:
  start editing a description, change that same task's description in the file and save, then blur
  → amber toast "task changed on disk … not applied" with a **Review** action that highlights the
  card.
- **M5 — Sidebar + badge:** The activity-bar badge shows the attention count; the sidebar lists
  "N unanswered question(s) — Feedback", "N awaiting review", "N proposal(s) to approve", each
  click revealing that phase in the board. Add an unanswered question in the file → badge
  increments; answer it in the board → it clears.
- **M6 — Loop terminals:** Click **Opus ▶** → a terminal `Claude Opus` opens in the workspace
  root and runs `claude --model opus --permission-mode auto '<loop prompt>'` — the `/loop` line
  (with `{MODEL}`→opus) is passed as the CLI's initial prompt argument and submitted by the REPL
  itself (TUI keystroke injection proved unfixably flaky and was removed). A second ▶ focuses the
  existing terminal instead of duplicating. **♻** disposes and respawns it, re-arming the loop.
  With `autoRecycle` on, when a model's task leaves In Progress and it has no other In Progress
  task, its terminal is recycled.
- **Logo icon rendering (t-027d):** The activity-bar icon (`media/icon.svg`, now the LoopBoard
  glyph) needs a visual check in both light and dark VS Code themes for contrast/legibility at
  24px — a headless loop cannot verify this. Also confirm the panel tab icon (same file, via
  `src/panel.ts`) renders correctly.
- **DRAFT card readability (t-6d4c):** A DRAFT card in the New column should read like a normal
  card — a "Draft" badge/label row on top, then the raw draft text as left-aligned body copy
  (not one long italic centered blob), followed by the "Groom with" select and the added date.
  Verify a long draft (e.g. the open-vsx one) wraps as readable body text and that clicking it
  still opens the inline edit textarea.
