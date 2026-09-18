// Manifest -> form model for LoopBoard's own settings page (t-sgrp). PURE: no `vscode` import, no
// node typings — compiled by tsconfig.test.json into out-test/ and unit-tested there.
//
// The page never hand-lists settings. The host reads its OWN `contributes.configuration`
// (`vscode.extensions.getExtension(...)?.packageJSON`), pairs each key with an `inspect()`-shaped
// value record, and hands both to `buildSettingsForm`. What comes back IS the page: sections in
// manifest order, one control per property, typed by the manifest. A setting added later therefore
// appears on the page automatically, and the page can never drift from the manifest.
//
// Every LoopBoard key is `"scope": "application"`, so there is exactly ONE writable scope: the
// global (user) one. That is why an `InspectedValue` carries only `defaultValue` + `globalValue` —
// a workspace value is not merely ignored here, it cannot exist.

import { BUILTIN_MODEL_IDS } from './model';

export const SETTINGS_PREFIX = 'loopBoard.';
// Marks a Beta property in the manifest, so the native escape-hatch view (`@tag:experimental`)
// agrees with the page's own Beta section instead of contradicting it.
export const EXPERIMENTAL_TAG = 'experimental';

// WHEN a changed setting takes effect. Two classes, no third: nothing LoopBoard reads is frozen at
// activation (every `getConfiguration` call in `src/` sits inside a closure taken at use time), so
// no setting ever needs a window reload.
//   `live`    — read on demand; the change is in force at once. Draws NO marker: because
//               `test/manifest-settings.test.js` forces EVERY property to be classified, an absent
//               marker is information, not an oversight.
//   `restart` — frozen into the spawn command (`buildClaudeBase` / `buildLoopCommand` in
//               `src/loop.ts`), so a running loop keeps what it was spawned with.
// Carried per property in the manifest itself (`loopBoardApplies`), so there is no second list to
// keep in step and a stale entry for a deleted key is impossible by construction.
export const APPLIES_KEY = 'loopBoardApplies';
export type Applies = 'live' | 'restart';
export const APPLIES_VALUES: Applies[] = ['live', 'restart'];

// ONE wording, three surfaces: the page's per-row marker, the model grid's header note and the
// `markdownDescription` sentence the NATIVE settings editor shows (it cannot render our marker).
// Everything below is built from the same tail, and the manifest sentence is asserted against it.
export const APPLIES_RESTART_TAIL = 'on the next loop start (▶) or restart (♻)';
export const APPLIES_RESTART_NOTE = `Applies ${APPLIES_RESTART_TAIL}`;
export const APPLIES_RESTART_SENTENCE = `${APPLIES_RESTART_NOTE}: a running loop keeps what it was spawned with.`;

// How a property's `type`/`enum` maps to a drawn control. `unknown` is the degrade-gracefully case:
// a future key with a type this page has no editor for renders read-only rather than throwing or
// vanishing — the escape hatch can still edit it.
export type ControlKind = 'boolean' | 'enum' | 'number' | 'string' | 'unknown';

export interface ManifestProperty {
  type?: string | string[];
  enum?: string[];
  enumDescriptions?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  order?: number;
  scope?: string;
  tags?: string[];
  markdownDescription?: string;
  description?: string;
  markdownDeprecationMessage?: string;
  deprecationMessage?: string;
  // LoopBoard's own key (see APPLIES_KEY). VSCode ignores manifest keys it does not know, and
  // `packageJSON` hands back the raw manifest, so it survives to the page untouched.
  loopBoardApplies?: string;
}

export interface ManifestSection {
  title?: string;
  order?: number;
  properties?: Record<string, ManifestProperty>;
}

// The two halves of `WorkspaceConfiguration.inspect()` that an application-scoped key can have.
// `globalValue !== undefined` is the whole definition of "modified" — exactly what the native
// editor's blue bar means, reproduced rather than approximated.
export interface InspectedValue {
  defaultValue?: unknown;
  globalValue?: unknown;
}
export type ValueMap = Record<string, InspectedValue | undefined>;

export interface SettingControl {
  key: string; // full setting id, e.g. `loopBoard.debug`
  label: string; // humanised from the key
  kind: ControlKind;
  description: string; // markdown SOURCE — rendered by media/markdown.js in the webview
  enumValues?: string[];
  enumDescriptions?: string[];
  defaultValue: unknown;
  value: unknown; // effective = globalValue ?? default
  modified: boolean;
  minimum?: number;
  maximum?: number;
  beta: boolean;
  readOnly: boolean;
  // `restart` draws the marker under the description; `live` draws nothing. An unclassified key
  // (which the manifest suite forbids) is treated as `live` — the page must not claim a fact the
  // manifest does not state.
  applies: Applies;
  // A boolean parent key, when one exists (`loopBoard.delegateWork.review` -> `loopBoard.delegateWork`).
  // Derived, not hard-coded: the page greys a dependent row while its parent is off, and a future
  // `x` + `x.y` pair gets the same treatment for free.
  dependsOn?: string;
}

export interface SettingsSection {
  title: string; // manifest title with the `LoopBoard: ` prefix stripped
  slug: string; // stable anchor id for the page's topic list — derived from the title, see sectionSlug
  order: number;
  beta: boolean;
  grid: boolean; // this section owns the hand-built model grid
  controls: SettingControl[];
}

export interface SettingsForm {
  sections: SettingsSection[];
  // The marker text a `restart` row draws. Sent WITH the form so the string the webview paints is
  // the one this (tested) module owns, instead of a copy hand-kept in media/settings.js.
  appliesNote: string;
}

export interface ConfigPatch {
  key: string;
  // `undefined` is meaningful: it is what `update(key, undefined, Global)` needs to RESET a key.
  value: unknown;
}

export type Validation = { ok: true; value: unknown } | { ok: false; reason: string };
export type PatchResult = { ok: true; patch: ConfigPatch } | { ok: false; reason: string };

// The 14 keys the hand-built grid claims (goal 4). They are ordinary manifest properties — the grid
// is a different PRESENTATION of them, not a different storage — so they are removed from their
// section's generic controls and the section is flagged `grid` instead.
export const MODEL_GRID_KEYS: string[] = [
  `${SETTINGS_PREFIX}defaultWorkerModel`,
  `${SETTINGS_PREFIX}defaultGroomerModel`,
  ...BUILTIN_MODEL_IDS.flatMap((id) =>
    ['enabled', 'model', 'effort', 'groomConcurrency'].map((f) => `${SETTINGS_PREFIX}models.${id}.${f}`)
  ),
];

export function isGridKey(key: string): boolean {
  return MODEL_GRID_KEYS.includes(key);
}

// A deprecated key is drawn by neither page: VSCode hides it from the native editor unless searched,
// and reproducing it here would advertise a setting whose whole message is "stop using me".
export function isDeprecated(prop: ManifestProperty): boolean {
  return !!(prop.markdownDeprecationMessage || prop.deprecationMessage);
}

// The property's classification, defaulting to `live` for anything unclassified or misspelt.
export function appliesOf(prop: ManifestProperty): Applies {
  return prop.loopBoardApplies === 'restart' ? 'restart' : 'live';
}

export function controlKind(prop: ManifestProperty): ControlKind {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return 'enum';
  const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
  if (type === 'boolean') return 'boolean';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'string') return 'string';
  return 'unknown';
}

// `loopBoard.contextLimit.percent` -> `Context limit — percent`. Dotted segments become em-dash
// separated phrases; camelCase becomes words; an ALL-CAPS run (`MB`) keeps its case.
export function humanizeKey(key: string): string {
  const leaf = key.startsWith(SETTINGS_PREFIX) ? key.slice(SETTINGS_PREFIX.length) : key;
  const segments = leaf.split('.').map((segment) =>
    segment
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(' ')
      .map((word) => (/^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word))
      .join(' ')
  );
  const text = segments.join(' — ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// `LoopBoard: Beta (experimental)` -> `Beta (experimental)`. The prefix exists so the NATIVE editor
// groups LoopBoard's sections together; on LoopBoard's own page every section is LoopBoard's, so
// repeating it in every heading is noise.
export function sectionTitle(title: string | undefined): string {
  const raw = (title ?? '').trim();
  return raw.startsWith('LoopBoard:') ? raw.slice('LoopBoard:'.length).trim() : raw;
}

// `Board & Workspace` -> `board-workspace`. The anchor the settings page's topic list scrolls to.
// Derived from the TITLE, never from the section's position, so reordering `contributes.configuration`
// cannot silently repoint an entry at a different section.
export function sectionSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

function isTaggedBeta(prop: ManifestProperty): boolean {
  return Array.isArray(prop.tags) && prop.tags.includes(EXPERIMENTAL_TAG);
}

// Manifest order within a section: explicit `order` first, declaration order as the tiebreaker —
// the same sequence the native editor and the README generator use.
function orderedEntries(section: ManifestSection): { key: string; prop: ManifestProperty; index: number }[] {
  return Object.entries(section.properties ?? {})
    .map(([key, prop], index) => ({ key, prop, index }))
    .sort((a, b) => (a.prop.order ?? 1e9) - (b.prop.order ?? 1e9) || a.index - b.index);
}

// Every boolean key in the whole manifest — the lookup that turns `x.y` into "depends on `x`".
function booleanKeys(sections: ManifestSection[]): Set<string> {
  const keys = new Set<string>();
  for (const section of sections) {
    for (const [key, prop] of Object.entries(section.properties ?? {})) {
      if (controlKind(prop) === 'boolean') keys.add(key);
    }
  }
  return keys;
}

function toControl(
  key: string,
  prop: ManifestProperty,
  inspected: InspectedValue | undefined,
  booleans: Set<string>
): SettingControl {
  const kind = controlKind(prop);
  const defaultValue = inspected && 'defaultValue' in inspected ? inspected.defaultValue : prop.default;
  const modified = inspected?.globalValue !== undefined;
  const parent = key.slice(0, key.lastIndexOf('.'));
  const control: SettingControl = {
    key,
    label: humanizeKey(key),
    kind,
    description: prop.markdownDescription ?? prop.description ?? '',
    defaultValue,
    value: modified ? inspected?.globalValue : defaultValue,
    modified,
    beta: isTaggedBeta(prop),
    readOnly: kind === 'unknown',
    applies: appliesOf(prop),
  };
  if (kind === 'enum') {
    control.enumValues = prop.enum ? [...prop.enum] : [];
    if (prop.enumDescriptions) control.enumDescriptions = [...prop.enumDescriptions];
  }
  if (typeof prop.minimum === 'number') control.minimum = prop.minimum;
  if (typeof prop.maximum === 'number') control.maximum = prop.maximum;
  if (key.includes('.') && parent !== key && booleans.has(parent)) control.dependsOn = parent;
  return control;
}

export function buildSettingsForm(sections: ManifestSection[], values: ValueMap = {}): SettingsForm {
  const booleans = booleanKeys(sections);
  const built: SettingsSection[] = [];
  // Two sections with the same title would otherwise share an anchor and the topic list would send
  // both entries to the first one.
  const slugs = new Map<string, number>();
  for (const section of sections) {
    const entries = orderedEntries(section).filter((e) => !isDeprecated(e.prop));
    const grid = entries.some((e) => isGridKey(e.key));
    const drawn = entries.filter((e) => !isGridKey(e.key));
    const controls = drawn.map((e) => toControl(e.key, e.prop, values[e.key], booleans));
    if (controls.length === 0 && !grid) continue;
    const title = sectionTitle(section.title);
    const slug = sectionSlug(title);
    const taken = slugs.get(slug) ?? 0;
    slugs.set(slug, taken + 1);
    built.push({
      title,
      slug: taken === 0 ? slug : `${slug}-${taken + 1}`,
      order: section.order ?? 1e9,
      // A section is Beta only when EVERY property it draws is tagged experimental — the tag is the
      // truth, the heading is its rendering.
      beta: controls.length > 0 && controls.every((c) => c.beta),
      grid,
      controls,
    });
  }
  return { sections: built.sort((a, b) => a.order - b.order), appliesNote: APPLIES_RESTART_NOTE };
}

// Every key the page needs an `inspect()` for — including the grid's, which the host reads through
// the same call.
export function formKeys(sections: ManifestSection[]): string[] {
  const keys: string[] = [];
  for (const section of sections) for (const key of Object.keys(section.properties ?? {})) keys.push(key);
  return keys;
}

// Host-side gate for every generic control edit. The webview is never trusted: it can post any
// value for any key, and this is the only thing standing between that and `update()`.
export function validateValue(control: SettingControl, raw: unknown): Validation {
  switch (control.kind) {
    case 'boolean':
      return { ok: true, value: raw === true };
    case 'enum': {
      const value = String(raw);
      if (!(control.enumValues ?? []).includes(value)) {
        return { ok: false, reason: `“${value}” is not one of ${(control.enumValues ?? []).join(', ')}.` };
      }
      return { ok: true, value };
    }
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(value)) return { ok: false, reason: 'must be a number.' };
      if (control.minimum !== undefined && value < control.minimum) {
        return { ok: false, reason: `must be at least ${control.minimum}.` };
      }
      if (control.maximum !== undefined && value > control.maximum) {
        return { ok: false, reason: `must be at most ${control.maximum}.` };
      }
      return { ok: true, value };
    }
    case 'string':
      return { ok: true, value: String(raw) };
    default:
      return { ok: false, reason: 'this setting has no editor here — use Open in VSCode Settings.' };
  }
}

export function toConfigPatch(control: SettingControl, raw: unknown): PatchResult {
  const validation = validateValue(control, raw);
  if (!validation.ok) return validation;
  return { ok: true, patch: { key: control.key, value: validation.value } };
}

// Per-setting reset. `undefined` is the value VSCode's `update()` reads as "remove this key",
// which is what restores the manifest default — the one affordance a custom page most easily loses.
export function resetPatch(key: string): ConfigPatch {
  return { key, value: undefined };
}

export function findControl(form: SettingsForm, key: string): SettingControl | undefined {
  for (const section of form.sections) {
    for (const control of section.controls) if (control.key === key) return control;
  }
  return undefined;
}
