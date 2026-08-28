'use strict';
// README drift guard (t-158b). The settings region is generated from package.json's
// `contributes.configuration`; the feature prose is hand-written and only coverage-checked.
// This is the backstop that binds an editor who never reads `.claude/rules/readme-regen.md` —
// CI cannot, because .github/workflows/build.yml carries paths-ignore: ['**/*.md'].
//
// The tool lives under `.claude/skills/` (never shipped, never compiled into out-test/), so this
// suite requires it directly rather than through out-test/.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tool = require('../.claude/skills/readme-regen/readme-tool.js');
const root = path.resolve(__dirname, '..');
const readme = () => fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('README.md carries the settings sentinels', () => {
  const text = readme();
  assert.ok(text.includes(tool.BEGIN), `missing ${tool.BEGIN}`);
  assert.ok(text.includes(tool.END), `missing ${tool.END}`);
  assert.ok(text.indexOf(tool.BEGIN) < text.indexOf(tool.END), 'sentinels are in the wrong order');
});

test('the settings region is exactly what the generator would write', () => {
  const problems = tool.check(root).filter((p) => p.startsWith('settings region'));
  assert.deepEqual(problems, [], 'run the readme-regen skill: docker run --rm -v "$(pwd)":/app -w /app node:22 node .claude/skills/readme-regen/readme-tool.js generate');
});

test('every command, view and documented behaviour still has README prose', () => {
  const problems = tool.check(root).filter((p) => !p.startsWith('settings region'));
  assert.deepEqual(problems, [], 'README.md lost coverage of a real contribution point');
});

test('generating is idempotent — the rendered region is a fixpoint', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const once = tool.renderSettings(manifest);
  assert.equal(tool.renderSettings(manifest), once);
  assert.ok(once.startsWith(tool.BEGIN) && once.endsWith(tool.END));
});

test('a table cell never breaks the row: newlines collapse and pipes escape', () => {
  const rendered = tool.renderSettings({
    contributes: {
      configuration: [
        {
          title: 'T',
          properties: {
            'x.y': { type: 'string', default: 'a|b', markdownDescription: 'one\ntwo | three' },
          },
        },
      ],
    },
  });
  const row = rendered.split('\n').find((l) => l.startsWith('| `x.y`'));
  assert.equal(row, '| `x.y` | `a|b` | one two \\| three |');
  assert.equal(row.split('\n').length, 1);
});

test('a deprecated setting is rendered as deprecated, not as ordinary prose', () => {
  const rendered = tool.renderSettings({
    contributes: {
      configuration: [
        {
          title: 'T',
          properties: {
            'x.old': { type: 'boolean', default: false, markdownDescription: 'ignored', markdownDeprecationMessage: 'Use x.new.' },
          },
        },
      ],
    },
  });
  const row = rendered.split('\n').find((l) => l.startsWith('| `x.old`'));
  assert.ok(row.includes('**Deprecated.** Use x.new.'), row);
  assert.ok(!row.includes('ignored'), 'the deprecation message replaces the description');
});

test('properties render in `order`, then manifest order — matching the VSCode settings page', () => {
  const rendered = tool.renderSettings({
    contributes: {
      configuration: [
        {
          title: 'T',
          properties: {
            'x.late': { type: 'string', default: '', order: 90 },
            'x.early': { type: 'string', default: '', order: 1 },
            'x.unordered': { type: 'string', default: '' },
          },
        },
      ],
    },
  });
  const ids = rendered.split('\n').filter((l) => l.startsWith('| `x.')).map((l) => l.split('`')[1]);
  assert.deepEqual(ids, ['x.early', 'x.late', 'x.unordered']);
});

test('every configuration group in the manifest gets its own heading and table', () => {
  const text = readme();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const group of manifest.contributes.configuration) {
    assert.ok(text.includes(`### ${group.title}`), `no heading for ${group.title}`);
    for (const id of Object.keys(group.properties)) {
      assert.ok(text.includes(`| \`${id}\` |`), `no row for ${id}`);
    }
  }
});
