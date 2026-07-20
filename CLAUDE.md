# CLAUDE.md — LoopBoard

VSCode extension: renders the workspace `TODO.md` as an interactive board, writes edits back to
markdown, spawns model-specific Claude Code loop terminals. Design: `PLAN.md`; decisions:
`DECISIONS.md`; verification status: `VERIFICATION.md`.

## Non-negotiable

1. Docker-only toolchain — NEVER install on the host (no `npm`/`brew`/`pip`/`apt`; never type
   `npm`/`npx`/`node` directly). Everything runs via `make` → `docker run node:22`. Host has
   only Docker, `make`, git, VSCode. A tool missing from node:22 gets its own image.
2. Zero runtime dependencies. devDependencies = exactly `typescript` + `@types/vscode`. No
   `@types/node`, no bundler, no frameworks; webview = vanilla HTML/CSS/JS.
3. `TODO.md` = source of truth (v3 grammar documented inside it). Parse tolerantly, write back
   canonical on every save, preserve unparseable lines verbatim (flagged in UI).
4. ALL markdown IO goes through `src/store.ts` — merge logic in exactly one place. Saves are
   field-level patches: re-read disk, re-parse, apply one field, serialize whole file, atomic
   write (temp + rename). Same-field conflict → disk wins + toast.
5. Board performs ONLY the two human gates (New→Backlog on tick, Review→DONE.md on accept).
   Everything else is a field patch the loop reacts to. Never auto-move tasks optimistically.

## Commands

```
make install    # npm install in Docker
make build      # tsc -> out/                 (extension host)
make test       # tsc tsconfig.test.json -> out-test/, node --test 'test/*.test.js'
make package    # vsce package -> loopboard-todo-<version>.vsix
make check      # build + test + package — MUST pass before any commit
make clean
```

Any `src/**` change requires `make test` + `make check` green before it counts as done.

## Architecture

- Pure modules (unit-tested in Docker; must NEVER import `vscode` or node typings):
  `parser.ts`, `writer.ts`, `model.ts`, `merge.ts`, `gates.ts`, `loop.ts`, `view.ts` —
  compiled by `tsconfig.test.json` (`types: []`) into `out-test/`.
- VSCode-touching (manual F5 verification only): `extension.ts`, `store.ts`, `controller.ts`,
  `panel.ts`, `sidebar.ts`, `terminals.ts`, `webview.ts` — main `tsconfig.json` → `out/`.
- Webview assets: `media/board.{html,css,js}`, `media/sidebar.{html,css,js}` — vanilla JS, CSP
  nonce, VSCode theme variables only.
- Keep new logic pure/testable; wrap `vscode` imports as thinly as possible.

## Critical learnings (do not rediscover)

- No `@types/node`: tests are plain CommonJS `.js` in `test/` requiring `out-test/`; main
  tsconfig adds lib `DOM` (not @types/node) for `setTimeout`/`TextDecoder`.
- `node --test` needs the glob `'test/*.test.js'` — a bare `test/` dir arg is treated as a
  module path (Node 22).
- Core invariant: parse→write→parse is a fixpoint; `serialize(parse(x))` idempotent as text.
  Any parser/writer change keeps the fixture suite green (incl. real v1 TODO.md with
  HTML-comment templates — task-like `- [ ]` lines inside comments must not parse as tasks).
- Emoji canonicalization: parser strips leading ❓/⚠️ from question/feedback text; writer
  re-adds them.
- Webview vs concurrent loop writes: board defers incoming refresh while a field is focused
  (`pendingBoard`, flushed on focusout). Model select normalizes `default (opus)` → `''`
  before patching so an unchanged default never trips a false same-field conflict.
- Section headings + HTML-comment extras round-trip verbatim via `getPhaseHeadings` /
  `getSectionExtras`.
- Terminals: plain VSCode terminals (`createTerminal`/`sendText`/`dispose`), one per model,
  named `Claude <Model>`; output can never be read (claude TUI + VSCode API limit). Loop
  launches as ONE line: `claude --permission-mode <mode> --model <model> '/loop ...'` — the
  ~200-char bootstrap prompt (from `buildLoopCommand`, points at TODO.md `## Automation`)
  rides as single-quoted argv. The CLI seeds it into the REPL input but does NOT auto-submit
  → lone Enter after `BOOT_DELAY_MS` (post-TUI-boot, past bracketed-paste detection). Pasting
  into a running REPL (e.g. `/clear`): paste + Enter after `SUBMIT_DELAY_MS`. Historical
  quoting breakage came from the old ~3,000-char prompt; the short line is apostrophe-free
  (still `'\''`-escaped). tmux = v2 path, isolated in `terminals.ts`.
- Packaging: `.vscodeignore` keeps the `.vsix` to `out/` + `media/` + manifest/README;
  `vsce package` needs `--no-dependencies` (zero runtime deps).

## Conventions

- Repo root IS the workspace it operates on (`workspaceContains:TODO.md` activation + root
  file IO align) — extension is not nested.
- Record notable implementation decisions as one-liners in `DECISIONS.md`; update
  `VERIFICATION.md` when the verification story changes.
- Manual checklist (M3–M6, F5 Extension Development Host) lives in `VERIFICATION.md`;
  headless sessions cannot run it — say so, never claim it done.
- `DONE.md` may be absent until the first Review acceptance; the store treats missing as
  empty — keep it that way.
- `media/todo-template.md` (scaffold for fresh workspaces) must mirror TODO.md's structural
  prose by hand — known drift hazard, no test catches prose divergence.
