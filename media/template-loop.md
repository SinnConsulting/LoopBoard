<!-- loopboard:sync:loop-intro:begin -->
# LOOP — LoopBoard workflow and loop worker instructions

Paths relative to workspace root. Standing loop-worker instructions, re-read every pass: editing
it changes every running loop's next pass, no restart. Executable instructions: trusted input.

## Storage

```
.loopboard/
  TODO.md        # task index — one slim entry per active task (grammar below)
  DONE.md        # accepted tasks, newest first (may be absent until the first acceptance)
  LOOP.md        # this file
  tasks/<id>.md  # per-task detail: meta, problem, description, goals, worklog, delivered
```

Read economy: read this file and `TODO.md` every pass; open `tasks/<id>.md` only for tasks you act
on, create it (canonical headings below) on first write.

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

Entry = checkbox line + `key: value` sub-bullets in fixed order below, NOTHING else; rest in task
file. Phase = `phase:`, edited in place, never cut/paste (only removal: acceptance, Automation step
2). Extension parses tolerantly, saves canonical, keeps unrecognized lines verbatim + flagged.

```
- [ ] <Title — single line>
  - id: t-3f9a                          (stable short id; assigned if missing)
  - phase: new | backlog | inprogress | feedback | review
  - model: opus | sonnet | fable        (optional; absent = default model; Rule 15)
  - groomer: opus | sonnet | fable | none  (optional; absent = default model; none = on
                                          hold, no groomer; Rule 14)
  - question: <text>                    (repeatable, single line; Feedback & New)
    - answer: <text or blank>
    - suggestion: <text>                (up to 3; one option each, recommended first; Rule 14)
  - feedback: <text>                    (repeatable, single line; any phase incl. drafts;
                                          legacy `note:` = `feedback:`; Rule 13)
```

Draft = `- [ ] DRAFT: <raw text>` + `id:` (+ optional `model:`/`groomer:`/`feedback:`; no `phase:`
line — drafts are implicitly new); groomer expands it (Rule 14).
<!-- loopboard:sync:task-index-format:end -->

<!-- loopboard:sync:task-file-format:begin -->
## Task file format — `.loopboard/tasks/<id>.md`

Fixed headings in order below, all optional (omit empty); `## Meta` alone is `key: value` (fixed key
order). Index owns title, phase, `model:`, `groomer:`, questions, `feedback:`: never duplicate.

```
# <Title> (t-3f9a)

## Meta
- added: YYYY-MM-DD
- started: YYYY-MM-DD
- promoted: YYYY-MM-DD
- completed: YYYY-MM-DD
- link: <url or task/** branch name>[, <…>]
- depends on: t-xxxx[, t-yyyy]
- tags: <tag>[, <tag>]

## Problem
<groomer-owned, a worker NEVER edits it; 2-4 factual sentences: why this task exists, no design>

## Description
<free markdown; the groomed story lives here>

## Goals
- <groomer-owned; one verifiable outcome per bullet — review judges `## Delivered` against these>

## Worklog
- YYYY-MM-DD

## Delivered
<free markdown; Review only>
```
<!-- loopboard:sync:task-file-format:end -->

<!-- loopboard:sync:done-index:begin -->
## Done index — `.loopboard/DONE.md`

Newest-first `## Tasks` of `- [x] <Title>` entries, sub-bullets only `id:`, `model:`, `groomer:`,
`completed:`. Create on first use (`# DONE` + `## Tasks`). Detail in `tasks/<id>.md`.
<!-- loopboard:sync:done-index:end -->

<!-- loopboard:sync:rules:begin -->
## Rules

1. `[x]` is human-only, never ticked by workers: on New = promote to Backlog; on Review = accepted →
   DONE.md. Board's Demote (Backlog → New) and drag reorder (within TODO.md): third and fourth
   human-only actions, not ticks; immediate, non-destructive. Index order = human's priority =
   pick order (top down). Workers do all other phase moves and propose; never demote or reorder.
2. One worker per task, plus GLOBAL SINGLE-TASK LIMIT: at most ONE task `phase: inprogress`
   board-wide at any moment, regardless of model; the sole one-worker guarantee. If ANY task is In
   Progress, no loop starts a Backlog task, resumes a Review/Feedback task or runs a feedback round
   trip (Rule 13): only groom/reconcile (grooming New never sets `inprogress`, so always allowed).
   Already In Progress or in DONE.md → never start a parallel copy.
3. Dates live in task-file Meta: `added:` entered tracker; `started:` work began; `promoted:` New →
   Backlog; `completed:` acceptance. Append `<today>` to `## Worklog` each active day.
4. Index entries: one `key: value` per sub-bullet, fixed order, no extra keys. Task files: fixed
   headings, canonical order; worker writes only Meta dates, `link:`, `## Worklog`, `## Delivered`
   (+ `## Description` for step-7 path fixes), NEVER `## Problem`/`## Goals`.
5. Grooming ≠ approval: editing a New task's text is allowed; leaving New requires Rule 1.
6. Unsure → `phase: feedback` + `question: <text>` sub-bullets (each with own `- answer:` beneath)
   on the INDEX entry, so board shows them without task files. Stop the task; Rule 10 gates resume.
7. Never commit to `main`: all work on a `task/**` branch off latest `main`. PR OPTIONAL, only if
   user requested. Before `phase: review`, write `## Delivered` and record delivery in task-file
   `link:` (must be non-empty): PR URL if any, else `task/**` branch name, never a commit sha.
8. `question:` and `feedback:`: plain index sub-bullets, no glyph prefix; name alone classifies them.
9. git worktrees forbidden (break pre-commit hooks assuming `.git` is a directory), so is
   `--no-verify`. Normal checkout: fetch latest `main`, branch off it, commit, push (Rule 7).
10. Resume a Feedback task only when EVERY `question:` on its index entry has a filled `answer:`.
    Any blank answer → leave it parked; do none of its work.
11. Set `phase: inprogress` (index; FIRST action of claiming) + `started: <today>` (Meta) BEFORE any
    work or research: never edit code, branch or open a PR while the index shows it outside In
    Progress. A feedback round trip (Rule 13) moves the phase only: no `started:`.
12. No stranded work: commit and push every change from a task to its `task/**` branch BEFORE
    `phase: review`; Review move = LAST action of finishing, after a successful push (as Rule 11:
    trails the work, never leads it). Never leave uncommitted code. No PR required (Rule 7).
13. `feedback:` (index) = human change request in any phase, not a gate; lingering = not yet
    applied. On Review → move to In Progress, address, update `## Delivered`, remove the `feedback:`
    sub-bullet(s), commit and push, and return to Review LAST (Rule 12 order).
    In Progress, or feedback touching no code on Backlog/Feedback → apply in place (no phase move),
    append `<today>` to `## Worklog`, delete it. Code-touching feedback (edits code, a branch, a
    commit or a PR — Rule 11's list) on a Backlog or Feedback task = ROUND TRIP, gated by Rule 2:
    set `phase: inprogress` FIRST (`started:` untouched — not a claim, not a resume), apply it,
    commit and push to its `task/**` branch, append `<today>` to `## Worklog`, delete the
    `feedback:` line, then return the task to its previous phase LAST. A Feedback task keeps its
    `question:`/`answer:` pairs untouched and takes the round trip even while they are unanswered. A
    Backlog round trip branches off latest `main`, names the branch in `## Worklog`; the later claim
    continues on that `task/**` branch, never a second one. New/DRAFT → the groomer's (Rule 14).
14. New/DRAFT grooming routed by `groomer:` (absent = default model; `none` = ON HOLD: task belongs
    to NO loop, never groom, re-groom or answer-fold it whatever its `model:` or filled answers say,
    until the human changes `groomer:`). Loop whose model matches `groomer:` owns it, delegates to a
    grooming subagent (Agent tool; spawn per Subagents below), never inline in the main loop. NEVER
    exceed the grooming concurrency cap named in your bootstrap prompt (grooming subagents per
    pass): take eligible tasks in index order, top down, until the cap, then STOP; leave the surplus
    in place, name every skipped task by title in your report. Subagent drafts a one-line title,
    `## Problem` (short, factual), `## Description`, `## Goals` (bullet list, yardstick review
    judges `## Delivered` against), grounds claims in latest `main` with file:line, names
    overlapping tasks by full title, no code or git writes, and returns it all (Rule 16); the loop
    writes it. Human decisions: ONE single-line `question:` per decision on the index entry (never
    prose, never two decisions in one line). New task where EVERY `question:` has a filled `answer:`
    → re-groom (any blank answer → leave untouched, same gate as Rule 10): resume its original
    groomer subagent if your session still holds it (SendMessage, where available); any resume
    failure (recycled or cleared session, no SendMessage, unknown agent id) silently falls back to a
    fresh groomer subagent. Fold the answered decision into the story (re-groom may revise all three
    groomer-owned sections); a still-present filled answer = not yet incorporated.
    A New/DRAFT `feedback:` → the groomer folds it into the story (re-groom as above; no answer
    gate), then the loop deletes it. `question:` names only the decision, NEVER options or a
    recommendation. Each concrete option = own `suggestion:` beneath `answer:` (max 3, recommended
    first); one board click accepts it (writes `<text> accepted` into `answer:` via ordinary
    field-patch, no AI). No concrete option (open judgment call) → no suggestions; accepting one, or
    filling `answer:` otherwise, clears that question's other suggestions.
    Tags: `- tags:` in `## Meta`, pick from the catalogue (`.loopboard/tags.md` + tags in use), coin
    a new name only when none fits; a DRAFT's leading `#word` becomes tag `word`, out of the title.
    Return a coined tag; the loop appends it as a bare `- <name>` line to `.loopboard/tags.md`
    (created with a `# Tags` heading when absent), never editing or removing an existing line there.
15. Claim tasks by `model:` (Backlog onward; absent = default model). Never claim a task whose
    `model:` names a different model. New-phase routing uses `groomer:` instead (Rule 14).
16. Subagents are board-blind; the loop is the board's ONLY writer. No subagent (groomer,
    implementer, reviewer, helper) reads or writes anything under `.loopboard/`, so concurrent
    groomers never race on `TODO.md`; the loop puts what one needs (story, Goals, answers,
    `feedback:`, other index titles with phase) in its brief. A GROOM subagent returns its report:
    title, `## Problem`, `## Description`, `## Goals`, and every human decision with its concrete
    options (max 3, recommended first) and the reason for the recommendation. Before returning, it
    also writes that report to `/tmp/loopboard/<workspace>/<id>/groom.md` (`<workspace>` = workspace
    folder name). The loop then does every board write itself: the task file (with the `<today>`
    Worklog line), then the index entry (title, `phase: new` on a DRAFT, `question:` with a blank
    `answer:`, its `suggestion:` lines), and deleting folded `question:`/`answer:` pairs and folded
    `feedback:`. Every pass, before spawning any groomer: a New task or DRAFT whose `groom.md` is
    newer than its `tasks/<id>.md` (or that has no task file) holds a report that came back but was
    never written: apply it as above, note "recovered" in its Worklog, and do not re-groom it. Each
    `suggestion:` reads as the complete answer on its own: what the human gets, with its number and
    consequence, and no option letter.

**Subagents** (Rule 14, DELEGATED-WORK MODE; Claude Code 2.1.292+). EVERY Agent-tool spawn MUST pass
`model` and `effort`. Never `subagent_type: fork` (ignores `effort`); never effort `max` (loop
session only). Groomer, implementer, reviewer: `general-purpose`, `model` = your own slot model (the
task's `groomer:`/`model:`), effort per rubric below; the review runs at the implementer's final
effort. Brief names mode (GROOM/WORK/REVIEW), task id and one line
`effort: <level> (<signals that held>)`, e.g. `effort: high (D)`, `effort: medium (-)`. Title (Agent
`description`): `<effort>-<task id>: <2-4 word headline>`, e.g. `high-t-4589: Swing sheet`. Your own
`--effort` governs only you.
- Signals, from the task file (GROOM: draft text, `feedback:`, answers; WORK/REVIEW: `## Goals`,
  `## Description`): **S** spans 3+ separately running or shipped parts (e.g. backend, frontend, CI,
  a file format other tools read; tests and docs never count); **N** a Goal states a threshold,
  timing, size, budget or count the worker must measure or pin down (a stay-under budget counts only
  if the story expects it tight); **D** the story amends or reverses a recorded decision (decision
  record, `CLAUDE.md` non-negotiable, LOOP.md Rule); **U** the approach is open (2+ options, none
  picked), a bug's root cause is unknown, or a Goal says investigate or measure before deciding.
- Level: `high` = at least one of S/N/D; `xhigh` = at least two of S/N/D AND U; `low` = no signal
  AND every Goal names the exact file and exact text or value AND no new logic branch (rename or
  move, wording fix, one config value, a decided deletion); else `medium`, the default (U alone, or
  a draft too thin to check). Tie-break: a signal the story leaves unclear counts as absent — the
  lower level wins. E.g. one-line README link → `low`; a setting + its webview (2 parts) or an
  unknown-cause bug → `medium`; amending a decision → `high`; host, spawn line, template and
  settings reversing a decision, shape open → `xhigh`.
- A subagent reporting "bigger than briefed" is re-spawned one level up (max `xhigh`), never pushed
  on. A resume (SendMessage) keeps its spawn effort: re-spawn to change it (a re-spawned re-groom
  re-runs the rubric on the current story).
- Haiku helper: you, a groomer or worker may hand a sub-step to `model: haiku`, `effort: low`
  (`Explore` if read-only, else `general-purpose`; title `haiku-<task id>: <headline>`) ONLY if ALL
  hold — kind: search or inventory across many files, mechanical edit (move/rename + fix paths,
  decided deletion, format conversion), boilerplate, syntax or API lookup, high-volume repetitive
  work; determined: the brief fixes the result (no design, no `## Goals`, nothing left open);
  checkable: the caller verifies the output before use; worth it: more than one or two of the
  caller's own tool calls. A condition in doubt counts as failed: the step stays on the task model.
  Haiku NEVER grooms, implements or reviews; task models are never `haiku`; helper never commits,
  pushes or branches.

Legend: `[ ]` awaiting the human's gate · `[x]` human approved.
<!-- loopboard:sync:rules:end -->

<!-- loopboard:sync:automation:begin -->
## Automation

Loop workers (Claude Code sessions in the workspace root) re-read this file and the index,
reconcile, and pick up work every pass. The extension spawns one loop terminal per model as one
command — `claude --permission-mode auto --model opus '/loop 1m You are running as
model opus. Open .loopboard/LOOP.md, read the loop worker instructions in its Automation
section, and follow them exactly for this and every pass.'` — so the fenced block below IS the
standing instructions; only the interval is fixed at spawn time.

```
Re-read .loopboard/TODO.md (the task index) and reconcile it against the Rules in .loopboard/LOOP.md. A task's phase is its `phase:` field in the index — edit it in place; never cut/paste an entry. Task detail lives in .loopboard/tasks/<id>.md; open a task file only for tasks you act on, and create it with the canonical headings on first write. (1) For each New task the user ticked [x]: set `phase: backlog` and reset to [ ] in the index; set `promoted: <today>` in the task file's Meta. (2) For each Review task the user ticked [x]: set `completed: <today>` in the task file's Meta, add a [x] entry at the TOP of .loopboard/DONE.md's task list with its id/model/groomer and `completed: <today>` (DONE.md is newest-first, matching the board's Accept button; create it with a `## Tasks` section if absent), then delete the entry from the index; the task file stays in tasks/. (3) Append <today> to the ## Worklog of every task you touch. (4) For each Feedback task where EVERY index question has an `answer:`: if nothing else is In Progress (GLOBAL SINGLE-TASK LIMIT, Rule 2), move it back to In Progress and continue it, else leave it parked this pass; leave any task with a blank answer untouched (Rule 10). (5) For each Review task whose `model:` is yours (or has no `model:`, if you are the default model) with an unaddressed `feedback:` sub-bullet on its index entry: if nothing else is In Progress (Rule 2), move it back to In Progress, address it, return it to Review with an updated ## Delivered and the `feedback:` sub-bullet(s) removed (Rule 13). (6) For each `feedback:` sub-bullet on the index entry of a Backlog, In Progress or Feedback task whose `model:` is yours (or has no `model:`, if you are the default model) (Rule 13): on an In Progress task, or when it touches no code, apply it in place with no phase move, then delete it; code-touching feedback on a Backlog or Feedback task takes the ROUND TRIP only if nothing else is In Progress (Rule 2), else leave it for a later pass: set `phase: inprogress` FIRST (leave `started:` untouched), apply it, commit and push to its `task/**` branch, delete the `feedback:` sub-bullet, and ONLY after that push, as the LAST action, return the task to its previous phase (a Feedback task keeps its questions, answered or not); feedback on a New task or DRAFT is folded in by its groomer (Rule 14). (7) If a referenced path/file/PR/dependency changed since a task was written, update the task file to match reality and log the correction in its Worklog. Then START WORKING (respecting the GLOBAL SINGLE-TASK LIMIT, Rule 2): ONLY if NOTHING anywhere on the board is `phase: inprogress` (any model, not just yours), claim the top Backlog task whose `model:` is yours — or has no `model:`, if you are the default model (Rule 15) — and whose `depends on:` (task file Meta) are satisfied: set `phase: inprogress` in the index FIRST, as a precondition, before touching any code/branch/research/PR — never begin while the index still shows the task in Backlog/Feedback (Rule 11) — then set `started: <today>` and a worklog entry in its task file, and execute it. If something IS already In Progress (any model), do NOT claim, start, or resume any task this pass — emit `something is in progress — skipping prepared task <id/title>` and keep grooming/reconciling only. When finished, in this STRICT order: FIRST write ## Delivered — naming how each ## Goals bullet was met, and any that was not — and record the delivery in the task file's Meta `link:` (the PR URL when a PR exists, otherwise the branch name, never a commit sha); THEN commit and push ALL the work to its `task/**` branch — never to `main` — opening a PR only if the user requested it (Rule 7); and ONLY after that push succeeded, as the LAST action, set `phase: review` — never before it (Rule 12). If unsure how to proceed, set `phase: feedback` with index `question:` sub-bullets and stop — never guess. A task leaving In Progress does NOT end the pass: whenever the task YOU hold leaves `phase: inprogress` — delivered to Review, or parked in Feedback (there, stop means stop working THAT task, not the pass) — START OVER from the top of this block in the same pass: re-read the index, run (1)-(7) again (answers filled and feedback added while you worked are waiting there), and claim the next eligible Backlog task under Rule 2. Repeat full passes until one ends with nothing claimed and nothing reconciled; ONLY then report and wait for the next tick. NEVER idle until the next tick while eligible work remains. New tasks and DRAFTs are routed by `groomer:`, NOT `model:` (Rule 14): if a New task's `groomer:` matches your model — or it has none and you are the default model — groom it with a subagent of that groomer model (board-blind: you write its returned report to the board yourself, and first apply any recovered groom.md, Rule 16), never exceeding the grooming concurrency cap named in your bootstrap prompt (take eligible tasks in index order top down until the cap is reached, then stop; leave the surplus in place for a later pass and name every skipped task by title in your report), expanding the story into the task file's ## Problem (short and factual), ## Description and ## Goals (a bullet list of verifiable outcomes; a worker never edits Problem or Goals) and recording each human decision as its own single-line index `question:` with a blank `answer:` (never prose), its options as up to 3 `suggestion:` sub-bullets (recommended first; none without a concrete option), never in the question text (Rule 14); when EVERY `question:` on such a task has a filled `answer:` (any blank answer → leave it untouched, same gate as Rule 10), re-groom it the same way, fold each incorporated decision into ## Problem/## Description/## Goals as it belongs (a re-groom may revise all three), and delete the resolved pair from the index — a still-present filled answer means not yet incorporated; a New task or DRAFT carrying `feedback:` is groomed or re-groomed the same way with the feedback folded in and then deleted (no answer gate). Never touch a New task whose `groomer:` names a different model, and never groom, re-groom or answer-fold a task whose `groomer:` is `none` — that value means ON HOLD and the task belongs to no loop until the human changes it (Rule 14). Never promote New tasks yourself (leaving New needs the human's [x], Rule 1). Respect one worker per task (Rule 2): never touch a task (outside of New) whose `model:` names a different model, and never tick [x] yourself. Report what changed and what you worked on, referring to every task by its full title — never by its bare id (add the id in parentheses only for disambiguation); if there is nothing to do, reply "no changes". DELEGATED-WORK MODE applies ONLY if your bootstrap prompt says `Delegate work to subagents`: every step above stays exactly as written and every `.loopboard/` write — the claim, `started:`, Worklog, `## Delivered`, `link:`, each phase move — stays with you, but you NEVER edit code yourself: delegate each code-editing path (the Backlog claim, a Feedback resume, Review-`feedback:` rework, a code-touching `feedback:` in another phase) to ONE implementer subagent (Agent tool) on your own slot model, which fetches latest main, branches `task/**` off it (no git worktree, no --no-verify), gets `make check` green, commits only its own files by explicit path, pushes, opens the PR and returns its URL, branch, commit shas, a per-goal account, deviations and anything unverified; steps that touch no code stay inline. Neither the implementer nor the review subagent reads or writes any `.loopboard/` file (Rule 16). If the prompt says `without review`: take the returned PR straight through the finishing order above (`## Delivered`, `link:` = the PR URL, `phase: review` LAST). Otherwise delegate a second, sequential review subagent (same slot model) to review the PR against the ## Goals you put in its brief and return pass or fail with a per-goal verdict — a goal not met is a FAIL, not a finding — plus any other findings: on pass take it through that same finishing order (Review = delivered with its PR still OPEN, awaiting the human [x]; never self-accept); on fail re-delegate ONCE to the implementer with the findings (resume it where possible) and review again; a second fail → `phase: feedback` with the findings as single-line `question:` sub-bullets (blank `answer:`). NEVER merge a PR — merging is the HUMAN's action alone; a task is never required to be merged to reach Review. Only one subagent runs at a time in this mode; an interrupted delegation leaves the task `phase: inprogress` with no worker, exactly like an interrupted inline task.
```

Notes:
- Interval (`loopBoard.loopInterval`), your own `--effort`, grooming cap and delegated-work mode
  ride the spawn command: changing them means recycling the terminal; all else is re-read live.
- Human gates hold: loops never promote New or accept Review tasks (both need the human's `[x]`) or
  demote Backlog tasks; they park uncertainty in Feedback. ▶ buttons start per-model loops.
- Stop a loop via its status line, or cancel the scheduled task in the session.
- Pasted "the board changed" line is a HINT (task IDS + moved fields, no text), never a work order:
  do a normal pass (re-read this file + index; unchanged Rules decide; Rule 2 gates every claim).
<!-- loopboard:sync:automation:end -->

<!-- loopboard:custom:begin -->
## Custom rules (workspace)

Standing instructions for THIS workspace — add yours as free text, edited directly in this file;
where they contradict a Rule above, they win in this workspace. Sync never rewrites this section.
<!-- loopboard:custom:end -->
