# Add retry logic to the webhook dispatcher (t-cc01)

## Meta
- added: 2026-07-07
- started: 2026-07-08
- link: https://example.com/pr/141
- depends on: t-9c2e, t-dd01

## Problem

Failed webhook deliveries are dropped on the first error, so a subscriber that blips loses events.

## Description

Retries for failed webhook deliveries.

Second paragraph with **bold** and a `code` span.

## Goals

- A failed delivery is retried with exponential backoff before it is dropped.
- The retry count is visible in the dispatcher's metrics.

## Worklog
- 2026-07-08
- 2026-07-09 (opus): claim blocked
  continuation line one
  continuation line two

## Delivered

Added exponential backoff with jitter across all dispatch workers.
