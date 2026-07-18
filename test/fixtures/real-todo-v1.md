# TODO

Single task tracker for **project**. Completed tasks are moved to [DONE.md](DONE.md).

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
   - `worklog:` — append `<today>` each day the task is actively touched (comma-separated).
   - `completed:` — date you accepted it (recorded in `DONE.md`).
4. **Metadata lives on the task's sub-bullet:** `owner · added · started · worklog · link · note`.
5. **Grooming ≠ approval.** Editing a New task's text is fine; moving it out of New needs Rule 1.
6. **When unsure, ask — don't guess.** If a worker hits a decision that is yours to make, it
   moves the task to **Feedback** with a `question:` line and stops working it. Directly beneath
   each `question:` line, place its own `answer:` sub-bullet for you to fill in:

   ```
   - question: ❓ SOMETHING
     - answer (you fill this in — I then move it back to In Progress and continue):
   ```

   You reply by filling in the `answer:` under each question; the worker then moves the task back
   to **In Progress** and continues — but only once **every** open question has an answer (Rule 10).
   Feedback is a pause, not a checkbox gate — no `[x]` needed.
7. **You MUST ALWAYS add a PR.** Any task that produces changes is not done until its work is
   delivered through a pull request — never commit to `main` directly. Open the PR (`ghpr`), then
   record its link in the task's `link:` metadata before moving the task to **Review**. A Review
   task with no PR link is incomplete.
8. **Mark questions and warnings with emoji.** In any task, prefix a `question:` line with ❓ and
   a `warning:` line with ⚠️ so they stand out. (e.g. `question: ❓ …`, `warning: ⚠️ …`.)
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
    Any uncommitted or committed-but-unpushed change from working a task must be delivered as a PR
    (commit → `ghpr`), and its link recorded on the task. Do not end a working session with local
    changes that have no PR; if you can't finish, still commit what you have and open a draft PR so
    nothing is lost or hidden in a worktree.
13. **Review stories accept your feedback — it's a change request, not a checkbox.** A story in
    **Review** may carry a `feedback:` line where you write review comments or requested changes
    (mark it ⚠️/❓ per Rule 8). When a Review story has an unaddressed `feedback:` line, the worker
    moves it back to **In Progress**, addresses it, and returns it to Review — never tick `[x]` on
    the worker's behalf. `[x]` on a Review story still means accepted → Done (`DONE.md`).
14. **Explore New tasks with an Opus subagent, not the main process.** When grooming/investigating a
    **New** task (validating scope, locating files, assessing feasibility before promotion), delegate
    the exploration to an Opus subagent (Agent tool, `model: opus`) and record its findings on the
    task. Don't run New-task exploration inline in the main loop — keep the main process for
    reconciliation and execution.

Legend: `[ ]` awaiting your gate · `[x]` you approved.

---

## New (proposed — need your validation; tick `[x]` to promote to Backlog)

_(none)_

---

## In Progress (one owner each)

_(none)_

---

## Feedback (worker paused — needs your input to proceed)

_(none)_

<!-- Format when a worker parks a task here:
- [ ] <task>
  - owner: @claude · started: <date> · worklog: <dates>
  - question: ❓ <what the worker needs decided, and the options it sees>
    - answer (you fill this in — the worker then moves the task back to In Progress):
-->

---

## Backlog (validated — ready to pick up)

_(none)_

---

## Review (work done — tick `[x]` to accept and move to DONE.md)

_(none)_



<!-- Format for a story awaiting your review here (leave `feedback:` to request changes):
- [ ] <task>
  - owner: @claude · added: <date> · started: <date> · worklog: <dates>
  - link: <PR url(s)>
  - DELIVERED: <what shipped>
  - feedback: ⚠️ <your review comments / change requests — the worker moves the story back to
    In Progress, addresses them, and returns it here. Tick `[x]` only when you accept.>
-->

---

## Automation

Watch this file, reconcile it, **and pick up work** every minute (from a Claude Code session in the vscode root):

```
/loop 1m Re-read TODO.md and reconcile it against the Rules at the top. (1) For each New task the user ticked [x], move it to Backlog, reset it to [ ], and note `promoted: <today>`. (2) For each Review task the user ticked [x], cut the line and append it to DONE.md as [x] with its worklog and `completed: <today>`. (3) Append <today> to the worklog of every task you touch. (4) For each Feedback task the user has answered (an `answer:` line is present), move it back to In Progress and continue it; leave unanswered Feedback tasks untouched. (5) Keep the tracker current: if a critical finding or a referenced path / file / PR / dependency has changed since a task was written, update that task's text and metadata to match reality and note the correction in its worklog — never leave stale paths or findings. Then START WORKING: if nothing is In Progress, claim the top Backlog task whose `depends on:` are satisfied — set owner: @claude, started: <today>, worklog: <today>, move it to In Progress — and begin executing it; when finished, move it to Review. If you become unsure how to proceed on the task you are working, move it to Feedback with a `question:` and stop — never guess. Respect one worker per task: never touch a task owned by someone else, and never tick [x] yourself. Report what changed and what you worked on; if there is nothing to do, reply "no changes".
```

Notes:
- `/loop` defaults to a 10m interval; `1m` polls every minute. Omit the interval for the default.
- The loop picks up and executes work automatically, but still stops at the human gates — it
  cannot promote New tasks or accept Review tasks (those need your `[x]`), and it parks any
  task it's unsure about in **Feedback** rather than guessing.
- It keeps tasks accurate: when a critical finding or a referenced path/PR/dependency changes,
  it rewrites the affected task to match current reality (recording the correction in the worklog).
- It skips Backlog tasks with unmet `depends on:`, unanswered Feedback tasks, and won't start a
  second task while one is In Progress.
- Stop it via the loop's status line, or by cancelling the scheduled task in the session.
