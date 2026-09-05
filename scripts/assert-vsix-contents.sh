#!/bin/sh
# Assert the .vsix contains exactly what the extension needs at runtime, and nothing private.
#
# .vscodeignore is an ALLOWLIST (`**` + negations), so a missing negation silently drops a shipped
# file and nothing else in the build notices: src/controller.ts readTemplates() reads
# media/template-{todo,loop}.md from the INSTALLED extension, so a dropped template only fails in
# the user's editor, at init / auto-heal / Sync Templates time. This script is the guard.
#
# Single source of truth for that list: test/packaging.test.js parses REQUIRED below and asserts
# .vscodeignore negates every entry, so the two files cannot drift apart.
#
# Run from the repo root with @vscode/vsce reachable via npx. Callers: `make package` and
# .github/workflows/release.yml (before publishing).
set -eu

# List A — every path that MUST be in the package.
REQUIRED='package.json
README.md
LICENSE
out/extension.js
media/board.html
media/board.css
media/board.js
media/sidebar.html
media/sidebar.css
media/sidebar.js
media/codicon/codicon.css
media/codicon/codicon.ttf
media/icon.svg
media/icon-dark.svg
media/icon-light.svg
media/loopboard-icon-128.png
media/template-todo.md
media/template-loop.md'

listing=$(npx --yes @vscode/vsce ls --no-dependencies)

# Private working directories must never leak in.
if printf '%s\n' "$listing" | grep -E '^(\.loopboard|\.claude)/'; then
  echo "ERROR: private files listed above leaked into the .vsix" >&2
  exit 1
fi

missing=0
for f in $REQUIRED; do
  if ! printf '%s\n' "$listing" | grep -qxF "$f"; then
    echo "ERROR: required file missing from the .vsix: $f" >&2
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1

echo "vsix contents OK — all required files present, no private files"
