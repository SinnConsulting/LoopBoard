// Stale `loopBoard.*` settings -> a migration plan (t-sgrp). PURE: no `vscode` import, no node
// typings — compiled by tsconfig.test.json into out-test/ and unit-tested there.
//
// Settings outlive the code that read them. A renamed key keeps sitting in the user's
// `settings.json` doing nothing; a deprecated key keeps steering behaviour from a name the docs no
// longer mention; an orphan is litter nothing will ever read again. None of the three is visible on
// the settings page — it draws only what the manifest declares — so the only way a user learns
// about them is a stray line in VSCode's log. This module is the one place that knows which keys
// are stale and what should become of them.
//
// It decides, it never acts: in goes (declared manifest keys, the values the host could actually
// read), out comes a list of PLANNED actions plus the exact `ConfigPatch`es that would carry them
// out. The controller previews the plan, waits for a human, and only then writes — so every
// judgement worth testing is here and the host stays a thin "ask, then apply". Every action is
// EXECUTABLE: the panel gives each row its own button, so no row is ever a note telling the user to
// go and edit JSON themselves.
//
// ADDING A MIGRATION: append a MigrationRule below. That table is the whole contract — the plan,
// the keys the host scans, the preview wording and the orphan exemptions all fall out of it.
//
// WHAT THE VSCODE API ALLOWS (established from the VSCode source, not assumed — the reason this
// feature is shaped the way it is):
//   * Undeclared keys ARE readable. `ConfigurationModelParser` only drops unregistered keys under
//     an opt-in `skipUnregistered`, which user settings do not use, so they survive into the
//     model's `contents`/`keys`; `inspect()` reads those models directly with no registry check,
//     and the object `getConfiguration('loopBoard')` returns is `mixin`ed with the section's value
//     tree, so it also ENUMERATES. That is what makes the orphan category buildable at all.
//   * Undeclared keys can be REMOVED but not written. `configurationEditing.ts` rejects an
//     unregistered key with ERROR_UNKNOWN_KEY only `&& operation.value !== undefined` — a removal
//     is explicitly exempt. Every write this module plans onto a stale key is a removal, and every
//     value it plans to WRITE goes to a declared key, so neither half can hit that error.
//   * READING AND REMOVING ARE DIFFERENT CODE PATHS, and only reading is value-tree shaped. This is
//     the asymmetry the `sweep` kind below is built on. A READ resolves through `toValuesTree`,
//     which logs `Conflict in settings file … Ignoring X as Y is true` and DROPS a child of a
//     scalar — so `loopBoard.delegateWork.review` is unreadable through any extension API while
//     `loopBoard.delegateWork` has a value. A REMOVE never consults that tree: `update(key,
//     undefined, Global)` reaches `ConfigurationEditingService.getEdits`, which calls
//     `setProperty(modelContent, jsonPath, undefined, …)` on the RAW TEXT of `settings.json`
//     (`parseTree(text)`), with `jsonPath = [key]` — ONE literal segment holding the whole dotted
//     name, matched by `findNodeAtLocation` against `propertyNode.children[0].value === segment`.
//     So the dotted key is a property NAME, never a path: removing `loopBoard.delegateWork.review`
//     cannot touch `loopBoard.delegateWork`. And when the property is absent `setProperty` returns
//     `[]` ("property does not exist, nothing to do"), `getEdits(...)[0]` is undefined and
//     `updateConfiguration`'s `if (edit)` skips the buffer edit and the save — a silent no-op that
//     leaves the file byte-identical. Hence: the shadowed key can be removed BLIND. The only thing
//     that stays impossible is REPORTING whether it was there.
//   * Two setups can hide an ORPHAN from the scan, both of them read-only degradations: a
//     non-default VSCode profile (`applicationConfiguration` is null only on the default profile;
//     otherwise application-scoped settings are re-read through a SCOPE-filtered model, and an
//     unregistered key has no known scope to keep it) and a remote window (the local user model is
//     then parsed under `LOCAL_MACHINE_SCOPES` instead of unfiltered). The failure mode is that the
//     key is simply not listed — never that the wrong thing is written — so it needs no guard here.

import { SETTINGS_PREFIX, ConfigPatch } from './settingsform';
import { resolveAfterTask } from './model';

export const AFTER_TASK_KEY = `${SETTINGS_PREFIX}afterTask`;
export const AUTO_RECYCLE_KEY = `${SETTINGS_PREFIX}autoRecycle`;
export const CLEAR_SESSION_KEY = `${SETTINGS_PREFIX}clearSessionAfterTask`;
export const DELEGATE_WORK_KEY = `${SETTINGS_PREFIX}delegateWork`;
export const DELEGATE_REVIEW_KEY = `${SETTINGS_PREFIX}delegateReview`;
export const OLD_DELEGATE_REVIEW_KEY = `${SETTINGS_PREFIX}delegateWork.review`;

// Keys the manifest does NOT declare and never will, but which the code still reads on purpose:
// `readDefaultModel` (src/controller.ts) falls back to the pre-split `loopBoard.defaultModel` when
// neither of the two new keys is set. Removing it as an "orphan" would silently change which model
// a pre-split config spawns — exactly the behaviour change this feature must never make.
// A legacy CONTAINER object (`{"loopBoard.models": {…}}`) needs no entry here: it is spared by the
// prefix rule in `isOrphan`, because declared keys live underneath it.
export const LEGACY_HONOURED_KEYS: string[] = [`${SETTINGS_PREFIX}defaultModel`];

export type SettingValues = Record<string, unknown>;

export interface MigrationRule {
  target: string; // the declared key that replaces the sources
  reason: 'renamed' | 'deprecated';
  sources: string[]; // stale keys, in precedence order
  // The scalar key whose presence makes a source unreadable (see the header note). While it is
  // set, a source that is not visible can still be REMOVED — just never read, and so never
  // migrated, because its value is what a migration would have carried over.
  shadowedBy?: string;
  // What the stale values should make the target, and WHICH source decided it. `undefined` means
  // they carry nothing worth keeping, so every present source is merely removed.
  resolve(values: SettingValues): { from: string; value: unknown } | undefined;
}

export const MIGRATIONS: MigrationRule[] = [
  {
    // Renamed on this branch. The old id is a child of the scalar `loopBoard.delegateWork`, so
    // VSCode was already discarding the value — migrating it is the first time the user's stated
    // choice ever takes effect.
    target: DELEGATE_REVIEW_KEY,
    reason: 'renamed',
    sources: [OLD_DELEGATE_REVIEW_KEY],
    shadowedBy: DELEGATE_WORK_KEY,
    resolve: (values) => {
      const raw = values[OLD_DELEGATE_REVIEW_KEY];
      return typeof raw === 'boolean' ? { from: OLD_DELEGATE_REVIEW_KEY, value: raw } : undefined;
    },
  },
  {
    // The deprecated boolean pair. The mapping is NOT restated here: `resolveAfterTask` is what
    // `readAfterTask` (src/controller.ts) calls at run time, so the value written is by
    // construction the one the pair is producing today — migrating cannot change behaviour, and a
    // future change to the honouring rule cannot leave a second copy behind to drift.
    target: AFTER_TASK_KEY,
    reason: 'deprecated',
    sources: [AUTO_RECYCLE_KEY, CLEAR_SESSION_KEY],
    resolve: (values) => {
      const mode = resolveAfterTask(
        undefined,
        values[AUTO_RECYCLE_KEY] === true,
        values[CLEAR_SESSION_KEY] === true
      );
      if (mode === 'none') return undefined;
      return { from: mode === 'recycle' ? AUTO_RECYCLE_KEY : CLEAR_SESSION_KEY, value: mode };
    },
  },
];

// Why a key is stale. `renamed` = the same setting under a new id; `deprecated` = a different
// setting took over its job; `orphan` = nothing declares it and nothing reads it.
export type StaleReason = 'renamed' | 'deprecated' | 'orphan';

// What the plan proposes. All four are executable from the panel — see `actionWrites`.
//   * `migrate` — set the destination from the stale value, then drop the stale key.
//   * `remove`  — drop a key that is confirmed present and confirmed worthless.
//   * `conflict`— stale key AND destination are both set by hand. Never part of a bulk apply,
//     because picking a winner is the human's call; its own button drops the stale key only.
//   * `sweep`   — a removal of a key that CANNOT BE READ (a child of a scalar parent). The write is
//     valid and provably harmless — it deletes the property if it is in `settings.json` and is a
//     byte-for-byte no-op if it is not (see the header note). What is impossible is reporting in
//     advance which of the two it will be, so the row says so and the user presses the button.
export type ActionKind = 'migrate' | 'remove' | 'conflict' | 'sweep';

export interface PlannedAction {
  key: string; // the stale key, as it sits in settings.json
  kind: ActionKind;
  reason: StaleReason;
  value: unknown; // what the stale key is set to today — `undefined` for `sweep`, which cannot see it
  target?: string; // migrate / conflict / sweep
  targetValue?: unknown; // migrate: what gets written. conflict: what is already there.
  detail: string; // the preview line's sentence — one place, so page and debug log agree
}

export interface MigrationPlan {
  actions: PlannedAction[];
  // Exactly what a BULK apply will `update()`, in order: every destination write first, then every
  // removal. A run interrupted halfway therefore leaves a value stored twice rather than lost.
  // Conflicts contribute nothing here; a per-row button is the only way to act on one.
  writes: ConfigPatch[];
  // Rules that stood down because their destination is already set by hand.
  conflicts: number;
  // Blind removals offered for a key this scan could not read. Counted APART from `findings`
  // because a sweep is not evidence of anything: a config with nothing but sweeps is a config with
  // nothing known to be wrong, and the panel must keep saying so rather than manufacture a problem.
  sweeps: number;
  // Everything the scan actually found — `actions.length - sweeps`. This, and not `actions.length`,
  // is what decides whether there is anything to migrate.
  findings: number;
}

// The writes for ONE row's button, so a user can take a single action and leave the rest. A
// migration writes its destination before dropping its source, exactly as the bulk order does.
export function actionWrites(action: PlannedAction): ConfigPatch[] {
  const removal: ConfigPatch = { key: action.key, value: undefined };
  if (action.kind !== 'migrate') return [removal];
  return [{ key: action.target as string, value: action.targetValue }, removal];
}

function show(value: unknown): string {
  return JSON.stringify(value ?? null);
}

// Every key the host must `inspect()` by name. The declared keys carry the page; the migration
// sources and their shadowing parents are known ids that enumeration cannot be trusted to surface
// (a source under a declared scalar parent is not walkable), and the legacy keys must be read so
// they are recognised rather than mistaken for orphans.
export function scanKeys(declared: string[]): string[] {
  const keys = [...declared];
  for (const rule of MIGRATIONS) {
    for (const key of [...rule.sources, rule.target, ...(rule.shadowedBy ? [rule.shadowedBy] : [])]) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  for (const key of LEGACY_HONOURED_KEYS) if (!keys.includes(key)) keys.push(key);
  return keys;
}

// A key nothing declares and nothing reads. Spared: anything declared, anything the code still
// honours by hand (LEGACY_HONOURED_KEYS), a stale key some rule already owns, and any legacy
// CONTAINER a declared key lives inside — `{"loopBoard.models": {…}}` resolves through the same
// dotted lookups as `loopBoard.models.opus.enabled`, so it is live config, not litter.
export function isOrphan(key: string, declared: string[], handled: string[]): boolean {
  if (!key.startsWith(SETTINGS_PREFIX) || key === SETTINGS_PREFIX) return false;
  if (declared.includes(key) || handled.includes(key)) return false;
  if (LEGACY_HONOURED_KEYS.includes(key)) return false;
  return !declared.some((d) => d.startsWith(`${key}.`));
}

export function buildMigrationPlan(declared: string[], values: SettingValues): MigrationPlan {
  const actions: PlannedAction[] = [];
  const destinationWrites: ConfigPatch[] = [];
  const removals: ConfigPatch[] = [];
  let conflicts = 0;
  let sweeps = 0;
  const handled: string[] = [];

  for (const rule of MIGRATIONS) {
    for (const source of rule.sources) handled.push(source);
    const present = rule.sources.filter((source) => values[source] !== undefined);

    if (present.length === 0) {
      // Nothing visible. If a parent that would HIDE a source is set, offer the blind removal
      // rather than report a clean bill of health the API cannot actually give. It is a real
      // action, not a note: pressing it deletes the key if it is there and does nothing at all if
      // it is not, and either way the user is done with it in one click.
      if (rule.shadowedBy && values[rule.shadowedBy] !== undefined) {
        sweeps += 1;
        removals.push({ key: rule.sources[0], value: undefined });
        actions.push({
          key: rule.sources[0],
          kind: 'sweep',
          reason: rule.reason,
          value: undefined,
          target: rule.target,
          detail:
            `cannot be READ while ${rule.shadowedBy} is set — VSCode drops a child of a plain ` +
            `value — but it can still be deleted. Remove takes it out of settings.json if it is ` +
            `there, and changes nothing if it is not. It never carried a value either way, so set ` +
            `${rule.target} for the behaviour you want.`,
        });
      }
      continue;
    }

    // The destination was set by hand. Overwriting it would throw away a deliberate choice, and
    // picking a winner is a decision only the human can make — so the whole rule stands down.
    if (values[rule.target] !== undefined) {
      conflicts += present.length;
      for (const key of present) {
        actions.push({
          key,
          kind: 'conflict',
          reason: rule.reason,
          value: values[key],
          target: rule.target,
          targetValue: values[rule.target],
          detail:
            `left out of Apply — ${rule.target} is already set to ${show(values[rule.target])}, ` +
            'and overwriting a choice you made by hand is not this button\'s call. Remove drops ' +
            'this old key and keeps that one.',
        });
      }
      continue;
    }

    const resolved = rule.resolve(values);
    if (resolved) destinationWrites.push({ key: rule.target, value: resolved.value });
    for (const key of present) {
      removals.push({ key, value: undefined });
      if (resolved && resolved.from === key) {
        actions.push({
          key,
          kind: 'migrate',
          reason: rule.reason,
          value: values[key],
          target: rule.target,
          targetValue: resolved.value,
          detail: `set ${rule.target} to ${show(resolved.value)}, then remove this key.`,
        });
      } else {
        actions.push({
          key,
          kind: 'remove',
          reason: rule.reason,
          value: values[key],
          target: rule.target,
          detail: resolved
            ? `remove — ${resolved.from} is what decides ${rule.target}, and this key changes nothing.`
            : `remove — this value has no effect on ${rule.target}.`,
        });
      }
    }
  }

  for (const key of Object.keys(values).sort()) {
    if (values[key] === undefined) continue;
    if (!isOrphan(key, declared, handled)) continue;
    removals.push({ key, value: undefined });
    actions.push({
      key,
      kind: 'remove',
      reason: 'orphan',
      value: values[key],
      detail: 'remove — LoopBoard has no setting by this name, and nothing reads it.',
    });
  }

  return {
    actions,
    writes: [...destinationWrites, ...removals],
    conflicts,
    sweeps,
    findings: actions.length - sweeps,
  };
}
