'use strict';
// Packaging gates (t-e1d7). Two invariants that nothing else in the build can see:
//
//   1. .vscodeignore is an ALLOWLIST, so a file the extension reads at runtime is only ever one
//      missing negation away from vanishing — and it vanishes silently, in the user's installed
//      extension, not in CI. media/template-{todo,loop}.md are the sharp edge: src/controller.ts
//      readTemplates() loads them from the installed extension for init, auto-heal and Sync.
//   2. release.yml releases only on shipped-content pushes. The trap is that a file-extension rule
//      would be wrong: the templates are markdown AND shipped, README.md is the Marketplace body.
//
// The `vsce ls` half of the guard (scripts/assert-vsix-contents.sh) needs a real package run and
// so cannot live in this Docker unit suite — it runs in `make package` / `make check PACKAGE=1`
// and in release.yml before publish. This test covers everything reachable from plain fs reads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');

// List A comes from the shell script, so the script, .vscodeignore and this test cannot drift.
function requiredPaths() {
  const script = read('scripts', 'assert-vsix-contents.sh');
  const block = /REQUIRED='([^']*)'/.exec(script);
  assert.ok(block, 'scripts/assert-vsix-contents.sh must define a single-quoted REQUIRED list');
  return block[1].split('\n').map((l) => l.trim()).filter(Boolean);
}

// Minimal glob → RegExp: `**` spans directories, `*` stops at a separator, and `/**/` may match
// zero directories (so out/**/*.js covers out/extension.js, as minimatch and Actions both treat it).
function globToRegExp(glob) {
  const escape = (lit) => lit.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const source = glob
    .split('/**/').map((segment) => segment
      .split('**').map((part) => part.split('*').map(escape).join('[^/]*'))
      .join('.*'))
    .join('(?:/.*)?/');
  return new RegExp('^' + source + '$');
}

function ignoreNegations() {
  return read('.vscodeignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('!'))
    .map((l) => globToRegExp(l.slice(1)));
}

function releasePaths() {
  const lines = read('.github', 'workflows', 'release.yml').split('\n');
  const start = lines.findIndex((l) => l.trim() === 'paths:');
  assert.notEqual(start, -1, "release.yml's push trigger must carry a paths: filter");
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const entry = /^\s+- '(.+)'$/.exec(line);
    if (!entry) break;
    out.push(entry[1]);
  }
  return out;
}

test('.vscodeignore is an allowlist that ignores everything by default', () => {
  const patterns = read('.vscodeignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  assert.equal(patterns[0], '**', '.vscodeignore must start by ignoring everything (allowlist)');
});

test('every required file survives .vscodeignore', () => {
  const negations = ignoreNegations();
  for (const file of requiredPaths()) {
    assert.ok(
      negations.some((re) => re.test(file)),
      file + ' is required at runtime but no .vscodeignore negation re-includes it — it would be ' +
      'dropped from the .vsix.',
    );
  }
});

test('the templates the extension reads at runtime are explicitly re-included', () => {
  const required = requiredPaths();
  for (const template of ['media/template-todo.md', 'media/template-loop.md']) {
    assert.ok(
      required.includes(template),
      template + ' must stay in the required-files list — src/controller.ts reads it from the ' +
      'installed extension for init, auto-heal and Sync Templates.',
    );
  }
});

test('doc and repo-housekeeping files stay out of the package', () => {
  const negations = ignoreNegations();
  const excluded = [
    'CLAUDE.md', 'DECISIONS.md', 'VERIFICATION.md', 'FAQ.md', 'language.md',
    'decisions/tooling.md', 'src/extension.ts', 'test/packaging.test.js', 'Makefile',
    'scripts/assert-vsix-contents.sh', '.loopboard/TODO.md', '.claude/rules/tests.md',
    'media/hero.jpg', 'media/screenshot-sidebar.png', 'media/screenshot-board.gif',
    'media/loopboard-icon.svg',
  ];
  for (const file of excluded) {
    assert.ok(
      !negations.some((re) => re.test(file)),
      file + ' must not be re-included by .vscodeignore — it does not ship.',
    );
  }
});

test('release.yml releases on shipped content only', () => {
  const paths = releasePaths();
  const expected = [
    'src/**',
    'media/**',
    '!media/hero.jpg',
    '!media/screenshot-sidebar.png',
    '!media/screenshot-board.gif',
    '!media/loopboard-icon.svg',
    'package.json',
    'package-lock.json',
    'README.md',
    'LICENSE',
    '.vscodeignore',
    'tsconfig.json',
    '.github/workflows/release.yml',
    '.releaserc.json',
  ];
  // Order matters to GitHub: a negation only narrows patterns listed before it.
  assert.deepEqual(paths, expected);
});

test('release.yml never triggers on repo-housekeeping paths', () => {
  const matchers = releasePaths()
    .filter((p) => !p.startsWith('!'))
    .map(globToRegExp);
  const excluded = [
    'test/gates.test.js', 'tsconfig.test.json', '.claude/rules/tests.md', '.loopboard/TODO.md',
    'CLAUDE.md', 'DECISIONS.md', 'decisions/tooling.md', 'VERIFICATION.md', 'FAQ.md',
    'language.md', 'Makefile', '.github/workflows/build.yml', '.github/workflows/publish.yml',
    '.gitignore',
  ];
  for (const file of excluded) {
    assert.ok(
      !matchers.some((re) => re.test(file)),
      'a change to ' + file + ' alone must not cut a release.',
    );
  }
});

test('media/template-*.md still trigger a release', () => {
  // The regression this whole gate exists to avoid: copying build.yml's paths-ignore ['**/*.md']
  // would have silently stopped shipping template changes, which every workspace re-syncs from.
  const matchers = releasePaths().filter((p) => !p.startsWith('!')).map(globToRegExp);
  for (const file of ['media/template-loop.md', 'media/template-todo.md', 'README.md']) {
    assert.ok(matchers.some((re) => re.test(file)), file + ' must be able to trigger a release.');
  }
});

test('.releaserc.json pins non-shipping commit types to no release', () => {
  const config = JSON.parse(read('.releaserc.json'));
  const analyzer = config.plugins.find(
    (p) => Array.isArray(p) && p[0] === '@semantic-release/commit-analyzer',
  );
  assert.ok(analyzer, '@semantic-release/commit-analyzer must be configured with releaseRules');
  const rules = analyzer[1].releaseRules;
  for (const type of ['docs', 'chore', 'ci', 'build', 'test', 'style', 'refactor']) {
    assert.ok(
      rules.some((r) => r.type === type && r.release === false),
      type + ' commits must not cut a release.',
    );
  }
});

test('the vsce-listing assertion runs in both the Makefile and release.yml', () => {
  const script = 'scripts/assert-vsix-contents.sh';
  assert.match(read('Makefile'), new RegExp(script.replace(/[.\/]/g, '\\$&')));
  assert.match(
    read('.github', 'workflows', 'release.yml'),
    new RegExp(script.replace(/[.\/]/g, '\\$&')),
  );
});
