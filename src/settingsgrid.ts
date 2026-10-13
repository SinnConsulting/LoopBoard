// The settings page's hand-built block (t-sgrp, rebuilt by t-0e99). PURE: no `vscode` import,
// compiled by tsconfig.test.json into out-test/ and unit-tested there.
//
// Two parts. The Orchestrator block holds the one loop's own `--model`, `--effort` and grooming cap.
// The Models table holds which task models are offered (`on`) and the per-task defaults as radio
// columns: `defaultGroomerModel`, `defaultWorkerModel` and `defaultReviewerModel` are each a single
// choice ACROSS the rows (the four models, `auto`, and `none` for the reviewer), so they belong in
// one table rather than as three more dropdowns elsewhere. The two default efforts sit beside their
// columns.
//
// Read side: none of this is new data. The host resolves it with the same `resolveOrchestrator` /
// `resolveTaskDefaults` the spawn and the board use, so the page shows what the loop would get.

import {
  BUILTIN_MODELS, Model, ModelsConfig, OrchestratorConfig, TaskDefaults, AUTO, NO_REVIEW, resolveModels,
  isModel, isValidModelString, isValidEffort, isEffortValue, EFFORT_LEVELS, TASK_EFFORT_LEVELS, MAX_GROOM_CONCURRENCY,
} from './model';
import { APPLIES_RESTART_TAIL, ConfigPatch, SETTINGS_PREFIX } from './settingsform';

// Everything in this block rides the spawn command (the orchestrator's flags and its bootstrap
// prompt), so a running loop keeps what it was started with. The grid replaces the generic rows for
// those keys, so it also replaces their per-row markers, in the SAME words off the same
// `APPLIES_RESTART_TAIL`. The board's selects and new drafts read the defaults at once; the page's
// subtitle says that part.
export const GRID_APPLY_NOTE = `orchestrator · models · defaults apply ${APPLIES_RESTART_TAIL}`;

export type GridRole = 'groomer' | 'worker' | 'reviewer';
export const GRID_ROLES: GridRole[] = ['groomer', 'worker', 'reviewer'];
export type GridSlot = Model | typeof AUTO | typeof NO_REVIEW | 'orchestrator' | 'defaults';
export type GridField = 'enabled' | GridRole | 'model' | 'effort' | 'groomConcurrency' | 'groomerEffort' | 'workerEffort';
export const GRID_FIELDS: GridField[] = [
  'enabled', 'groomer', 'worker', 'reviewer', 'model', 'effort', 'groomConcurrency', 'groomerEffort', 'workerEffort',
];

export function isGridField(value: unknown): value is GridField {
  return typeof value === 'string' && (GRID_FIELDS as string[]).includes(value);
}

export interface GridRow {
  id: Model | typeof AUTO | typeof NO_REVIEW;
  label: string;
  toggle: boolean; // carries an `on` switch: the four task models only
  enabled: boolean; // `auto` and `none` are always offered
  roles: GridRole[]; // the radio columns this row offers
  groomer: boolean; // is this row `loopBoard.defaultGroomerModel`?
  worker: boolean; // ... `defaultWorkerModel`?
  reviewer: boolean; // ... `defaultReviewerModel`?
}

export interface ModelGrid {
  orchestrator: {
    model: string; // the RAW configured `--model` string; '' means "use the default"
    spawned: string; // what the next spawn actually passes
    effort: string;
    groomConcurrency: number;
  };
  rows: GridRow[];
  defaults: TaskDefaults;
  efforts: readonly string[]; // the orchestrator's session levels, low..max
  taskEfforts: readonly string[]; // the default-effort selects: auto, then low..xhigh (no max)
  note: string;
}

export type GridPatchResult = { ok: true; patches: ConfigPatch[] } | { ok: false; reason: string };

export function enabledKey(model: Model): string {
  return `${SETTINGS_PREFIX}models.${model}.enabled`;
}

const ROLE_KEY: Record<GridRole, string> = {
  groomer: `${SETTINGS_PREFIX}defaultGroomerModel`,
  worker: `${SETTINGS_PREFIX}defaultWorkerModel`,
  reviewer: `${SETTINGS_PREFIX}defaultReviewerModel`,
};

export function buildModelGrid(
  models: ModelsConfig,
  orchestrator: { raw: string; resolved: OrchestratorConfig },
  defaults: TaskDefaults
): ModelGrid {
  const row = (id: GridRow['id'], label: string, toggle: boolean, enabled: boolean, roles: GridRole[]): GridRow => ({
    id, label, toggle, enabled, roles,
    groomer: defaults.groomer === id,
    worker: defaults.worker === id,
    reviewer: defaults.reviewer === id,
  });
  return {
    orchestrator: {
      model: orchestrator.raw,
      spawned: orchestrator.resolved.model,
      effort: orchestrator.resolved.effort,
      groomConcurrency: orchestrator.resolved.groomConcurrency,
    },
    rows: [
      ...resolveModels(models).map((m) => row(m.id, m.label, true, m.enabled, GRID_ROLES)),
      row(AUTO, 'auto', false, true, GRID_ROLES),
      row(NO_REVIEW, 'none', false, true, ['reviewer']),
    ],
    defaults,
    efforts: EFFORT_LEVELS,
    taskEfforts: [AUTO, ...TASK_EFFORT_LEVELS],
    note: GRID_APPLY_NOTE,
  };
}

// `minimum: 1` in the manifest, `MAX_GROOM_CONCURRENCY` above. CLAMPED rather than refused, because
// a spinner dragged to 0 has an obvious intent (the smallest legal cap) while a typo'd `--model`
// string does not. Non-numeric input has no intent to honour and returns null.
export function clampGroomConcurrency(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) return null;
  return Math.min(MAX_GROOM_CONCURRENCY, Math.max(1, Math.floor(value)));
}

export function isKnownSlot(value: unknown): value is GridSlot {
  return value === 'orchestrator' || value === 'defaults' || value === AUTO || value === NO_REVIEW || isModel(value);
}

function label(model: Model): string {
  return BUILTIN_MODELS.find((m) => m.id === model)?.label ?? model;
}

function orchestratorPatch(field: GridField, raw: unknown): GridPatchResult {
  const key = `${SETTINGS_PREFIX}orchestrator.${field}`;
  switch (field) {
    case 'model': {
      const value = String(raw ?? '').trim();
      // Empty RESETS the key, so the default (`opus`) applies again; a legal edit, not a refusal.
      if (value === '') return { ok: true, patches: [{ key, value: undefined }] };
      if (!isValidModelString(value)) {
        return { ok: false, reason: `“${value}” is not a valid --model string, so the default would be spawned instead.` };
      }
      return { ok: true, patches: [{ key, value }] };
    }
    case 'effort': {
      const value = String(raw ?? '');
      if (!isValidEffort(value)) return { ok: false, reason: `“${value}” is not one of ${EFFORT_LEVELS.join(', ')}.` };
      return { ok: true, patches: [{ key, value }] };
    }
    case 'groomConcurrency': {
      const value = clampGroomConcurrency(raw);
      if (value === null) return { ok: false, reason: 'grooming concurrency must be a whole number.' };
      return { ok: true, patches: [{ key, value }] };
    }
    default:
      return { ok: false, reason: 'unknown grid field.' };
  }
}

// One grid cell edit -> the config patches it means. Returns a REASON instead of patches whenever
// the edit would leave the board in a state it cannot render honestly; the page shows that reason
// in place, the way the native editor shows a validation error.
//
// Decided here (t-sgrp, kept by t-0e99): disabling a model that is a current default groomer,
// worker or reviewer is REFUSED, not auto-reassigned. A disabled model is hidden from the board's
// selects and never offered to `auto`, so a disabled default would send every task that names no
// model of its own to a model the user can no longer see, and silently moving the default would
// change which model runs the user's work without being asked. The radio is in the same row, so
// fixing it is one click; the same rule read the other way refuses making an OFF model a default.
export function gridPatch(grid: ModelGrid, slot: unknown, field: unknown, raw: unknown): GridPatchResult {
  if (!isKnownSlot(slot)) return { ok: false, reason: 'unknown grid row.' };
  if (!isGridField(field)) return { ok: false, reason: 'unknown grid field.' };
  if (slot === 'orchestrator') return orchestratorPatch(field, raw);
  if (slot === 'defaults') {
    if (field !== 'groomerEffort' && field !== 'workerEffort') return { ok: false, reason: 'unknown grid field.' };
    const value = String(raw ?? '');
    if (!isEffortValue(value)) return { ok: false, reason: `“${value}” is not one of ${grid.taskEfforts.join(', ')}.` };
    const key = `${SETTINGS_PREFIX}${field === 'groomerEffort' ? 'defaultGroomerEffort' : 'defaultWorkerEffort'}`;
    return { ok: true, patches: [{ key, value }] };
  }
  const row = grid.rows.find((r) => r.id === slot);
  if (!row) return { ok: false, reason: 'unknown grid row.' };

  if (field === 'enabled') {
    if (!row.toggle || !isModel(slot)) return { ok: false, reason: `${row.label} cannot be turned off.` };
    const enabled = raw === true;
    if (!enabled) {
      for (const role of GRID_ROLES) {
        if (row[role]) return { ok: false, reason: `${label(slot)} is the default ${role}: make another row the default ${role} first.` };
      }
    }
    return { ok: true, patches: [{ key: enabledKey(slot), value: enabled }] };
  }
  if (field === 'groomer' || field === 'worker' || field === 'reviewer') {
    if (!row.roles.includes(field)) return { ok: false, reason: `${row.label} cannot be the default ${field}.` };
    if (!row.enabled) return { ok: false, reason: `${row.label} is off: turn it on before making it the default ${field}.` };
    return { ok: true, patches: [{ key: ROLE_KEY[field], value: slot }] };
  }
  return { ok: false, reason: 'unknown grid field.' };
}
