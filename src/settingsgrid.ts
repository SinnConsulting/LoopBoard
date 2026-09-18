// The model grid's own logic (t-sgrp, goal 4). PURE: no `vscode` import — compiled by
// tsconfig.test.json into out-test/ and unit-tested there.
//
// The grid is the ONE hand-built block on the settings page: `loopBoard.models.<slot>.*` is a
// 3 × 4 matrix that the native editor can only draw as 14 flat rows, and `defaultWorkerModel` /
// `defaultGroomerModel` are single-choice ACROSS the slots, so they belong in the same table as
// radio columns rather than as two more dropdowns somewhere else. That is what makes the grid an
// overview instead of a re-skin.
//
// Read side: none of this is new data. `resolveModels` already produces exactly this matrix, and it
// is reused verbatim here so an invalid `--model` string is resolved (and rejected) by the same code
// the spawn line goes through.

import {
  BUILTIN_MODEL_IDS, Model, ModelConfigEntry, ModelsConfig, resolveModels, isValidModelString,
  isValidEffort, EFFORT_LEVELS, Effort, MAX_GROOM_CONCURRENCY,
} from './model';
import { APPLIES_RESTART_TAIL, ConfigPatch, SETTINGS_PREFIX } from './settingsform';

// The truthfulness note the grid must carry (goal 4): `model`, `effort` and `groomConcurrency` are
// frozen into the spawn command, so a running loop keeps what it was started with. Saying nothing
// would imply the change is live.
//
// The grid replaces the generic rows for those keys, so it also replaces their per-row markers —
// and it says it in the SAME words, off the same `APPLIES_RESTART_TAIL`, naming only the three
// columns it applies to (`on` and the two default-model radios are live). One fact, one wording,
// never twice on the page in two voices.
export const GRID_APPLY_NOTE = `model · effort · groomers apply ${APPLIES_RESTART_TAIL}`;

export type GridField = 'enabled' | 'worker' | 'groomer' | 'model' | 'effort' | 'groomConcurrency';
export const GRID_FIELDS: GridField[] = ['enabled', 'worker', 'groomer', 'model', 'effort', 'groomConcurrency'];

export function isGridField(value: unknown): value is GridField {
  return typeof value === 'string' && (GRID_FIELDS as string[]).includes(value);
}

export interface GridRow {
  id: Model;
  label: string;
  enabled: boolean;
  worker: boolean; // is this slot `loopBoard.defaultWorkerModel`?
  groomer: boolean; // is this slot `loopBoard.defaultGroomerModel`?
  model: string; // the RAW configured override; '' means "use the built-in default"
  spawned: string; // what resolveModels would actually put on the shell line
  effort: Effort;
  groomConcurrency: number;
}

export interface ModelGrid {
  rows: GridRow[];
  defaultWorker: Model;
  defaultGroomer: Model;
  efforts: readonly string[];
  note: string;
}

export type GridPatchResult = { ok: true; patches: ConfigPatch[] } | { ok: false; reason: string };

export function slotKey(slot: Model, field: 'enabled' | 'model' | 'effort' | 'groomConcurrency'): string {
  return `${SETTINGS_PREFIX}models.${slot}.${field}`;
}

// The configured override as typed, before resolveModels falls back. The grid's `--model` field
// edits THIS, not the resolved string: showing `opus` in a slot whose override is empty would make
// an unset field look set, and clearing it back to the default would then be impossible.
function rawOverride(entry: ModelConfigEntry | undefined): string {
  if (typeof entry === 'string') return entry;
  return typeof entry?.model === 'string' ? entry.model : '';
}

export function buildModelGrid(cfg: ModelsConfig, defaultWorker: Model, defaultGroomer: Model): ModelGrid {
  return {
    defaultWorker,
    defaultGroomer,
    efforts: EFFORT_LEVELS,
    note: GRID_APPLY_NOTE,
    rows: resolveModels(cfg).map((m) => ({
      id: m.id,
      label: m.label,
      enabled: m.enabled,
      worker: m.id === defaultWorker,
      groomer: m.id === defaultGroomer,
      model: rawOverride(cfg[m.id]),
      spawned: m.model,
      effort: m.effort,
      groomConcurrency: m.groomConcurrency,
    })),
  };
}

// `minimum: 1` in the manifest, `MAX_GROOM_CONCURRENCY` above — CLAMPED rather than refused, because
// a spinner dragged to 0 has an obvious intent (the smallest legal cap) while a typo'd `--model`
// string does not. Non-numeric input has no intent to honour and returns null.
export function clampGroomConcurrency(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) return null;
  return Math.min(MAX_GROOM_CONCURRENCY, Math.max(1, Math.floor(value)));
}

export function isKnownSlot(value: unknown): value is Model {
  return typeof value === 'string' && (BUILTIN_MODEL_IDS as string[]).includes(value);
}

// One grid cell edit -> the config patches it means. Returns a REASON instead of patches whenever
// the edit would leave the board in a state it cannot render honestly — the page shows that reason
// in place, the way the native editor shows a validation error.
//
// Decided here (the "disabling the slot that is the default worker/groomer" case): the write is
// REFUSED, not auto-reassigned. A disabled slot is hidden from the Loops overview and from the
// board's model selects, so a disabled default would route every unlabelled task to a slot the user
// can no longer see or start — and silently moving the default to another slot would change which
// model runs the user's work without being asked. The radio column is in the same row, so fixing it
// is one click, and the same rule read the other way refuses making a slot that is OFF the default.
export function gridPatch(grid: ModelGrid, slot: unknown, field: unknown, raw: unknown): GridPatchResult {
  if (!isKnownSlot(slot)) return { ok: false, reason: 'unknown model slot.' };
  if (!isGridField(field)) return { ok: false, reason: 'unknown grid field.' };
  const row = grid.rows.find((r) => r.id === slot);
  if (!row) return { ok: false, reason: 'unknown model slot.' };

  switch (field) {
    case 'enabled': {
      const enabled = raw === true;
      if (!enabled && grid.defaultWorker === slot) {
        return { ok: false, reason: `${row.label} is the default worker — make another slot the default worker first.` };
      }
      if (!enabled && grid.defaultGroomer === slot) {
        return { ok: false, reason: `${row.label} is the default groomer — make another slot the default groomer first.` };
      }
      return { ok: true, patches: [{ key: slotKey(slot, 'enabled'), value: enabled }] };
    }
    case 'worker':
    case 'groomer': {
      const role = field === 'worker' ? 'worker' : 'groomer';
      if (!row.enabled) {
        return { ok: false, reason: `${row.label} is off — turn the slot on before making it the default ${role}.` };
      }
      const key = field === 'worker' ? `${SETTINGS_PREFIX}defaultWorkerModel` : `${SETTINGS_PREFIX}defaultGroomerModel`;
      return { ok: true, patches: [{ key, value: slot }] };
    }
    case 'model': {
      const value = String(raw ?? '').trim();
      // Empty CLEARS the override back to the built-in default — a legal edit, not a rejected one.
      if (value !== '' && !isValidModelString(value)) {
        return {
          ok: false,
          reason: `“${value}” is not a valid --model string — it would be ignored and \`${slot}\` spawned instead.`,
        };
      }
      return { ok: true, patches: [{ key: slotKey(slot, 'model'), value }] };
    }
    case 'effort': {
      const value = String(raw ?? '');
      if (!isValidEffort(value)) {
        return { ok: false, reason: `“${value}” is not one of ${EFFORT_LEVELS.join(', ')}.` };
      }
      return { ok: true, patches: [{ key: slotKey(slot, 'effort'), value }] };
    }
    default: {
      const value = clampGroomConcurrency(raw);
      if (value === null) return { ok: false, reason: 'grooming concurrency must be a whole number.' };
      return { ok: true, patches: [{ key: slotKey(slot, 'groomConcurrency'), value }] };
    }
  }
}
