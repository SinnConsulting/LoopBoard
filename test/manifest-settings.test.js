'use strict';
// Manifest invariants for `contributes.configuration` (t-sgrp).
//
// These are the goals 1–3 backstop: the section layout, the (now empty) Beta area and — the one that
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

// t-2047: the delegation pair graduated out of Beta into Agent Setup — same ids, so existing user
// values carry over (decisions/tooling.md graduation rule).
const GRADUATED_KEYS = ['loopBoard.delegateWork', 'loopBoard.delegateReview'];

// WHEN a changed setting takes effect. `restart` = frozen into the spawn command, so a running loop
// keeps what it was spawned with; `live` = read on demand. There is no third class: every
// `getConfiguration` call in `src/` sits inside a closure taken at use time, so nothing is frozen at
// activation and no setting needs a window reload.
//
// This list is the SPAWN-COMMAND reality, hand-kept against `src/loop.ts`: `buildClaudeBase`
// (permissionMode, the resolved `--model` string, `--effort`) and `buildLoopCommand` (interval,
// groomConcurrency, delegateWork, delegateReview) are the only places a setting is baked in.
// Adding a setting to package.json without classifying it — or classifying one this list does not
// know — turns the suite red, which is the whole point: an absent marker on the settings page is
// then information ("this one is live"), never an oversight.
const RESTART_KEYS = [
  'loopBoard.permissionMode',
  'loopBoard.loopInterval',
  'loopBoard.models.opus.model', 'loopBoard.models.opus.effort', 'loopBoard.models.opus.groomConcurrency',
  'loopBoard.models.sonnet.model', 'loopBoard.models.sonnet.effort', 'loopBoard.models.sonnet.groomConcurrency',
  'loopBoard.models.fable.model', 'loopBoard.models.fable.effort', 'loopBoard.models.fable.groomConcurrency',
  'loopBoard.delegateWork', 'loopBoard.delegateReview',
];
// The one sentence every `restart` description ends with, so the NATIVE settings editor — which
// cannot render the page's marker — states the same fact in the same words. Imported, not retyped:
// it is the same constant the page and the grid note are built from.
const { APPLIES_RESTART_SENTENCE } = require('../out-test/settingsform.js');

test('the three sections are declared in the agreed order', () => {
  assert.deepEqual(
    sections.map((s) => s.title),
    [
      'LoopBoard: Models & Slots',
      'LoopBoard: Agent Setup',
      'LoopBoard: Board & Workspace',
    ]
  );
  assert.deepEqual(sections.map((s) => s.order), [1, 2, 3]);
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

test('no Beta section exists and no shipped key carries a Beta marker (t-2047)', () => {
  // The last two Beta keys graduated; the empty section was deleted rather than left drawn as an
  // empty heading. The tag-driven rendering stays for future betas and is covered by a synthetic
  // manifest in test/settingsform.test.js. A new beta must re-add all three markers together.
  assert.ok(
    !sections.some((s) => /beta|experimental/i.test(s.title)),
    'a Beta section is declared again — add its keys, markers and tests together'
  );
  for (const { key, prop } of entries()) {
    const tagged = Array.isArray(prop.tags) && prop.tags.includes('experimental');
    assert.equal(tagged, false, `${key} carries the experimental tag but no Beta section exists`);
    assert.ok(!prop.markdownDescription.startsWith('**Beta —**'), `${key} still opens with the **Beta —** sentence`);
  }
});

test('the graduated delegation keys sit in Agent Setup right after nudgeLoops (t-2047)', () => {
  const agent = sections.find((s) => s.title === 'LoopBoard: Agent Setup');
  const keys = Object.entries(agent.properties).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
  const at = keys.indexOf('loopBoard.nudgeLoops');
  assert.deepEqual(keys.slice(at, at + 3), ['loopBoard.nudgeLoops', ...GRADUATED_KEYS]);
  for (const key of GRADUATED_KEYS) {
    assert.equal(agent.properties[key].loopBoardApplies, 'restart', `${key} must stay a restart setting`);
    assert.ok(agent.properties[key].order < 900, `${key} must sort before the deprecated pair`);
  }
});

test('new defaults: context limit 35, delegate work on, delegate review off (t-2047)', () => {
  const all = Object.fromEntries(entries().map((e) => [e.key, e.prop]));
  assert.equal(all['loopBoard.contextLimit.percent'].default, 35);
  assert.equal(all['loopBoard.contextLimit.action'].default, 'recycle');
  assert.equal(all['loopBoard.delegateWork'].default, true);
  assert.equal(all['loopBoard.delegateReview'].default, false);
  // Each description says which state is the default.
  assert.match(all['loopBoard.contextLimit.percent'].markdownDescription, /`35` \(default\)/);
  assert.match(all['loopBoard.delegateWork'].markdownDescription, /^On \(default\):/);
  assert.match(all['loopBoard.delegateReview'].markdownDescription, /Off \(default\):/);
  assert.ok(!/On \(default\)/.test(all['loopBoard.delegateReview'].markdownDescription), 'delegateReview still claims On is the default');
  assert.ok(!/Off \(default\)/.test(all['loopBoard.delegateWork'].markdownDescription), 'delegateWork still claims Off is the default');
});

test('with every setting unset, a spawn ends "without review" and a loop trips at 35% (t-2047)', () => {
  // What the host hands the pure modules when nothing is set: VSCode's c.get returns the manifest
  // default, so feed exactly those through the real prompt builder and the real trip rule.
  const all = Object.fromEntries(entries().map((e) => [e.key, e.prop]));
  const { buildLoopCommand } = require('../out-test/loop.js');
  const { sanitizeContextPercent, shouldTrip } = require('../out-test/context.js');
  const tpl = fs.readFileSync(path.join(root, 'media', 'template-loop.md'), 'utf8');
  const cmd = buildLoopCommand(
    tpl, 'opus', all['loopBoard.loopInterval'].default, 3,
    all['loopBoard.delegateWork'].default, all['loopBoard.delegateReview'].default
  );
  assert.ok(cmd.endsWith(' Delegate work to subagents without review.'), cmd);
  const threshold = sanitizeContextPercent(all['loopBoard.contextLimit.percent'].default);
  assert.equal(threshold, 35);
  assert.equal(shouldTrip(35, threshold, 's1', undefined), true, 'trips at 35%');
  assert.equal(shouldTrip(34, threshold, 's1', undefined), false, 'not below 35%');
});

// t-2047 decision 2: the host `c.get('<key>', <fallback>)` calls live in vscode-touching modules the
// Docker suite cannot import, so they are read as source text and pinned to the manifest default.
// VSCode returns the manifest default for an unset key; the fallback only matters if the
// declaration goes missing — and must then say the same thing.
test('every host c.get fallback for the t-2047 keys equals its manifest default', () => {
  const all = Object.fromEntries(entries().map((e) => [e.key, e.prop]));
  const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');
  const cases = [
    ['extension.ts', 'delegateWork'],
    ['extension.ts', 'delegateReview'],
    ['controller.ts', 'contextLimit.percent'],
  ];
  for (const [file, key] of cases) {
    const escaped = key.replace(/\./g, '\\.');
    const hits = [...src(file).matchAll(new RegExp(`c\\.get(?:<[^>]+>)?\\('${escaped}',\\s*([^)]+)\\)`, 'g'))];
    assert.equal(hits.length, 1, `expected exactly one c.get('${key}', …) in src/${file}, found ${hits.length}`);
    assert.deepEqual(
      JSON.parse(hits[0][1].trim()), all[`loopBoard.${key}`].default,
      `src/${file}: c.get('${key}', ${hits[0][1].trim()}) disagrees with the manifest default`
    );
  }
});

test('the idle-stop pair ships in Agent Setup after delegateReview, off by default (t-2dd4)', () => {
  const agent = sections.find((s) => s.title === 'LoopBoard: Agent Setup');
  const enabled = agent.properties['loopBoard.idleStop.enabled'];
  const minutes = agent.properties['loopBoard.idleStop.minutes'];
  assert.ok(enabled && minutes, 'both idle-stop keys must be declared in Agent Setup');
  assert.equal(enabled.type, 'boolean');
  assert.equal(enabled.default, false, 'the idle stop is opt-in');
  assert.equal(minutes.type, 'integer');
  assert.equal(minutes.default, 60);
  assert.equal(minutes.minimum, 1);
  assert.equal(enabled.order, 90);
  assert.equal(minutes.order, 100);
  const keys = Object.entries(agent.properties).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
  const at = keys.indexOf('loopBoard.delegateReview');
  assert.deepEqual(keys.slice(at + 1, at + 3), ['loopBoard.idleStop.enabled', 'loopBoard.idleStop.minutes']);
  for (const prop of [enabled, minutes]) {
    assert.equal(prop.loopBoardApplies, 'live');
    assert.equal(prop.scope, 'application');
  }
  assert.equal(minutes.loopBoardDependsOn, 'loopBoard.idleStop.enabled');
  // Both descriptions name the 30 s warning and the ■-equivalent stop.
  for (const prop of [enabled, minutes]) {
    assert.match(prop.markdownDescription, /30 seconds/);
    assert.match(prop.markdownDescription, /■/);
  }
  // The host fallbacks say the same as the manifest (read as source text, as above).
  const src = fs.readFileSync(path.join(root, 'src', 'controller.ts'), 'utf8');
  for (const [key, prop] of [['idleStop.enabled', enabled], ['idleStop.minutes', minutes]]) {
    const escaped = key.replace(/\./g, '\\.');
    const hits = [...src.matchAll(new RegExp(`c\\.get(?:<[^>]+>)?\\('${escaped}',\\s*([^)]+)\\)`, 'g'))];
    assert.equal(hits.length, 1, `expected exactly one c.get('${key}', …) in src/controller.ts`);
    assert.deepEqual(JSON.parse(hits[0][1].trim()), prop.default, `c.get('${key}', ${hits[0][1].trim()}) disagrees with the manifest`);
  }
  // …and the pure sanitizer's fallback is the manifest default too.
  const { DEFAULT_IDLE_MINUTES } = require('../out-test/idle.js');
  assert.equal(DEFAULT_IDLE_MINUTES, minutes.default);
});

test('no property id is a prefix of another — a scalar key can never have a child key', () => {
  // The trap this exists for (found in a user's VSCode log, shipped in v3.7.0 as
  // `loopBoard.delegateWork.review`):
  //
  //   Conflict in settings file … Ignoring loopBoard.delegateWork.review as loopBoard.delegateWork is true
  //
  // VSCode stores settings as a flat map but resolves them as a TREE, so a key holding a scalar
  // cannot also be an object with children. Declare both `x` and `x.y` and VSCode silently DROPS
  // the user's `x.y` whenever `x` is set — i.e. exactly when `x.y` would have mattered — and the
  // code's `get(x.y, default)` falls back to the default with nothing to show for it. Neither the
  // manifest, the settings UI nor `make check` said a word; only the log did.
  //
  // Dotted NAMESPACES are fine and stay fine: `loopBoard.contextLimit.percent` /
  // `loopBoard.contextLimit.action` and `loopBoard.models.<slot>.<field>` have no scalar
  // `loopBoard.contextLimit` or `loopBoard.models` property above them, which is the whole rule.
  const declared = entries().map((e) => e.key);
  for (const parent of declared) {
    for (const child of declared) {
      if (child === parent) continue;
      assert.ok(
        !child.startsWith(parent + '.'),
        `"${parent}" and "${child}" cannot both be declared: "${parent}" holds a scalar, so VSCode ` +
        `IGNORES "${child}" whenever "${parent}" is set — the user's value is discarded and the code ` +
        `silently reads the default. Rename "${child}" to a sibling id (e.g. the last segment folded ` +
        'into the name), or make the parent an object property with no scalar of its own.'
      );
    }
  }
});

test('a declared dependency names a real boolean setting', () => {
  // `loopBoardDependsOn` replaced the old `x` + `x.y` name derivation, which the prefix rule above
  // has just made impossible. A reference that no longer resolves would grey a row forever.
  const all = Object.fromEntries(entries().map((e) => [e.key, e.prop]));
  for (const { key, prop } of entries()) {
    if (prop.loopBoardDependsOn === undefined) continue;
    const target = all[prop.loopBoardDependsOn];
    assert.ok(target, `${key} depends on ${prop.loopBoardDependsOn}, which is not declared`);
    assert.equal(
      target.type, 'boolean',
      `${key} depends on ${prop.loopBoardDependsOn}, which is not a boolean — only a toggle can gate a row`
    );
  }
  // The one real dependency, asserted by name so a rename cannot quietly drop it: the review
  // toggle is meaningless while delegation is off, and the page must keep greying it.
  assert.equal(all['loopBoard.delegateReview'].loopBoardDependsOn, 'loopBoard.delegateWork');
});

test('the graduated keys keep their original ids — graduating must never rename a key', () => {
  // Recorded in decisions/tooling.md: the SECTION carries the status, not the id. A move to
  // `loopBoard.beta.*` would drop existing values silently now and force a second rename later.
  // (`loopBoard.delegateWork.review` -> `loopBoard.delegateReview` is not a counter-example: that id
  // was unusable, so there was no honoured value to drop — see the prefix test above.)
  const declared = new Set(entries().map((e) => e.key));
  for (const key of GRADUATED_KEYS) {
    assert.ok(!key.includes('.beta.'), `${key} must not live in a beta namespace`);
    assert.ok(declared.has(key), `${key} must stay declared under its original id`);
  }
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

test('every property says WHEN a change takes effect — exactly one valid class, no exceptions', () => {
  for (const { key, prop } of entries()) {
    assert.ok(
      prop.loopBoardApplies === 'live' || prop.loopBoardApplies === 'restart',
      `${key} has loopBoardApplies ${JSON.stringify(prop.loopBoardApplies)} — every setting must be ` +
      'classified `live` (read on demand) or `restart` (frozen into the spawn command), or the ' +
      'settings page cannot say when a change lands and an absent marker stops meaning anything.'
    );
  }
});

test('the classification matches the spawn command, in both directions', () => {
  const declared = entries().map((e) => e.key);
  const restart = entries().filter((e) => e.prop.loopBoardApplies === 'restart').map((e) => e.key);
  // Direction 1: nothing frozen into the spawn command is marked live.
  assert.deepEqual(
    [...restart].sort(), [...RESTART_KEYS].sort(),
    'the `restart` set and src/loop.ts disagree — a setting is either newly frozen into the spawn ' +
    'command or no longer is'
  );
  // Direction 2: no stale entry for a key that no longer exists.
  for (const key of RESTART_KEYS) {
    assert.ok(declared.includes(key), `${key} is classified but no longer declared in the manifest`);
  }
});

test('every restart property ends with the one standard sentence, and no live one carries it', () => {
  for (const { key, prop } of entries()) {
    const restart = prop.loopBoardApplies === 'restart';
    if (restart) {
      assert.ok(
        prop.markdownDescription.trimEnd().endsWith(APPLIES_RESTART_SENTENCE),
        `${key}'s markdownDescription must END with: ${APPLIES_RESTART_SENTENCE}\n  got: ` +
        `…${prop.markdownDescription.slice(-120)}`
      );
    } else {
      assert.ok(
        !prop.markdownDescription.includes(APPLIES_RESTART_SENTENCE),
        `${key} is live but carries the restart sentence`
      );
      // The other half of the same trap: a live description must not grow its own ad-hoc phrasing
      // of the fact. `afterTask` and `contextLimit.*` legitimately talk about RESTARTING LOOPS as a
      // feature, which is why the check is on the marker's wording, not on the word "restart".
      assert.ok(
        !/(♻|▶)\s*\)?\s*$/.test(prop.markdownDescription.trim()),
        `${key} is live but its description ends on a ▶/♻ note — say it with loopBoardApplies instead`
      );
    }
  }
});

test('the model grid may speak for its slot keys: the classification it claims is the real one', () => {
  // The grid replaces the generic rows for `loopBoard.models.*`, so ONE header note stands in for
  // their markers. It reads "model · effort · groomers apply …" — that is only true while those
  // three are `restart` and the slot toggle is `live`.
  const all = Object.fromEntries(entries().map((e) => [e.key, e.prop]));
  for (const slot of ['opus', 'sonnet', 'fable']) {
    for (const field of ['model', 'effort', 'groomConcurrency']) {
      assert.equal(all[`loopBoard.models.${slot}.${field}`].loopBoardApplies, 'restart');
    }
    assert.equal(all[`loopBoard.models.${slot}.enabled`].loopBoardApplies, 'live');
  }
  for (const key of ['loopBoard.defaultWorkerModel', 'loopBoard.defaultGroomerModel']) {
    assert.equal(all[key].loopBoardApplies, 'live', `${key} is a radio column the grid note does not cover`);
  }
});

// t-cffc: the effort default is stated twice — the manifest (what the settings page and the native
// editor show as the default) and the `'medium'` fallbacks in src/model.ts / src/loop.ts (what a
// spawn actually passes to `--effort` when the key is unset). Pin both to the same level.
test('every slot effort defaults to medium, matching the resolveModels / buildClaudeBase fallback', () => {
  const all = Object.fromEntries(entries().map((e) => [e.key, e.prop]));
  const { resolveModels } = require('../out-test/model.js');
  const { buildClaudeBase } = require('../out-test/loop.js');
  for (const slot of ['opus', 'sonnet', 'fable']) {
    assert.equal(all[`loopBoard.models.${slot}.effort`].default, 'medium', `${slot} effort default`);
    assert.equal(resolveModels({}).find((m) => m.id === slot).effort, 'medium', `${slot} resolveModels fallback`);
  }
  assert.ok(buildClaudeBase('auto', 'opus').includes(' --effort medium'), 'buildClaudeBase fallback');
});

test('every key the code reads is still declared in the manifest', () => {
  // Cheap drift guard: a section rename that dropped a property would otherwise only show up at
  // runtime, as a setting that silently reverts to its hard-coded fallback.
  const declared = new Set(entries().map((e) => e.key));
  for (const key of [
    'loopBoard.permissionMode', 'loopBoard.loopInterval', 'loopBoard.afterTask',
    'loopBoard.defaultWorkerModel', 'loopBoard.defaultGroomerModel',
    'loopBoard.maxAttachmentSizeMB', 'loopBoard.autoSyncTemplates', 'loopBoard.sidebarMarquee',
    'loopBoard.nudgeLoops',
    'loopBoard.contextLimit.percent', 'loopBoard.contextLimit.action', 'loopBoard.debug',
    'loopBoard.delegateWork', 'loopBoard.delegateReview', 'loopBoard.idleStop.enabled', 'loopBoard.idleStop.minutes',
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

test('the sidebar marquee is an opt-in live boolean in Board & Workspace, off by default (t-9a29)', () => {
  const board = sections.find((s) => s.title === 'LoopBoard: Board & Workspace');
  const prop = board.properties['loopBoard.sidebarMarquee'];
  assert.ok(prop, 'loopBoard.sidebarMarquee must be declared in Board & Workspace');
  assert.equal(prop.type, 'boolean');
  assert.equal(prop.default, false, 'the sidebar must hold still unless the human opts in');
  assert.equal(prop.scope, 'application');
  assert.equal(prop.loopBoardApplies, 'live');
  // Sits right after the order-20 slot, which the template-sync toggle holds (the pulse toggle it
  // was placed next to became loopBoard.autoSyncTemplates in t-4dce).
  const keys = Object.entries(board.properties).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
  assert.equal(keys.indexOf('loopBoard.sidebarMarquee'), keys.indexOf('loopBoard.autoSyncTemplates') + 1);
});

test('template auto-sync is a live boolean in Board & Workspace, on by default (t-4dce)', () => {
  const board = sections.find((s) => s.title === 'LoopBoard: Board & Workspace');
  const prop = board.properties['loopBoard.autoSyncTemplates'];
  assert.ok(prop, 'loopBoard.autoSyncTemplates must be declared in Board & Workspace');
  assert.equal(prop.type, 'boolean');
  assert.equal(prop.default, true, 'templates sync on activation unless the human opts out');
  assert.equal(prop.scope, 'application');
  assert.equal(prop.loopBoardApplies, 'live');
  assert.match(prop.markdownDescription, /LOOP\.md\.bkp/, 'the description must name the legacy backup');
  assert.match(prop.markdownDescription, /loopboard:custom/, 'the description must promise the custom section is untouched');
});

test('the dropped sidebar pulse toggle is no longer declared anywhere (t-4dce)', () => {
  assert.ok(!entries().some((e) => e.key === 'loopBoard.pulseTemplateSync'), 'loopBoard.pulseTemplateSync must be gone');
});
