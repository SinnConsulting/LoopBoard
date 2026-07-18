# LoopBoard — Implementation Plan

A VSCode extension that renders the workspace's `TODO.md` as an interactive board,
writes edits back to the markdown, and spawns model-specific Claude Code loop terminals.

## Decisions (resolved in grilling session, 2026-07-10)

| Topic | Decision |
|---|---|
| Platform | VSCode extension: TypeScript extension host + webview with **vanilla HTML/CSS/JS** (no frameworks, no runtime npm deps) |
| Toolchain policy | **Node.js AND every other package/tool/dependency MUST be installed and run inside Docker containers only — nothing is ever installed on the host** (no npm, brew, pip, apt, etc.). All tooling (`npm install`, `tsc`, tests, `vsce package`) runs via `docker run node:22`; tools missing from that image get their own image, not a host install. Host assumes only Docker, `make`, git, and VSCode. Unavoidable exception: the packaged extension executes in VSCode's own built-in extension-host Node runtime — that is VSCode itself, not a host install |
| Scope | Operates on `TODO.md` / `DONE.md` in the **root of the open workspace folder** |
| Source of truth | `TODO.md` stays markdown; format is **tightened** (strict `key: value` sub-bullets) |
| Enforcement | Extension parses tolerantly, **writes back canonical format on every save**; unparseable lines preserved verbatim and flagged in the UI |
| Concurrency | File watcher live-refreshes the board; on save, **field-level merge** against the current file on disk |
| Model routing | Optional `model: opus\|sonnet\|fable` per task; **no field = default (opus)** |
| Story creation | Board appends raw text as a `DRAFT:` task in New; the **existing loop's Opus subagent grooms it** (Rule 14) — no agent plumbing in the extension |
| Entry point | Activity-bar icon → slim **sidebar summary** (counts + attention items); board opens as a **full editor-tab webview** |
| Gate moves | Ticking `[x]` in the board **performs the move immediately** (New→Backlog, Review→DONE.md); the loop's reconcile becomes a fallback |
| Attention badge | Counts: Feedback tasks with unanswered questions + Review tasks + New tasks awaiting promotion |
| Done column | Read-only, rendered from `DONE.md` (newest first, capped at 50) |
| Loop prompt | Template lives in `TODO.md`'s **Automation section** with a `{MODEL}` placeholder; extension substitutes and injects |
| Terminals | **Plain VSCode terminals, one per model** (`Claude Opus` / `Claude Sonnet` / `Claude Fable`) via `createTerminal` + `sendText`. Reuse + focus if it exists; running/stopped dot in the board. Zero external deps; loops die with the VSCode window (restart = one click, lossless since state is in TODO.md). tmux is the v2 upgrade path behind `terminals.ts` if persistence/output-reading is ever needed |
| Session recycle | ♻ **Clear button per model** = `terminal.dispose()` + respawn with fresh loop (lossless — state lives in TODO.md). **Auto-recycle**: when the file watcher sees a task owned by model X leave In Progress (→ Review/Feedback-resolved) and nothing else is In Progress for X, recycle its terminal so each task starts with fresh context |
| Terminal cwd | Workspace root (the directory VSCode was started in) |
| Permission mode | `--permission-mode auto` by default (confirmed valid in installed CLI); overridable via setting `loopBoard.permissionMode` |

---

## 1. Tightened TODO.md format (v2 spec)

### Task grammar

```
- [ ] <Title — single line>
  - id: t-3f9a
  - owner: @claude | unassigned
  - model: opus | sonnet | fable        (optional; absent = default)
  - added: YYYY-MM-DD
  - started: YYYY-MM-DD                  (optional)
  - promoted: YYYY-MM-DD                 (optional)
  - worklog: YYYY-MM-DD, YYYY-MM-DD      (optional)
  - link: <url>[, <url>]                 (optional)
  - depends on: t-xxxx[, t-yyyy]         (optional)
  - description: <free text, may wrap onto further indented lines>
  - note: <human instruction to the worker — free text>   (optional)
  - question: ❓ <text>                   (repeatable)
    - answer: <text or blank>
  - feedback: ⚠️ <text>                   (Review only, optional)
  - DELIVERED: <text>                     (Review only)
```

Rules of the grammar:

- **One key per line, fixed order** as listed above. Unknown keys/lines are preserved
  verbatim at the end of the task and flagged in the UI ("unrecognized line").
- **`id:` is new.** Stable short id (`t-` + 4 hex chars) assigned by the canonical writer
  if missing. It is the merge/identity anchor — titles may be edited freely.
- **`description:` is new** (today the title carries everything). Multi-line via
  continuation lines indented 4 spaces under the key.
- **`note:` is the "open text to ask questions / modify the story" field** from the UI.
  The loop prompt gains one instruction: *honor `note:` lines — apply the instruction,
  record it in the worklog, then remove the note.*
- Section headings unchanged: `## New`, `## In Progress`, `## Feedback`, `## Backlog`,
  `## Review` (+ `_(none)_` placeholder when empty). HTML comment blocks are preserved verbatim.
- Draft tasks created from the board: `- [ ] DRAFT: <raw text>` + `id` + `added` only;
  the loop's groomer expands them into full stories.

### One-time migration (part of this project, not the extension)

- Rewrite the **Rules** section: document the v2 grammar, `id:`, `description:`, `note:`,
  and `model:` routing ("claim tasks whose `model:` matches yours; tasks without `model:`
  belong to the default model, currently opus").
- Rewrite the **Automation** section to hold the loop prompt as a fenced block with a
  literal `{MODEL}` placeholder, e.g.:

  ```
  /loop 1m You are running as model {MODEL}. Re-read TODO.md ... claim the top Backlog
  task whose `model:` is {MODEL} (or has no model: field, if {MODEL} is the default
  model per the Rules) and whose depends-on are satisfied ...
  ```

- Existing gate rules unchanged; the extension performing New→Backlog / Review→DONE.md
  moves is compatible (loop steps 1–2 simply find nothing to do).

---

## 2. Extension architecture

```
loopboard/
├── package.json              # manifest: views, commands, badge, settings, activation
├── tsconfig.json
├── src/
│   ├── extension.ts          # activate(): wire everything
│   ├── model.ts              # Task/Board type defs
│   ├── parser.ts             # TODO.md + DONE.md → Board (tolerant)
│   ├── writer.ts             # Board → canonical markdown (strict)
│   ├── store.ts              # load/save/merge/watch; single owner of file IO
│   ├── gates.ts              # promote(), accept() move logic
│   ├── terminals.ts          # spawn/reuse/status of model terminals + loop injection
│   ├── sidebar.ts            # WebviewViewProvider for the activity-bar summary
│   └── panel.ts              # WebviewPanel for the full board
├── media/
│   ├── board.html            # static shell (CSP nonce placeholders)
│   ├── board.css
│   ├── board.js              # vanilla JS: render, edit, postMessage protocol
│   ├── sidebar.html/.css/.js
│   └── icon.svg
└── test/
    ├── parser.test.ts        # round-trip fixtures
    └── fixtures/*.md
```

- **Zero runtime dependencies.** devDependencies only: `typescript`, `@types/vscode`.
  No bundler needed at this size (`tsc` → `out/`).
- **Dockerized toolchain (MUST — nothing installed on the host).** Every Node
  invocation goes through Docker, e.g. `docker run --rm -v "$PWD":/app -w /app
  node:22 npm ci` / `npx tsc` — and the same applies to any other package manager or
  tool (no brew/pip/apt installs on the host; a missing tool gets a dedicated image).
  Provide a `Makefile` (or shell scripts) wrapping these so no one types `npm` on the
  host by accident. Consequence: parser/writer unit tests run as plain Node tests in
  the container (`node --test`), not via `@vscode/test-electron` (which needs a GUI
  VSCode download — drop it; extension-host behavior is verified manually per the
  milestone checks). Local debugging still uses VSCode's F5 Extension Development Host,
  which runs on VSCode's bundled runtime, not a host Node install.
- All markdown IO goes through `store.ts` so merge logic exists in exactly one place.

### package.json contributions

- `viewsContainers.activitybar`: `loopboard` container (icon = clipboard/kanban svg).
- `views`: one `webviewView` (`loopBoard.sidebar`) in that container.
- `commands`: `loopBoard.openBoard`, `loopBoard.spawnLoop` (arg: model),
  `loopBoard.refresh`.
- `configuration`:
  - `loopBoard.permissionMode`: `auto` (default) | `acceptEdits` | `bypassPermissions` | `dontAsk` | `default` | `plan`
  - `loopBoard.defaultModel`: `opus` (default) | `sonnet` | `fable`
  - `loopBoard.loopInterval`: string, default `1m`
  - `loopBoard.autoRecycle`: boolean, default `true` (recycle a model's terminal after it completes a task)
  - `loopBoard.startupDelayMs`: number, default `3000` (wait before injecting `/loop` into a fresh claude REPL)
- `activationEvents`: `workspaceContains:TODO.md` + the view/commands.

### Data model (`model.ts`)

```ts
type Phase = 'new' | 'backlog' | 'inprogress' | 'feedback' | 'review' | 'done';
interface Question { text: string; answer: string; }
interface Task {
  id: string; title: string; phase: Phase; checked: boolean;
  owner?: string; model?: 'opus'|'sonnet'|'fable';
  added?: string; started?: string; promoted?: string;
  worklog: string[]; links: string[]; dependsOn: string[];
  description?: string; note?: string;
  questions: Question[]; feedback?: string; delivered?: string;
  unknownLines: string[];        // preserved verbatim, flagged in UI
  raw: string;                   // original block, for conflict detection
}
interface Board { preamble: string; tasks: Task[]; automation: string;
                  done: Task[];   /* from DONE.md, read-only */ }
```

### Save & merge protocol (`store.ts`)

1. Webview sends a **field-level patch**: `{ taskId, field, value }` (or a gate action,
   or `createDraft`), never the whole board.
2. Extension re-reads `TODO.md` from disk, re-parses, locates the task by `id:`
   (fallback: exact title match for pre-migration tasks, assigning an id on write).
3. Applies the patch to that fresh parse; serializes the **entire file** canonically;
   writes atomically (write temp file in same dir, rename over).
4. Conflict rule: if the *same field of the same task* differs from what the webview
   last rendered, the disk value wins and the board shows a toast
   ("Task changed on disk — your edit to X was not applied; review and retry").
   Different fields / different tasks merge silently.
5. Task not found by id or title → patch rejected with a toast + refresh.

### File watching

- `createFileSystemWatcher('**/TODO.md')` + one for `DONE.md`, workspace root only.
- Debounce 300 ms → re-parse → `postMessage({type:'board', board})` to sidebar + panel,
  recompute badge. Self-writes are indistinguishable from loop writes — that's fine,
  the refresh is idempotent.

### Attention badge

- `webviewView.badge = { value: n, tooltip }` where
  `n = feedbackUnanswered + reviewCount + newCount` (excluding DRAFTs still ungroomed?
  → **include** them; they still await a human eventually, and excluding needs a heuristic).
- Sidebar lists the individual items grouped by phase, each clickable → opens board
  scrolled to that task. This is the "blinking icon that tells you where to look"
  equivalent (VSCode has no blink API; badge + number is the platform-native version).

---

## 3. Board UI (full-tab webview)

Layout: left rail 25%, content 75%, VSCode theme variables (`--vscode-*`) throughout
so it matches light/dark themes. No CSS framework.

**Left rail (top → bottom):**
- Phases in workflow order: New, Backlog, In Progress, Feedback, Review, Done —
  each with count and an attention dot (● amber) when it contains badge-relevant items.
  Click selects the phase; content pane shows that phase's tasks.
- Divider, then **Loops**: three rows (Opus / Sonnet / Fable) with a status dot
  (green = terminal alive, grey = none) and a ▶ button → `loopBoard.spawnLoop`.
- Divider, then **＋ New story**: opens the big-textbox composer in the content pane.

**Content pane — task cards, in file order:**
- Title (inline-editable), phase-relevant metadata line (owner · model dropdown ·
  dates · links as anchors), description (editable textarea, auto-grow).
- **Feedback phase:** each `question:` rendered read-only with an editable
  `answer:` textarea directly beneath — the centerpiece interaction.
- **Review phase:** DELIVERED text, PR links, and an editable `feedback:` textarea
  (writing one = change request per Rule 13).
- **Every card:** a collapsed "Note to worker" input → writes `note:`.
- **New / Review cards:** a checkbox; ticking triggers the gate move via `gates.ts`
  (confirm dialog on Review→Done since it rewrites two files).
- Unrecognized lines shown in a muted "unparsed" chip per task.
- Editing model: **save on blur / Enter** per field (sends the field patch); no global
  save button, no dirty-board state to reconcile.

**Composer (New story):**
- One large textarea + Save. On save: append DRAFT task to New (id + added),
  toast "Draft saved — the loop will groom it into a story."

**Done phase:** read-only list from `DONE.md`, newest first, capped at 50, with
completed dates and PR links.

### Webview ↔ extension messages

```
webview → ext:  ready | patch{taskId,field,value} | gate{taskId,action} |
                createDraft{text} | spawnLoop{model} | openFile{path} | reveal{taskId}
ext → webview:  board{board, terminalStatus} | toast{level,text} | revealTask{taskId}
```

Webview hardening: CSP with nonce, `retainContextWhenHidden: false` +
`getState/setState` for scroll/selection restore.

---

## 4. Loop terminals (`terminals.ts`)

Backend decision: **plain VSCode terminals** — everything v1 needs (spawn, inject,
clear, auto-recycle, status) works with `createTerminal`/`sendText`/`dispose`, with
zero external dependencies. Known trade-offs, accepted: loops die with the VSCode
window (restart = one ▶ click, lossless since all state is in TODO.md), and the
extension can never read terminal output (VSCode's read APIs are proposed-only or
shell-prompt-only, useless under the claude TUI) — so loop injection uses a fixed
delay and context-% detection is off the table. tmux (detached persistent sessions,
`send-keys`/`capture-pane`) remains the v2 upgrade path, isolated behind this module.

- `spawnLoop(model)`:
  1. If a terminal named `Claude <Model>` exists in `window.terminals` → `show()` it, done.
  2. Else `window.createTerminal({ name: 'Claude <Model>', cwd: workspaceRoot, iconPath })`.
  3. `sendText('claude --model <model> --permission-mode <cfg.permissionMode>')`.
  4. After a fixed startup delay (default 3 s, setting `loopBoard.startupDelayMs`;
     if injection proves flaky, fallback: copy the /loop line to the clipboard + toast),
     read the Automation section's fenced block from the current parse, substitute
     `{MODEL}`, `sendText('/loop <interval> ' + prompt)`.
- **♻ Clear button per model:** `terminal.dispose()` → respawn via `spawnLoop`.
  Confirm dialog if that model currently owns an In Progress task.
- **Auto-recycle (`loopBoard.autoRecycle`):** on each file-watcher refresh, diff
  In Progress ownership per model; when model X's task left In Progress and X has no
  other In Progress task, dispose + respawn its terminal → fresh context per task,
  no output parsing needed.
- **Status:** `window.terminals` scan + `onDidOpenTerminal`/`onDidCloseTerminal` →
  green/grey dot per model in sidebar + board. "Running" means the terminal exists;
  whether the loop inside is alive is not tracked (needs output reading → v2/tmux).

---

## 5. Milestones & verification

1. **M1 — Parser + writer + format spec.**
   `parser.ts`, `writer.ts`, `model.ts`; fixtures incl. the current real TODO.md.
   → verify: round-trip test (parse→write→parse is a fixpoint; v1-format fixture
   normalizes to v2 with ids assigned and nothing lost, unknown lines preserved).
2. **M2 — TODO.md v2 migration.** Rewrite Rules + Automation (with `{MODEL}` block,
   `note:` handling, model routing) in this repo.
   → verify: M1 parser parses the migrated file with zero unknown lines.
3. **M3 — Read-only board.** Extension scaffold, panel, left rail, task cards,
   Done column, file watcher refresh.
   → verify: open board on migrated TODO.md; edit the file in a text editor,
   board refreshes within ~1 s.
4. **M4 — Editing + gates + merge.** Field patches, answer/feedback/note inputs,
   composer, gate moves, atomic write, conflict toast.
   → verify: tick a New task → it appears in Backlog with `promoted:`; accept a
   Review task → lands in DONE.md; simulate a loop write between load and save →
   other tasks' changes survive, conflict on same field toasts.
5. **M5 — Sidebar + badge.** Summary view, attention list, badge count, reveal-in-board.
   → verify: add an unanswered question to the file → badge increments; answering
   it in the board clears it.
6. **M6 — Loop terminals.** Spawn/reuse/status, prompt substitution, ♻ clear,
   auto-recycle, settings.
   → verify: click Opus ▶ → terminal `Claude Opus` opens in workspace root, claude
   starts with `--permission-mode auto`, `/loop` line lands after the startup delay;
   second click focuses instead of duplicating; ♻ disposes and respawns it;
   completing a task recycles the terminal.

## Open items / flagged defaults

- Startup delay before `/loop` injection (default 3 s) needs empirical tuning against
  the installed claude CLI; clipboard fallback if flaky.
- "Stale In Progress" attention indicator: deliberately out of v1 (was not selected).
- v2 candidates: tmux backend (loops that survive VSCode restarts, output reading /
  context-% recycle, loop-alive detection), stop/restart controls.
