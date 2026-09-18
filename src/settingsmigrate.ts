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
// judgement worth testing is here and the host stays a thin "ask, then apply".
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
//   * A child of a SCALAR key is invisible. `toValuesTree` logs `Conflict in settings file …
//     Ignoring X as Y is true` and drops the child, so `loopBoard.delegateWork.review` can only be
//     read while `loopBoard.delegateWork` is unset in the same scope. That is not a gap this code
//     can close — hence the `manual` action kind, which reports the case instead of guessing.
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
  // set, a source that is NOT visible cannot be confirmed, migrated or removed — only reported.
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

// What the plan proposes. Only `migrate` and `remove` ever write; `conflict` and `manual` are
// reports — a plan of nothing but those two writes nothing at all.
export type ActionKind = 'migrate' | 'remove' | 'conflict' | 'manual';

export interface PlannedAction {
  key: string; // the stale key, as it sits in settings.json
  kind: ActionKind;
  reason: StaleReason;
  value: unknown; // what the stale key is set to today — `undefined` for `manual`, which cannot see it
  target?: string; // migrate / conflict / manual
  targetValue?: unknown; // migrate: what gets written. conflict: what is already there.
  detail: string; // the preview line's sentence — one place, so page and debug log agree
}

export interface MigrationPlan {
  actions: PlannedAction[];
  // Exactly what the host will `update()`, in order: every destination write first, then every
  // removal. A run interrupted halfway therefore leaves a value stored twice rather than lost.
  writes: ConfigPatch[];
  // Rules that stood down because their destination is already set by hand, and sources that are
  // invisible behind a scalar parent. Both are reported, neither is written.
  conflicts: number;
  manual: number;
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
  let manual = 0;
  const handled: string[] = [];

  for (const rule of MIGRATIONS) {
    for (const source of rule.sources) handled.push(source);
    const present = rule.sources.filter((source) => values[source] !== undefined);

    if (present.length === 0) {
      // Nothing visible. If a parent that would HIDE a source is set, say so rather than report a
      // clean bill of health that only holds because the API cannot see round the corner.
      if (rule.shadowedBy && values[rule.shadowedBy] !== undefined) {
        manual += 1;
        actions.push({
          key: rule.sources[0],
          kind: 'manual',
          reason: rule.reason,
          value: undefined,
          target: rule.target,
          detail:
            `cannot be read while ${rule.shadowedBy} is set — VSCode drops a child of a plain ` +
            `value, so this key is invisible here whether or not it is in your settings.json. ` +
            `If it is there, delete it by hand and set ${rule.target} instead.`,
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
            `left alone — ${rule.target} is already set to ${show(values[rule.target])}. ` +
            'Decide which one you meant, then run this again.',
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

  return { actions, writes: [...destinationWrites, ...removals], conflicts, manual };
}
