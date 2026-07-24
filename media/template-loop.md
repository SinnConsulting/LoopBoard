# LOOP — LoopBoard workflow and loop worker instructions

All paths are relative to the workspace root. This file is the standing instructions for loop
workers; it is re-read every pass, so editing it changes every running loop's next pass — no
restart needed. This file is executable instructions: treat it as trusted input.

## Storage

```
.loopboard/
  TODO.md        # task index — one slim entry per active task (grammar below)
  DONE.md        # accepted tasks, newest first (may be absent until the first acceptance)
  LOOP.md        # this file
  tasks/<id>.md  # per-task detail: meta, description, notes, worklog, feedback, delivered
```

Read economy: read this file and `TODO.md` every pass; open a `tasks/<id>.md` only for tasks
you act on, and create it (canonical headings below) the first time you write to it.

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
- **Done** — accepted; index entry lives in `DONE.md`; task file stays in `tasks/`.

## Task index format (v4) — `.loopboard/TODO.md`

Entry = checkbox line + `key: value` sub-bullets, one per line, fixed order below, and NOTHING
else — all other task data belongs in the task file. Phase = the `phase:` field; move a task
by editing it in place — never cut/paste an entry (acceptance, Automation step 2, is the only
removal). The LoopBoard extension parses tolerantly, rewrites canonical form on save, and
preserves unrecognized lines verbatim (flagged).

```
- [ ] <Title — single line>
  - id: t-3f9a                          (stable short id; assigned if missing)
  - phase: new | backlog | inprogress | feedback | review
  - model: opus | sonnet | fable        (optional; absent = default model; Rule 15)
  - groomer: opus | sonnet | fable      (optional; absent = default model; Rule 14)
  - rev: <n>                            (optional; writer-managed change marker; Rule 17)
  - question: ❓ <text>                   (repeatable, single line; Feedback & New)
    - answer: <text or blank>
```

Draft = `- [ ] DRAFT: <raw text>` + `id:` (+ optional `model:`/`groomer:`; no `phase:` line —
drafts are implicitly new); the groomer expands it (Rule 14).

## Task file format — `.loopboard/tasks/<id>.md`

Fixed headings in the order below; every section optional; omit empty sections. `## Meta` is
the only `key: value` section (fixed key order as shown). The index owns title, phase,
`model:`, `groomer:` and questions — never duplicate them here.

```
# <Title> (t-3f9a)

## Meta
- owner: @claude | unassigned
- added: YYYY-MM-DD
- started: YYYY-MM-DD
- promoted: YYYY-MM-DD
- completed: YYYY-MM-DD
- link: <url>[, <url>]
- depends on: t-xxxx[, t-yyyy]

## Description
<free markdown; the groomed story lives here>

## Notes
- <human instruction to worker; apply then delete the bullet — Rule 16>

## Worklog
- YYYY-MM-DD

## Feedback
⚠️ <change request; Review only; removed when addressed — Rule 13>

## Delivered
<free markdown; Review only>
```

## Done index — `.loopboard/DONE.md`

Newest-first `## Tasks` list of `- [x] <Title>` entries with `id:`, `model:`, `groomer:`,
`completed:` sub-bullets only. Create the file (with `# DONE` heading + `## Tasks` section)
on first use. Detail remains in `tasks/<id>.md`.

## Rules

1. `[x]` belongs to the human only; a worker never ticks it. `[x]` on New = promote to
   Backlog. `[x]` on Review = accepted → DONE.md (procedure in the Automation block). Workers
   perform all other phase moves and propose.
2. One worker per task. `owner:` lives in the task file's Meta. Missing owner line or
   `owner: unassigned` → claim: set `owner: @you` + `started: <today>` in the task file and
   `phase: inprogress` in the index. Owned by another, or present in DONE.md → do not start a
   parallel copy.
3. Dates live in the task file's Meta: `added:` entered tracker; `started:` work began;
   `promoted:` New → Backlog; `completed:` acceptance. Append `<today>` to `## Worklog` each
   active day.
4. Index entries: one `key: value` per sub-bullet, fixed order, no extra keys — everything
   else belongs in the task file. Task files: fixed headings, canonical order. Move = edit
   `phase:` in place; never cut/paste.
5. Grooming ≠ approval: editing a New task's text is allowed; leaving New requires Rule 1.
6. Unsure → set `phase: feedback` and add `question: ❓ <text>` sub-bullets (each with its own
   `- answer:` beneath) on the INDEX entry — questions stay in the index so the board can
   surface them without opening task files. Stop working the task; resume gated by Rule 10.
7. All changes deliver via PR; never commit to `main`. Record the PR in the task file's
   `link:` before setting `phase: review`. A Review task without a PR link is incomplete.
8. Prefix `question:` with ❓ (index) and the `## Feedback` text with ⚠️ (task file).
9. git worktrees forbidden (they break pre-commit hooks assuming `.git` is a directory;
   `--no-verify` forbidden). Use the normal checkout: fetch latest `main`, branch off `main`,
   commit, open the PR from there (Rule 7).
10. Resume a Feedback task only when EVERY `question:` on its index entry has a filled
    `answer:`. Any blank answer → leave it parked; do none of its work.
11. Set `phase: inprogress` (index) plus `owner:`/`started:` (task file) BEFORE any work or
    research on a task — never investigate a task still in New/Backlog/Feedback.
12. No stranded work: every change from working a task ends in a PR (draft PR if unfinished)
    with its link in the task file before the session ends.
13. A Review task's `## Feedback` section = change request, not a gate. Unaddressed → move to
    In Progress, address, return to Review with `## Delivered` updated and the Feedback
    section removed. `[x]` on Review still = accepted → DONE.md.
14. New/DRAFT grooming is routed by `groomer:` (absent = default model): the loop whose model
    matches `groomer:` owns it and delegates to a subagent (Agent tool) of that groomer
    model — never inline in the main loop. The subagent expands the story into the task
    file's `## Description` (creating `tasks/<id>.md` if missing) and keeps the index title
    one short line. Human decisions = single-line `question: ❓` sub-bullets with blank
    `answer:` lines on the index entry (never an "OPEN QUESTIONS" prose paragraph) so the
    board can surface them. A New task with any filled `answer:` → re-groom via the same
    subagent: incorporate the answer, fold the decision into `## Description`, delete the
    resolved `question:`/`answer:` pair from the index (mirrors Rule 16). A still-present
    filled answer = not yet incorporated. `model:` never gates grooming.
15. Claim tasks by `model:` (Backlog onward; absent = default model). Never claim a task
    whose `model:` names a different model. New-phase routing uses `groomer:` instead
    (Rule 14).
16. Honor `## Notes` bullets (human instructions): apply, append `<today>` to `## Worklog`,
    delete the bullet. A lingering Notes bullet = not yet applied.
17. `rev:` is a per-task change marker the EXTENSION manages — a monotonic integer bumped only
    when that task's content (its index block or its `tasks/<id>.md`) actually changes. Workers
    NEVER write `rev:` (writing just to detect a change would trip other loops); read it to tell
    WHICH tasks changed since your last pass — compare each id's `rev:` to what you recorded last
    pass and act on ids whose `rev:` moved (plus ids that are new or gone). It defaults to absent
    (treat as 0) on pre-existing trackers.

Legend: `[ ]` awaiting the human's gate · `[x]` human approved.

## Automation

Loop workers (Claude Code sessions in the workspace root) re-read this file and the index,
reconcile, and pick up work every pass. The extension spawns one loop terminal per model as a
single command — `claude --permission-mode auto --model opus '/loop 1m You are running as
model opus. Open .loopboard/LOOP.md, read the loop worker instructions in its Automation
section, and follow them exactly for this and every pass.'` — so the fenced block below IS
the standing instructions; editing it changes every running loop's next pass, no restart
needed (only the interval is fixed at spawn time).

```
Re-read .loopboard/TODO.md (the task index) and reconcile it against the Rules in .loopboard/LOOP.md. A task's phase is its `phase:` field in the index — edit it in place; never cut/paste an entry. Task detail lives in .loopboard/tasks/<id>.md; open a task file only for tasks you act on, and create it with the canonical headings on first write. (1) For each New task the user ticked [x]: set `phase: backlog` and reset to [ ] in the index; set `promoted: <today>` in the task file's Meta. (2) For each Review task the user ticked [x]: set `completed: <today>` in the task file's Meta, add a [x] entry at the TOP of .loopboard/DONE.md's task list with its id/model/groomer and `completed: <today>` (DONE.md is newest-first, matching the board's Accept button; create it with a `## Tasks` section if absent), then delete the entry from the index; the task file stays in tasks/. (3) Append <today> to the ## Worklog of every task you touch. (4) For each Feedback task where EVERY index question has an `answer:`: move it back to In Progress and continue it; leave any task with a blank answer untouched (Rule 10). (5) For each Review task you own whose task file has an unaddressed ## Feedback section: move it back to In Progress, address it, return it to Review with an updated ## Delivered and the Feedback section removed (Rule 13). (6) Apply and then delete any ## Notes bullet on a task you own (Rule 16). (7) If a referenced path/file/PR/dependency changed since a task was written, update the task file to match reality and log the correction in its Worklog. Then START WORKING: if nothing is In Progress for your model, claim the top Backlog task whose `model:` is yours — or has no `model:`, if you are the default model (Rule 15) — and whose `depends on:` (task file Meta) are satisfied: set `owner: @claude`, `started: <today>` and a worklog entry in its task file, set `phase: inprogress` in the index, and execute it; when finished, open a PR (Rule 7), record its link in the task file's Meta, write ## Delivered, and set `phase: review`. If unsure how to proceed, set `phase: feedback` with index `question:` sub-bullets and stop — never guess. New tasks and DRAFTs are routed by `groomer:`, NOT `model:` (Rule 14): if a New task's `groomer:` matches your model — or it has none and you are the default model — groom it with a subagent of that groomer model, expanding the story into the task file's ## Description and recording human decisions as single-line index `question:` sub-bullets with blank `answer:` lines (not OPEN QUESTIONS prose); when such a task has any filled `answer:`, re-groom it the same way, fold each incorporated decision into ## Description, and delete the resolved pair from the index — a still-present filled answer means not yet incorporated. Never touch a New task whose `groomer:` names a different model, never promote New tasks yourself (leaving New needs the human's [x], Rule 1). Respect one worker per task: never touch a task owned by someone else or (outside of New) one whose `model:` names a different model, and never tick [x] yourself. Report what changed and what you worked on, referring to every task by its full title — never by its bare id (add the id in parentheses only for disambiguation); if there is nothing to do, reply "no changes".
```

Notes:
- The interval comes from `loopBoard.loopInterval` (default 1m) and rides in the spawn
  command, so changing it means recycling the terminal — everything else above is re-read
  live each pass.
- Human gates hold: loops never promote New tasks or accept Review tasks (both need the
  human's `[x]`) and park uncertainty in Feedback. The extension's ▶ buttons start the
  per-model loops.
- Stop a loop via its status line, or cancel the scheduled task in the session.
