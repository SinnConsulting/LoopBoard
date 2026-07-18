# Prompt for the implementation agent — build the "LoopBoard" VSCode extension

You are implementing a VSCode extension in this repository. The authoritative
specification is **`PLAN.md` in the repo root — read it completely before writing any
code.** This prompt tells you how to execute that plan; where the two ever disagree,
`PLAN.md` wins, except for the Non-negotiables below, which always win.

## Context

The extension renders the open workspace's `TODO.md` (strict format defined in
PLAN.md §1) as an interactive board: a human ticks approval checkboxes, answers an AI
worker's questions, and reviews delivered work. Claude Code loops rewrite the file
about once a minute, so live refresh and field-level merge (PLAN.md §2, "Save & merge
protocol") are core, not nice-to-haves.

**Visual design is NOT your job.** A separate agent (Claude Design, outside this
task) is producing the UI from `design-prompt.md`; its deliverables are HTML mockups
(`board.html`, `sidebar.html`) plus design notes. If those mockups already exist in
the repo, treat them as the authoritative visual reference and port their markup/CSS
into `media/`. If they don't exist yet, build a plain, functional UI that implements
the structure and interactions of `design-prompt.md` §3–§9 without investing in
visual polish (spacing/color/motion details) — the design agent's output will be
merged in later, so keep your markup close to the structure described there (same
regions, same element types, stable ids/classes) to make that swap cheap. Do not
edit `design-prompt.md`.

## Non-negotiables (violating any of these = failed task)

1. **Node.js — and ALL other packages, tools, and dependencies — are installed and
   run ONLY inside Docker containers. NEVER install anything on the host system.**
   No `node`/`npm`/`npx`/`tsc` on the host, and equally no `brew install`, `pip
   install`, `apt-get`, `gem`, `cargo`, or any other host-level installation of
   anything. Every toolchain command goes through
   `docker run --rm -v "$PWD":/app -w /app node:22 …`; if you need a tool the
   `node:22` image lacks, use or build an appropriate image (e.g. a small
   `Dockerfile.dev`) — do not put it on the host. The only things assumed on the
   host are Docker, `make`, git, and VSCode itself. Create a `Makefile` with
   targets `install`, `build`, `test`, `package` wrapping the Docker commands, and
   use those targets yourself for every build/test run.
2. **Zero runtime npm dependencies.** `dependencies` in package.json stays empty.
   devDependencies: `typescript` and `@types/vscode` only. If you feel you need a
   library (markdown parser, uuid, watcher…), you don't — write the small amount of
   code instead.
3. **Webview is vanilla HTML/CSS/JS.** No frameworks, no bundler, no CDN or network
   requests. CSP with a nonce on every webview. All colors via `var(--vscode-*)`.
4. **TODO.md is the single source of truth.** Never hold board state that isn't
   derived from a fresh parse. Every write: re-read → re-parse → apply the one
   field-level patch → serialize the whole file canonically → atomic write
   (temp file + rename). Preserve unparseable lines verbatim.
5. **Never lose user or worker data.** The round-trip property (parse → write →
   parse is a fixpoint; unknown lines survive) is enforced by tests, and gate moves
   append to `DONE.md` — they never delete content anywhere else.

## Execution order

Work milestones M1–M6 exactly as defined in PLAN.md §5, in order. Do not start a
milestone before the previous one's verification passes. For each milestone:

1. Implement.
2. Run its verification (PLAN.md lists one per milestone). Automated where possible:
   M1's round-trip and merge tests are `node --test` suites under `test/`, run via
   `make test` (inside Docker). For UI milestones (M3–M6), verification is manual in
   the Extension Development Host (F5) — perform it, and record what you did and saw.
3. Commit with a message `M<n>: <what>` before moving on. Never add a Co-Authored-By
   trailer.

Notes on specific milestones:

- **M1 (parser/writer):** put the format grammar in one place (`parser.ts` header
  comment). Test fixtures MUST include: the current real `TODO.md` from this repo
  (v1 format → normalizes to v2, ids assigned, nothing lost), a fully v2 file
  (fixpoint), a file with unknown lines/keys (preserved + flagged), a task with two
  questions one answered, and the HTML comment blocks (verbatim).
- **M2 (TODO.md migration):** rewrite the Rules and Automation sections of the real
  `TODO.md` per PLAN.md §1. Keep every existing rule's meaning; add `id:`,
  `description:`, `note:` handling, `model:` routing, and the `{MODEL}` fenced loop
  template. After migration, the M1 parser must parse it with zero unknown lines
  (add that as a test).
- **M3–M4 (board):** webview ↔ extension messages are exactly the protocol in
  PLAN.md §3 ("Webview ↔ extension messages") — field patches only, never the whole
  board from webview to extension. Test the merge logic (patch applied to a fresh
  parse; same-field conflict → disk wins + toast) with unit tests in Docker; the
  webview itself is verified manually.
- **M5 (sidebar/badge):** badge counts = unanswered-question Feedback tasks +
  Review tasks + New tasks (DRAFTs included).
- **M6 (terminals):** plain VSCode terminals per PLAN.md §4 — `createTerminal` +
  `sendText('claude --model <m> --permission-mode <cfg>')`, `/loop` injection after
  the configured startup delay, dispose+respawn for ♻ and auto-recycle. Do NOT
  introduce tmux, node-pty, or output parsing — explicitly out of scope for v1.

## Working agreements

- Keep it small: single-purpose modules as laid out in PLAN.md §2's file tree; no
  speculative abstractions, no settings beyond those listed in PLAN.md.
- TypeScript `strict: true`; target the VSCode engine version you declare
  (`^1.90.0` is fine).
- If PLAN.md is ambiguous or silent on something you must decide, choose the
  simplest option consistent with the Non-negotiables, and record the decision in
  a `DECISIONS.md` (one line each: what, why). Do not stop to ask unless data loss
  or the Non-negotiables are at stake.
- If a verification fails, fix it before proceeding — never mark a milestone done
  with a failing check, and never weaken a test to make it pass.

## Definition of done

- `make install && make build && make test` succeed from a clean checkout with only
  Docker and `make` on the host (state the exact commands you ran and their results).
- All M1–M6 verifications pass; the manual ones are written up (what you clicked,
  what happened) in `VERIFICATION.md`.
- The extension activates in the Extension Development Host against this repo's
  migrated `TODO.md`: board renders all phases, an answer typed into a Feedback
  question lands in the file, ticking a Review task moves it to `DONE.md`, and the
  Opus ▶ button opens a terminal that starts claude and injects the loop.
- `README.md` (short): what it is, Docker-only build instructions via `make`, how to
  launch (F5), settings reference.
- Final deliverable message: summary of what was built, decisions taken
  (from `DECISIONS.md`), verification results, and anything deferred.
