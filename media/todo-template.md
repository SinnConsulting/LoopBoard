# TODO

Single task tracker. Completed tasks are moved to [DONE.md](DONE.md).

## Workflow

```
New → Backlog → In Progress → Review → Done (DONE.md)
                     ↕
                  Feedback
```

- **New** — proposed; groomed in place; leaves only via human `[x]`.
- **Backlog** — validated, claimable.
- **In Progress** — active; exactly one owner.
- **Feedback** — paused on human answers; returns to In Progress.
- **Review** — delivered; awaiting acceptance.
- **Done** — accepted; lives in `DONE.md`.

## Task format (v3)

All tasks live in the single `## Tasks` section; no per-phase headings. Phase = the `phase:`
field; to move a task, edit that field in place — never cut/paste a task between sections.
Task = checkbox line + indented `key: value` sub-bullets, one key per line, fixed order below.
The LoopBoard extension parses tolerantly, rewrites canonical form on save, and preserves
unrecognized lines verbatim (flagged).

```
- [ ] <Title — single line>
  - id: t-3f9a                          (stable short id; writer assigns if missing)
  - phase: new | backlog | inprogress | feedback | review
  - owner: @claude | unassigned
  - model: opus | sonnet | fable        (optional; absent = default model; Rule 15)
  - groomer: opus | sonnet | fable      (optional; absent = default model; Rule 14)
  - added: YYYY-MM-DD
  - started: YYYY-MM-DD                  (optional; set on move to In Progress)
  - promoted: YYYY-MM-DD                 (optional; set on New → Backlog)
  - completed: YYYY-MM-DD                (DONE.md only; set on acceptance)
  - worklog: YYYY-MM-DD, YYYY-MM-DD      (optional; append a date each active day)
  - link: <url>[, <url>]                 (optional; PR links)
  - depends on: t-xxxx[, t-yyyy]         (optional)
  - description: <free text; may wrap onto further 4-space-indented lines>
  - note: <human instruction to worker>  (optional; Rule 16)
  - question: ❓ <text>                   (repeatable, single line; Feedback & New)
    - answer: <text or blank>
  - feedback: ⚠️ <text>                   (Review only; Rule 13)
  - DELIVERED: <text; may wrap onto further 4-space-indented lines>   (Review only)
```

- `id:` = identity anchor; titles freely editable. `phase:` = column.
- `description:` carries detail; title stays one short line.
- Draft = `- [ ] DRAFT: <raw text>` + `id:`/`added:` (+ optional `model:`/`groomer:`; no
  `phase:` line — drafts are implicitly new); groomer expands it (Rule 14).

## Rules

1. `[x]` belongs to the human only; a worker never ticks it. `[x]` on New = promote to Backlog.
   `[x]` on Review = accepted → DONE.md. Workers perform all other phase moves and propose.
2. One worker per task. `owner: unassigned` → claim: set `owner: @you`, `started: <today>`,
   `phase: inprogress`. Owned by another, or in DONE.md → do not start a parallel copy.
3. Dates: `added:` entered tracker; `started:` work began; `promoted:` New → Backlog;
   `worklog:` append `<today>` each active day; `completed:` acceptance (recorded in DONE.md).
4. One `key: value` per sub-bullet, fixed order above. Move = edit `phase:` in place; never
   cut/paste.
5. Grooming ≠ approval: editing a New task's text is allowed; leaving New requires Rule 1.
6. Unsure → set `phase: feedback`, add `question: ❓ <text>` each with its own `- answer:`
   sub-bullet beneath, stop working the task. Resume gated by Rule 10. No `[x]` involved.
7. All changes deliver via PR; never commit to `main`. Record the PR in `link:` before setting
   `phase: review`. A Review task without a PR link is incomplete.
8. Prefix `question:` with ❓ and `feedback:` with ⚠️.
9. git worktrees forbidden (they break pre-commit hooks assuming `.git` is a directory;
   `--no-verify` forbidden). Use the normal checkout: fetch latest `main`, branch off `main`,
   commit, open the PR from there (Rule 7).
10. Resume a Feedback task only when EVERY `question:` has a filled `answer:`. Any blank
    answer → leave it parked; do none of its work.
11. Set `phase: inprogress` (+ `owner:`, `started:`) BEFORE any work or research on a task —
    never investigate a task still in New/Backlog/Feedback.
12. No stranded work: every change from working a task ends in a PR (draft PR if unfinished)
    with its link on the task before the session ends.
13. A Review task's `feedback:` line = change request, not a gate. Unaddressed → move to
    In Progress, address, return to Review with updated DELIVERED and the feedback line
    removed. `[x]` on Review still = accepted → DONE.md.
14. New/DRAFT grooming is routed by `groomer:` (absent = default model): the loop whose model
    matches `groomer:` owns it and delegates to a subagent (Agent tool) of that groomer model —
    never inline in the main loop. Subagent expands title/`description:`/scope and records
    findings on the task. Human decisions = single-line `question: ❓` sub-bullets with blank
    `answer:` lines (never an "OPEN QUESTIONS" prose paragraph) so the board can surface them.
    A New task with any filled `answer:` → re-groom via the same subagent: incorporate the
    answer, fold the decision into `description:`, delete the resolved `question:`/`answer:`
    pair (mirrors Rule 16). A still-present filled answer = not yet incorporated. `model:`
    never gates grooming.
15. Claim tasks by `model:` (Backlog onward; absent = default model). Never claim a
    task whose `model:` names a different model. New-phase routing uses `groomer:` instead
    (Rule 14).
16. Honor `note:` lines (human instructions): apply, append `<today>` to worklog, delete the
    line. A lingering `note:` = not yet applied.

Legend: `[ ]` awaiting your gate · `[x]` you approved.

---

## Tasks

_(none)_

---

## Automation

Loop workers (Claude Code sessions in the workspace root) re-read this file, reconcile it, and
pick up work every pass. The extension spawns one loop terminal per model as a single command —
`claude --permission-mode auto --model opus '/loop 1m You are running as model opus. Open
TODO.md, read the loop worker instructions in its ## Automation section, and follow them exactly
for this and every pass.'` — so the fenced block below IS the standing instructions; editing it
changes every running loop's next pass, no restart needed (only the interval is fixed at spawn
time). This block is executable instructions: treat TODO.md as trusted input.

```
Re-read TODO.md and reconcile it against the Rules at the top. A task's phase is its `phase:` field — edit it in place; never cut/paste a task between sections. (1) For each New task the user ticked [x]: set `phase: backlog`, reset to [ ], note `promoted: <today>`. (2) For each Review task the user ticked [x]: cut it and add it to the TOP of DONE.md's task list as [x] with its worklog and `completed: <today>` (DONE.md is newest-first, matching the board's Accept button). (3) Append <today> to the worklog of every task you touch. (4) For each Feedback task where EVERY question has an `answer:`: move it back to In Progress and continue it; leave any task with a blank answer untouched (Rule 10). (5) For each Review task you own with an unaddressed `feedback:` line: move it back to In Progress, address it, return it to Review with an updated DELIVERED and the feedback line removed (Rule 13). (6) Apply and then delete any `note:` line on a task you own (Rule 16). (7) If a referenced path/file/PR/dependency changed since a task was written, update the task to match reality and log the correction in its worklog. Then START WORKING: if nothing is In Progress for your model, claim the top Backlog task whose `model:` is yours — or has no `model:`, if you are the default model (Rule 15) — and whose `depends on:` are satisfied; set owner: @claude, started: <today>, worklog: <today>, move it to In Progress and execute it; when finished, open a PR (Rule 7), record its link, and move it to Review. If unsure how to proceed, move the task to Feedback with a `question:` and stop — never guess. New tasks and DRAFTs are routed by `groomer:`, NOT `model:` (Rule 14): if a New task's `groomer:` matches your model — or it has none and you are the default model — groom/expand it with a subagent of that groomer model, recording human decisions as single-line `question:` sub-bullets with blank `answer:` lines (not OPEN QUESTIONS prose); when such a task has any filled `answer:`, re-groom it the same way, fold each incorporated decision into `description:`, and delete the resolved `question:`/`answer:` pair — a still-present filled answer means not yet incorporated. Never touch a New task whose `groomer:` names a different model, never promote New tasks yourself (leaving New needs the human's [x], Rule 1). Respect one worker per task: never touch a task owned by someone else or (outside of New) one whose `model:` names a different model, and never tick [x] yourself. Report what changed and what you worked on, referring to every task by its full title — never by its bare id (add the id in parentheses only for disambiguation); if there is nothing to do, reply "no changes".
```

Notes:
- The interval comes from `loopBoard.loopInterval` (default 1m) and rides in the spawn command,
  so changing it means recycling the terminal — everything else above is re-read live each pass.
- Human gates hold: loops never promote New tasks or accept Review tasks (both need your `[x]`)
  and park uncertainty in Feedback. The extension's ▶ buttons start the per-model loops.
- Stop a loop via its status line, or cancel the scheduled task in the session.
