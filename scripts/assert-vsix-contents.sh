#!/bin/sh
# Assert the .vsix contains exactly what the extension needs at runtime, and nothing private.
#
# SINGLE SOURCE OF TRUTH: .vscodeignore. It is an ALLOWLIST (`**` + one negation per shipped path)
# and this script DERIVES the required-file list from those negation lines — nothing here restates
# it, so the shipped-file list lives in exactly one file. That matters because a missing negation
# silently drops a shipped file and nothing else in the build notices: src/controller.ts
# readTemplates() reads media/template-{todo,loop}.md from the INSTALLED extension, so a dropped
# template only fails in the user's editor, at init / auto-heal / Sync Templates time.
#
# Deleting a negation therefore also deletes the assertion — so test/packaging.test.js re-derives
# what must be re-included from the code that reads it (package.json's icons, src/panel.ts,
# src/webview.ts's page assets, src/controller.ts's templates, src/*.ts) and fails if .vscodeignore
# stops negating any of it. Neither file carries a hand-written copy of the list.
#
# Run from the repo root with @vscode/vsce reachable via npx. Callers: `make package`,
# .github/workflows/build.yml and .github/workflows/release.yml (before publishing).
set -eu

# Every concrete path .vscodeignore re-includes. Glob negations (e.g. !out/**/*.js) name no single
# file, so they are expanded from their real source further down instead.
REQUIRED=$(sed -n 's/^[[:space:]]*!//p' .vscodeignore | grep -v '[*?]' || true)
if [ -z "$REQUIRED" ]; then
  echo "ERROR: no concrete negation lines found in .vscodeignore — is it still an allowlist?" >&2
  exit 1
fi

listing=$(npx --yes @vscode/vsce ls --no-dependencies)

# Private working directories must never leak in.
if printf '%s\n' "$listing" | grep -E '^(\.loopboard|\.claude)/'; then
  echo "ERROR: private files listed above leaked into the .vsix" >&2
  exit 1
fi

missing=0
require() {
  if ! printf '%s\n' "$listing" | grep -qxF "$1"; then
    echo "ERROR: required file missing from the .vsix: $1" >&2
    missing=1
  fi
}

for f in $REQUIRED; do
  require "$f"
done

# package.json's main is out/extension.js, but it requires every other compiled module at
# activation time, so listing only the entry point would let a narrowed `!out/**/*.js` negation
# ship an extension that dies with "Cannot find module './store'". Derive the list from src/ so a
# new module is covered without editing anything here.
for source in src/*.ts; do
  require "out/$(basename "$source" .ts).js"
done

[ "$missing" -eq 0 ] || exit 1

echo "vsix contents OK — all required files present, no private files"
