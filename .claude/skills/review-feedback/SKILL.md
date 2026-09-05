---
name: review-feedback
description: Write code-review findings into a LoopBoard story's review box — `feedback:` sub-bullets on the task's Review entry in .loopboard/TODO.md — so the owning loop re-triggers, moves the task back to In Progress and addresses them (LOOP.md Rule 13). Use after a /review or /code-review of a task PR when the user wants the concerns on the story ("write the concerns to the story", "put the review on the task", "feedback the findings").
---

# review-feedback — findings → story review box

A PR review that only posts GitHub comments does NOT reach the loop. Loops read
`.loopboard/TODO.md`; a Review task's `feedback:` sub-bullets are the change request that makes
the owning loop move it back to In Progress, fix, and return it to Review (Rule 13). This skill
writes the findings there.

## Input

`<pr-number | task-id> [findings]`. Findings default to the most recent review of that target in
this session (the list the user already read — never a re-derived one; see `/review`).

## Steps

1. **Resolve the task.** From a PR number: `gh pr view <n> --json headRefName` → branch
   `task/<id>-…` gives the id; cross-check `link:` in `.loopboard/tasks/<id>.md`. From a task id:
   use it directly. Abort with a message if the index entry is not `phase: review` — `feedback:`
   is Review-only (Rule 13); on a New/Backlog task use a `note:` instead and say so.

2. **Write the sub-bullets.** Edit ONLY that entry in `.loopboard/TODO.md`, in place. Append one
   `  - feedback: <single line>` per finding AFTER the existing `id`/`phase`/`model`/`groomer`/
   `rev` lines (fixed order; never write `rev:`; no glyph prefix, Rule 8). Each line: what is
   wrong, the failure in one clause, the fix direction, and `file ~line` in parentheses. Lead the
   first one with `Review of PR #<n> (inline comments posted):` when comments went up. Use a
   content-anchored `perl -0pi` substitution on the entry, not line numbers — loops write the file
   concurrently. Do not touch the task file: feedback is index-only until the worker addresses it.

3. **Verify** by printing the entry back. Report the task by full title and the count of feedback
   lines, and name the loop that owns it (`model:`).

## Rules

- The task's `model:` loop owns the fix. Never move the phase yourself and never add feedback to
  a task in any phase but Review.
- One finding per line, single line each (the index grammar is one `key: value` per sub-bullet).
- Findings already on the entry are not re-added; check before appending.
