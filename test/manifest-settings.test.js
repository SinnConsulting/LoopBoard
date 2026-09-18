'use strict';
// Manifest invariants for `contributes.configuration` (t-sgrp).
//
// These are the goals 1–3 backstop: the four-section layout, the Beta area and — the one that
// matters for security — `"scope": "application"` on EVERY key. Without the scope assertion a
// future setting added without a scope would quietly fall back to `window` and become settable from
// a cloned repo's `.vscode/settings.json`, which is exactly the door this story closed. The check
// has no exception list on purpose: a new key fails the suite rather than opening it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sections = manifest.contributes.configuration;

const entries = () => {
  const out = [];
  for (const section of sections) {
    for (const [key, prop] of Object.entries(section.properties)) out.push({ section, key, prop });
  }
  return out;
};

const BETA_KEYS = ['loopBoard.delegateWork', 'loopBoard.delegateWork.review'];

test('the four sections are declared in the agreed order', () => {
  assert.deepEqual(
    sections.map((s) => s.title),
    [
      'LoopBoard: Models & Slots',
      'LoopBoard: Agent Setup',
      'LoopBoard: Board & Workspace',
      'LoopBoard: Beta (experimental)',
    ]
  );
  assert.deepEqual(sections.map((s) => s.order), [1, 2, 3, 4]);
});

test('section orders are unique', () => {
  const orders = sections.map((s) => s.order);
  assert.equal(new Set(orders).size, orders.length, 'two sections share an order — their layout is then undefined');
});

test('every loopBoard property is application-scoped — no exceptions', () => {
  for (const { key, prop } of entries()) {
    assert.ok(key.startsWith('loopBoard.'), `${key} is not a loopBoard.* key`);
    assert.equal(
      prop.scope, 'application',
      `${key} has scope ${JSON.stringify(prop.scope)} — every LoopBoard setting must be user-settings-only, ` +
      'or a cloned repo can set it through .vscode/settings.json or a repo-supplied .devcontainer/.'
    );
  }
});

test('every property carries an explicit order and a markdownDescription', () => {
  for (const { key, prop } of entries()) {
    assert.equal(typeof prop.order, 'number', `${key} has no explicit order`);
    assert.equal(typeof prop.markdownDescription, 'string', `${key} has no markdownDescription`);
    assert.ok(prop.markdownDescription.trim().length > 0, `${key} has an empty markdownDescription`);
  }
});

test('orders are renumbered in tens and unique within their section', () => {
  for (const section of sections) {
    const orders = Object.values(section.properties).map((p) => p.order);
    assert.equal(
      new Set(orders).size, orders.length,
      `${section.title} has duplicate orders — a later insert must not need a renumber`
    );
    for (const [key, prop] of Object.entries(section.properties)) {
      assert.equal(prop.order % 10, 0, `${key} is not numbered in tens (${prop.order})`);
      assert.ok(prop.order > 0, `${key} has a non-positive order`);
    }
  }
});

test('the Beta section contains exactly the keys intended to be beta', () => {
  const beta = sections.find((s) => s.title === 'LoopBoard: Beta (experimental)');
  assert.deepEqual(Object.keys(beta.properties), BETA_KEYS);
  // And nothing OUTSIDE it claims to be experimental.
  for (const { section, key, prop } of entries()) {
    const tagged = Array.isArray(prop.tags) && prop.tags.includes('experimental');
    assert.equal(
      tagged, section === beta,
      `${key}: tags and section disagree about whether it is Beta`
    );
  }
});

test('every Beta key is marked all three ways: section, sentence and tag', () => {
  const beta = sections.find((s) => s.title === 'LoopBoard: Beta (experimental)');
  for (const [key, prop] of Object.entries(beta.properties)) {
    assert.deepEqual(prop.tags, ['experimental'], `${key} must carry tags: ["experimental"]`);
    assert.ok(
      prop.markdownDescription.startsWith('**Beta —**'),
      `${key}'s markdownDescription must open with the **Beta —** sentence, so the native editor ` +
      'says the same thing LoopBoard\'s own Beta heading does'
    );
    assert.match(
      prop.markdownDescription,
      /may change or be withdrawn/,
      `${key}'s Beta sentence must say the feature may change or be withdrawn`
    );
  }
});

test('the Beta keys keep their original ids — graduating must never rename a key', () => {
  // Recorded in decisions/tooling.md: the SECTION carries the status, not the id. A move to
  // `loopBoard.beta.*` would drop existing values silently now and force a second rename later.
  for (const key of BETA_KEYS) assert.ok(!key.includes('.beta.'), `${key} must not live in a beta namespace`);
});

test('the deprecated pair is still declared, still deprecated, and still out of the tens run', () => {
  const agent = sections.find((s) => s.title === 'LoopBoard: Agent Setup');
  for (const key of ['loopBoard.autoRecycle', 'loopBoard.clearSessionAfterTask']) {
    const prop = agent.properties[key];
    assert.ok(prop, `${key} must stay declared — it is still honoured as a fallback`);
    assert.equal(typeof prop.markdownDeprecationMessage, 'string', `${key} must stay deprecated`);
    assert.ok(prop.order >= 900, `${key} must sort after the section's live settings`);
  }
});

test('every key the code reads is still declared in the manifest', () => {
  // Cheap drift guard: a section rename that dropped a property would otherwise only show up at
  // runtime, as a setting that silently reverts to its hard-coded fallback.
  const declared = new Set(entries().map((e) => e.key));
  for (const key of [
    'loopBoard.permissionMode', 'loopBoard.loopInterval', 'loopBoard.afterTask',
    'loopBoard.defaultWorkerModel', 'loopBoard.defaultGroomerModel',
    'loopBoard.maxAttachmentSizeMB', 'loopBoard.pulseTemplateSync', 'loopBoard.nudgeLoops',
    'loopBoard.contextLimit.percent', 'loopBoard.contextLimit.action', 'loopBoard.debug',
    'loopBoard.delegateWork', 'loopBoard.delegateWork.review',
    'loopBoard.models.opus.enabled', 'loopBoard.models.opus.model',
    'loopBoard.models.opus.effort', 'loopBoard.models.opus.groomConcurrency',
    'loopBoard.models.sonnet.enabled', 'loopBoard.models.sonnet.model',
    'loopBoard.models.sonnet.effort', 'loopBoard.models.sonnet.groomConcurrency',
    'loopBoard.models.fable.enabled', 'loopBoard.models.fable.model',
    'loopBoard.models.fable.effort', 'loopBoard.models.fable.groomConcurrency',
  ]) {
    assert.ok(declared.has(key), `${key} is read by src/ but no longer declared`);
  }
});
