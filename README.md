<div align="center">

![LoopBoard logo](media/loopboard-icon-128.png)

# LoopBoard

**Your `TODO.md`, as a live board your AI agents work from.**

*Write stories in plain markdown — agent loops groom, build, and deliver them while you keep the only two keys that matter: what gets started, and what gets accepted.*

**⚠️ Beta:** still under active development — expect rough edges and breaking changes between
versions.

</div>

---

LoopBoard is a VSCode extension that renders the open workspace's `TODO.md` as an interactive
board: tick approval checkboxes, answer an AI worker's questions, review delivered work, and spawn
per-model Claude Code loop terminals — without editing markdown by hand.

The file stays the single source of truth. Every edit re-reads the disk, applies one field-level
patch, and writes the whole file back canonically (atomic temp-file + rename), so humans, the
board, and multiple agent loops can share it safely. Accepted work is archived to `DONE.md`.

## How it works

```
New → Backlog → In Progress → Review → Done (DONE.md)
                     ↕
                  Feedback
```

1. **You describe** a story in the "+ New story" composer (free text, no formatting needed) and
   pick which model **grooms** it and which model **executes** it.
2. **A loop grooms** the draft into a full story — title, description, scope — and surfaces any
   decisions it needs from you as inline questions on the card.
3. **You promote** it with a tick. A matching model loop claims it, works it, and parks it in
   **Feedback** whenever it would otherwise have to guess.
4. **You review** the DELIVERED summary — write change-request feedback to send it back, or tick
   to accept and archive it.

The board performs only the two human gates (promote and accept); everything else is a field
patch the loops react to on their next pass. No work starts and nothing ships without your tick.

## Quick start

Open this folder in VSCode and press **F5** to start the Extension Development Host. The host
opens against this repo, whose `TODO.md` drives the board. Click the LoopBoard icon in the
activity bar for the sidebar summary, then **Open Board** (or run `LoopBoard: Open Board`).

## Build (Docker only)

Node and every other tool run **inside Docker** — nothing is installed on the host. The host
needs only Docker, `make`, git, and VSCode. All toolchain commands are wrapped in the `Makefile`:

```
make install    # npm install (typescript + @types/vscode only) in node:22
make build      # tsc -> out/
make test       # compile pure modules + run node --test round-trip / merge suites
make package    # build a .vsix via @vscode/vsce
```

Zero runtime dependencies; the webview is vanilla HTML/CSS/JS with a CSP nonce on every script.

## Using it

- **Left rail** — phases (New → Done) with counts and an amber attention dot when a phase needs
  you; per-model **Loops** with ▶ (start/focus) and ♻ (recycle) buttons; **＋ New story**.
- **New** — tick a task's checkbox to promote it to Backlog.
- **Feedback** — type an answer under each question; the loop resumes once all are answered.
- **Review** — read DELIVERED, optionally write review feedback (sends it back), or tick to accept
  (confirm) → archived to `DONE.md`.
- **New story** composer — write free text, choose the groom/worker models inline; it lands as a
  `DRAFT:` the loop grooms into a story.
- Edits save on blur/Enter as field patches. If the file changed on disk under your edit, the disk
  value wins and a toast tells you.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `loopBoard.permissionMode` | `auto` | `--permission-mode` passed to the claude CLI |
| `loopBoard.defaultModel` | `opus` | model that owns tasks with no `model:` field |
| `loopBoard.loopInterval` | `1m` | interval used in the injected `/loop` line |
| `loopBoard.autoRecycle` | `true` | recycle a model's terminal after it finishes a task |
| `loopBoard.startupDelayMs` | `3000` | wait before injecting `/loop` into a fresh claude REPL |

> Migrating from "Claude TODO Board" (≤ 0.1.1): the extension, command, and settings ids were
> renamed from `claudeTodo.*` to `loopBoard.*` with no fallback — re-enter any custom
> settings.json values under the new keys.

## Loop terminals

The ▶ buttons open a plain VSCode terminal named `Claude <Model>` in the workspace root, run
`claude --model <m> --permission-mode <cfg>`, and after the startup delay inject the `/loop` block
from `TODO.md`'s Automation section with `{MODEL}` substituted. ♻ disposes and respawns for a fresh
context. Loops die with the VSCode window (restart is one click — all state lives in `TODO.md`).

## License

MIT
