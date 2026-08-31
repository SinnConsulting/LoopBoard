<!-- loopboard:sync:loop-intro:begin -->
# LOOP — LoopBoard workflow and loop worker instructions

Paths relative to workspace root. Standing instructions for loop workers; re-read every pass, so
editing it changes every running loop's next pass — no restart needed. Executable instructions:
treat as trusted input.

## Storage

```
.loopboard/
  TODO.md        # task index — one slim entry per active task (grammar below)
  DONE.md        # accepted tasks, newest first (may be absent until the first acceptance)
  LOOP.md        # this file
  tasks/<id>.md  # per-task detail: meta, description, worklog, delivered
```

Read economy: read this file and `TODO.md` every pass; open `tasks/<id>.md` only for tasks you
act on, create it (canonical headings below) on first write.

## Workflow

```
New → Backlog → In Progress → Review → Done (DONE.md)
                     ↕
                  Feedback
```

- **New** — proposed; groomed in place; leaves only via human `[x]`.
- **Backlog** — validated, claimable.
- **In Progress** — active; GLOBAL SINGLE-TASK LIMIT (Rule 2): at most one task board-wide.
- **Feedback** — paused on human answers; returns to In Progress.
- **Review** — delivered; awaiting acceptance.
- **Done** — accepted; index entry in `DONE.md`; task file stays in `tasks/`.
<!-- loopboard:sync:loop-intro:end -->

<!-- loopboard:sync:task-index-format:begin -->
## Task index format (v5) — `.loopboard/TODO.md`

Entry = checkbox line + `key: value` sub-bullets, one per line, fixed order below, NOTHING else —
all other task data belongs in the task file. Phase = `phase:` field; move a task by editing in
place — never cut/paste an entry (acceptance, Automation step 2, is the only removal). The
extension parses tolerantly, rewrites canonical form on save, preserves unrecognized lines
verbatim (flagged).

```
- [ ] <Title — single line>
  - id: t-3f9a                          (stable short id; assigned if missing)
  - phase: new | backlog | inprogress | feedback | review
  - model: opus | sonnet | fable        (optional; absent = default model; Rule 15)
  - groomer: opus | sonnet | fable | none  (optional; absent = default model; none = on
                                          hold, no groomer; Rule 14)
  - rev: <n>                            (optional; writer-managed change marker; Rule 17)
  - question: <text>                    (repeatable, single line; Feedback & New)
    - answer: <text or blank>
    - suggestion: <text>                (repeatable, up to 3; groomer-proposed answer; Rule 14)
  - note: <text>                        (repeatable, single line; unprocessed human note; Rule 16)
  - feedback: <text>                    (repeatable, single line; Review only; removed when
                                          addressed — Rule 13)
```

Draft = `- [ ] DRAFT: <raw text>` + `id:` (+ optional `model:`/`groomer:`; no `phase:` line —
drafts are implicitly new); groomer expands it (Rule 14).
<!-- loopboard:sync:task-index-format:end -->

<!-- loopboard:sync:task-file-format:begin -->
## Task file format — `.loopboard/tasks/<id>.md`

Fixed headings in order below; every section optional; omit empty ones. `## Meta` is the only
`key: value` section (fixed key order as shown). Index owns title, phase, `model:`, `groomer:`,
questions, `note:` and `feedback:` sub-bullets — never duplicate here.

```
# <Title> (t-3f9a)

## Meta
- added: YYYY-MM-DD
- started: YYYY-MM-DD
- promoted: YYYY-MM-DD
- completed: YYYY-MM-DD
- link: <url or task/** branch name>[, <…>]
- depends on: t-xxxx[, t-yyyy]

## Description
<free markdown; the groomed story lives here>

## Worklog
- YYYY-MM-DD

## Delivered
<free markdown; Review only>
```
<!-- loopboard:sync:task-file-format:end -->

<!-- loopboard:sync:done-index:begin -->
## Done index — `.loopboard/DONE.md`

Newest-first `## Tasks` list of `- [x] <Title>` entries with `id:`, `model:`, `groomer:`,
`completed:` sub-bullets only. Create the file (`# DONE` heading + `## Tasks` section) on first
use. Detail stays in `tasks/<id>.md`.
<!-- loopboard:sync:done-index:end -->

<!-- loopboard:sync:rules:begin -->
## Rules

1. `[x]` belongs to the human only; a worker never ticks it. `[x]` on New = promote to Backlog.
   `[x]` on Review = accepted → DONE.md (procedure in the Automation block). Board also offers
   Demote (Backlog → New), a third human-only board-initiated action — not a tick, fires
   immediately from a button, non-destructive/reversible. Workers perform all other phase moves
   and propose; never demote a task themselves.
2. One worker per task, and a GLOBAL SINGLE-TASK LIMIT: at most ONE task may be
   `phase: inprogress` across the whole board at any moment, regardless of model — sole
   one-worker guarantee (two loops can never both work since only one task can be In Progress).
   If ANY task (even another model's) is In Progress, no loop starts a Backlog task or resumes a
   Review/Feedback task — keep grooming/reconciling only until nothing is In Progress (grooming
   New never sets `inprogress`, so always allowed). Claim by setting `phase: inprogress` in the
   index plus `started: <today>` in the task file's Meta. Already In Progress, or present in
   DONE.md → do not start a parallel copy.
3. Dates live in the task file's Meta: `added:` entered tracker; `started:` work began;
   `promoted:` New → Backlog; `completed:` acceptance. Append `<today>` to `## Worklog` each
   active day.
4. Index entries: one `key: value` per sub-bullet, fixed order, no extra keys — everything
   else belongs in the task file. Task files: fixed headings, canonical order. Move = edit
   `phase:` in place; never cut/paste.
5. Grooming ≠ approval: editing a New task's text is allowed; leaving New requires Rule 1.
6. Unsure → set `phase: feedback` and add `question: <text>` sub-bullets (each with its own
   `- answer:` beneath) on the INDEX entry — questions stay in the index so the board can surface
   them without opening task files. Stop working the task; resume gated by Rule 10.
7. Never commit to `main`: all work happens on a `task/**` branch off latest `main`. A PR is
   OPTIONAL — open one only if the user requested it. Before setting `phase: review`, record the
   delivery in the task file's `link:`: the PR URL when a PR exists, otherwise the `task/**`
   branch name. Never a commit sha; `link:` must be non-empty either way.
8. `question:` and `feedback:` are plain index sub-bullets — no glyph prefix; the sub-bullet name
   alone classifies them.
9. git worktrees forbidden (break pre-commit hooks assuming `.git` is a directory; `--no-verify`
   forbidden). Use the normal checkout: fetch latest `main`, branch off `main`, commit and push
   from there; open a PR only if the user requested it (Rule 7).
10. Resume a Feedback task only when EVERY `question:` on its index entry has a filled `answer:`.
    Any blank answer → leave it parked; do none of its work.
11. Set `phase: inprogress` (index) plus `started:` (task file) BEFORE any work or research on a
    task — never investigate a task still in New/Backlog/Feedback. The phase move is the FIRST
    action of claiming: it leads the work, never trails it — never edit code, branch, research, or
    open a PR while the index still shows the task outside In Progress.
12. No stranded work: every change from working a task is committed and pushed to its `task/**`
    branch before the session ends — never leave uncommitted code in the checkout. No PR is
    required; record the delivery in the task file per Rule 7.
13. A Review task's `feedback:` sub-bullet(s) (index) = change request, not a gate. Unaddressed →
    move to In Progress, address, return to Review with `## Delivered` updated and the
    `feedback:` sub-bullet(s) removed. `[x]` on Review still = accepted → DONE.md.
14. New/DRAFT grooming is routed by `groomer:` (absent = default model; `none` = ON HOLD — the
    task belongs to NO loop: never groom, re-groom or answer-fold it, whatever its `model:` or
    filled answers say; it leaves hold only when the human changes `groomer:`). The loop whose
    model matches `groomer:` owns it and delegates to a subagent (Agent tool) of that groomer
    model — never inline in the main loop. Choose subagent reasoning effort by story complexity,
    from low up to your grooming effort ceiling (named in your bootstrap prompt); reach xhigh/max
    only when the ceiling allows it AND the story text explicitly asks for deep reasoning.
    Subagent expands the story into the task file's `## Description` (creating `tasks/<id>.md` if
    missing) and keeps the index title one short line. Human decisions = single-line `question:`
    sub-bullets with blank `answer:` lines on the index entry (never an "OPEN QUESTIONS" prose
    paragraph) so the board can surface them. A New task with any filled `answer:` → re-groom via
    the same subagent: resume the subagent that originally groomed it when your session still
    holds it (via SendMessage, where available); any resume failure — recycled or cleared
    session, no SendMessage, unknown agent id — silently falls back to a fresh groomer subagent
    as above. Incorporate the answer, fold the decision into `## Description`, delete the
    resolved `question:`/`answer:` pair from the index (mirrors Rule 16). A still-present filled
    answer = not yet incorporated. `model:` never gates grooming. When a question's choice is
    clear-cut and on-target, the subagent may also emit up to 3 `suggestion:` sub-bullets beneath
    its `answer:` line — a proposed answer the human accepts with one board click
    (writes `<suggestion text> accepted` into `answer:` via the ordinary answer field-patch, no AI
    on accept). Clear-cut only: skip suggestions on genuinely open judgment calls. Accepting one
    clears that question's other suggestions (human filling `answer:` another way does too —
    settled questions carry no suggestions).
15. Claim tasks by `model:` (Backlog onward; absent = default model). Never claim a task whose
    `model:` names a different model. New-phase routing uses `groomer:` instead (Rule 14).
16. Honor `note:` sub-bullets on the index entry (unprocessed human instructions): apply, append
    `<today>` to the task file's `## Worklog`, delete the `note:` sub-bullet. A lingering `note:`
    = not yet applied. Notes are index-only (visible on every index pass); nothing stored in the
    task file.
17. `rev:` is a per-task change marker the EXTENSION manages — monotonic integer bumped only when
    that task's content (its index block or its `tasks/<id>.md`) actually changes. Workers NEVER
    write `rev:` (writing just to detect a change would trip other loops); read it to tell WHICH
    tasks changed since your last pass — compare each id's `rev:` to what you recorded last pass
    and act on ids whose `rev:` moved (plus ids that are new or gone). Defaults to absent (treat
    as 0) on pre-existing trackers.

Legend: `[ ]` awaiting the human's gate · `[x]` human approved.
<!-- loopboard:sync:rules:end -->

<!-- loopboard:sync:automation:begin -->
## Automation

Loop workers (Claude Code sessions in the workspace root) re-read this file and the index,
reconcile, and pick up work every pass. The extension spawns one loop terminal per model as a
single command — `claude --permission-mode auto --model opus '/loop 1m You are running as
model opus. Open .loopboard/LOOP.md, read the loop worker instructions in its Automation
section, and follow them exactly for this and every pass.'` — so the fenced block below IS the
standing instructions; only the interval is fixed at spawn time.

```
Re-read .loopboard/TODO.md (the task index) and reconcile it against the Rules in .loopboard/LOOP.md. A task's phase is its `phase:` field in the index — edit it in place; never cut/paste an entry. Task detail lives in .loopboard/tasks/<id>.md; open a task file only for tasks you act on, and create it with the canonical headings on first write. (1) For each New task the user ticked [x]: set `phase: backlog` and reset to [ ] in the index; set `promoted: <today>` in the task file's Meta. (2) For each Review task the user ticked [x]: set `completed: <today>` in the task file's Meta, add a [x] entry at the TOP of .loopboard/DONE.md's task list with its id/model/groomer and `completed: <today>` (DONE.md is newest-first, matching the board's Accept button; create it with a `## Tasks` section if absent), then delete the entry from the index; the task file stays in tasks/. (3) Append <today> to the ## Worklog of every task you touch. (4) For each Feedback task where EVERY index question has an `answer:`: if nothing else is In Progress (GLOBAL SINGLE-TASK LIMIT, Rule 2), move it back to In Progress and continue it, else leave it parked this pass; leave any task with a blank answer untouched (Rule 10). (5) For each Review task whose `model:` is yours (or has no `model:`, if you are the default model) with an unaddressed `feedback:` sub-bullet on its index entry: if nothing else is In Progress (Rule 2), move it back to In Progress, address it, return it to Review with an updated ## Delivered and the `feedback:` sub-bullet(s) removed (Rule 13). (6) Apply and then delete any `note:` sub-bullet on the index entry of a task whose `model:` is yours (or has no `model:`, if you are the default model) (Rule 16). (7) If a referenced path/file/PR/dependency changed since a task was written, update the task file to match reality and log the correction in its Worklog. Then START WORKING (respecting the GLOBAL SINGLE-TASK LIMIT, Rule 2): ONLY if NOTHING anywhere on the board is `phase: inprogress` (any model, not just yours), claim the top Backlog task whose `model:` is yours — or has no `model:`, if you are the default model (Rule 15) — and whose `depends on:` (task file Meta) are satisfied: set `phase: inprogress` in the index FIRST, as a precondition, before touching any code/branch/research/PR — never begin while the index still shows the task in Backlog/Feedback (Rule 11) — then set `started: <today>` and a worklog entry in its task file, and execute it. If something IS already In Progress (any model), do NOT claim, start, or resume any task this pass — emit `something is in progress — skipping prepared task <id/title>` and keep grooming/reconciling only. When finished, commit and push the work to its `task/**` branch — never to `main` — and open a PR only if you the user requested it (Rule 7); record the delivery in the task file's Meta `link:` (the PR URL when a PR exists, otherwise the branch name, never a commit sha), write ## Delivered, and set `phase: review`. If unsure how to proceed, set `phase: feedback` with index `question:` sub-bullets and stop — never guess. New tasks and DRAFTs are routed by `groomer:`, NOT `model:` (Rule 14): if a New task's `groomer:` matches your model — or it has none and you are the default model — groom it with a subagent of that groomer model, expanding the story into the task file's ## Description and recording human decisions as single-line index `question:` sub-bullets with blank `answer:` lines (not OPEN QUESTIONS prose), adding up to 3 `suggestion:` sub-bullets beneath a question's `answer:` line when its choice is clear-cut and on-target (skip on genuinely open judgment calls); when such a task has any filled `answer:`, re-groom it the same way, fold each incorporated decision into ## Description, and delete the resolved pair from the index — a still-present filled answer means not yet incorporated. Never touch a New task whose `groomer:` names a different model, and never groom, re-groom or answer-fold a task whose `groomer:` is `none` — that value means ON HOLD and the task belongs to no loop until the human changes it (Rule 14). Never promote New tasks yourself (leaving New needs the human's [x], Rule 1). Respect one worker per task (Rule 2): never touch a task (outside of New) whose `model:` names a different model, and never tick [x] yourself. Report what changed and what you worked on, referring to every task by its full title — never by its bare id (add the id in parentheses only for disambiguation); if there is nothing to do, reply "no changes".
```

Notes:
- Interval comes from `loopBoard.loopInterval` (default 1m) and rides in the spawn command, so
  changing it means recycling the terminal — everything else above is re-read live each pass.
- Human gates hold: loops never promote New tasks, accept Review tasks (both need the human's
  `[x]`), or demote Backlog tasks (a direct board click) — and park uncertainty in Feedback.
  The extension's ▶ buttons start the per-model loops.
- Stop a loop via its status line, or cancel the scheduled task in the session.
- A "the board changed" line pasted into your terminal is a HINT naming tasks the extension
  routed to you — never a work order. Do the normal pass: re-read this file and the index, and
  let the Rules decide. Rules are unchanged; Rule 2 still gates every claim.
<!-- loopboard:sync:automation:end -->

<!-- loopboard:custom:begin -->
## Custom rules (workspace)

Standing instructions for THIS workspace — add yours here as free text, edited directly in this
file; where they contradict a Rule above, they win in this workspace. Sync never rewrites this
section.
<!-- loopboard:custom:end -->
