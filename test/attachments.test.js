'use strict';
// Pure attachment-link helpers (t-ae10, src/attachments.ts): which staged files a text links, the
// label-agnostic link strip behind a feedback chip's ×, and which of a deleted feedback item's
// files are safe to delete. The store-side file deletion itself is VERIFICATION.md item 13.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { attachmentPaths, stripAttachmentLink, unreferencedAttachments } = require('../out-test/attachments.js');

const C = '.loopboard/cache/t-1a2b/';

test('attachmentPaths: this task\'s own cache links only, label-agnostic, de-duplicated, in order', () => {
  const text = `see [image.png](${C}image-2.png) and [a.pdf](${C}a.pdf), again [x](${C}image-2.png)` +
    ` but not [other](.loopboard/cache/t-9999/b.png) nor [trav](${C}../t-9999/b.png) nor [web](https://x.test/c.png)`;
  assert.deepEqual(attachmentPaths(text, 't-1a2b'), [`${C}image-2.png`, `${C}a.pdf`]);
  assert.deepEqual(attachmentPaths('no links here', 't-1a2b'), []);
});

test('stripAttachmentLink removes every link to the path whatever its label; other text is untouched', () => {
  assert.equal(stripAttachmentLink(`fix this [image.png](${C}image-2.png) please`, `${C}image-2.png`), 'fix this please');
  assert.equal(stripAttachmentLink(`[image.png](${C}image-2.png)`, `${C}image-2.png`), '', 'an image-only item empties');
  const other = `keep  double  spaces [b](${C}b.png)`;
  assert.equal(stripAttachmentLink(other, `${C}image.png`), other, 'a text without the path comes back byte-identical');
  assert.equal(
    stripAttachmentLink(`[image.png](${C}image.png) and [image.png](${C}image-2.png)`, `${C}image.png`),
    `and [image.png](${C}image-2.png)`,
    'a same-named but different path is kept',
  );
});

test('unreferencedAttachments: a deleted item\'s files go unless still mentioned elsewhere', () => {
  const removed = `look [image.png](${C}image.png) and [image.png](${C}image-2.png) and [log.txt](${C}log.txt)`;
  const remaining = [
    'Title of the task',
    `another feedback item [shot](${C}image-2.png)`, // still linked from another item
    `## Description\n\nsee ${C}log.txt for the trace`, // still mentioned in the task file
  ];
  assert.deepEqual(unreferencedAttachments(removed, remaining, 't-1a2b'), [`${C}image.png`]);
  assert.deepEqual(unreferencedAttachments(removed, [], 't-1a2b'), [`${C}image.png`, `${C}image-2.png`, `${C}log.txt`]);
  assert.deepEqual(unreferencedAttachments('plain text', ['x'], 't-1a2b'), []);
});

test('unreferencedAttachments never selects another task\'s file', () => {
  const removed = '[b](.loopboard/cache/t-9999/b.png)';
  assert.deepEqual(unreferencedAttachments(removed, [], 't-1a2b'), []);
});

test('[D6] a feedback item folded from `note\\n[image.png](…)` still yields its path, and the strip removes it (t-c4d1)', () => {
  const { feedbackLines } = require('../out-test/merge.js');
  const [item] = feedbackLines('note\n[image.png](.loopboard/cache/t-1/image.png)');
  assert.equal(item, 'note [image.png](.loopboard/cache/t-1/image.png)');
  assert.deepEqual(attachmentPaths(item, 't-1'), ['.loopboard/cache/t-1/image.png']);
  assert.equal(stripAttachmentLink(item, '.loopboard/cache/t-1/image.png'), 'note');
});
