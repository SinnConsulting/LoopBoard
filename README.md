<div align="center">

![LoopBoard logo](https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/media/loopboard-icon-128.png)

# LoopBoard

[![Publish to Marketplace](https://github.com/SinnConsulting/LoopBoard/actions/workflows/publish.yml/badge.svg)](https://github.com/SinnConsulting/LoopBoard/actions/workflows/publish.yml)
[![Release](https://github.com/SinnConsulting/LoopBoard/actions/workflows/release.yml/badge.svg)](https://github.com/SinnConsulting/LoopBoard/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/SinnConsulting/LoopBoard/blob/main/LICENSE)
[![runtime deps: 0](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](#security-model)

**The missing UI for Claude Code loops.**<br>
**Claude Code is the engine.**<br>
**LoopBoard is the cockpit.**<br>
**You're still the pilot.**

**Less prompting. No babysitting. More building.**

</div>

> "I don't prompt Claude anymore. I have loops running that prompt Claude and figure out what to do. My job is to write loops."
>
> — Boris Cherny, creator of Claude Code at Anthropic

[![LoopBoard demo — watch on YouTube](https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/media/hero.jpg)](https://youtu.be/Cqdq1-CAapc)

LoopBoard is a VSCode extension that turns your workspace `.loopboard/` tracker into an interactive
board your Claude Code agent loops groom, build, and deliver from — while you keep the only three
keys that matter: **what gets started, what gets accepted, and what gets sent back.** Markdown stays
the source of truth.

## Small on purpose

Agentic development breaks down when the task tooling becomes bloated and detached from the code it
is supposed to be about. LoopBoard is deliberately small:

- **Markdown is the single source of truth.** `.loopboard/` is plain files in your workspace. The
  board is a live view of them, never a second database, and everything survives the extension
  being uninstalled.
- **Exactly three human actions.** Promote, accept, demote. Everything else on the board is a field
  patch the loops read on their next pass.
- **Zero runtime dependencies.** Nothing ships with the extension but its own compiled code; the
  webview is vanilla HTML/CSS/JS with a CSP nonce on every script.
- **Native VSCode mechanisms only.** A webview panel, an activity-bar view, and plain terminals —
  the same APIs any extension uses. LoopBoard does not wire itself into pre/post hooks, does not
  scatter files across your project, and adds no file that can conflict with your own. Install it
  and carry on working exactly as before; uninstall it and only `.loopboard/` remains, which is
  yours and gitignored.

```
        you tick [x]                                    you tick [x]
             │                                               │
   New ──────┴──────► Backlog ────► In Progress ────► Review ┴────► Done (DONE.md)
    ▲                                    ▲   │                          
    └──── you click Demote ──────────────┘   └──► Feedback ─┐           
                                                  ▲          │           
                                                  └──────────┘           
                                              (your answers resume it)
```

Promote (New → Backlog) and Accept (Review → `DONE.md`) are ticks only you can make. Demote
(Backlog → New) is an immediate, non-destructive button click. A loop claims the top Backlog task
itself — at most one task board-wide is ever In Progress — and parks in Feedback rather than
guessing.

## Why LoopBoard?

What you get, at a glance:

- 🗂️ **Your `TODO.md` is the board** — markdown stays the source of truth; the UI is a live view, never a second database.
- 🤖 **Agents groom, build, and deliver** — Groomer and Worker loops collaborate on each task while you hold the only three gates: promote, accept, demote.
- ⏯️ **Press Start, not prompts** — spawn model-specific Claude Code loop terminals in one click instead of writing a fresh prompt per task.
- 🧩 **Multi-model slots** — assign Opus / Sonnet / Fable per task (groom vs. work), each a configurable slot.
- 🔒 **Zero runtime dependencies** — the extension ships no runtime deps; the webview is vanilla HTML/CSS/JS with a CSP nonce on every script.
- 🧵 **Context stays on the task** — worklog, feedback, and delivery notes live in `tasks/<id>.md`, not scattered across chats.

## How LoopBoard works

1. Create a task.
2. Start the Groomer and Worker loops.
3. Review the Groomed story.
4. Approve it.
5. Let the Worker build.
6. Answer questions—or chat with Claude when deeper discussion is needed.

> **That's it.**

![LoopBoard board in motion](https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/media/screenshot-board.gif)

## Get started

Run **`LoopBoard: Initialize Workspace`** from the Command Palette (or the board's empty-state
button) to scaffold `.loopboard/` in your workspace. Click the LoopBoard icon in the activity bar
for the sidebar summary, then **Open Board** (or run `LoopBoard: Open Board`). Accepted work is
archived to `.loopboard/DONE.md`.

Every command LoopBoard adds to the palette:

- **LoopBoard: Initialize Workspace** — scaffold `.loopboard/` here (refuses if it already exists).
- **LoopBoard: Open Board** — open the board panel.
- **LoopBoard: Refresh** — re-read `.loopboard/` from disk, for an edit made outside VSCode.
- **LoopBoard: Start Loop** — spawn a loop terminal, the same action as the sidebar's ▶.

## Storage layout

```
.loopboard/
  TODO.md          slim task index — one entry per active task (id, phase, model, groomer, Q&A)
  DONE.md          accepted tasks, newest first (created lazily on the first acceptance)
  LOOP.md          workflow rules + the loop worker instructions the loops read every pass
  tasks/<id>.md    per-task detail: meta, description, notes, worklog, feedback, delivered
  cache/<id>/      staged image attachments (created on the first attach), see below
```

The board composes each card from the slim index entry plus its `tasks/<id>.md`. Every edit
re-reads the disk, applies one field-level patch, and writes the whole file back canonically
(atomic temp-file + rename) — so humans, the board, and multiple agent loops share it safely. On
acceptance the index entry moves to `DONE.md` while the task file stays in `tasks/` as history.

`.loopboard/` is gitignored, so anything under it — including staged attachments — is local-only
and never committed or shared via git. Attach an image to a task by dragging it onto a card (or
the New Story composer) or pasting it from the clipboard — no button, drag-drop/paste only — and
it's staged under `.loopboard/cache/<id>/`, referenced with a markdown link in the task's
description (or the specific comment/answer field it was dropped into; drafts carry the link in
their raw story text). In the New Story composer, pasting inserts a `[name](…)` link at the
caret and the image stays pending (the draft isn't saved yet) — Save Draft stages the bytes and
rewrites the link to the real cache path. Each card lists its staged images in an Attachments
area with a × that deletes the file and its link; all remaining staged files are deleted once
the task is accepted to `DONE.md`.

## Using the board

The activity-bar **sidebar** (left) is a read-only, at-a-glance summary — click any row to jump into the board. From top to bottom, it shows:

| | |
|---|---|
| ![LoopBoard sidebar](https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/media/screenshot-sidebar.png) | <ul><li><b>Attention banner</b> — everything currently waiting on you: tasks in <b>Review</b> plus groomed proposals in <b>New</b> that are ready to promote.</li><li><b>Phases</b> — every column (New, Backlog, In Progress, Feedback, Review, Done) with a live task count.</li><li><b>Loops</b> — one row per model (Opus, Sonnet, Fable), each with its assigned role, a running-status dot, and ▶ spawn / ↻ recycle / ⏹ stop controls.</li><li><b>Settings</b> — opens the extension's configuration.</li></ul> |

On the board itself:

- **New** — tick a task's checkbox to promote it to Backlog.
- **Backlog** — click Demote to send a task back to New; it's immediate and non-destructive.
- **Feedback** — type an answer under each question; the loop resumes once all are answered.
- **Review** — read DELIVERED, optionally write review feedback (sends it back), or tick to accept → archived to `DONE.md`.
- **New story** composer — write free text and choose the groom/worker models inline; it lands as a `DRAFT:` the loop grooms into a story.

Edits save on blur/Enter as field patches; if the file changed on disk under your edit, the disk
value wins and a toast tells you. The board performs only the three human actions — promote, accept
and demote — everything else is a field patch the loops react to on their next pass.

## Loop terminals

The ▶ buttons open a plain VSCode terminal named `Claude <Model>` in the workspace root and run
`claude --model <m> --permission-mode <cfg>` with a tiny bootstrap prompt that points the loop at
`.loopboard/LOOP.md`'s Automation section — the standing instructions each loop re-reads every pass.
↻ disposes and respawns for a fresh context. Loops die with the VSCode window; restart is one click,
since all state lives in `.loopboard/`.

## Settings

Every setting below is generated from `contributes.configuration` in `package.json`, grouped and
ordered exactly as VSCode's own settings page renders them.

<!-- loopboard:settings:begin -->

### LoopBoard: Models

| Setting | Default | Description |
|---|---|---|
| `loopBoard.defaultWorkerModel` | `sonnet` | The model that owns (works) tasks with no explicit `model:` field. |
| `loopBoard.defaultGroomerModel` | `opus` | The model that grooms tasks/drafts with no explicit `groomer:` field. |
| `loopBoard.models.opus.enabled` | `true` | **Opus slot.** Show it in the Loops overview and the board's model selects. The two settings below apply to this slot. |
| `loopBoard.models.opus.model` | `""` | Custom `--model` string spawned for the Opus slot (e.g. `opus[1m]`). Empty = `opus`. Invalid strings are ignored. |
| `loopBoard.models.opus.effort` | `high` | Grooming-subagent reasoning-effort ceiling for the Opus slot (Rule 14 in `LOOP.md`) — the loop chooses low..this ceiling by story complexity, reserving xhigh/max for when the ceiling allows it and the story explicitly asks for deep reasoning. |
| `loopBoard.models.sonnet.enabled` | `true` | **Sonnet slot.** Show it in the Loops overview and the board's model selects. The two settings below apply to this slot. |
| `loopBoard.models.sonnet.model` | `""` | Custom `--model` string spawned for the Sonnet slot (e.g. `sonnet[1m]`). Empty = `sonnet`. Invalid strings are ignored. |
| `loopBoard.models.sonnet.effort` | `high` | Grooming-subagent reasoning-effort ceiling for the Sonnet slot (Rule 14 in `LOOP.md`) — the loop chooses low..this ceiling by story complexity, reserving xhigh/max for when the ceiling allows it and the story explicitly asks for deep reasoning. |
| `loopBoard.models.fable.enabled` | `true` | **Fable slot.** Show it in the Loops overview and the board's model selects. The two settings below apply to this slot. |
| `loopBoard.models.fable.model` | `""` | Custom `--model` string spawned for the Fable slot. Empty = `fable`. Invalid strings are ignored. |
| `loopBoard.models.fable.effort` | `high` | Grooming-subagent reasoning-effort ceiling for the Fable slot (Rule 14 in `LOOP.md`) — the loop chooses low..this ceiling by story complexity, reserving xhigh/max for when the ceiling allows it and the story explicitly asks for deep reasoning. |

### LoopBoard: Loop Behavior

| Setting | Default | Description |
|---|---|---|
| `loopBoard.loopInterval` | `1m` | Interval passed to `/loop` (e.g. `1m`, `5m`). Frozen into the spawn command, so a change reaches a running loop only after you restart it with ♻. |
| `loopBoard.afterTask` | `none` | What to do with a model's loop terminal once it finishes a task. Replaces the old `loopBoard.autoRecycle` / `loopBoard.clearSessionAfterTask` pair — if you still have either of those set and have not set this one, it is honoured (on → `recycle`, clear → `clear`). You can always restart a loop by hand with ♻. |
| `loopBoard.nudgeLoops` | `true` | When a board change gives one loop something to do — a note, a story whose questions are now FULLY answered, review feedback, a task promoted to Backlog — paste a line naming that task into that model's running loop terminal, so it acts on the change now instead of on its next scheduled pass. The text only seeds the REPL input, so it never interrupts work in flight, and it only ever supplements the loop's own board re-read. No terminal for that model: the nudge is held for its next start. Off disables the nudges entirely; loops keep working exactly as before. |
| `loopBoard.permissionMode` | `auto` | `--permission-mode` passed to the `claude` CLI when spawning a loop terminal. Frozen into the spawn command, so a change reaches a running loop only after you restart it with ♻. |
| `loopBoard.pulseTemplateSync` | `true` | Subtly pulse the sidebar's Synchronise Templates row when TODO.md/LOOP.md differ from the shipped templates, so it's easy to notice there's scaffolding to refresh. Off disables the animation entirely (independent of the OS-level reduced-motion setting, which is honoured either way). |
| `loopBoard.customRules` | `[]` | Extra standing instructions for the loop workers in THIS workspace, one per entry. Workspace-only: set it in Workspace settings — a User-level (global) value is ignored, because this setting writes into the workspace's `.loopboard/LOOP.md` and a global value would edit every open LoopBoard workspace at once. Entries are rendered into a `## Custom rules (workspace)` block in `.loopboard/LOOP.md`, which workers re-read every pass — so an edit reaches running loops with no terminal recycle. The block is hand-editable and Synchronise Templates never touches it: the extension only reconciles the lines carrying its own `loopboard:custom-rule:` marker, so removing an entry here removes its line while rules you add by hand are left alone. Custom Rules are numbered in their own sequence ("Custom Rule 1", "Custom Rule 2", …), separate from the predefined Rules 1-17, and where a Custom Rule contradicts a predefined Rule the Custom Rule wins in this workspace. |
| `loopBoard.debug` | `off` | Opt-in verbose trace. With `info`/`verbose`, LoopBoard appends timestamped lines to `.loopboard/debug.log`. Field **values are logged verbatim** (no eliding) — this is safe because the log stays local under the gitignored `.loopboard/` and is never committed. The log is tail-capped at 10 MB (oldest lines dropped); there is no separate command to open it. |
| `loopBoard.maxAttachmentSizeMB` | `10` | Maximum size (MB) for an image attached to a task (drag-drop, paste, or the picker). Attachments are staged under `.loopboard/cache/` and cleaned up on acceptance. |
| `loopBoard.autoRecycle` | `false` | **Deprecated.** Replaced by `loopBoard.afterTask`. Still honoured while `loopBoard.afterTask` is unset (on → `recycle`); set that instead and clear this. |
| `loopBoard.clearSessionAfterTask` | `false` | **Deprecated.** Replaced by `loopBoard.afterTask`. Still honoured while `loopBoard.afterTask` is unset (on → `clear`); set that instead and clear this. |

<!-- loopboard:settings:end -->

See [FAQ.md](https://github.com/SinnConsulting/LoopBoard/blob/main/FAQ.md) for common questions (e.g. why there's no Haiku slot).

### Workspace custom rules (`loopBoard.customRules`)

Extra standing instructions for the loop workers in **this** workspace — one single-line rule per
array entry:

```jsonc
"loopBoard.customRules": [
  "There must be a PR after a task has been completed"
]
```

They are rendered into a `## Custom rules (workspace)` block in `.loopboard/LOOP.md`. Workers
re-read that file on every pass, so an edit reaches running loops immediately — no terminal
recycle.

- **Numbered separately.** Custom Rules get their own sequence — "Custom Rule 1", "Custom Rule 2",
  … — disjoint from the predefined Rules 1-17 under `## Rules`, which this feature never reads,
  renumbers or rewrites. Numbers are positional, so removing one renumbers those below it.
- **A Custom Rule wins** over a predefined Rule it contradicts, in this workspace. That is how a
  workspace re-tightens something the shipped template relaxes. It is prose the worker reads, not
  something the extension enforces or validates.
- **Synchronise Templates never touches the block** — it lives in the `loopboard:custom` marker
  namespace, which the template sync machinery does not see.
- **The block is yours to edit.** The extension reconciles only the lines carrying its own
  `loopboard:custom-rule:` marker: removing an entry from the setting removes exactly its line, and
  clearing the setting removes every marked line while leaving the block, its lead-in prose and any
  rules you added by hand. Editing a marked line by hand *adopts* it — the marker is dropped and
  the line becomes yours (the setting's original wording then reappears as a new marked line, so
  prefer editing the setting).

### Configuring models (`loopBoard.models.<slot>`)

The built-in model slots — `opus`, `sonnet`, `fable` — are what you assign to tasks
(`model:` / `groomer:`) and what the sidebar **Loops** rows spawn. Each slot is configured through
three keys:

- `loopBoard.models.<slot>.enabled` — show/hide the slot in the Loops overview and the board's model selects.
- `loopBoard.models.<slot>.model` — the actual string passed as `claude --model <string>` (e.g. `opus[1m]` or a dated snapshot). Empty falls back to the slot's built-in default; anything outside `[A-Za-z0-9._\[\]-]` is rejected before it reaches the terminal.
- `loopBoard.models.<slot>.effort` — grooming-subagent reasoning-effort ceiling (`low`…`max`) for that slot, per Rule 14 in `LOOP.md`.

```jsonc
// Pin Opus to a dated snapshot; run Sonnet with the 1M-context window; hide Fable.
"loopBoard.models.opus.model": "claude-opus-4-8",
"loopBoard.models.sonnet.model": "sonnet[1m]",
"loopBoard.models.fable.enabled": false
```

> Migrating from "Claude TODO Board" (≤ 0.1.1): the extension, command, and settings ids were
> renamed from `claudeTodo.*` to `loopBoard.*` with no fallback — re-enter any custom settings.json
> values under the new keys.

## Build & contribute (Docker only)

Node and every other tool run **inside Docker** — nothing is installed on the host, which needs
only Docker, `make`, git, and VSCode (`engines.vscode` is `^1.90.0`), plus an authenticated Claude
Code CLI to run the loops. `make check` is the verification gate and must be green before any
commit; pressing **F5** to launch an Extension Development Host against this repo's own
`.loopboard/` tracker is an optional extra smoke test. All toolchain commands are wrapped in the
`Makefile`:

```
make install    # npm install (typescript + @types/vscode only) in node:22
make build      # tsc -> out/
make test       # compile pure modules + run node --test round-trip / merge suites
make check      # build + test — the gate that must pass before committing
make package    # build a .vsix via @vscode/vsce
```

Zero runtime dependencies; the webview is vanilla HTML/CSS/JS with a CSP nonce on every script.

## Security model

**Treat `.loopboard/` and workspace settings as trusted input.** LoopBoard points an autonomous
`claude` session at `.loopboard/LOOP.md`'s Automation block, running with the configured
`loopBoard.permissionMode` — which may be `bypassPermissions`. Anything written into `LOOP.md` (or
the task files it opens), or into `.vscode/settings.json`, steers an agent that can run commands on
your machine. This is inherent to what LoopBoard does, not a bug.

- A `.loopboard/` from a source you don't control (a cloned repo, a shared workspace) is a
  prompt-injection vector with arbitrary-command-execution reach.
- **Review `.loopboard/LOOP.md` before starting a loop in a repo you didn't author**, and set
  `loopBoard.permissionMode` no higher than you're comfortable running unattended.

VSCode Workspace Trust gates activation, but trusting a repo to open it is not the same as vetting
what its `.loopboard/` will tell an agent to do.

## Usage volume

Advertised usage limits for Pro and Max plans assume *"ordinary, individual usage of Claude Code and
the Agent SDK."* A tight loop (the default is `1m`) spinning multiple model terminals unattended
around the clock can push past that, and Anthropic may rate-limit or enforce against the account.
LoopBoard drives your own locally-authenticated Claude Code CLI — nothing here is against the ToS,
but its design encourages high-frequency multi-model looping, so it's worth being aware of.

---

<div align="center">

**Less prompting. No babysitting. More building.**

MIT License

</div>
