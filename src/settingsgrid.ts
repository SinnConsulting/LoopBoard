// The settings page's hand-built block (t-sgrp, rebuilt by t-0e99). PURE: no `vscode` import,
// compiled by tsconfig.test.json into out-test/ and unit-tested there.
//
// Two dense tables of dropdowns (owner feedback on t-0e99: selects over radios, free text only
// where nothing else can say it). The Roles table holds, per role, the model and effort a spawn
// gets when the task names none of its own: the orchestrator's own `--model`/`--effort` and grooming
// cap, then the groomer, worker and reviewer defaults. Every model select offers only the models
// switched on in the Models table, which holds per model its `on` switch, the model id its alias
// resolves to (the one free-text field: an id cannot be enumerated) and its effort floor/ceiling.
//
// Read side: none of this is new data. The host resolves it with the same `resolveOrchestrator` /
// `resolveTaskDefaults` / `resolveModels` the spawn and the board use, so the page shows what the
// loop would get.

import {
  Model, ModelsConfig, OrchestratorConfig, TaskDefaults, NO_REVIEW, resolveModels, isModel,
  isValidModelString, isValidEffort, EFFORT_LEVELS, MAX_GROOM_CONCURRENCY,
} from './model';
import { APPLIES_RESTART_TAIL, ConfigPatch, SETTINGS_PREFIX } from './settingsform';

// Everything in this block rides the spawn (the orchestrator's flags, its bootstrap prompt and its
// terminal env), so a running loop keeps what it was started with. The grid replaces the generic
// rows for those keys, so it also replaces their per-row markers, in the SAME words off the same
// `APPLIES_RESTART_TAIL`. The board's selects and new drafts read the defaults at once; the page's
// subtitle says that part.
export const GRID_APPLY_NOTE = `orchestrator · models · defaults apply ${APPLIES_RESTART_TAIL}`;

export type GridRole = 'orchestrator' | 'groomer' | 'worker' | 'reviewer';
export const GRID_ROLES: GridRole[] = ['orchestrator', 'groomer', 'worker', 'reviewer'];
export type GridSlot = GridRole | Model;
export type GridField = 'model' | 'effort' | 'groomConcurrency' | 'enabled' | 'modelId' | 'minEffort' | 'maxEffort';
export const GRID_FIELDS: GridField[] = ['model', 'effort', 'groomConcurrency', 'enabled', 'modelId', 'minEffort', 'maxEffort'];

export function isGridField(value: unknown): value is GridField {
  return typeof value === 'string' && (GRID_FIELDS as string[]).includes(value);
}

export interface RoleRow {
  id: GridRole;
  label: string;
  model: string;
  models: string[]; // the model select's options: the enabled models (+ `none` for the reviewer)
  effort: string | null; // null = the reviewer, which runs at the task's worker effort
  groomConcurrency?: number; // the orchestrator only
}

export interface ModelRow {
  id: Model;
  label: string;
  enabled: boolean;
  modelId: string; // '' = the CLI's own alias
  minEffort: string;
  maxEffort: string;
  usedBy: GridRole[]; // the roles whose model this is: it cannot be switched off while any is
}

export interface ModelGrid {
  roles: RoleRow[];
  models: ModelRow[];
  efforts: readonly string[]; // low..max: every effort select on the page
  note: string;
}

export type GridPatchResult = { ok: true; patches: ConfigPatch[] } | { ok: false; reason: string };

const ROLE_LABEL: Record<GridRole, string> = {
  orchestrator: 'Orchestrator', groomer: 'Groomer', worker: 'Worker', reviewer: 'Reviewer',
};

const ROLE_MODEL_KEY: Record<GridRole, string> = {
  orchestrator: `${SETTINGS_PREFIX}orchestrator.model`,
  groomer: `${SETTINGS_PREFIX}defaultGroomerModel`,
  worker: `${SETTINGS_PREFIX}defaultWorkerModel`,
  reviewer: `${SETTINGS_PREFIX}defaultReviewerModel`,
};

const ROLE_EFFORT_KEY: Partial<Record<GridRole, string>> = {
  orchestrator: `${SETTINGS_PREFIX}orchestrator.effort`,
  groomer: `${SETTINGS_PREFIX}defaultGroomerEffort`,
  worker: `${SETTINGS_PREFIX}defaultWorkerEffort`,
};

export function modelKey(model: Model, field: 'enabled' | 'modelId' | 'minEffort' | 'maxEffort'): string {
  return `${SETTINGS_PREFIX}models.${model}.${field}`;
}
export function enabledKey(model: Model): string {
  return modelKey(model, 'enabled');
}

export function buildModelGrid(models: ModelsConfig, orchestrator: OrchestratorConfig, defaults: TaskDefaults): ModelGrid {
  const resolved = resolveModels(models);
  const on = resolved.filter((m) => m.enabled).map((m) => m.id as string);
  // A role still pointing at a model that is off (set in settings.json) keeps it as an option, so
  // the select shows the truth instead of silently displaying another model.
  const options = (current: string, extra: string[] = []) => {
    const list = on.concat(extra);
    return list.includes(current) ? list : list.concat([current]);
  };
  const roleModel: Record<GridRole, string> = {
    orchestrator: orchestrator.model, groomer: defaults.groomer, worker: defaults.worker, reviewer: defaults.reviewer,
  };
  return {
    roles: [
      { id: 'orchestrator', label: ROLE_LABEL.orchestrator, model: orchestrator.model, models: options(orchestrator.model), effort: orchestrator.effort, groomConcurrency: orchestrator.groomConcurrency },
      { id: 'groomer', label: ROLE_LABEL.groomer, model: defaults.groomer, models: options(defaults.groomer), effort: defaults.groomerEffort },
      { id: 'worker', label: ROLE_LABEL.worker, model: defaults.worker, models: options(defaults.worker), effort: defaults.workerEffort },
      { id: 'reviewer', label: ROLE_LABEL.reviewer, model: defaults.reviewer, models: options(defaults.reviewer, [NO_REVIEW]), effort: null },
    ],
    models: resolved.map((m) => ({
      id: m.id,
      label: m.label,
      enabled: m.enabled,
      modelId: m.modelId,
      minEffort: m.minEffort,
      maxEffort: m.maxEffort,
      usedBy: GRID_ROLES.filter((r) => roleModel[r] === m.id),
    })),
    efforts: EFFORT_LEVELS,
    note: GRID_APPLY_NOTE,
  };
}

// `minimum: 1` in the manifest, `MAX_GROOM_CONCURRENCY` above. CLAMPED rather than refused, because
// a spinner dragged to 0 has an obvious intent (the smallest legal cap) while a typo'd model id
// does not. Non-numeric input has no intent to honour and returns null.
export function clampGroomConcurrency(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) return null;
  return Math.min(MAX_GROOM_CONCURRENCY, Math.max(1, Math.floor(value)));
}

export function isKnownSlot(value: unknown): value is GridSlot {
  return (GRID_ROLES as unknown[]).includes(value) || isModel(value);
}

function rolePatch(grid: ModelGrid, role: RoleRow, field: GridField, raw: unknown): GridPatchResult {
  if (field === 'model') {
    const value = String(raw ?? '');
    const row = grid.models.find((m) => m.id === value);
    if (!(role.id === 'reviewer' && value === NO_REVIEW) && !row) return { ok: false, reason: `“${value}” is not a model.` };
    if (row && !row.enabled) return { ok: false, reason: `${row.label} is off: turn it on before making it the ${role.label.toLowerCase()} model.` };
    return { ok: true, patches: [{ key: ROLE_MODEL_KEY[role.id], value }] };
  }
  if (field === 'effort') {
    const key = ROLE_EFFORT_KEY[role.id];
    if (!key) return { ok: false, reason: 'the reviewer runs at the task’s worker effort.' };
    const value = String(raw ?? '');
    if (!isValidEffort(value)) return { ok: false, reason: `“${value}” is not one of ${EFFORT_LEVELS.join(', ')}.` };
    return { ok: true, patches: [{ key, value }] };
  }
  if (field === 'groomConcurrency' && role.id === 'orchestrator') {
    const value = clampGroomConcurrency(raw);
    if (value === null) return { ok: false, reason: 'grooming concurrency must be a whole number.' };
    return { ok: true, patches: [{ key: `${SETTINGS_PREFIX}orchestrator.groomConcurrency`, value }] };
  }
  return { ok: false, reason: 'unknown grid field.' };
}

function modelPatch(row: ModelRow, field: GridField, raw: unknown): GridPatchResult {
  switch (field) {
    case 'enabled': {
      const enabled = raw === true;
      if (!enabled && row.usedBy.length) {
        return { ok: false, reason: `${row.label} is the ${row.usedBy[0]} model: pick another ${row.usedBy[0]} model first.` };
      }
      return { ok: true, patches: [{ key: modelKey(row.id, 'enabled'), value: enabled }] };
    }
    case 'modelId': {
      const value = String(raw ?? '').trim();
      // Empty RESETS the key, so the CLI's own alias applies again; a legal edit, not a refusal.
      if (value === '') return { ok: true, patches: [{ key: modelKey(row.id, 'modelId'), value: undefined }] };
      if (!isValidModelString(value)) return { ok: false, reason: `“${value}” is not a valid model id, so ${row.id} would keep its own.` };
      return { ok: true, patches: [{ key: modelKey(row.id, 'modelId'), value }] };
    }
    case 'minEffort':
    case 'maxEffort': {
      const value = String(raw ?? '');
      if (!isValidEffort(value)) return { ok: false, reason: `“${value}” is not one of ${EFFORT_LEVELS.join(', ')}.` };
      const min = field === 'minEffort' ? value : row.minEffort;
      const max = field === 'maxEffort' ? value : row.maxEffort;
      const levels: readonly string[] = EFFORT_LEVELS;
      if (levels.indexOf(min) > levels.indexOf(max)) {
        return { ok: false, reason: `${row.label}: the lowest effort (${min}) cannot be above the highest (${max}).` };
      }
      return { ok: true, patches: [{ key: modelKey(row.id, field), value }] };
    }
    default:
      return { ok: false, reason: 'unknown grid field.' };
  }
}

// One grid cell edit -> the config patches it means. Returns a REASON instead of patches whenever
// the edit would leave the board in a state it cannot render honestly; the page shows that reason
// in place, the way the native editor shows a validation error.
//
// Decided here (t-sgrp, kept by t-0e99): switching off a model that a role uses is REFUSED, not
// auto-reassigned. A disabled model is hidden from the board's selects and the bootstrap prompt,
// so a disabled default would send every task that names no model of its own to a model the user
// can no longer see, and silently moving the default would change which model runs the user's work
// without being asked. The same rule read the other way refuses making an OFF model a role's model.
export function gridPatch(grid: ModelGrid, slot: unknown, field: unknown, raw: unknown): GridPatchResult {
  if (!isKnownSlot(slot)) return { ok: false, reason: 'unknown grid row.' };
  if (!isGridField(field)) return { ok: false, reason: 'unknown grid field.' };
  const role = grid.roles.find((r) => r.id === slot);
  if (role) return rolePatch(grid, role, field, raw);
  const row = grid.models.find((m) => m.id === slot);
  if (!row) return { ok: false, reason: 'unknown grid row.' };
  return modelPatch(row, field, raw);
}
