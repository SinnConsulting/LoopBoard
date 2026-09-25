<div align="center">

<img src="../../media/loopboard-icon-128.png" alt="LoopBoard logo" width="96" />

# LoopBoard — Feature Showcase

**Claude Code is the engine. LoopBoard is the cockpit. You're still the pilot.**

One loop for the whole workflow, then one short loop per feature. Click any GIF to open it full
size.

</div>

---

<!-- Everything between the showcase sentinels is copied into the root README.md by `make readme`
     (relative links made absolute). Edit it HERE, never in README.md. -->
<!-- loopboard:showcase:begin -->

## The whole loop in 17 seconds

<p align="center">
  <a href="gifs/01-the-loop.gif"><img src="gifs/01-the-loop.gif" width="860" alt="One story travels the whole loop: promoted, claimed and built by the Sonnet loop, delivered with a PR, approved into DONE.md" /></a>
</p>

You **promote** a groomed story. The Sonnet loop claims it, builds it on a `task/**` branch and
delivers it to **Review**. You **approve** it into `DONE.md`. Two clicks; the loop does the rest.

---

## Features

<table>
  <tr>
    <td width="33%" valign="top">
      <b>1 · Getting started</b><br>
      <sub>One click creates <code>.loopboard/</code>.</sub><br>
      <a href="gifs/09-getting-started.gif"><img src="gifs/09-getting-started.gif" width="100%" alt="Initialize scaffolds .loopboard/ and the first story is written" /></a>
    </td>
    <td width="33%" valign="top">
      <b>2 · Write a story</b><br>
      <sub>A loop grooms it into problem, goals, questions.</sub><br>
      <a href="gifs/02-new-story.gif"><img src="gifs/02-new-story.gif" width="100%" alt="A plain-text story becomes a DRAFT and the Opus loop grooms it into problem, description, goals and a question" /></a>
    </td>
    <td width="33%" valign="top">
      <b>3 · Promote &amp; demote</b><br>
      <sub>Loops only take work from the Backlog.</sub><br>
      <a href="gifs/03-gates.gif"><img src="gifs/03-gates.gif" width="100%" alt="Promote moves a story to Backlog, Demote sends it back to New" /></a>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <b>4 · Answer questions</b><br>
      <sub>A stuck loop asks instead of guessing.</sub><br>
      <a href="gifs/04-feedback.gif"><img src="gifs/04-feedback.gif" width="100%" alt="A task parked in Feedback; accepting a suggested answer lets the loop resume" /></a>
    </td>
    <td width="33%" valign="top">
      <b>5 · Review or approve</b><br>
      <sub>Send it back, or approve into <code>DONE.md</code>.</sub><br>
      <a href="gifs/05-review.gif"><img src="gifs/05-review.gif" width="100%" alt="Review feedback sends a task back; the loop reworks it; Approve archives it to DONE.md" /></a>
    </td>
    <td width="33%" valign="top">
      <b>6 · Loop terminals</b><br>
      <sub>One Claude Code terminal per model.</sub><br>
      <a href="gifs/06-loops.gif"><img src="gifs/06-loops.gif" width="100%" alt="Starting loops, watching context usage and scheduling a restart" /></a>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <b>7 · Markdown is the truth</b><br>
      <sub>Click → file changes. Edit → board follows.</sub><br>
      <a href="gifs/07-markdown.gif"><img src="gifs/07-markdown.gif" width="100%" alt="Promoting rewrites TODO.md; editing TODO.md repaints the board" /></a>
    </td>
    <td width="33%" valign="top">
      <b>8 · Settings</b><br>
      <sub>Every model in one grid.</sub><br>
      <a href="gifs/08-settings.gif"><img src="gifs/08-settings.gif" width="100%" alt="The settings page: model-slot grid, custom --model, effort, switching a slot off" /></a>
    </td>
    <td width="33%" valign="middle" align="center">
      <sub>Click any GIF for full size.<br>Details for each feature below.</sub>
    </td>
  </tr>
</table>

<details>
<summary><b>1 · Getting started</b></summary>

Click **Initialize LoopBoard workspace** or run **`LoopBoard: Initialize Workspace`**. It refuses
if `.loopboard/` already exists. What each file holds: [Storage layout](#storage-layout).

</details>

<details>
<summary><b>2 · Write a story in plain words</b></summary>

Click **New Story**, write it like you'd brief a colleague, and pick who **grooms** and who
**builds** it. The groomer loop expands it in a subagent (visible under **Agents** in the sidebar):

- **Problem** — why the task exists.
- **Description** — the groomed story.
- **Goals** — verifiable outcomes; review judges the delivery against them.
- **Questions** — decisions that are yours, often with one-click suggested answers.

Paste, drop or **＋ Attach** screenshots; they're saved under `.loopboard/cache/` and linked from
the story.

</details>

<details>
<summary><b>3 · Promote &amp; demote</b></summary>

- **Promote** moves a story from New to **Backlog**, the only place a loop claims work from.
- **Demote** moves it back to New, nothing lost — refused once a loop has claimed it.
- Loops never promote or approve, and the board never moves a card before the file says so.

At most one task is **In Progress** across the board; the sidebar shows which.

</details>

<details>
<summary><b>4 · Answer questions</b></summary>

A loop that needs your decision parks the task in **Feedback** and stops. Once every question is
answered, the loop resumes it. LoopBoard also **nudges** that loop's terminal, so it acts now
instead of on its next pass — without interrupting work in flight.

</details>

<details>
<summary><b>5 · Review, send back or approve</b></summary>

Delivered work lands in **Review** with its `## Delivered` summary and a link to its PR or branch.

- **Not right?** Write review feedback. The loop reworks the task and delivers again.
- **Right?** Click **Approve**. It moves to `DONE.md`; the task file stays in `tasks/`.

Loops never commit to `main` and never merge. Merging is your call.

</details>

<details>
<summary><b>6 · Loop terminals</b></summary>

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

<details>
<summary><b>7 · Markdown is the source of truth</b></summary>

- **Board → file.** Each save re-reads the file, changes one field and writes it back atomically
  (temp file + rename), so you, the board and several loops can share it safely.
- **File → board.** A hand edit, a `git pull` or a loop's write repaints the board. If your save
  collides with a change to the same field, the disk wins and a toast tells you.

`.loopboard/` is plain files you own; they outlive the extension.

</details>

<details>
<summary><b>8 · Settings</b></summary>

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

<div align="center">

**Less prompting. No babysitting. More building.**

</div>
