# Rule: tests

Test rules for LoopBoard. Applies to every change made while working a task.

## Every change ships with a test

- Every feature or fix lands with a test that covers it: a case in `test/*.test.js` run by
  `make test`. Behaviour that only exists in the webview (`media/`) and cannot reach the Docker
  suite gets a `VERIFICATION.md` checklist item instead, and is named as untested below.
- Never delete, skip, disable, or weaken an existing test (no `skip`, no loosened assertions, no
  raised budgets) to make a change pass. A test that a change breaks is a finding about the
  change, not about the test.

## Untestable or failing → Feedback, human answer required

- If the change cannot be tested, or its test does not pass, commit and push the work as it stands,
  then set `phase: feedback` — not Review, not Backlog. Add `question:` sub-bullets on the index
  entry (each with a blank `- answer:`) stating exactly what is untested or failing, why, and what
  decision is needed (accept as is, drop the change, or a different approach). Rule 10 then holds
  the task until every question is answered.
- Never move such a task to Review on your own: Review means tested and green.
