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

<!-- The feature showcase below is generated from docs/showcase/README.md by `make readme`.
     Edit it there, never here. -->
<!-- loopboard:showcase:begin -->

## The whole loop in 17 seconds

<p align="center">
  <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/01-the-loop.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/01-the-loop.gif" width="860" alt="One story travels the whole loop: promoted, claimed and built by the Sonnet loop, delivered with a PR, approved into DONE.md" /></a>
</p>

A groomed story waits in **New**. You **promote** it, and the Sonnet loop's next pass claims it,
builds it on a `task/**` branch, opens a PR and moves it to **Review**. You **approve** it, and
it's archived to `DONE.md`. You made two clicks. The loop did everything in between.

---

## Features at a glance

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>1 · Getting started</h3>
      <p>One click scaffolds <code>.loopboard/</code> (<code>TODO.md</code>, <code>LOOP.md</code>, <code>tasks/</code>) and you write your first story.</p>
      <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/09-getting-started.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/09-getting-started.gif" width="100%" alt="Initialize scaffolds .loopboard/ and the first story is written" /></a>
    </td>
    <td width="50%" valign="top">
      <h3>2 · Write a story in plain words</h3>
      <p>It lands in New as a <code>DRAFT:</code>. The groomer loop turns it into a problem, a description, goals and questions for you.</p>
      <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/02-new-story.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/02-new-story.gif" width="100%" alt="A plain-text story becomes a DRAFT and the Opus loop grooms it into problem, description, goals and a question" /></a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>3 · Promote &amp; demote</h3>
      <p>Promote sends a story to the Backlog, the only place a loop claims work from. Demote undoes it, and nothing is lost.</p>
      <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/03-gates.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/03-gates.gif" width="100%" alt="Promote moves a story to Backlog, Demote sends it back to New" /></a>
    </td>
    <td width="50%" valign="top">
      <h3>4 · Answer questions</h3>
      <p>A blocked loop parks the task in Feedback instead of guessing. Answer it, or accept a suggestion, and the loop resumes.</p>
      <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/04-feedback.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/04-feedback.gif" width="100%" alt="A task parked in Feedback; accepting a suggested answer lets the loop resume" /></a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>5 · Review, send back or accept</h3>
      <p>Read what was delivered. Review feedback sends the task back for rework, and Approve archives it to <code>DONE.md</code>.</p>
      <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/05-review.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/05-review.gif" width="100%" alt="Review feedback sends a task back; the loop reworks it; Approve archives it to DONE.md" /></a>
    </td>
    <td width="50%" valign="top">
      <h3>6 · Loop terminals</h3>
      <p>▶ starts one Claude Code terminal per model slot. Each row shows live context usage, and a right-click schedules a restart.</p>
      <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/06-loops.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/06-loops.gif" width="100%" alt="Starting loops, watching context usage and scheduling a restart" /></a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>7 · Markdown is the source of truth</h3>
      <p>A click on the board rewrites <code>TODO.md</code>, and an edit to <code>TODO.md</code> repaints the board. There's no database.</p>
      <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/07-markdown.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/07-markdown.gif" width="100%" alt="Promoting rewrites TODO.md; editing TODO.md repaints the board" /></a>
    </td>
    <td width="50%" valign="top">
      <h3>8 · Settings</h3>
      <p>All three model slots in one grid: <code>--model</code>, effort and groomers. They're plain VS Code user settings.</p>
      <a href="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/08-settings.gif"><img src="https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/docs/showcase/gifs/08-settings.gif" width="100%" alt="The settings page: model-slot grid, custom --model, effort, switching a slot off" /></a>
    </td>
  </tr>
</table>

---

## Details

<details>
<summary><b>1 · Getting started</b></summary>

Open any repository and click **Initialize LoopBoard workspace**, or run
**`LoopBoard: Initialize Workspace`** from the Command Palette. It refuses if `.loopboard/` already
exists.

| File | What it holds |
|---|---|
| `TODO.md` | The slim task index: one entry per active task (id, phase, model, groomer, Q&A) |
| `LOOP.md` | The workflow rules and the standing instructions every loop re-reads on each pass |
| `tasks/<id>.md` | Per-task detail: problem, description, goals, worklog, delivered |
| `DONE.md` | Accepted work, newest first. It's created on your first acceptance |

**Requires Claude Code 2.1.0 or newer.** Loops are spawned with `--name`, which older CLIs reject.

</details>

<details>
<summary><b>2 · Write a story in plain words</b></summary>

Click **New Story**, write the way you'd brief a colleague, and pick which model **grooms** the
story and which one **builds** it. On its next pass the groomer loop expands the draft through a
subagent (the sidebar's **Agents** section shows it while it runs):

- **Problem**: why the task exists, in a few factual sentences.
- **Description**: the groomed story itself.
- **Goals**: one verifiable outcome per bullet. Review later judges the delivery against these.
- **Questions**, if something is genuinely yours to decide, often with one-click suggested answers.

You can paste or drop screenshots into the composer. When you save, they're staged under
`.loopboard/cache/` and linked from the story.

</details>

<details>
<summary><b>3 · Promote &amp; demote</b></summary>

- **Promote** (on New) moves the story to **Backlog**, the only place a loop ever claims work from.
- **Demote** (on Backlog) sends it back to New with nothing lost. The store refuses the demote if
  a loop has already claimed the task.
- Loops never tick a box, and the board never moves a card optimistically: every move is a real
  write to `TODO.md` that the next refresh confirms.

At most one task is **In Progress** across the whole board. The sidebar shows which one, and which
Backlog work is queued behind it.

</details>

<details>
<summary><b>4 · Answer questions</b></summary>

When a loop hits a decision that's yours to make, it parks the task in **Feedback** with a question
and stops. When every question has an answer, the owning loop resumes the task on its own. By
default LoopBoard also **nudges** that loop: it pastes a one-line pointer into the loop's terminal,
so the loop acts now instead of waiting for its next scheduled pass. The nudge never interrupts
work that's already in flight.

</details>

<details>
<summary><b>5 · Review, send back or accept</b></summary>

Finished work lands in **Review** with its `## Delivered` summary and a link to the PR.

- **Not quite right?** Write review feedback. The loop picks the task back up, addresses the
  feedback, removes it and delivers again.
- **Happy with it?** Click **Approve**. The task is archived to `DONE.md` and its task file stays
  in `tasks/` as history.

Loops never merge a PR. Merging is always your call.

</details>

<details>
<summary><b>6 · Loop terminals</b></summary>

Each **▶** opens a plain VS Code terminal named `Claude <Model>` and starts one command:

```sh
claude --permission-mode auto --model 'opus' --effort medium --name loopboard-opus-<id> \
  '/loop 5m You are running as model opus with a grooming concurrency cap of 3. Open .loopboard/LOOP.md, …'
```

The prompt only points the loop at the **Automation** section of `.loopboard/LOOP.md`, which the
loop re-reads on every pass, so if you edit your rules there the running loops follow the edit.

- **Context bar.** Set `loopBoard.contextLimit.percent` and LoopBoard restarts (or `/clear`s) a
  session at that mark. A loop that owns the In Progress task is never interrupted: the restart
  waits until it's idle.
- **♻ / ■** restart a loop with a fresh context, or stop it. **Right-click** any of the three
  buttons to schedule that action.

The Claude sessions shown in these recordings are simulated, because VS Code gives extensions no
way to read a terminal. The spawn line is the one LoopBoard actually sends.

</details>

<details>
<summary><b>7 · Markdown is the source of truth</b></summary>

- **Click on the board → the markdown changes.** Every edit re-reads the file, applies exactly one
  field and writes it back canonically (atomic temp file + rename). That's how you, the board and
  several agent loops can share one file safely.
- **Edit the file → the board follows.** A hand edit, a `git pull` or a loop's write all repaint the
  board. If one of your saves collides with an on-disk change to the same field, the disk wins and
  a toast tells you.

`.loopboard/` is plain files that belong to you, and they survive uninstalling the extension.

</details>

<details>
<summary><b>8 · Settings</b></summary>

The sidebar's **Settings** row opens LoopBoard's own settings page. The model slots are one grid,
with a column each for **on**, **default worker**, **default groomer**, **`--model`**, **effort**
and **groomers**. Every other `loopBoard.*` setting is grouped into sections below it.

- These are ordinary **VS Code user settings**. Every key is application-scoped on purpose: a cloned
  repo can never decide how much authority your agent runs with.
- Spawn-time settings (`--model`, effort, the loop interval, the permission mode and so on) apply on
  the next ▶ start or ♻ restart.

</details>

---

## Cheat sheet

| You | The loops |
|---|---|
| Write a story in plain words | Groom it into problem, description, goals and questions |
| **Promote** New → Backlog | Claim the top Backlog task (one In Progress, board-wide) |
| Answer questions | Resume the parked task |
| Write review feedback | Rework the task and deliver again |
| **Approve** Review → `DONE.md` | Nothing more to do. The work is done |
| **Demote** Backlog → New | Leave it alone until you promote it again |

---

<details>
<summary><b>About these recordings</b></summary>

These GIFs aren't mock-ups. Each one renders the extension's **real webview code**
(`media/board.js`, `media/sidebar.js`, `media/settings.js`) in headless Chromium, inside a VS
Code–styled window. A small stand-in host answers the webviews' messages with the **same pure
modules the extension ships** (parser, writer, merge, gates, view, nudge, settings form), so every
click in a GIF rewrites the markdown exactly as the extension would. Time is fully scripted, so the
recordings are reproducible:

```sh
make showcase                 # every scene → docs/showcase/gifs/*.gif, then refresh README.md
make showcase SCENES="01 07"  # only the scenes named
make readme                   # README.md only: copy this page's showcase in, regenerate settings
```

Everything runs in Docker (`docs/showcase/studio/Dockerfile`: Playwright's Chromium, ffmpeg,
gifsicle), with no network access and the repository as the only mount. The scene scripts live in
`docs/showcase/studio/scenes/`.

</details>

<!-- loopboard:showcase:end -->

---

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
      you click Promote                              you click Approve
             │                                               │
   New ──────┴──────► Backlog ────► In Progress ────► Review ┴────► Done (DONE.md)
    ▲                    │               ▲   │
    └── you click Demote ┘               │   └──► Feedback ─┐
                                         │                  │
                                         └──────────────────┘
                                          (your answers resume it)
```

Promote (New → Backlog) and Approve (Review → `DONE.md`) are clicks only you can make. Demote
(Backlog → New) is immediate and non-destructive. A loop claims the top Backlog task itself — at
most one task board-wide is ever In Progress — and parks in Feedback rather than guessing.

## Requirements & commands

- **VSCode `^1.90.0`** and an authenticated **Claude Code CLI, 2.1.0 or newer**. Loop terminals are
  spawned with `--name`, which is what lets the context-usage bar tell one slot's session from
  another's. An older CLI rejects the unknown option and the terminal exits immediately — and
  because a terminal's output can never be read back, the extension cannot tell you why. If your
  loops die the instant they start, check `claude --version` first.
- Loop terminals die with the VSCode window; restarting is one click, since all state lives in
  `.loopboard/`.

Click the **LoopBoard** icon in the activity bar for the sidebar summary. Every command LoopBoard
adds to the palette:

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
  tasks/<id>.md    per-task detail: meta, problem, description, goals, worklog, delivered
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

## The sidebar

The activity-bar **sidebar** is a read-only, at-a-glance summary — click any row to jump into the
board. From top to bottom:

| | |
|---|---|
| ![LoopBoard sidebar](https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/media/screenshot-sidebar.png) | <ul><li><b>Attention banner</b> — everything currently waiting on you: tasks in <b>Review</b> plus groomed proposals in <b>New</b> that are ready to promote.</li><li><b>Phases</b> — every column (New, Backlog, In Progress, Feedback, Review, Done) with a live task count.</li><li><b>Loops</b> — one row per model (Opus, Sonnet, Fable), each with its assigned role, a running-status dot, a context-usage bar, and ▶ start / ♻ restart / ■ stop controls (right-click any of them to schedule it).</li><li><b>In Progress</b> and <b>Agents</b> — the task being built and any live subagents, shown only while there are some.</li><li><b>Settings</b> — opens LoopBoard's settings page.</li></ul> |

## Workspace custom rules (edit `.loopboard/LOOP.md` directly)

Extra standing instructions for the loop workers in **this** workspace live as a hand-written
section in `.loopboard/LOOP.md` itself — free-form markdown, no setting involved. Freshly
initialized workspaces already carry the empty section (it ships in the template); in an older
workspace, add it yourself:

```markdown
<!-- loopboard:custom:begin -->
## Custom rules (workspace)

Standing instructions for THIS workspace — free text, edited here; where they contradict a
Rule above, they win in this workspace.

1. PRs must be created before moving to in review. Otherwise task not done.
<!-- loopboard:custom:end -->
```

- **The file is the feature.** Workers re-read `LOOP.md` on every pass, so an edit reaches running
  loops immediately — no terminal recycle, no extension involvement. The extension never parses,
  rewrites or validates the section; what you save is exactly what stays.
- **Workspace-isolated by construction.** The text lives in this workspace's `.loopboard/LOOP.md`
  and can apply nowhere else.
- **Template sync never touches it.** Sync runs automatically once per activation (window load or
  extension update) while `loopBoard.autoSyncTemplates` is on (the default), and on demand from the
  **Synchronise Templates** button on the settings page. It rewrites only `loopboard:sync:`-marked
  template blocks; the `loopboard:custom` markers (and any other text outside sync markers) survive
  verbatim. The one caveat: a `LOOP.md` with **no** `loopboard:sync:` markers at all is treated as
  legacy and replaced wholesale — on activation too, without asking — after its previous text is
  backed up to `.loopboard/LOOP.md.bkp`, and a warning popup says so. Any modern `LOOP.md` has
  those markers.
- **Precedence is prose.** A custom rule that contradicts a predefined Rule wins in this workspace
  because the lead-in says so and workers read it — nothing is enforced by the extension.

## Security model

**Treat `.loopboard/` as trusted input.** LoopBoard points an autonomous `claude` session at
`.loopboard/LOOP.md`'s Automation block, running with the configured `loopBoard.permissionMode` —
which may be `bypassPermissions`. Anything written into `LOOP.md`, or into the task files it opens,
steers an agent that can run commands on your machine. This is inherent to what LoopBoard does, not
a bug.

- A `.loopboard/` from a source you don't control (a cloned repo, a shared workspace) is a
  prompt-injection vector with arbitrary-command-execution reach. It stays in the repo by design —
  the tracker *is* the repo's — so it remains the one channel worth reading before you press ▶.
- **Review `.loopboard/LOOP.md` before starting a loop in a repo you didn't author**, and set
  `loopBoard.permissionMode` no higher than you're comfortable running unattended.

**The settings channel is enforced shut.** Every `loopBoard.*` key is declared
`"scope": "application"`, which means user settings only. A repository cannot set one — not through
its `.vscode/settings.json`, and not through a `.devcontainer/devcontainer.json` it ships (which is
why the scope is `application` and not `machine`: `machine` still permits remote settings, and a
dev container's settings come from inside the repo). `loopBoard.permissionMode` is the key this is
really about: a cloned repo must never get to decide how much authority your agent runs with.

VSCode Workspace Trust gates activation, but trusting a repo to open it is not the same as vetting
what its `.loopboard/` will tell an agent to do.

### Migrating from a workspace setting

If you previously set a `loopBoard.*` key in a workspace's `.vscode/settings.json` (or in a
`.code-workspace` file), **that value no longer has any effect** — VSCode does not migrate a
workspace value when a key stops being workspace-settable, it silently ignores it. Move any setting
you still want into your user settings (the sidebar's Settings row, or
`@ext:SinnConsulting.loopboard-todo` in VSCode's own Settings editor, both of which now write there
exclusively), and delete the stale workspace entries. No key was renamed, so the names are
unchanged.

The trade-off is accepted deliberately: a repository can no longer ship its own default models,
effort or delegation mode for a team to share. LoopBoard configuration belongs to the
person, not to the checked-out repo.

## Usage volume

Advertised usage limits for Pro and Max plans assume *"ordinary, individual usage of Claude Code and
the Agent SDK."* A tight loop (the default interval is `5m`; `1m` is tighter still) spinning
multiple model terminals unattended around the clock can push past that, and Anthropic may
rate-limit or enforce against the account. LoopBoard drives your own locally-authenticated Claude
Code CLI — nothing here is against the ToS, but its design encourages high-frequency multi-model
looping, so it's worth being aware of.

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
make readme     # rebuild this README's generated parts (showcase + settings tables)
make showcase   # re-record the showcase GIFs, then make readme
```

This README is partly generated. The feature showcase is copied from
[`docs/showcase/README.md`](https://github.com/SinnConsulting/LoopBoard/blob/main/docs/showcase/README.md)
and the settings tables are rendered from `contributes.configuration` in `package.json`; edit
those sources, then run `make readme`. `make check` fails while either part is stale.

## Settings

The sidebar's **Settings** row opens LoopBoard's own settings page: the same keys, grouped into
four sections, with the three model slots drawn as one clickable grid (on · worker · groomer ·
`--model` · effort · groomers) instead of fourteen flat rows. It carries a modified marker and a
per-setting reset, and keeps an **Open in VSCode Settings** escape hatch to the native
`@ext:SinnConsulting.loopboard-todo` view for settings search and JSON editing. Its header also
holds **Synchronise Templates**, which previews and (after a confirm) syncs this window's
`.loopboard/` TODO.md and LOOP.md to the shipped templates.

These stay ordinary VSCode settings — `settings.json` and Settings Sync are unaffected — with one
deliberate restriction: **every `loopBoard.*` key is `"scope": "application"`, so it can only be set
in your USER settings.** See [Security model](#security-model).

See [FAQ.md](https://github.com/SinnConsulting/LoopBoard/blob/main/FAQ.md) for common questions (e.g. why there's no Haiku slot).

### Configuring models (`loopBoard.models.<slot>`)

The built-in model slots — `opus`, `sonnet`, `fable` — are what you assign to tasks
(`model:` / `groomer:`) and what the sidebar **Loops** rows spawn. Each slot is configured through
four keys:

- `loopBoard.models.<slot>.enabled` — show/hide the slot in the Loops overview and the board's model selects.
- `loopBoard.models.<slot>.model` — the actual string passed as `claude --model <string>` (e.g. `opus[1m]` or a dated snapshot). Empty falls back to the slot's built-in default; anything outside `[A-Za-z0-9._\[\]-]` is rejected before it reaches the terminal.
- `loopBoard.models.<slot>.effort` — the reasoning effort (`low`…`max`, default `medium`) that slot's loop session is started with, passed as `claude --effort <level>`. Every subagent the loop spawns — grooming, and the implementer/review subagents when `loopBoard.delegateWork` is on — runs at that same session effort.
- `loopBoard.models.<slot>.groomConcurrency` — how many grooming subagents that slot's loop may run in parallel in one pass (default `3`, minimum `1`; there is no unlimited setting). Eligible tasks over the cap are left in place, taken in index order top down, and picked up on a later pass.

The `.effort` flag and the `.groomConcurrency` cap are fixed when the loop is spawned — the cap rides the loop's bootstrap prompt, as do `loopBoard.delegateWork` and `loopBoard.delegateReview` — so a change to any of them takes effect the **next time that slot's loop is started or restarted (♻)**; a running loop keeps the values it was spawned with, exactly like `loopBoard.loopInterval`.

```jsonc
// Pin Opus to a dated snapshot; run Sonnet with the 1M-context window; hide Fable.
"loopBoard.models.opus.model": "claude-opus-4-8",
"loopBoard.models.sonnet.model": "sonnet[1m]",
"loopBoard.models.fable.enabled": false
```

> **Renamed:** `loopBoard.delegateWork.review` is now **`loopBoard.delegateReview`**. The old id
> could never take effect: VSCode resolves settings as a tree, so a key holding a scalar cannot
> also have a child key — with `loopBoard.delegateWork` set, VSCode logged
> `Ignoring loopBoard.delegateWork.review as loopBoard.delegateWork is true` and discarded the
> value, leaving the default (`true`) in force. Nothing that was actually being honoured is lost by
> the rename; if you had set the old key, set the new one to the value you meant and delete the old
> line from your user `settings.json`.

> Migrating from "Claude TODO Board" (≤ 0.1.1): the extension, command, and settings ids were
> renamed from `claudeTodo.*` to `loopBoard.*` with no fallback — re-enter any custom settings.json
> values under the new keys.

### All settings

Generated from `contributes.configuration` in `package.json`, grouped and ordered exactly as both
settings pages render them.

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
