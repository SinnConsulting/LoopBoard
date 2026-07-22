# TODO

Task index. One slim entry per active task; detail lives in `tasks/<id>.md`. Rules, formats,
and loop worker instructions: [LOOP.md](LOOP.md). Accepted tasks move to [DONE.md](DONE.md).

## Tasks

- [ ] Add rate limiting middleware to the public REST API
  - id: t-aa01
  - phase: new

- [ ] DRAFT: the /orders endpoint sometimes returns 500 on stale cursor
  - id: t-aa02

- [ ] Fix flaky CI: e2e suite times out on cold Docker cache
  - id: t-bb01
  - phase: inprogress
  - model: opus

- [ ] Add retry logic to the webhook dispatcher
  - id: t-cc01
  - phase: feedback
  - model: opus
  - question: ❓ Exponential backoff with jitter, or fixed 30s intervals?
    - answer: Exponential with jitter, cap at 5 attempts.
  - question: ❓ Dead-letter failed webhooks to a DB table, or log and drop?
    - answer:

- [ ] Migrate integration tests from Jest to node:test
  - id: t-dd01
  - phase: backlog
  - model: sonnet

- [ ] Add structured logging (pino) to the worker processes
  - id: t-ee01
  - phase: review
  - model: opus

<!-- Format when a worker parks a task here:
- [ ] <task>
  - question: ❓ <what the worker needs decided>
    - answer:
-->
