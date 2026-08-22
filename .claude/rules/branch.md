# Rule: branch

Git branch rules for LoopBoard.

## Naming

Branches MUST be created with the name `task/**`:

```yaml
branches:
  - 'task/**'
```

Examples: `task/t-33cb-drop-owner-field`, `task/t-9e27-attachment-chips`.

Never branch directly off a bare task id (`t-33cb-…`) — the `task/` prefix is mandatory.

## Why

`.github/workflows/build.yml` triggers on `push` with `branches: ['task/**']`. Any other branch
name silently skips the per-branch build + test + `.vsix` artifact, so no reviewer can install the
build under review. The trigger also carries `paths-ignore: ['**/*.md']` — doc-only pushes
intentionally produce no build.

`.github/workflows/release.yml` triggers on push to `main`; releases stay entirely on `main`.

## Before pushing a branch

- `make check` (build + test) MUST pass before any commit. Any `src/**` change additionally
  requires `make test` green before it counts as done.
- Never add Claude as a co-author; no `Co-Authored-By` trailer referencing Claude or Anthropic.
- Commit or push only when explicitly asked. If on `main`, create a `task/**` branch first.
