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

LoopBoard turns a `.loopboard/` folder of markdown into a board in VS Code. Claude Code loops
groom, build and deliver the tasks. You decide **what starts, what ships and what goes back**.

<!-- The feature showcase below is generated from docs/showcase/README.md by `make readme`.
     Edit it there, never here. -->
<!-- loopboard:showcase:begin -->

## The whole loop in 17 seconds

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/01-the-loop.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/01-the-loop.gif" width="860" alt="One story travels the whole loop: promoted, claimed and built by the Sonnet loop, delivered with a PR, approved into DONE.md" /></a>
</p>

You **promote** a groomed story. The Sonnet loop claims it, builds it on a `task/**` branch and
delivers it to **Review**. You **approve** it into `DONE.md`. Two clicks; the loop does the rest.

---

## Features

### 1 · Getting started

One click creates `.loopboard/` with `TODO.md`, `LOOP.md` and `tasks/`.

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/09-getting-started.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/09-getting-started.gif" width="860" alt="Initialize scaffolds .loopboard/ and the first story is written" /></a>
</p>

<details>
<summary>Details</summary>

Click **Initialize LoopBoard workspace** or run **`LoopBoard: Initialize Workspace`**. It refuses
if `.loopboard/` already exists. What each file holds: [Storage layout](#storage-layout).

</details>

### 2 · Write a story in plain words

A groomer loop turns it into problem, description, goals and questions for you.

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/02-new-story.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/02-new-story.gif" width="860" alt="A plain-text story becomes a DRAFT and the Opus loop grooms it into problem, description, goals and a question" /></a>
</p>

<details>
<summary>Details</summary>

Click **New Story**, write it like you'd brief a colleague, and pick who **grooms** and who
**builds** it. The groomer loop expands it in a subagent (visible under **Agents** in the sidebar):

- **Problem** — why the task exists.
- **Description** — the groomed story.
- **Goals** — verifiable outcomes; review judges the delivery against them.
- **Questions** — decisions that are yours, often with one-click suggested answers.

Paste, drop or **＋ Attach** screenshots; they're saved under `.loopboard/cache/` and linked from
the story.

</details>

### 3 · Promote & demote

Promote puts a story in the Backlog, the only place loops take work from. Demote takes it back.

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/03-gates.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/03-gates.gif" width="860" alt="Promote moves a story to Backlog, Demote sends it back to New" /></a>
</p>

<details>
<summary>Details</summary>

- **Promote** moves a story from New to **Backlog**, the only place a loop claims work from.
- **Demote** moves it back to New, nothing lost — refused once a loop has claimed it.
- Loops never promote or approve, and the board never moves a card before the file says so.

At most one task is **In Progress** across the board; the sidebar shows which.

</details>

### 4 · Answer questions

A stuck loop parks the task in Feedback instead of guessing. Answer, and it resumes.

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/04-feedback.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/04-feedback.gif" width="860" alt="A task parked in Feedback; accepting a suggested answer lets the loop resume" /></a>
</p>

<details>
<summary>Details</summary>

A loop that needs your decision parks the task in **Feedback** and stops. Once every question is
answered, the loop resumes it. LoopBoard also **nudges** that loop's terminal, so it acts now
instead of on its next pass — without interrupting work in flight.

</details>

### 5 · Review, send back or approve

Review feedback sends the task back for rework. Approve archives it to `DONE.md`.

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/05-review.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/05-review.gif" width="860" alt="Review feedback sends a task back; the loop reworks it; Approve archives it to DONE.md" /></a>
</p>

<details>
<summary>Details</summary>

Delivered work lands in **Review** with its `## Delivered` summary and a link to its PR or branch.

- **Not right?** Write review feedback. The loop reworks the task and delivers again.
- **Right?** Click **Approve**. It moves to `DONE.md`; the task file stays in `tasks/`.

Loops never commit to `main` and never merge. Merging is your call.

</details>

### 6 · Loop terminals

▶ starts one Claude Code terminal per model, with live context usage. Right-click to schedule.

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/06-loops.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/06-loops.gif" width="860" alt="Starting loops, watching context usage and scheduling a restart" /></a>
</p>

<details>
<summary>Details</summary>

Each **▶** opens a VS Code terminal named `Claude <Model>` running one command:

```sh
claude --permission-mode auto --model 'opus' --effort medium --name loopboard-opus-<id> \
  '/loop 5m You are running as model opus with a grooming concurrency cap of 3. Open .loopboard/LOOP.md, …'
```

The prompt only points at the **Automation** section of `.loopboard/LOOP.md`, which the loop
re-reads every pass — edit your rules there and running loops follow.

- **Context bar** — set `loopBoard.contextLimit.percent` to restart (or `/clear`) a session at that
  mark. A loop holding the In Progress task is never interrupted; the restart waits.
- **♻ / ■** — restart with a fresh context, or stop. **Right-click** ▶ ♻ ■ to schedule it.

The Claude sessions in these recordings are simulated (VS Code can't read a terminal); the spawn
line is the real one.

</details>

### 7 · Markdown is the source of truth

A click rewrites `TODO.md`; an edit to `TODO.md` repaints the board. No database.

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/07-markdown.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/07-markdown.gif" width="860" alt="Promoting rewrites TODO.md; editing TODO.md repaints the board" /></a>
</p>

<details>
<summary>Details</summary>

- **Board → file.** Each save re-reads the file, changes one field and writes it back atomically
  (temp file + rename), so you, the board and several loops can share it safely.
- **File → board.** A hand edit, a `git pull` or a loop's write repaints the board. If your save
  collides with a change to the same field, the disk wins and a toast tells you.

`.loopboard/` is plain files you own; they outlive the extension.

</details>

### 8 · Settings

Every model in one grid: `--model`, effort, groomers. Plain VS Code user settings.

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/08-settings.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/08-settings.gif" width="860" alt="The settings page: model-slot grid, custom --model, effort, switching a slot off" /></a>
</p>

<details>
<summary>Details</summary>

The sidebar's **Settings** row opens LoopBoard's settings page. One grid covers every model:
**on**, **default worker**, **default groomer**, **`--model`**, **effort**, **groomers**. Other
settings are grouped below.

- These are **VS Code user settings**; a cloned repo can never change how much authority your agent
  gets.
- Spawn-time settings (`--model`, effort, interval, permission mode, …) apply on the next ▶ or ♻.

</details>

---

## Storage layout

```
.loopboard/
  TODO.md          task index — one entry per active task (id, phase, model, groomer, Q&A)
  DONE.md          approved tasks, newest first (created on the first approval)
  LOOP.md          workflow rules + the loop instructions, re-read every pass
  tasks/<id>.md    per task: meta, problem, description, goals, worklog, delivered
  cache/<id>/      attached images (created on the first attach)
```

- **Field-level, atomic saves.** Every save re-reads the file, patches one field and writes the
  whole file back (temp file + rename). On approval the index entry moves to `DONE.md`; the task
  file stays in `tasks/`.
- **Images.** Drop, paste or **＋ Attach** them on a card, an answer or the New Story composer.
  They're stored under `.loopboard/cache/<id>/`, linked from the task, and deleted on approval.
- **Commit it or ignore it.** LoopBoard doesn't touch your `.gitignore`: commit `.loopboard/` to
  share the tracker, or ignore it to keep it local.

---

## Workspace custom rules

Add standing instructions for **this** workspace in `.loopboard/LOOP.md` — free markdown, no
setting. New workspaces ship the empty section; in older ones, add it:

```markdown
<!-- loopboard:custom:begin -->
## Custom rules (workspace)

Standing instructions for THIS workspace — add yours here as free text, edited directly in this
file; where they contradict a Rule above, they win in this workspace. Sync never rewrites this
section.

1. Open a PR before moving a task to Review.
<!-- loopboard:custom:end -->
```

- **Live.** Loops re-read `LOOP.md` every pass; no restart needed. LoopBoard never reads or edits
  the section.
- **Survives template sync.** Sync (on activation while `loopBoard.autoSyncTemplates` is on, or
  **Synchronise Templates** on the settings page) rewrites only `loopboard:sync:` blocks.
  Exception: a `LOOP.md` with no `loopboard:sync:` markers at all is replaced whole, after a backup
  to `.loopboard/LOOP.md.bkp`.
- **Custom wins.** Where a custom rule contradicts a built-in Rule, loops follow yours.

---

## Cheat sheet

| You | The loops |
|---|---|
| Write a story in plain words | Groom it into problem, description, goals, questions |
| **Promote** New → Backlog | Claim the top Backlog task (one In Progress, board-wide) |
| Answer questions | Resume the parked task |
| Write review feedback | Rework and deliver again |
| **Approve** Review → `DONE.md` | Nothing — it's done |
| **Demote** Backlog → New | Leave it alone until promoted again |

---

<details>
<summary><b>About these recordings</b></summary>

No mock-ups. Each GIF runs the extension's **real webview code** (`media/board.js`,
`media/sidebar.js`, `media/settings.js`) in headless Chromium, answered by the **same pure modules
the extension ships** — so every click rewrites the markdown exactly as the extension would.
Scripted time makes them reproducible:

```sh
make showcase                 # every scene → docs/showcase/gifs/*.gif, then refresh README.md
make showcase SCENES="01 07"  # only the scenes named
make readme                   # README.md only: copy this page's showcase in, regenerate settings
```

Everything runs in Docker (`docs/showcase/studio/Dockerfile`) with no network access; scenes live
in `docs/showcase/studio/scenes/`.

</details>

<!-- loopboard:showcase:end -->

---

## Small on purpose

- **Markdown is the source of truth.** The board is a live view of `.loopboard/`, never a second
  database.
- **Three human actions:** promote, accept, demote — the **Promote**, **Approve** and **Demote**
  buttons. Everything else is a field the loops read on their next pass.
- **Zero runtime dependencies.** Vanilla HTML/CSS/JS webviews with a CSP nonce on every script.
- **Native VS Code only.** A webview, an activity-bar view and plain terminals. No hooks, no files
  outside `.loopboard/`. Uninstall it and only `.loopboard/` remains.

```
     you click Promote                               you click Approve
             │                                               │
   New ──────┴──────► Backlog ────► In Progress ────► Review ┴────► Done (DONE.md)
    ▲                    │               ▲   │
    └── you click Demote ┘               │   └──► Feedback ─┐
                                         │                  │
                                         └──────────────────┘
                                          (your answers resume it)
```

## Get started

1. Install LoopBoard. You need VS Code 1.90+ and a logged-in **Claude Code CLI 2.1.0+**.
2. Run **LoopBoard: Initialize Workspace**.
3. Write a story, then press **▶** on a loop in the sidebar.

Commands:

- **LoopBoard: Initialize Workspace** — create `.loopboard/` (refuses if it exists).
- **LoopBoard: Open Board** — open the board.
- **LoopBoard: Refresh** — re-read `.loopboard/` after an edit made outside VS Code.
- **LoopBoard: Start Loop** — start a loop terminal, like ▶ in the sidebar.

Loop terminal closes the moment it starts? Check `claude --version`: older CLIs reject the `--name`
flag, and VS Code can't show why. Loop terminals close with the window; ▶ brings them back, since
all state lives in `.loopboard/`.

## Security model

**Treat `.loopboard/` as trusted input.** A loop is an autonomous `claude` session that follows
`.loopboard/LOOP.md` with your `loopBoard.permissionMode` — possibly `bypassPermissions`. Whatever
`LOOP.md` or a task file says, the agent may run on your machine.

- A `.loopboard/` you didn't write (a cloned repo, a shared workspace) is a prompt-injection
  vector. **Read `.loopboard/LOOP.md` before pressing ▶** in a repo you didn't author.
- Set `loopBoard.permissionMode` no higher than you'd run unattended.
- **Repos can't raise it.** Every `loopBoard.*` key is `"scope": "application"`: user settings
  only. A repo's `.vscode/settings.json` or `.devcontainer/devcontainer.json` cannot set them.
- VS Code Workspace Trust gates activation — but trusting a repo is not vetting its `LOOP.md`.

## Usage volume

Pro and Max limits assume *"ordinary, individual usage of Claude Code and the Agent SDK."* Several
loops running around the clock (default interval `5m`) can exceed that and get the account
rate-limited. LoopBoard drives your own Claude Code CLI and breaks no terms — just watch the
volume.

## Build & contribute (Docker only)

Everything runs in Docker; the host needs only Docker, `make`, git and VS Code. `make check` must
pass before every commit; **F5** launches an Extension Development Host on this repo's own
`.loopboard/`.

```
make install    # npm install (typescript + @types/vscode only) in node:22
make build      # tsc -> out/
make test       # compile the pure modules + run the node --test suites
make check      # build + test — the gate before every commit
make package    # build a .vsix via @vscode/vsce
make readme     # rebuild this README's generated parts (showcase + settings tables)
make showcase   # re-record the showcase GIFs, then make readme
```

Parts of this README are generated: the showcase from
[`docs/showcase/README.md`](https://github.com/SinnConsulting/LoopBoard/blob/main/docs/showcase/README.md),
the settings tables from `package.json`. Edit those, run `make readme`; `make check` fails while
either is stale.

## Settings

The sidebar's **Settings** row opens LoopBoard's settings page: four sections, the model slots as
one grid, a reset per setting, **Synchronise Templates**, and **Open in VSCode Settings**
(`@ext:SinnConsulting.loopboard-todo`) for search and JSON. They're ordinary user settings — see
[Security model](#security-model) for why they're user-only. Questions like "why no Haiku slot?"
are answered in [FAQ.md](https://github.com/SinnConsulting/LoopBoard/blob/main/FAQ.md).

### Model slots (`loopBoard.models.<slot>`)

The slots `opus`, `sonnet` and `fable` are what tasks name (`model:` / `groomer:`) and what the
sidebar's **Loops** rows start. Each has four keys:

- `.enabled` — show or hide the slot.
- `.model` — the string passed as `claude --model` (e.g. `opus[1m]`). Empty = the slot name;
  anything outside `[A-Za-z0-9._\[\]-]` is rejected.
- `.effort` — `claude --effort` for the loop session and every subagent it starts (`low`…`max`,
  default `medium`).
- `.groomConcurrency` — grooming subagents per pass (default `3`, minimum `1`). Extra tasks wait
  for a later pass.

These, like `loopBoard.loopInterval`, `loopBoard.delegateWork` and `loopBoard.delegateReview`, apply
on the slot's next **▶** or **♻**; a running loop keeps what it started with.

<details>
<summary><b>Migration notes</b></summary>

- **Workspace settings are ignored.** A `loopBoard.*` value in `.vscode/settings.json` or a
  `.code-workspace` file no longer applies; move it to your user settings. Repos can no longer
  ship team defaults — deliberately.
- **`loopBoard.delegateWork.review` → `loopBoard.delegateReview`.** The old key never took effect
  (VS Code can't give a boolean setting a child key); set the new one and delete the old line.
- **`claudeTodo.*` → `loopBoard.*`** (from "Claude TODO Board" ≤ 0.1.1), no fallback: re-enter
  custom values under the new keys.

</details>

### All settings

Generated from `contributes.configuration` in `package.json`, in the order the settings pages
show them.

<!-- loopboard:settings:begin -->

### LoopBoard: Models & Slots

| Setting | Default | Description |
|---|---|---|
| `loopBoard.defaultWorkerModel` | `sonnet` | The model that owns (works) tasks with no explicit `model:` field. |
| `loopBoard.defaultGroomerModel` | `opus` | The model that grooms tasks/drafts with no explicit `groomer:` field. |
| `loopBoard.models.opus.enabled` | `true` | **Opus slot.** Show it in the Loops overview and the board's model selects. The two settings below apply to this slot. |
| `loopBoard.models.opus.model` | `""` | Custom `--model` string spawned for the Opus slot (e.g. `opus[1m]`). Empty = `opus`. Invalid strings are ignored. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.models.opus.effort` | `medium` | Reasoning effort the Opus slot's loop session is started with, passed as `claude --effort`. Every subagent the loop spawns (grooming, and with `loopBoard.delegateWork` on the implementer and review subagents) runs at the same effort. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.models.opus.groomConcurrency` | `3` | Cap on how many grooming subagents the Opus slot's loop may run in parallel during one pass (Rule 14 in `LOOP.md`). Eligible tasks over the cap are left in place, taken in index order top down, and picked up on a later pass — nothing is queued or dropped. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.models.sonnet.enabled` | `true` | **Sonnet slot.** Show it in the Loops overview and the board's model selects. The two settings below apply to this slot. |
| `loopBoard.models.sonnet.model` | `""` | Custom `--model` string spawned for the Sonnet slot (e.g. `sonnet[1m]`). Empty = `sonnet`. Invalid strings are ignored. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.models.sonnet.effort` | `medium` | Reasoning effort the Sonnet slot's loop session is started with, passed as `claude --effort`. Every subagent the loop spawns (grooming, and with `loopBoard.delegateWork` on the implementer and review subagents) runs at the same effort. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.models.sonnet.groomConcurrency` | `3` | Cap on how many grooming subagents the Sonnet slot's loop may run in parallel during one pass (Rule 14 in `LOOP.md`). Eligible tasks over the cap are left in place, taken in index order top down, and picked up on a later pass — nothing is queued or dropped. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.models.fable.enabled` | `true` | **Fable slot.** Show it in the Loops overview and the board's model selects. The two settings below apply to this slot. |
| `loopBoard.models.fable.model` | `""` | Custom `--model` string spawned for the Fable slot. Empty = `fable`. Invalid strings are ignored. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.models.fable.effort` | `medium` | Reasoning effort the Fable slot's loop session is started with, passed as `claude --effort`. Every subagent the loop spawns (grooming, and with `loopBoard.delegateWork` on the implementer and review subagents) runs at the same effort. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.models.fable.groomConcurrency` | `3` | Cap on how many grooming subagents the Fable slot's loop may run in parallel during one pass (Rule 14 in `LOOP.md`). Eligible tasks over the cap are left in place, taken in index order top down, and picked up on a later pass — nothing is queued or dropped. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |

### LoopBoard: Agent Setup

| Setting | Default | Description |
|---|---|---|
| `loopBoard.permissionMode` | `auto` | `--permission-mode` passed to the `claude` CLI when spawning a loop terminal. This setting is deliberately **user-scoped only** — a cloned repository must never be able to decide how much authority your agent runs with. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.loopInterval` | `5m` | Interval passed to `/loop` (e.g. `1m`, `5m`). Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.afterTask` | `none` | What to do with a model's loop terminal once it finishes a task. Replaces the old `loopBoard.autoRecycle` / `loopBoard.clearSessionAfterTask` pair — if you still have either of those set and have not set this one, it is honoured (on → `recycle`, clear → `clear`). Whatever this is set to, the ♻ button still recycles a loop by hand at any time. |
| `loopBoard.contextLimit.percent` | `0` | Automatically restart a loop once its Claude session fills this percentage of its context window. `0` (default) never restarts a loop for its context size — the usage bar under each running loop row still shows. The window is taken from the model that actually ran, as recorded in the session transcript (the 5-series models are 1,000,000 tokens natively; a `[1m]` suffix also means 1,000,000; anything unrecognised falls back to 200,000), so `50` on a 1M slot is the 500k mark. A loop that owns the In Progress task is **never** interrupted: the restart waits for it to go idle. |
| `loopBoard.contextLimit.action` | `recycle` | What to do with a loop terminal when `loopBoard.contextLimit.percent` trips. Independent of `loopBoard.afterTask`, which reacts to a finished task rather than to context size. |
| `loopBoard.nudgeLoops` | `true` | When a board change gives one loop something to do — a note, a story whose questions are now FULLY answered, review feedback, a task promoted to Backlog — paste a line naming that task into that model's running loop terminal, so it acts on the change now instead of on its next scheduled pass. The text only seeds the REPL input, so it never interrupts work in flight, and it only ever supplements the loop's own board re-read. No terminal for that model: the nudge is held for its next start. Off disables the nudges entirely; loops keep working exactly as before. |
| `loopBoard.autoRecycle` | `false` | **Deprecated.** Replaced by `loopBoard.afterTask`. Still honoured while `loopBoard.afterTask` is unset (on → `recycle`); set that instead and clear this. |
| `loopBoard.clearSessionAfterTask` | `false` | **Deprecated.** Replaced by `loopBoard.afterTask`. Still honoured while `loopBoard.afterTask` is unset (on → `clear`); set that instead and clear this. |

### LoopBoard: Board & Workspace

| Setting | Default | Description |
|---|---|---|
| `loopBoard.maxAttachmentSizeMB` | `10` | Maximum size (MB) for an image attached to a task (drag-drop, paste, or the picker). Attachments are staged under `.loopboard/cache/` and cleaned up on acceptance. |
| `loopBoard.autoSyncTemplates` | `true` | Sync `.loopboard/` TODO.md and LOOP.md to the templates this extension ships, automatically, once when the window loads or the extension updates. It updates the extension-owned `loopboard:sync:` blocks and recreates missing files, and does a one-time legacy replacement of an unmarked LOOP.md (the old file is kept as `.loopboard/LOOP.md.bkp`) or an unmarked TODO.md intro. The `loopboard:custom` section and every task entry are never touched. Each auto-sync that writes shows a popup naming what changed. Off: nothing syncs by itself — use **Synchronise Templates** at the top of the LoopBoard settings page. |
| `loopBoard.sidebarMarquee` | `false` | Scroll long In Progress task titles and subagent labels in the sidebar back and forth so the whole text passes by. Off (default) holds them still and truncates them with `…` instead; hover a row for the full text. The OS-level reduced-motion setting is honoured either way. |
| `loopBoard.debug` | `off` | Opt-in verbose trace. With `info`/`verbose`, LoopBoard appends timestamped lines to `.loopboard/debug.log`. Field **values are logged verbatim** (no eliding) — this is safe because the log stays local under the gitignored `.loopboard/` and is never committed. The log is tail-capped at 10 MB (oldest lines dropped); there is no separate command to open it. |

### LoopBoard: Beta (experimental)

| Setting | Default | Description |
|---|---|---|
| `loopBoard.delegateWork` | `false` | **Beta —** experimental; this setting may change or be withdrawn in a future release. Off (default): each loop grooms through a subagent (Rule 14 in `LOOP.md`) but implements tasks inline in its own session. On: the loop also delegates every code-editing step — the Backlog claim, a Feedback resume, Review-feedback rework, code-touching notes — to an implementer subagent on the loop's own slot model, running at the loop session's effort (that slot's `.effort`); the subagent branches, commits and opens the PR, while the loop keeps all `.loopboard/` bookkeeping. With `loopBoard.delegateReview` on (default) a second, sequential review subagent gates that PR before the loop sets Review. Either way the loop never merges: a delivered task sits in Review with its PR still open, waiting for you to tick it and merge. The behaviour itself lives in the Automation section of `LOOP.md`; only the mode rides the loop's bootstrap prompt. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |
| `loopBoard.delegateReview` | `true` | **Beta —** experimental; this setting may change or be withdrawn in a future release. Only applies while `loopBoard.delegateWork` is on. On (default): after the implementer subagent returns its PR, a review subagent (same slot model, same session effort) reviews it; a pass takes the task straight to Review with the PR open, awaiting your tick; a fail is handed back to the implementer once, then parks the task in Feedback with the findings as questions. Off: no review subagent runs — the implementer's PR goes to Review directly, exactly like the non-delegated flow. Either way the loop never merges a PR: merging is always yours. Applies on the next loop start (▶) or restart (♻): a running loop keeps what it was spawned with. |

<!-- loopboard:settings:end -->

---

<div align="center">

**Less prompting. No babysitting. More building.**

MIT License

</div>
