# Add retry logic to the webhook dispatcher (t-cc01)

## Meta
- owner: @claude
- added: 2026-07-07
- started: 2026-07-08
- link: https://example.com/pr/141
- depends on: t-9c2e, t-dd01

## Description

Retries for failed webhook deliveries.

Second paragraph with **bold** and a `code` span.

## Notes
- Rebase on main before opening the PR.
- Add a metric for retry count.

## Worklog
- 2026-07-08
- 2026-07-09

## Feedback

⚠️ Please redact the auth token from the request log fields.

## Delivered

Added exponential backoff with jitter across all dispatch workers.
