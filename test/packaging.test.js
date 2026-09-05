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

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// Pinned here, deliberately: reading the list only out of the shell script would make deleting an
// entry from BOTH files a green test, and dropping e.g. codicon.ttf ships a working build with
// broken webview icons. The script is cross-checked against this list below instead.
const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE',
  'out/extension.js',
  'media/board.html',
  'media/board.css',
  'media/board.js',
  'media/sidebar.html',
  'media/sidebar.css',
  'media/sidebar.js',
  'media/codicon/codicon.css',
  'media/codicon/codicon.ttf',
  'media/icon.svg',
  'media/icon-dark.svg',
  'media/icon-light.svg',
  'media/loopboard-icon-128.png',
  'media/template-todo.md',
  'media/template-loop.md',
];

function scriptRequiredPaths() {
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

test('the packaging script asserts exactly the pinned required-file list', () => {
  assert.deepEqual(scriptRequiredPaths(), REQUIRED);
});

test('every required file survives .vscodeignore', () => {
  const negations = ignoreNegations();
  for (const file of REQUIRED) {
    assert.ok(
      negations.some((re) => re.test(file)),
      file + ' is required at runtime but no .vscodeignore negation re-includes it — it would be ' +
      'dropped from the .vsix.',
    );
  }
});

test('the templates the extension reads at runtime are explicitly re-included', () => {
  for (const template of ['media/template-todo.md', 'media/template-loop.md']) {
    assert.ok(
      REQUIRED.includes(template),
      template + ' must stay in the required-files list — src/controller.ts reads it from the ' +
      'installed extension for init, auto-heal and Sync Templates.',
    );
  }
});

test('every compiled module is required, not just the entry point', () => {
  // out/extension.js alone is not enough: it requires the rest at activation time, so a narrowed
  // !out/**/*.js negation would ship an extension that dies with "Cannot find module './store'".
  // The script derives them from src/, so assert that derivation is still there.
  const script = read('scripts', 'assert-vsix-contents.sh');
  assert.match(
    script,
    /for source in src\/\*\.ts/,
    'the script must require one out/<name>.js per src/*.ts, not just the entry point.',
  );
  assert.match(script, /out\/\$\(basename "\$source" \.ts\)\.js/);
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

test('custom releaseRules keep breaking changes and reverts releasable', () => {
  // commit-analyzer only falls back to its default rules when the custom ones return `undefined`.
  // A `{ type: 'docs', release: false }` rule carries no `breaking` key, so it also matches a
  // breaking commit and returns `false` — which is NOT undefined, so { breaking: true } from the
  // default preset never runs. Without these two rules a `refactor!:` carrying a BREAKING CHANGE
  // footer silently cuts no release at all.
  const config = JSON.parse(read('.releaserc.json'));
  const rules = config.plugins.find(
    (p) => Array.isArray(p) && p[0] === '@semantic-release/commit-analyzer',
  )[1].releaseRules;
  assert.ok(
    rules.some((r) => r.breaking === true && r.release === 'major'),
    'releaseRules must restate { breaking: true, release: "major" } — overriding the defaults ' +
    'drops it, and breaking changes would stop releasing.',
  );
  assert.ok(
    rules.some((r) => r.revert === true && r.release === 'patch'),
    'releaseRules must restate { revert: true, release: "patch" } for the same reason.',
  );
});

test('the vsce-listing assertion runs in the Makefile and in both workflows', () => {
  const script = /scripts\/assert-vsix-contents\.sh/;
  assert.match(read('Makefile'), script);
  // build.yml too: `make check` runs the assertion only under the opt-in PACKAGE=1, so without
  // the branch build catching it the first gate would be release.yml, after the tag exists.
  assert.match(read('.github', 'workflows', 'build.yml'), script);
  assert.match(read('.github', 'workflows', 'release.yml'), script);
});

test('release.yml asserts the package contents before anything is published', () => {
  const lines = read('.github', 'workflows', 'release.yml').split('\n');
  const assertStep = lines.findIndex((l) => l.includes('assert-vsix-contents.sh'));
  const publishing = lines.findIndex(
    (l) => l.includes('gh release upload') || l.includes('vsce publish'),
  );
  assert.ok(assertStep !== -1 && publishing !== -1);
  assert.ok(
    assertStep < publishing,
    'the assertion must run before the upload/publish steps, or a failure strands a published ' +
    'GitHub Release with no .vsix asset.',
  );
});
