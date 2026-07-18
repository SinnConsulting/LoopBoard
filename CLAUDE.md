# CLAUDE.md — LoopBoard

VSCode extension that renders the workspace `TODO.md` as an interactive board, writes edits
back to the markdown, and spawns model-specific Claude Code loop terminals. Full design in
`PLAN.md`; decision log in `DECISIONS.md`; verification status in `VERIFICATION.md`.

## Non-negotiable requirements

1. **Dockerized toolchain — nothing is ever installed on the host.** No `npm`, `brew`, `pip`,
   `apt` on the host. Every Node/tool invocation goes through `docker run node:22` via the
   `Makefile`. Host assumes only Docker, `make`, git, and VSCode. A tool missing from the
   `node:22` image gets its own image, never a host install.
2. **Zero runtime dependencies.** devDependencies are exactly `typescript` + `@types/vscode`.
   No `@types/node`, no bundler, no frameworks — the webview is vanilla HTML/CSS/JS.
3. **`TODO.md` stays the source of truth** (markdown, v2 grammar documented inside `TODO.md`
   itself). The extension parses tolerantly, writes back canonical format on every save, and
   preserves unparseable lines verbatim (flagged in the UI).
4. **All markdown IO goes through `src/store.ts`** — merge logic exists in exactly one place.
   Saves are field-level patches: re-read disk, re-parse, apply one field, serialize the whole
   file, atomic write (temp file + rename). Same-field conflict → disk wins + toast.
5. **The board performs only the two human gates** (New→Backlog on tick, Review→DONE.md on
   accept). Everything else (Review feedback, notes, answers) is a field patch; the loop reacts
   on its next pass. Never auto-move tasks optimistically.

## Commands

```
make install    # npm install (typescript + @types/vscode) in Docker
make build      # tsc -> out/            (extension host code)
make test       # tsc tsconfig.test.json -> out-test/, then node --test 'test/*.test.js'
make package    # vsce package -> loopboard-0.1.1.vsix
make check      # build + test + package — run before every commit
make clean      # rm out/ out-test/ node_modules/ *.vsix
```

Never type `npm`/`npx`/`node` directly on the host — always via `make` (or the `$(DOCKER)`
prefix). `make check` must pass before any commit.

## Architecture (what lives where)

- **Pure modules (unit-tested in Docker, must never import `vscode` or node typings):**
  `parser.ts`, `writer.ts`, `model.ts`, `merge.ts`, `gates.ts`, `loop.ts`, `view.ts`.
  Compiled by `tsconfig.test.json` (`types: []`) into `out-test/`.
- **VSCode-touching modules (verified manually via F5, not unit-testable here):**
  `extension.ts`, `store.ts`, `controller.ts`, `panel.ts`, `sidebar.ts`, `terminals.ts`,
  `webview.ts`. Compiled by the main `tsconfig.json` into `out/`.
- **Webview assets:** `media/board.{html,css,js}`, `media/sidebar.{html,css,js}` — vanilla JS,
  CSP nonce, VSCode theme variables only.
- Keep new logic pure/testable where possible; put the `vscode` import behind the thinnest
  wrapper you can.

## Critical learnings (hard-won — don't rediscover)

- **Testing without `@types/node`:** tests are plain CommonJS `.js` files in `test/` requiring
  compiled modules from `out-test/`. `tsconfig.test.json` uses `types: []`; the main
  `tsconfig.json` adds the `DOM` lib (not `@types/node`) to get `setTimeout`/`TextDecoder` in
  the extension host.
- **`node --test` needs a glob** (`'test/*.test.js'`), not a bare directory — Node 22 treats a
  bare `test/` argument as a module path.
- **Round-trip is the core invariant:** parse→write→parse must be a fixpoint, and
  `serialize(parse(x))` must be idempotent as text. Any parser/writer change must keep the
  fixture suite (incl. the real v1 TODO.md with HTML-comment templates containing task-like
  `- [ ]` lines) green — HTML comments after a real task must not be mis-parsed as tasks.
- **Emoji canonicalization:** parser strips leading `❓`/`⚠️` from question/feedback text; the
  writer re-adds them.
- **Webview vs concurrent loop writes:** the board defers applying an incoming refresh while a
  field is focused (`pendingBoard`, flushed on `focusout`) so a mid-typing file change can't
  discard input. The model select normalizes `default (opus)` to `''` before patching so an
  unchanged default never trips a false same-field conflict.
- **Board structural extras:** exact section headings and HTML-comment templates ride on the
  Board via `getPhaseHeadings`/`getSectionExtras` helpers so they round-trip verbatim.
- **Terminals:** plain VSCode terminals (`createTerminal`/`sendText`/`dispose`), one per model,
  named `Claude <Model>`. Output can never be read (VSCode API limitation under the claude
  TUI). `/loop` is a slash command, so it must be submitted *inside* the REPL to invoke the
  loop skill — passing it as the claude CLI's initial-prompt argv sends it as literal text.
  So: launch `claude` bare, wait `BOOT_DELAY_MS` for the TUI, `sendText(prompt, false)` to
  paste the single-line prompt (no newline), then a lone Enter after `SUBMIT_DELAY_MS` (past
  the bracketed-paste detection window). The prompt is one line, so the newline-swallowing
  caveat doesn't apply; no shell quoting is involved. tmux is the v2 path, isolated behind
  `terminals.ts`.
- **Packaging:** `.vscodeignore` keeps the `.vsix` to `out/` + `media/` + manifest/README
  (27 files). `vsce package` needs `--no-dependencies` (zero runtime deps).

## Working conventions

- **Any change to extension code (`src/**`) requires `make test` and `make check` to pass
  before it is considered done** — never report an extension edit as complete without them
  green (`make check` runs build + test + package).
- Extension lives at the repo root (not nested) — this repo IS the workspace it operates on,
  so `workspaceContains:TODO.md` activation and root file IO line up.
- Record notable implementation decisions as one-liners in `DECISIONS.md` (what + why).
- Update `VERIFICATION.md` when the automated or manual verification story changes.
- Manual verification checklist (M3–M6, F5 Extension Development Host) is in
  `VERIFICATION.md` — headless sessions cannot run it; say so rather than claiming it done.
- `DONE.md` does not exist until the first Review task is accepted; the store treats a missing
  file as empty — keep it that way.
