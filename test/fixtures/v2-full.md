# TODO

Single task tracker. Completed tasks are moved to [DONE.md](DONE.md).

## Rules

See PLAN.md for the v2 grammar.

---

## New (proposed — need your validation; tick `[x]` to promote to Backlog)

- [ ] Add rate limiting middleware to the public REST API
  - id: t-aa01
  - owner: unassigned
  - added: 2026-07-09
  - description: Protect the public API from abuse with a token-bucket limiter.

- [ ] DRAFT: the /orders endpoint sometimes returns 500 on stale cursor — validate and return 400?
  - id: t-aa02
  - added: 2026-07-10

---

## In Progress (one owner each)

- [ ] Fix flaky CI: e2e suite times out on cold Docker cache
  - id: t-bb01
  - owner: @claude
  - model: opus
  - added: 2026-07-08
  - started: 2026-07-09
  - worklog: 2026-07-09, 2026-07-10
  - link: https://example.com/pr/138
  - description: The e2e job times out when the Docker layer cache is cold.

---

## Feedback (worker paused — needs your input to proceed)

- [ ] Add retry logic to the webhook dispatcher
  - id: t-cc01
  - owner: @claude
  - model: opus
  - added: 2026-07-07
  - started: 2026-07-08
  - worklog: 2026-07-08
  - description: Retries for failed webhook deliveries.
  - question: ❓ Exponential backoff with jitter, or fixed 30s intervals?
    - answer: Exponential with jitter, cap at 5 attempts — consumers are idempotent.
  - question: ❓ Dead-letter failed webhooks to a DB table, or log and drop?
    - answer:

<!-- Format when a worker parks a task here:
- [ ] <task>
  - question: ❓ <what the worker needs decided>
    - answer:
-->

---

## Backlog (validated — ready to pick up)

- [ ] Migrate integration tests from Jest to node:test
  - id: t-dd01
  - owner: unassigned
  - model: sonnet
  - added: 2026-07-08
  - depends on: t-9c2e
  - description: Move the suite off Jest.

---

## Review (work done — tick `[x]` to accept and move to DONE.md)

- [ ] Add structured logging (pino) to the worker processes
  - id: t-ee01
  - owner: @claude
  - model: opus
  - added: 2026-07-05
  - started: 2026-07-06
  - worklog: 2026-07-06, 2026-07-07
  - link: https://example.com/pr/140
  - note: honor this then remove it
  - feedback: ⚠️ Please redact the auth token from the request log fields.
  - DELIVERED: Added pino with request-scoped child loggers across all workers.

---

## Automation

Watch this file every minute.

```
/loop 1m You are running as model {MODEL}. Re-read TODO.md and reconcile it.
```
