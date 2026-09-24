/* The demo workspace every recording starts from: a small REST API project ("acme-api") with one
 * task in each phase. Scenes pick the tasks they need and may override a task's index lines.
 * Everything is plain LoopBoard markdown (index grammar v5 + the task-file format from LOOP.md). */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../server');

const TODO_TEMPLATE = fs.readFileSync(path.join(ROOT, 'media', 'template-todo.md'), 'utf8');
const PREAMBLE = TODO_TEMPLATE.slice(0, TODO_TEMPLATE.indexOf('## Tasks'));

const TASKS = {
  't-4f2a': {
    title: 'Add rate limiting to the public REST API',
    index: ['phase: new', 'model: sonnet', 'groomer: opus'],
    detail: `## Meta
- added: 2026-09-23

## Problem

The public API accepts unlimited requests per key. A single misbehaving integration saturated the
database pool twice last week and took the dashboard down with it.

## Description

Add a token-bucket limiter as Express middleware in front of every \`/v1\` route, keyed by API key
(falling back to client IP). Buckets live in the existing Redis instance. Over-limit requests get
\`429 Too Many Requests\` with a \`Retry-After\` header.

## Goals

- Every \`/v1\` route is limited per API key, 600 requests / minute by default.
- Over-limit responses are \`429\` with \`Retry-After\` and an \`X-RateLimit-Remaining\` header.
- Limits are configurable per plan without a redeploy.
`,
  },
  't-9c1d': {
    title: 'Export invoices as CSV from the billing page',
    index: ['phase: new', 'model: sonnet', 'groomer: opus',
      'question: Include line items, or one row per invoice?', '  - answer:',
      '  - suggestion: One row per invoice', '  - suggestion: Include line items'],
    detail: `## Meta
- added: 2026-09-24

## Problem

Finance re-types invoice data into their spreadsheet every month-end close.

## Description

A **Download CSV** button on the billing page that exports the invoices matching the current filter.
`,
  },
  't-7b3e': {
    title: 'Migrate integration tests from Jest to node:test',
    index: ['phase: backlog', 'model: sonnet'],
    detail: `## Meta
- added: 2026-09-20
- promoted: 2026-09-22

## Problem

Jest is the last heavy devDependency; its transform step doubles cold test runs in CI.

## Description

Port \`test/integration/**\` to the built-in \`node:test\` runner and drop Jest.

## Worklog
- 2026-09-22
`,
  },
  't-2d8c': {
    title: 'Fix flaky CI: e2e suite times out on cold Docker cache',
    index: ['phase: inprogress', 'model: sonnet'],
    detail: `## Meta
- added: 2026-09-21
- started: 2026-09-25
- promoted: 2026-09-22
- link: task/t-2d8c-ci-cache

## Problem

About one in four CI runs fails with a 10-minute timeout while the e2e stage pulls images.

## Description

Warm the Docker layer cache in a dedicated job and pin the e2e images by digest.

## Worklog
- 2026-09-25
`,
  },
  't-5e61': {
    title: 'Retry failed webhook deliveries',
    index: ['phase: feedback', 'model: opus',
      'question: Exponential backoff with jitter, or fixed 30s intervals?', '  - answer: Exponential with jitter, capped at 5 attempts.',
      'question: What happens after the last attempt fails?', '  - answer:',
      '  - suggestion: Dead-letter to a database table', '  - suggestion: Log and drop'],
    detail: `## Meta
- added: 2026-09-18
- started: 2026-09-24
- promoted: 2026-09-19
- link: task/t-5e61-webhook-retries

## Problem

Webhook deliveries are dropped on the first network error, so subscribers silently miss events.

## Description

Retry failed deliveries from the dispatcher queue before giving up on them.

## Goals

- A failed delivery is retried before it is given up on.
- The retry count is visible in the dispatcher metrics.

## Worklog
- 2026-09-24
- 2026-09-25 (opus): parked on two design questions
`,
  },
  't-a13f': {
    title: 'Structured JSON logging for the worker processes',
    index: ['phase: review', 'model: opus'],
    detail: `## Meta
- added: 2026-09-16
- started: 2026-09-23
- promoted: 2026-09-17
- link: https://github.com/acme/acme-api/pull/212

## Problem

Worker logs are free-text lines; nothing can be filtered by job id or level in the log viewer.

## Description

Replace \`console.log\` in \`workers/\` with a pino logger that emits one JSON object per line.

## Goals

- Every worker log line is JSON with \`level\`, \`time\`, \`jobId\` and \`msg\`.
- No request payloads or secrets appear in the logs.

## Worklog
- 2026-09-23
- 2026-09-24

## Delivered

Swapped every \`console.*\` call in \`workers/\` for a shared **pino** logger (\`lib/log.ts\`) with a
\`jobId\` child binding per job. Request bodies and the \`authorization\` header are redacted.
14 new tests; CI green. PR: https://github.com/acme/acme-api/pull/212
`,
  },
};

const DONE = [
  { id: 't-31b0', title: 'Paginate the /v1/orders endpoint with opaque cursors', model: 'sonnet', completed: '2026-09-22' },
  { id: 't-c8e4', title: 'Add health and readiness probes for Kubernetes', model: 'sonnet', completed: '2026-09-19' },
  { id: 't-0a7f', title: 'Move secrets from .env files to the vault', model: 'opus', completed: '2026-09-15' },
];

function entryText(id, t, over) {
  const index = over && over[id] ? over[id] : t.index;
  return [`- [ ] ${t.title}`, `  - id: ${id}`, ...index.map((l) => (l.startsWith('  ') ? '  ' + l : '  - ' + l))].join('\n');
}

// files(['t-4f2a', ...], { overrides: { 't-4f2a': [...index lines] }, done: true })
function files(ids, opts) {
  const o = opts || {};
  const out = {};
  const entries = ids.map((id) => entryText(id, TASKS[id], o.overrides));
  out['TODO.md'] = PREAMBLE + '## Tasks\n\n' + (entries.length ? entries.join('\n\n') : '_(none)_') + '\n';
  for (const id of ids) out[`tasks/${id}.md`] = `# ${TASKS[id].title} (${id})\n\n${TASKS[id].detail}`;
  if (o.done !== false) {
    out['DONE.md'] = '# DONE\n\n## Tasks\n\n' + DONE.map((d) =>
      `- [x] ${d.title}\n  - id: ${d.id}\n  - model: ${d.model}\n  - completed: ${d.completed}`).join('\n\n') + '\n';
  }
  return out;
}

module.exports = { files, TASKS };
