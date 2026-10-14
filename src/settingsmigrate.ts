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
import { isValidModelString, isValidEffort, sanitizeGroomConcurrency } from './model';

export const AFTER_TASK_KEY = `${SETTINGS_PREFIX}afterTask`;
export const AUTO_RECYCLE_KEY = `${SETTINGS_PREFIX}autoRecycle`;
export const CLEAR_SESSION_KEY = `${SETTINGS_PREFIX}clearSessionAfterTask`;
export const DELEGATE_WORK_KEY = `${SETTINGS_PREFIX}delegateWork`;
export const DELEGATE_REVIEW_KEY = `${SETTINGS_PREFIX}delegateReview`;
export const OLD_DELEGATE_REVIEW_KEY = `${SETTINGS_PREFIX}delegateWork.review`;
export const DEFAULT_REVIEWER_KEY = `${SETTINGS_PREFIX}defaultReviewerModel`;
// The per-model loop slots (t-0e99): `models.<slot>.effort|groomConcurrency` became the one
// orchestrator's `orchestrator.effort|groomConcurrency`, `models.<slot>.model` that model's id.
export const LEGACY_SLOTS = ['opus', 'sonnet', 'fable'];
export const ORCHESTRATOR_FIELDS = ['effort', 'groomConcurrency'];
export const slotFieldKey = (slot: string, field: string): string => `${SETTINGS_PREFIX}models.${slot}.${field}`;
export const orchestratorKey = (field: string): string => `${SETTINGS_PREFIX}orchestrator.${field}`;
export const AUTO_SYNC_TEMPLATES_KEY = `${SETTINGS_PREFIX}autoSyncTemplates`;
export const PULSE_TEMPLATE_SYNC_KEY = `${SETTINGS_PREFIX}pulseTemplateSync`;

// Keys the manifest does NOT declare and never will, but which the code still reads on purpose:
// `resolveTaskDefaults` (src/model.ts) falls back to the pre-split `loopBoard.defaultModel` when
// neither of the two new keys is set. Removing it as an "orphan" would silently change which model
// a pre-split config runs, exactly the behaviour change this feature must never make.
// A legacy CONTAINER object (`{"loopBoard.models": {…}}`) needs no entry here: it is spared by the
// prefix rule in `isOrphan`, because declared keys live underneath it.
export const LEGACY_HONOURED_KEYS: string[] = [`${SETTINGS_PREFIX}defaultModel`];

// The object-typed `loopBoard.models` setting that predates the flat `models.<id>.*` keys (until
// cccd5bb). A migration that empties it leaves `"loopBoard.models": {}` behind (t-0e99 FB11). A read
// cannot tell that literal object from the flat keys VSCode folds into the same value tree, so it is
// offered like a sweep: re-write every leaf it shows as its flat declared key (a no-op for a flat
// key, a rescue for a nested one), then remove the literal property.
export const LEGACY_CONTAINER_KEY = `${SETTINGS_PREFIX}models`;

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
  // The sources can never carry a value, so a target set by hand is no conflict for them: they are
  // removed either way (t-0e99's Sonnet/Fable slot keys).
  inert?: boolean;
}

// One rule per orchestrator field (t-0e99). The old Opus loop is the one whose effort and grooming
// cap carry over; `resolveOrchestrator` (src/model.ts) reads the same key while the target is unset,
// so migrating writes exactly the value already in force. The Sonnet and Fable slot values carry
// nothing: an inert rule per field only removes them.
const ORCHESTRATOR_RULES: MigrationRule[] = ORCHESTRATOR_FIELDS.flatMap((field) => [
  {
    target: orchestratorKey(field),
    reason: 'deprecated' as const,
    sources: [slotFieldKey('opus', field)],
    resolve: (values: SettingValues) => {
      const from = slotFieldKey('opus', field);
      const raw = values[from];
      if (field === 'effort') return typeof raw === 'string' && isValidEffort(raw) ? { from, value: raw } : undefined;
      return raw !== undefined && sanitizeGroomConcurrency(raw) === raw ? { from, value: raw } : undefined;
    },
  },
  {
    target: orchestratorKey(field),
    reason: 'deprecated' as const,
    sources: LEGACY_SLOTS.filter((slot) => slot !== 'opus').map((slot) => slotFieldKey(slot, field)),
    resolve: () => undefined,
    inert: true,
  },
]);

// Each slot's own `--model` string (t-0e99 FB4) is that model's id now (`models.<slot>.modelId`,
// applied as the alias's env override): `readModelsConfig` reads it there until migrated. The bare
// alias carries nothing, as it is what an unset model id already means.
const MODEL_ID_RULES: MigrationRule[] = LEGACY_SLOTS.map((slot) => ({
  target: slotFieldKey(slot, 'modelId'),
  reason: 'renamed' as const,
  sources: [slotFieldKey(slot, 'model')],
  resolve: (values: SettingValues) => {
    const from = slotFieldKey(slot, 'model');
    const raw = values[from];
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value && value !== slot && isValidModelString(value) ? { from, value } : undefined;
  },
}));

export const MIGRATIONS: MigrationRule[] = [
  ...ORCHESTRATOR_RULES,
  ...MODEL_ID_RULES,
  {
    // t-0e99: the review subagent's MODEL replaced the on/off switch. `true` meant "a review gates
    // the PR", whose successor is `opus` (owner decision 2026-10-14); `false` becomes `none`, since
    // the shipped default reviews on Opus now and an explicit opt-out must not be lost. ONLY `delegateReview` decides, exactly as `resolveTaskDefaults`
    // reads it until this is applied: the pre-rename child id never took effect, so it is
    // removal-only (carrying it would turn reviews on against an explicit `delegateReview: false`
    // once that key is gone). It is a child of the scalar `loopBoard.delegateWork`, so while that
    // is set it can only be swept, never read.
    target: DEFAULT_REVIEWER_KEY,
    reason: 'deprecated',
    sources: [DELEGATE_REVIEW_KEY, OLD_DELEGATE_REVIEW_KEY],
    shadowedBy: DELEGATE_WORK_KEY,
    resolve: (values) =>
      values[DELEGATE_REVIEW_KEY] === true ? { from: DELEGATE_REVIEW_KEY, value: 'opus' }
        : values[DELEGATE_REVIEW_KEY] === false ? { from: DELEGATE_REVIEW_KEY, value: 'none' } : undefined,
  },
  {
    // t-4dce: the sidebar Synchronise Templates row and its drift pulse are gone; activation
    // auto-sync took over the job of keeping templates current. A pulse preference says nothing
    // about whether to auto-sync, so a stored value is only removed — never carried over.
    target: AUTO_SYNC_TEMPLATES_KEY,
    reason: 'deprecated',
    sources: [PULSE_TEMPLATE_SYNC_KEY],
    resolve: () => undefined,
  },
];

// Settings whose whole feature is gone, so they carry nothing anywhere (t-0e99 FB13: the
// after-task recycle/clear was removed with `loopBoard.afterTask` and its deprecated boolean pair).
// Each is a plain removal, listed as deprecated rather than as an anonymous orphan.
export const RETIRED_KEYS: { key: string; detail: string }[] = [AFTER_TASK_KEY, AUTO_RECYCLE_KEY, CLEAR_SESSION_KEY].map((key) => ({
  key,
  detail: 'remove: the after-task recycle/clear was removed; ♻, the context limit, idle stop and schedules remain.',
}));

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
//     Like a conflict it is NEVER part of a bulk apply: the scan has no evidence anything is there,
//     so it must not ride along on a click the user made about something else.
export type ActionKind = 'migrate' | 'remove' | 'conflict' | 'sweep';

export interface PlannedAction {
  key: string; // the stale key, as it sits in settings.json
  kind: ActionKind;
  reason: StaleReason;
  value: unknown; // what the stale key is set to today — `undefined` for `sweep`, which cannot see it
  target?: string; // migrate / conflict / sweep
  targetValue?: unknown; // migrate: what gets written. conflict: what is already there.
  detail: string; // the preview line's sentence — one place, so page and debug log agree
  writes?: ConfigPatch[]; // a row whose writes are more than its own removal (the container sweep)
}

export interface MigrationPlan {
  actions: PlannedAction[];
  // Exactly what a BULK apply will `update()`, in order: every destination write first, then every
  // removal. A run interrupted halfway therefore leaves a value stored twice rather than lost.
  // Conflicts and sweeps contribute NOTHING here — a per-row button is the only way to act on
  // either, because neither is a write the scan can justify on the user's behalf. So the count on
  // the Apply button is a count of changes that are certainly changes.
  writes: ConfigPatch[];
  // Rules that stood down because their destination is already set by hand.
  conflicts: number;
  // Blind removals offered for a key this scan could not read. Counted APART from `findings`
  // because a sweep is not evidence of anything: a config with nothing but sweeps is a config with
  // nothing known to be wrong, and the panel must keep saying so rather than manufacture a problem.
  // The page keeps them out of the main list entirely, behind a collapsed disclosure.
  sweeps: number;
  // Everything the scan actually found — `actions.length - sweeps`. This, and not `actions.length`,
  // is what decides whether there is anything to migrate.
  findings: number;
}

// The writes for ONE row's button, so a user can take a single action and leave the rest. A
// migration writes its destination before dropping its source, exactly as the bulk order does.
export function actionWrites(action: PlannedAction): ConfigPatch[] {
  if (action.writes) return action.writes;
  const removal: ConfigPatch = { key: action.key, value: undefined };
  if (action.kind !== 'migrate') return [removal];
  return [{ key: action.target as string, value: action.targetValue }, removal];
}

// The activation pass behind `loopBoard.autoMigrateSettings` (t-0e99): exactly the bulk Apply's
// writes, so a conflict (which value wins is the user's call) and a sweep (no evidence the key is
// there) stay in the Migrate Config panel for a manual click.
export function decideAutoMigrate(plan: MigrationPlan, autoMigrateEnabled: boolean): ConfigPatch[] {
  return autoMigrateEnabled ? plan.writes : [];
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
  for (const { key } of RETIRED_KEYS) if (!keys.includes(key)) keys.push(key);
  if (!keys.includes(LEGACY_CONTAINER_KEY)) keys.push(LEGACY_CONTAINER_KEY);
  return keys;
}

function leaves(prefix: string, node: unknown, out: ConfigPatch[]): void {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) leaves(`${prefix}.${k}`, v, out);
  } else {
    out.push({ key: prefix, value: node });
  }
}

// Offered only while every leaf the container shows is a declared key, so the re-writes keep all of
// them and the removal can lose nothing; a stale leaf still inside it is a migration's business first.
function containerSweep(declared: string[], value: unknown): PlannedAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keep: ConfigPatch[] = [];
  leaves(LEGACY_CONTAINER_KEY, value, keep);
  if (keep.some((p) => !declared.includes(p.key))) return undefined;
  return {
    key: LEGACY_CONTAINER_KEY,
    kind: 'sweep',
    reason: 'deprecated',
    value: undefined,
    detail:
      'the object form of the model settings that older versions wrote, left behind (often as {}) ' +
      'once its keys moved. Remove re-writes every model setting it holds as its own key, then deletes ' +
      'the object if it is there; your values stay as they are.',
    writes: [...keep, { key: LEGACY_CONTAINER_KEY, value: undefined }],
  };
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
      // Deliberately NOT pushed onto `removals`: a sweep is never carried by a bulk apply, only by
      // its own button inside the page's collapsed "legacy keys" disclosure.
      if (rule.shadowedBy && values[rule.shadowedBy] !== undefined) {
        sweeps += 1;
        // The source that sits UNDER the scalar parent is the one a read cannot see (t-0e99 gave
        // this rule a second, readable source).
        const hidden = rule.sources.find((k) => k.startsWith(`${rule.shadowedBy}.`)) ?? rule.sources[0];
        actions.push({
          key: hidden,
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
    // An inert rule carries nothing, so there is no choice to protect: it falls through to removal.
    if (values[rule.target] !== undefined && !rule.inert) {
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

  for (const { key, detail } of RETIRED_KEYS) {
    handled.push(key);
    if (values[key] === undefined) continue;
    removals.push({ key, value: undefined });
    actions.push({ key, kind: 'remove', reason: 'deprecated', value: values[key], detail });
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

  const container = containerSweep(declared, values[LEGACY_CONTAINER_KEY]);
  if (container) {
    sweeps += 1;
    actions.push(container);
  }

  return {
    actions,
    writes: [...destinationWrites, ...removals],
    conflicts,
    sweeps,
    findings: actions.length - sweeps,
  };
}
