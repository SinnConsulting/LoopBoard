# TODO

Single task tracker. Completed tasks are moved to [DONE.md](DONE.md).

## Workflow

```
New → Backlog → In Progress → Review → Done (DONE.md)
                     ↕
                  Feedback
```

- **New** — freshly proposed. Groom in place; promote only on approval.
- **Backlog** — validated, ready to pick up.
- **In Progress** — actively worked. Exactly one owner.
- **Feedback** — worker is unsure how to proceed and has paused for your input. Branches off
  In Progress; returns there once you answer.
- **Review** — work finished, awaiting acceptance.
- **Done** — accepted; cut from here and appended to `DONE.md`.

## Task format (v3)

Every task lives in a single `## Tasks` section — there are **no per-phase headings**. Each task's
phase is its own `- phase:` field, so moving a task between phases is a one-line, in-place field
edit (never cut a task out of one section and paste it into another — that risked losing a task
mid-move). Each task is a checkbox line plus indented `key: value` sub-bullets, **one key per line,
in this fixed order**. The LoopBoard extension parses this file tolerantly and rewrites it
in canonical form on every save; unrecognized lines are preserved verbatim and flagged.

```
- [ ] <Title — single line>
  - id: t-3f9a                          (stable short id; the writer assigns one if missing)
  - phase: new | backlog | inprogress | feedback | review   (which column the task is in)
  - owner: @claude | unassigned
  - model: opus | sonnet | fable        (optional; absent = the default model, see Rule 15)
  - groomer: opus | sonnet | fable      (optional; which model grooms it, absent = default model; see Rule 14)
  - added: YYYY-MM-DD
  - started: YYYY-MM-DD                  (optional; set when moving to In Progress)
  - promoted: YYYY-MM-DD                 (optional; set when New → Backlog)
  - worklog: YYYY-MM-DD, YYYY-MM-DD      (optional; append a date each active day)
  - link: <url>[, <url>]                 (optional; PR links live here)
  - depends on: t-xxxx[, t-yyyy]         (optional)
  - description: <free text; may wrap onto further 4-space-indented lines>
  - note: <human instruction to the worker>   (optional; see Rule 16)
  - question: ❓ <text>                   (repeatable, single line; Feedback & New)
    - answer: <text or blank>
  - feedback: ⚠️ <text>                   (Review only; see Rule 13)
  - DELIVERED: <text; may wrap onto further 4-space-indented lines>   (Review only)
```

- **`id:`** is the identity anchor — titles may be edited freely without breaking tracking.
- **`phase:`** is the source of truth for which column a task is in — change it to move the task.
- **`description:`** carries the detail; the title stays a single short line.
- A **draft** created from the board is just `- [ ] DRAFT: <raw text>` with `id:` and `added:`
  (phase defaults to New); the loop's groomer (Rule 14) expands it into a full story.

## Rules

1. **The checkbox is your approval, and only yours.** A worker never ticks `[x]`.
   - `[x]` on a **New** task = promote it to **Backlog**.
   - `[x]` on a **Review** task = it is **Done** (move it to `DONE.md`).
   - Workers move tasks between the other columns and propose the tick; you make it.
2. **One worker per task.** Check the `owner:` field before starting.
   - `owner: unassigned` → claim it (`owner: @you`, `started: <today>`), move to **In Progress**.
   - Owned by someone else, or already in `DONE.md` → don't start a parallel copy; coordinate.
3. **Track dates.** Every task carries its history so you can see when it was worked:
   - `added:` — date it entered the tracker.
   - `started:` — date work began (set when moving to In Progress).
   - `promoted:` — date it moved New → Backlog.
   - `worklog:` — append `<today>` each day the task is actively touched (comma-separated).
   - `completed:` — date you accepted it (recorded in `DONE.md`).
4. **Metadata lives on the task's sub-bullets**, one `key: value` per line, in the fixed order
   documented under *Task format (v3)* above. A task's **phase is the `phase:` field** — to move a
   task between columns, edit that field in place (do not cut/paste the task between sections).
5. **Grooming ≠ approval.** Editing a New task's text is fine; moving it out of New needs Rule 1.
6. **When unsure, ask — don't guess.** If a worker hits a decision that is yours to make, it
   moves the task to **Feedback** with a `question:` line and stops working it. Directly beneath
   each `question:` line, place its own `answer:` sub-bullet for you to fill in:

   ```
   - question: ❓ SOMETHING
     - answer:
   ```

   You reply by filling in the `answer:` under each question; the worker then moves the task back
   to **In Progress** and continues — but only once **every** open question has an answer (Rule 10).
   Feedback is a pause, not a checkbox gate — no `[x]` needed.
7. **You MUST ALWAYS add a PR.** Any task that produces changes is not done until its work is
   delivered through a pull request — never commit to `main` directly. Open the PR, then
   record its link in the task's `link:` metadata before moving the task to **Review**. A Review
   task with no PR link is incomplete.
8. **Mark questions and warnings with emoji.** Prefix a `question:` line with ❓ and a `feedback:`
   line with ⚠️ so they stand out. (e.g. `question: ❓ …`, `feedback: ⚠️ …`.)
9. **MUST NOT use git worktrees — work in the normal checkout.** Worktrees break repo pre-commit
   hooks that assume `.git` is a directory (in a worktree `.git` is a gitfile, so hooks doing e.g.
   `touch .git/…` fail, and `--no-verify` is forbidden). So never use `git worktree` for tasks.
   Instead, in the normal checkout: `git pull` / fetch latest `main`, create the task branch off
   `main`, then commit and open the PR from that checkout (per Rule 7).
10. **Resume a Feedback task only when ALL its open questions are answered.** If a task has multiple
    `question:` items, it stays in **Feedback** until every one has a filled-in `answer:`. A single
    answered question is not enough — do not move it back to In Progress or start any of its work
    while any question remains blank.
11. **Move a task to In Progress BEFORE working or researching it.** The moment you begin any work
    or investigation on a task, it must already be in **In Progress** (set `owner:`, `started:`).
    Never research or edit for a task while it still sits in New/Backlog/Feedback — the board must
    always show, at a glance, exactly what is being worked right now.
12. **If you started working and have code to commit, ALWAYS open a PR — never leave work stranded.**
    Any uncommitted or committed-but-unpushed change from working a task must be delivered as a PR,
    and its link recorded on the task. Do not end a working session with local changes that have no
    PR; if you can't finish, still commit what you have and open a draft PR so nothing is lost.
13. **Review stories accept your feedback — it's a change request, not a checkbox.** A story in
    **Review** may carry a `feedback:` line where you write review comments or requested changes
    (mark it ⚠️ per Rule 8). When a Review story has an unaddressed `feedback:` line, the worker
    moves it back to **In Progress**, addresses it, and returns it to Review — never tick `[x]` on
    the worker's behalf. `[x]` on a Review story still means accepted → Done (`DONE.md`).
14. **Explore New tasks (and drafts) with a subagent, not the main process.** When
    grooming/investigating a **New** task — including expanding a `DRAFT:` into a full story
    (title, `description:`, scope) — delegate the exploration to a subagent (Agent tool) whose
    `model:` is the task's `groomer:` field (default model, currently opus, when `groomer:` is
    absent), and record its findings on the task. Don't run New-task exploration inline in
    the main loop — keep the main process for reconciliation and execution. Decisions the human
    must make go on the task as structured single-line `question:` sub-bullets (each with its
    `- answer:` beneath, Rule 6 format) — NOT as an "OPEN QUESTIONS" prose paragraph inside
    `description:` — so New cards surface them in the board's question UI for inline answering.
15. **Claim tasks by `model:`.** Each loop runs as a specific model. Claim only tasks whose
    `model:` matches yours; a task with **no `model:` field belongs to the default model**
    (currently **opus**). Never claim a task whose `model:` names a different model than the one
    you are running as.
16. **Honor `note:` lines, then remove them.** A `note:` is a human instruction added from the
    board for the worker's next pass. Apply the instruction, append `<today>` to the worklog, then
    **delete the `note:` line**. A lingering `note:` means it has not been applied yet.

Legend: `[ ]` awaiting your gate · `[x]` you approved.

---

## Tasks

_(none)_

<!-- Format when a worker parks a task here:
- [ ] <task>
  - id: t-xxxx
  - phase: feedback
  - owner: @claude
  - started: <date>
  - worklog: <dates>
  - question: ❓ <what the worker needs decided, and the options it sees>
    - answer:
-->

<!-- Format for a story awaiting your review here (leave `feedback:` to request changes):
- [ ] <task>
  - id: t-xxxx
  - phase: review
  - owner: @claude
  - added: <date>
  - started: <date>
  - worklog: <dates>
  - link: <PR url(s)>
  - DELIVERED: <what shipped>
  - feedback: ⚠️ <your review comments / change requests — the worker moves the story back to
    In Progress, addresses them, and returns it here. Tick `[x]` only when you accept.>
-->

---

## Automation

Loop workers watch this file, reconcile it, **and pick up work** every minute (from Claude Code
sessions in the workspace root). The LoopBoard extension spawns one loop terminal per model and
pastes only a tiny bootstrap prompt naming that terminal's model and the configured interval —
`/loop 1m You are running as model opus. Open TODO.md, read the loop worker instructions in its
## Automation section, and follow them exactly for this and every pass.` — so the fenced block
below IS the standing instructions every loop follows. Editing it changes every running loop's
behavior on its next pass, no terminal restart needed (only the interval is fixed at spawn time).
This block is executable instructions: treat TODO.md as trusted input.

```
Re-read TODO.md and reconcile it against the Rules at the top. Every task lives in the single `## Tasks` section and carries a `- phase:` field — to "move" a task to another phase, edit its `phase:` field in place (never cut/paste a task between sections). (1) For each New task the user ticked [x], move it to Backlog (set `phase: backlog`), reset it to [ ], and note `promoted: <today>`. (2) For each Review task the user ticked [x], cut it and append it to DONE.md as [x] with its worklog and `completed: <today>`. (3) Append <today> to the worklog of every task you touch. (4) For each Feedback task where EVERY question has an `answer:`, move it back to In Progress and continue it; leave any task with a blank answer untouched. (5) For each Review task you own with an unaddressed `feedback:` line, move it back to In Progress, address the feedback, then return it to Review with an updated DELIVERED and the feedback line removed (Rule 13). (6) Apply any `note:` line on a task you own — do what it says, record it in the worklog, then delete the note (Rule 16). (7) Keep the tracker current: if a referenced path / file / PR / dependency changed since a task was written, update the task's text and metadata to match reality and note the correction in its worklog. Then START WORKING: if nothing is In Progress for your model, claim the top Backlog task whose `model:` is your model — or has no `model:` field, if your model is the default model per Rule 15 — and whose `depends on:` are satisfied; set owner: @claude, started: <today>, worklog: <today>, move it to In Progress, and begin executing it; when finished, open a PR (Rule 7), record its link, and move it to Review. If you become unsure how to proceed, move the task to Feedback with a `question:` and stop — never guess. For New tasks and DRAFTs, groom/expand them with a subagent whose model is the task's `groomer:` field (default model if unset) per Rule 14, recording human decisions as single-line `question:` sub-bullets with blank `answer:` lines (not OPEN QUESTIONS prose); never promote them yourself. Respect one worker per task: never touch a task owned by someone else or one whose `model:` names a different model, and never tick [x] yourself. Report what changed and what you worked on, referring to every task by its full title — never by its bare id (ids like t-3f9a mean nothing to the reader; add the id in parentheses only if disambiguation is needed); if there is nothing to do, reply "no changes".
```

Notes:
- `/loop` defaults to a 10m interval; `1m` polls every minute. The interval is part of the pasted
  bootstrap prompt (from `loopBoard.loopInterval`), so changing it requires recycling the terminal;
  everything else above is re-read live each pass.
- The loop picks up and executes work automatically, but still stops at the human gates — it
  cannot promote New tasks or accept Review tasks (those need your `[x]`), and it parks any task
  it's unsure about in **Feedback** rather than guessing.
- Model routing: each loop only claims tasks whose `model:` matches it (or unlabeled tasks, if it
  is the default model). The extension's ▶ buttons start these per-model loops for you.
- It keeps tasks accurate: when a referenced path/PR/dependency changes, it rewrites the affected
  task to match current reality (recording the correction in the worklog).
- It skips Backlog tasks with unmet `depends on:`, Feedback tasks with any blank answer, and won't
  start a second task while one is In Progress for its model.
- Tasks are a flat list in `## Tasks`; a task's phase is its `phase:` field, so moving a task is a
  one-line in-place edit (no section cut/paste — nothing can be lost mid-move).
- Stop it via the loop's status line, or by cancelling the scheduled task in the session.
