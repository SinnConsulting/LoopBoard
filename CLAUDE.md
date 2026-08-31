# CLAUDE.md — LoopBoard

@.claude/rules/branch.md

VSCode extension: renders workspace `.loopboard/` tracker as interactive board, writes edits back
to markdown, spawns model-specific Claude Code loop terminals. Decisions: `decisions/` (index
`DECISIONS.md`); verification status: `VERIFICATION.md`.

Storage: everything under `.loopboard/` — `TODO.md` (slim task index, grammar v5), `DONE.md`
(accepted, lazy), `LOOP.md` (rules + loop worker instructions), `tasks/<id>.md` (per-task detail).

## Non-negotiable

1. Docker-only toolchain — NEVER install on host (no `npm`/`brew`/`pip`/`apt`; never type
   `npm`/`npx`/`node` directly). Everything runs via `make` → `docker run node:22`. Host has only
   Docker, `make`, git, VSCode. Tool missing from node:22 gets its own image.
2. Zero runtime dependencies. devDependencies = exactly `typescript` + `@types/vscode`. No
   `@types/node`, no bundler, no frameworks; webview = vanilla HTML/CSS/JS.
3. `.loopboard/` markdown = source of truth. Index (`TODO.md`, grammar v5) carries only
   id/phase/model/groomer/questions/notes per entry; every other field lives in `tasks/<id>.md`.
   Parse tolerantly, write back canonical on every save, preserve unparseable lines verbatim
   (flagged in UI). Grammar + task-file format documented in `LOOP.md`.
4. ALL markdown IO goes through `src/store.ts` — only module that knows `.loopboard/` paths; merge
   logic in exactly one place (`merge.ts`, `patchTarget` routes index vs detail). Saves are
   field-level patches on ONE file: re-read disk, re-parse, apply one field, serialize whole file,
   atomic write (temp + rename). Same-field conflict → disk wins + toast.
5. Board performs ONLY three human actions: promote (New→Backlog on tick), accept (Review→DONE.md
   on tick), demote (Backlog→New, immediate button click, non-destructive). Everything else is a
   field patch the loop reacts to. Never auto-move tasks optimistically.

## Commands

```
make install         # npm install in Docker
make build           # tsc -> out/                 (extension host)
make test            # tsc tsconfig.test.json -> out-test/, node --test 'test/*.test.js'
make package         # vsce package -> loopboard-todo-<version>.vsix
make check           # build + test (no .vsix) — MUST pass before any commit
make check PACKAGE=1 # build + test + package — opt-in packaging check on the same command
make clean
```

Any `src/**` change requires `make test` + `make check` green before it counts as done.

## Architecture

- Pure modules (unit-tested in Docker; must NEVER import `vscode` or node typings): `parser.ts` +
  `writer.ts` (index file), `taskfile.ts` (per-task detail file), `model.ts`, `merge.ts`,
  `gates.ts`, `loop.ts`, `view.ts` — compiled by `tsconfig.test.json` (`types: []`) into
  `out-test/`.
- VSCode-touching (manual F5 verification only): `extension.ts`, `store.ts`, `controller.ts`,
  `panel.ts`, `sidebar.ts`, `terminals.ts`, `webview.ts` — main `tsconfig.json` → `out/`.
- Webview assets: `media/board.{html,css,js}`, `media/sidebar.{html,css,js}` — vanilla JS, CSP
  nonce, VSCode theme variables only.
- Keep new logic pure/testable; wrap `vscode` imports as thinly as possible.

## Critical learnings (do not rediscover)

- No `@types/node`: tests are plain CommonJS `.js` in `test/` requiring `out-test/`; main tsconfig
  adds lib `DOM` (not @types/node) for `setTimeout`/`TextDecoder`.
- `node --test` needs glob `'test/*.test.js'` — bare `test/` dir arg is treated as module path
  (Node 22).
- Core invariant: parse→write→parse is a fixpoint for BOTH files; `serializeTodo(parseTodo(x))` and
  `serializeTaskFile(parseTaskFile(x))` idempotent as text. Any parser/writer change keeps fixture
  suite green (incl. index fixture with an HTML-comment template — task-like `- [ ]` lines inside
  comments must not parse as entries).
- Emoji canonicalization: index parser strips leading ❓ from question text; task-file parser strips
  ⚠️ from `## Feedback`; writers re-add them.
- Task file `tasks/<id>.md` is eager-scaffolded on draft create (t-6ab4: `store.createDraft` writes
  a skeleton — `added: <today>`, everything else empty and so omitted by `serializeTaskFile`, same
  shape the writer already canonicalizes an empty detail to). Missing file (only possible for
  pre-t-6ab4 entries or one deleted out-of-band) still parses as empty detail and card still shows
  the "no detail file yet" hint — no longer fires for ordinary new drafts. Writer rewrites H1 from
  index title on every task-file save (index title wins on divergence).
- Webview vs concurrent loop writes: board defers incoming refresh while a field is focused
  (`pendingBoard`, flushed on focusout). Model select normalizes `default (opus)` → `''` before
  patching so an unchanged default never trips a false same-field conflict.
- Index `## Tasks` heading + HTML-comment extras round-trip verbatim via `getTasksHeading` /
  `getTasksExtras`.
- Terminals: plain VSCode terminals (`createTerminal`/`sendText`/`dispose`), one per model, named
  `Claude <Model>`; output can never be read (claude TUI + VSCode API limit). Loop launches as ONE
  line: `claude --permission-mode <mode> --model <model> '/loop ...'` — the ~200-char bootstrap
  prompt (from `buildLoopCommand(store.loopText, …)`, points at `.loopboard/LOOP.md`'s
  `## Automation`; slices that section out first since LOOP.md has several earlier fences) rides as
  single-quoted argv. CLI seeds it into REPL input but does NOT auto-submit → lone Enter after
  `BOOT_DELAY_MS` (post-TUI-boot, past bracketed-paste detection). Pasting into a running REPL (e.g.
  `/clear`): paste + Enter after `SUBMIT_DELAY_MS`. Short line is apostrophe-free (still
  `'\''`-escaped).
- Scheduled loop actions (t-77d1): all three sidebar row buttons keep their immediate left-click
  meaning (▶ `spawnLoop`, ♻ `recycleLoop`, ■ `stopLoop`); RIGHT-click (`contextmenu`, host menu
  suppressed) opens a popover scheduling that same action (preset minutes + `Custom…`, always
  MINUTES; `repeat`; `force` on restart/stop only — a start interrupts nothing, and `armSchedule`
  forces it false). ONE schedule per model whatever armed it (`start`/`restart`/`stop` are
  contradictory), so arming replaces. Scheduling is available on all three buttons in ANY loop state
  — hence `aria-disabled` + `.off` instead of the real `disabled` attribute, which would fire no
  mouse events and take the right-click away with the left. `appliesTo` re-checks at fire time and
  SWALLOWS an action that no longer matches (a `restart` armed for a since-stopped loop does
  nothing, never a silent start); schedule still fires, so a one-shot disarms and a repeat keeps its
  cadence. Schedule logic is pure (`src/schedule.ts`, unit-tested); controller owns the per-model
  schedule map and its `setTimeout`s, SESSION-ONLY (nothing in `globalState`/`workspaceState`/
  `.loopboard/`, so a reload clears every schedule — matching terminals, which die with the window
  too). Force consent is a native modal taken ONCE at arm time (a scheduled action is unattended by
  definition); fire time is silent and only logged. With `force` off the timer defers instead of
  firing while that model owns the In-Progress task (a scheduled start never defers — `mayFire`
  short-circuits it), and waits indefinitely — it fires on the same idle edge `maybeAutoRecycle`
  watches, since the tracker is the only signal for "busy". A forced restart leaves the task
  `phase: inprogress` with no worker, which Rule 2 turns into a board-wide block — hence the modal's
  wording.
- Workspace custom rules (t-4a04): a hand-owned `<!-- loopboard:custom:begin/end -->` free-text
  section in `.loopboard/LOOP.md` — NO setting, NO reconciler, NO config listener (the earlier
  `loopBoard.customRules` + per-line-marker machinery was removed after human rejection; do not
  reintroduce it). The extension never reads or writes the section; it survives Sync by
  construction because `sync.ts` matches only the `loopboard:sync:` namespace (regression test in
  `test/sync.test.js`). Caveat: a LOOP.md with NO sync markers at all is legacy-replaced wholesale
  on Sync (backed up to `LOOP.md.bkp`). `src/` has no `onDidChangeConfiguration` listener anywhere
  — configuration is read on demand.
- Packaging: `.vscodeignore` keeps the `.vsix` to `out/` + `media/` + manifest/README;
  `vsce package` needs `--no-dependencies` (zero runtime deps).
- Debug trace (`loopBoard.debug` = `off | info | verbose`): any new code that writes a
  `.loopboard/` file, reads/acts on VSCode configuration, or shows a popup MUST emit a
  `store.debugLog(level, event, detail)` line — `info` for lifecycle (gates and their
  request/cancel, loop spawn/recycle/stop, disk-wins conflicts, activation, toast `warning`s, native
  popups + user's choice on interactive modals), `verbose` for per-patch/attachment/config-read/
  message/refresh-trigger/template-preview detail and routine toast `success`/`info` — routed
  through the single store sink (`store.ts`), never a private `console.log` or ad-hoc file. `off`
  writes nothing. Values logged verbatim into the gitignored `.loopboard/debug.log` (buffered
  hybrid: in-memory buffer → debounced flush → whole-file read-concat-write, no temp+rename, 10 MB
  tail-cap, forced flush on `deactivate`). Pure modules stay vscode/store-free — log at the
  store/controller/terminals boundary, never thread a logger into them.

## Conventions

- Repo root IS the workspace it operates on (`workspaceContains:.loopboard/TODO.md` activation +
  `.loopboard/` file IO align) — extension is not nested. Missing `.loopboard/` → board shows init
  empty-state; `LoopBoard: Initialize Workspace` / `loopboard.init` scaffolds it and refuses if it
  already exists.
- Record notable implementation decisions as one-liners in the matching `decisions/<category>.md`
  (index: `DECISIONS.md`; append at the bottom); update `VERIFICATION.md` when the verification
  story changes.
- Manual checklist (M3–M6, F5 Extension Development Host) lives in `VERIFICATION.md`; headless
  sessions cannot run it — say so, never claim it done.
- `DONE.md` may be absent until first Review acceptance; store treats missing as empty — keep it
  that way.
- `media/template-todo.md` + `media/template-loop.md` (scaffold for fresh `.loopboard/` workspaces).
  `template-loop.md` is not hand-mirrored: its marked sections are the source `src/sync.ts`'s
  `syncMarkedSections` pushes into every workspace's `.loopboard/LOOP.md` on Sync and activation
  auto-heal (`store.syncTemplates`/`store.autoHeal`). Compressing it is scoped by
  `.claude/rules/template-loop-compress.md` (`paths:` → `media/template-loop.md`) to the
  `template-loop-compress` skill (`.claude/skills/template-loop-compress/`); `CLAUDE.md` has the
  same pair (`.claude/rules/claude-md-compress.md`, `.claude/skills/claude-md-compress/`). Each
  runs in an Opus subagent, is lossless-only (obsolete content is a separate human edit), writes
  only when its own self-check passes, and never engages for any other file. Both files also carry
  a line budget asserted in `test/` — the backstop that binds an editor who never reads the rule.
