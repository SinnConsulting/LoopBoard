# TODO

Task index with pre-t-ae10 `note:` lines, interleaved with `feedback:` ones.

## Tasks

- [ ] Fix flaky CI: e2e suite times out on cold Docker cache
  - id: t-ln01
  - phase: inprogress
  - model: opus
  - note: Rebase on main before opening the PR.
  - feedback: Keep the retry cap at 3.
  - note: Add a metric for retry count.

- [ ] DRAFT: the /orders endpoint sometimes returns 500 on stale cursor
  - id: t-ln02
  - note: Include the cursor format in the story.
