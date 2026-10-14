/* LoopBoard's own settings page (t-sgrp). Vanilla JS, no framework.

   This file draws NOTHING of its own: the host derives the whole form from the extension's
   `contributes.configuration` (src/settingsform.ts) plus the hand-built Roles and Models tables
   (src/settingsgrid.ts) and posts both. A setting added to package.json later therefore shows up
   here without a line of change in this file, and the page can never drift from the manifest.

   Every edit goes back to the host, which re-validates it (the webview is never trusted) and writes
   ConfigurationTarget.Global — the only writable scope, since every LoopBoard key is
   `"scope": "application"`. The host's config listener then posts a fresh form, so what is on screen
   is always what is on disk. */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const { mdToHtml } = window.LoopBoardMarkdown;

  // ---- tiny DOM helper (same contract as media/board.js's) ----
  function h(tag, props) {
    const e = document.createElement(tag);
    props = props || {};
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = Array.isArray(arguments[i]) ? arguments[i] : [arguments[i]];
      for (const kid of kids) {
        if (kid == null || kid === false) continue;
        e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      }
    }
    return e;
  }

  // Mirrors isValidModelString (src/model.ts): the same allowlist the spawn line is checked against,
  // so the inline "invalid" state a user sees is the decision the host will actually make.
  const VALID_MODEL = /^[A-Za-z0-9._[\]-]+$/;

  const root = document.getElementById('root');
  let state = null; // { form, grid, extensionId }
  // A repaint that lands mid-typing would blow away the caret (same problem the board solves with
  // `pendingBoard`): hold it while a field is focused and flush on focusout.
  let pending = null;
  let errors = {}; // key or `slot/field` -> reason, cleared on the next accepted state
  // The stale-settings panel: `{ plan, done, applied, failures }` or null when it is not open.
  // Deliberately NOT part of `state`, which is replaced wholesale by every incoming form — the
  // panel must survive the repaint its own writes trigger, or the result would flash and vanish.
  let migration = null;
  // Whether the "legacy keys" disclosure is expanded. Module-level, so it survives the repaint its
  // own Remove triggers — `migration` is replaced wholesale by every incoming `settingsMigration`,
  // and a disclosure that collapsed itself the moment you used it would hide its own result.
  let legacyOpen = false;

  function hasFocus() {
    const el = document.activeElement;
    return !!el && el !== document.body && root.contains(el)
      && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
  }

  function apply(next) {
    if (hasFocus()) { pending = next; return; }
    pending = null;
    state = next;
    render();
  }

  document.addEventListener('focusout', () => {
    // Let the resulting change event commit first.
    setTimeout(() => { if (pending && !hasFocus()) apply(pending); }, 0);
  });

  // ---- messages ----
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'settings') {
      errors = {};
      apply({ form: msg.form, grid: msg.grid, migrations: msg.migrations || 0, extensionId: msg.extensionId, problem: msg.problem });
      return;
    }
    if (msg.type === 'settingsMigration') {
      migration = {
        plan: msg.plan || { actions: [], writes: [], conflicts: 0, sweeps: 0, findings: 0 },
        done: !!msg.done,
        applied: msg.applied || 0,
        failures: msg.failures || [],
        did: msg.did || '',
        // Which kind of row produced `did`, so the report lands where the click did: a sweep's
        // result belongs inside the disclosure, never in the default view.
        didKind: msg.didKind || '',
      };
      pending = null;
      render();
      return;
    }
    if (msg.type === 'settingsError') {
      errors[msg.key || (msg.slot + '/' + msg.field)] = msg.reason;
      // Repaint unconditionally: the write was refused, so the control still shows the value the
      // user typed and must be put back to what is actually stored, with the reason beside it.
      pending = null;
      render();
    }
  });

  function patch(key, value) { vscode.postMessage({ type: 'settingsPatch', key, value }); }
  function reset(key) { vscode.postMessage({ type: 'settingsReset', key }); }
  function gridEdit(slot, field, value) { vscode.postMessage({ type: 'gridPatch', slot, field, value }); }

  // ---- markdown description, with links routed through the host ----
  function description(markdown) {
    const el = h('div', { class: 'desc', html: mdToHtml(markdown || '') });
    for (const a of el.querySelectorAll('a[data-mdlink]')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'openLink', url: a.getAttribute('data-mdlink') });
      });
    }
    return el;
  }

  function errorFor(id) {
    return errors[id] ? h('div', { class: 'err' }, errors[id]) : null;
  }

  // WHEN a change takes effect. Drawn ONLY for a `restart` setting (src/settingsform.ts classifies
  // every key from the manifest's `loopBoardApplies`); a `live` row gets nothing, because a page
  // where every row claims something says nothing. The text comes from the form model, so the
  // marker, the grid's note and the manifest sentence are one string in one tested place.
  function appliesMarker(text) {
    return h('div', { class: 'applies' }, h('span', { class: 'ico', 'aria-hidden': 'true' }, '⟳'), text);
  }

  function toggle(checked, label, onchange) {
    return h('button', {
      class: 'sw', type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false',
      'aria-label': label,
      onclick: () => onchange(!checked),
    });
  }

  // ---- generic controls, one per manifest property ----
  function controlFor(control) {
    switch (control.kind) {
      case 'boolean':
        return toggle(control.value === true, control.label, (v) => patch(control.key, v));
      case 'enum': {
        const select = h('select', { 'aria-label': control.label });
        (control.enumValues || []).forEach((option, i) => {
          const hint = (control.enumDescriptions || [])[i];
          select.append(h('option', { value: option, selected: option === control.value, title: hint }, option));
        });
        select.addEventListener('change', () => patch(control.key, select.value));
        return select;
      }
      case 'number': {
        const input = h('input', {
          type: 'number', 'aria-label': control.label, value: String(control.value ?? ''),
          min: control.minimum === undefined ? null : String(control.minimum),
          max: control.maximum === undefined ? null : String(control.maximum),
        });
        input.addEventListener('change', () => patch(control.key, Number(input.value)));
        return input;
      }
      case 'string': {
        const input = h('input', {
          type: 'text', 'aria-label': control.label, value: String(control.value ?? ''),
          placeholder: String(control.defaultValue ?? ''),
        });
        input.addEventListener('change', () => patch(control.key, input.value));
        return input;
      }
      default:
        // An unknown type degrades to a read-only row rather than throwing or vanishing — the
        // escape hatch can still edit it.
        return h('span', { class: 'subtle' }, JSON.stringify(control.value));
    }
  }

  function booleanValue(key) {
    for (const section of state.form.sections) {
      for (const control of section.controls) if (control.key === key) return control.value === true;
    }
    return true; // an unknown parent never disables its dependant
  }

  function settingRow(control) {
    const off = control.dependsOn && !booleanValue(control.dependsOn);
    return h('div', { class: 'row' + (off ? ' dependent' : '') },
      h('div', {},
        h('div', { class: 'key' }, control.modified ? h('span', { class: 'dot', title: 'Modified' }) : null, control.label),
        description(control.description),
        control.applies === 'restart' ? appliesMarker(state.form.appliesNote) : null,
        errorFor(control.key)),
      h('div', { class: 'ctl' },
        h('button', {
          class: 'reset', type: 'button', hidden: !control.modified,
          title: 'Reset to the default (' + JSON.stringify(control.defaultValue ?? null) + ')',
          onclick: () => reset(control.key),
        }, 'Reset'),
        controlFor(control)));
  }

  // ---- the one hand-built block (t-0e99): the Roles table + the Models table ----
  // Dropdowns throughout (owner feedback on t-0e99); the model id is the one free-text field,
  // because an id cannot be enumerated.
  function gridSelect(values, value, label, onchange) {
    const sel = h('select', { 'aria-label': label });
    for (const v of values) sel.append(h('option', { value: v, selected: v === value }, v));
    sel.addEventListener('change', () => onchange(sel.value));
    return sel;
  }

  function gridTable() {
    const grid = state.grid;

    // Roles: the model and effort each spawn gets when the task names none of its own. Every model
    // select offers only the models switched on below.
    const roleBody = h('tbody', {});
    for (const r of grid.roles) {
      const effort = r.effort === null
        ? h('span', { class: 'subtle' }, 'the worker’s')
        : gridSelect(grid.efforts, r.effort, r.label + ' effort', (v) => gridEdit(r.id, 'effort', v));
      let groomers = null;
      if (r.groomConcurrency !== undefined) {
        groomers = h('input', {
          type: 'number', min: '1', value: String(r.groomConcurrency), 'aria-label': 'Grooming subagents per pass',
          title: 'Grooming subagents the Orchestrator may run in parallel per pass',
        });
        groomers.addEventListener('change', () => gridEdit(r.id, 'groomConcurrency', Number(groomers.value)));
      }
      roleBody.append(h('tr', {},
        h('td', { class: 'left always' }, h('span', { class: 'slot' }, r.label)),
        h('td', {}, gridSelect(r.models, r.model, r.label + ' model', (v) => gridEdit(r.id, 'model', v))),
        h('td', {}, effort),
        h('td', {}, groomers)));
    }
    const roles = h('table', { class: 'grid roles' },
      h('thead', {}, h('tr', {},
        h('th', { class: 'left' }, 'Role'), h('th', {}, 'model'), h('th', {}, 'effort'), h('th', {}, 'groomers / pass'))),
      roleBody);

    // Models: on/off, the id its alias resolves to, and the effort floor and ceiling every spawn on
    // it is clamped into.
    const modelBody = h('tbody', {});
    for (const m of grid.models) {
      const id = h('input', {
        type: 'text', value: m.modelId, placeholder: m.id, 'aria-label': m.label + ' model id',
        title: 'Model id the `' + m.id + '` alias resolves to for the Orchestrator and every subagent; empty = the CLI’s own',
      });
      id.addEventListener('input', () => {
        const v = id.value.trim();
        id.classList.toggle('invalid', v !== '' && !VALID_MODEL.test(v));
      });
      id.addEventListener('change', () => gridEdit(m.id, 'modelId', id.value));
      modelBody.append(h('tr', { class: m.enabled ? '' : 'disabled' },
        h('td', { class: 'left always' }, h('span', { class: 'slot' }, m.label)),
        h('td', { class: 'always' }, toggle(m.enabled, m.label + ' enabled', (v) => gridEdit(m.id, 'enabled', v))),
        h('td', { class: 'left model' }, id),
        h('td', {}, gridSelect(grid.efforts, m.minEffort, m.label + ' lowest effort', (v) => gridEdit(m.id, 'minEffort', v))),
        h('td', {}, gridSelect(grid.efforts, m.maxEffort, m.label + ' highest effort', (v) => gridEdit(m.id, 'maxEffort', v)))));
    }
    const models = h('table', { class: 'grid models' },
      h('thead', {}, h('tr', {},
        h('th', { class: 'left' }, 'Model'), h('th', {}, 'on'), h('th', { class: 'left' }, 'model id'),
        h('th', {}, 'lowest effort'), h('th', {}, 'highest effort'))),
      modelBody);

    const ids = grid.roles.map((r) => r.id).concat(grid.models.map((m) => m.id));
    const rowErrors = ['model', 'effort', 'groomConcurrency', 'enabled', 'modelId', 'minEffort', 'maxEffort']
      .flatMap((field) => ids.map((id) => errors[id + '/' + field]))
      .filter(Boolean);

    return [
      h('div', { class: 'grid-head' },
        h('span', { class: 'subtle' },
          'One Orchestrator loop delegates every groom, implementation and review to a subagent on the '
          + 'task’s own model and effort, else the role’s below; each model clamps the effort into its '
          + 'range. The board and new drafts use a change at once.'),
        // Same marker as a `restart` row's: the grid stands in for those rows, so it must not say
        // their fact in a second voice. `grid.note` names what it covers.
        appliesMarker(grid.note)),
      roles,
      models,
      rowErrors.length ? h('div', { class: 'err' }, rowErrors[0]) : null,
    ];
  }

  // ---- stale settings: preview, then confirm ----
  // Nothing here decides anything. The host owns the plan (src/settingsmigrate.ts, unit-tested) and
  // REBUILDS it when the confirmation arrives, so this panel is a rendering of a decision already
  // made elsewhere — it cannot cause a write the host did not independently plan.
  const KIND_LABEL = { migrate: 'Migrate', remove: 'Remove', conflict: 'Conflict', sweep: 'Remove?' };
  // Every row is executable — a row that could only tell the user to go and edit JSON themselves is
  // not worth listing. The host re-derives the action from the key, so this is a request, not an
  // instruction: it can never ask for a write the host did not independently plan.
  const DO_LABEL = { migrate: 'Migrate', remove: 'Remove', conflict: 'Remove old', sweep: 'Remove' };
  const DO_TITLE = {
    migrate: 'Write the new key from this value, then delete this one.',
    remove: 'Delete this key from your user settings.',
    conflict: 'Delete this old key and keep the one you set by hand. Nothing else is touched.',
    sweep: 'Delete this key from settings.json if it is there. If it is not, nothing happens.',
  };

  function doButton(action) {
    return h('button', {
      class: 'btn mig-do', type: 'button', title: DO_TITLE[action.kind] || '',
      onclick: () => vscode.postMessage({ type: 'settingsMigrateKey', key: action.key }),
    }, DO_LABEL[action.kind] || 'Apply');
  }

  function migrationLine(action) {
    return h('li', { class: 'mig-line mig-' + action.kind },
      h('span', { class: 'mig-tag' }, KIND_LABEL[action.kind] || action.kind),
      h('span', {},
        h('code', {}, action.key),
        action.value === undefined ? null : h('span', { class: 'subtle' }, ' = ' + JSON.stringify(action.value)),
        ' — ' + action.detail),
      doButton(action));
  }

  // ---- the disclosure for keys that cannot be read ----
  // A SWEEP row can never be seen resolved: it exists because the key is invisible to the
  // configuration API, so the scan lists it again immediately after removing it. Shown in the
  // default view that reads as the panel reporting a finished removal and re-offering the same
  // removal in the same breath — which is exactly what confused the first build. So it lives behind
  // a collapsed disclosure instead: out of the default view entirely, still one click from being
  // dealt with, and never written unless the user opens this and presses Remove.
  function legacyDisclosure() {
    const plan = migration.plan;
    const rows = plan.actions.filter((a) => a.kind === 'sweep');
    if (!rows.length) return null;
    // The result of a Remove is reported HERE, beside the button that caused it — never in the
    // default view, which must stay a plain verdict.
    const didLine = migration.did && migration.didKind === 'sweep'
      ? h('p', { class: 'mig-did' }, migration.did)
      : null;
    return h('details', {
      class: 'mig-legacy', open: legacyOpen,
      ontoggle: (ev) => { legacyOpen = ev.target.open; },
    },
      h('summary', {}, 'Legacy keys this page cannot read (' + rows.length + ')'),
      h('p', { class: 'subtle' },
        'VSCode hides a setting that is written as a child of another setting, so LoopBoard cannot ',
        'tell whether these are in your ', h('code', {}, 'settings.json'), '. Deleting one works ',
        'even though reading it does not — and does nothing at all if it was never there.'),
      didLine,
      h('ul', { class: 'mig-list' }, rows.map(migrationLine)));
  }

  function migrationPanel() {
    if (!migration) return null;
    const plan = migration.plan;
    const close = h('button', { class: 'btn', type: 'button', onclick: () => { migration = null; render(); } }, 'Close');

    // Findings only — sweeps are drawn by `legacyDisclosure`, which is independent of all of this.
    const rows = plan.actions.filter((a) => a.kind !== 'sweep');
    const didLine = migration.did && migration.didKind !== 'sweep'
      ? h('p', { class: 'mig-did' }, migration.did)
      : null;
    const fails = migration.failures && migration.failures.length
      ? h('ul', { class: 'mig-list' }, migration.failures.map((f) => h('li', { class: 'err' }, f)))
      : null;

    if (migration.done) {
      return h('div', { class: 'migrate' },
        h('div', { class: 'mig-head' }, h('strong', {}, 'Migration finished'), close),
        h('p', {}, migration.applied === 0
          ? 'Nothing was written.'
          : 'Applied ' + migration.applied + ' change' + (migration.applied === 1 ? '' : 's') + ' to your user settings.'),
        fails,
        rows.length ? h('p', {}, 'Still listed — each row below still has its own button.') : null,
        rows.length ? h('ul', { class: 'mig-list' }, rows.map(migrationLine)) : null,
        legacyDisclosure());
    }

    // `findings` and not `actions.length` decides the verdict: a sweep is an offer, not evidence, so
    // a config with nothing but sweeps has nothing known to be wrong and must read that way.
    if (!plan.findings) {
      return h('div', { class: 'migrate' },
        h('div', { class: 'mig-head' }, h('strong', {}, 'Nothing to migrate'), close),
        h('p', {}, 'Every ', h('code', {}, 'loopBoard.*'),
          ' key LoopBoard can read in your user settings is one it still declares and reads.'),
        didLine,
        fails,
        legacyDisclosure());
    }

    // The bulk button only earns its place when it saves clicks: with a single automatic write the
    // row's own button already is the whole action. Neither conflicts nor sweeps are in the count —
    // `plan.writes` holds only the writes that are certainly writes.
    const writes = (plan.writes || []).length;
    return h('div', { class: 'migrate pending' },
      h('div', { class: 'mig-head' },
        h('strong', {}, 'Review — nothing is written until you press a button'),
        close),
      didLine,
      fails,
      h('ul', { class: 'mig-list' }, rows.map(migrationLine)),
      h('div', { class: 'mig-actions' },
        writes > 1
          ? h('button', {
              class: 'btn primary', type: 'button',
              title: 'Run every row above except the conflicts, which need your decision.',
              onclick: () => vscode.postMessage({ type: 'settingsMigrate' }),
            }, 'Apply all ' + writes + ' changes')
          : null,
        h('button', { class: 'btn', type: 'button', onclick: () => { migration = null; render(); } }, 'Cancel')),
      legacyDisclosure());
  }

  // ---- topic list ----
  // The heading text and the nav entry are the SAME derivation, so a section can never be listed
  // under a name it is not drawn under.
  function sectionLabel(section) {
    return section.beta ? section.title.replace(/\s*\(experimental\)\s*$/, '') : section.title;
  }
  // `slug` comes from the form model (src/settingsform.ts) — title-derived, so reordering the
  // manifest cannot repoint an entry at a different section.
  function sectionId(section) { return 'section-' + section.slug; }

  // Entries are derived from the same `state.form.sections` the page is drawn from: a section added
  // to `contributes.configuration` later appears here with no change to this file. WHETHER the list
  // is shown is a pure CSS decision (the min-width media query in media/settings.css) — there is no
  // width measurement and no resize listener here, so at narrow widths it is simply not on the page.
  function topicList() {
    if (!state.form.sections.length) return null;
    const nav = h('nav', { class: 'toc', 'aria-label': 'Settings sections' },
      h('div', { class: 'toc-title' }, 'Sections'));
    for (const section of state.form.sections) {
      nav.append(h('button', {
        class: 'toc-link', type: 'button',
        onclick: () => {
          const target = document.getElementById(sectionId(section));
          if (target) target.scrollIntoView({ block: 'start' });
        },
      }, sectionLabel(section), section.beta ? h('span', { class: 'tag' }, 'experimental') : null));
    }
    return nav;
  }

  // ---- page ----
  function render() {
    root.textContent = '';
    if (!state) return;

    const wrap = h('div', { class: 'wrap' });
    wrap.append(h('header', {},
      h('h1', {}, 'LoopBoard Settings'),
      // Next to the escape hatch, and deliberately BEFORE it: both are about settings that this
      // page cannot show you — one because the key is stale, one because you want the raw JSON.
      // Warning-coloured with a count while stale keys exist (t-0e99 FB11), so a pending migration is
      // seen without opening the panel.
      h('button', {
        class: 'btn' + (state.migrations ? ' warn' : ''), type: 'button',
        title: state.migrations
          ? state.migrations + ' setting' + (state.migrations === 1 ? '' : 's') + ' in your user settings can be migrated; shows what it would do before changing anything'
          : 'Look for loopBoard.* keys in your user settings that were renamed, deprecated or dropped; shows what it would do before changing anything',
        onclick: () => { migration = null; vscode.postMessage({ type: 'settingsScanStale' }); },
      }, state.migrations ? 'Migrate Config (' + state.migrations + ')' : 'Migrate Config'),
      // The one per-WORKSPACE action on a page of global settings (t-4dce): it runs the manual
      // preview → modal confirm → sync flow on this window's `.loopboard/`, whether
      // `loopBoard.autoSyncTemplates` is on or off.
      h('button', {
        class: 'btn', type: 'button',
        title: 'Sync THIS window’s .loopboard/ TODO.md and LOOP.md to the templates this extension ships — previews the changes and asks before writing',
        onclick: () => vscode.postMessage({ type: 'syncTemplates' }),
      }, 'Synchronise Templates'),
      h('button', {
        class: 'btn', type: 'button',
        title: 'Open the same settings in VSCode’s own Settings editor',
        onclick: () => vscode.postMessage({ type: 'openNativeSettings' }),
      }, 'Open in VSCode Settings')));
    wrap.append(h('div', { class: 'subtle' },
      'All LoopBoard settings are global (user) settings — they are not configurable per repository.'));

    if (state.problem) wrap.append(h('div', { class: 'banner' }, state.problem));
    if (state.migrations && !migration) {
      wrap.append(h('div', { class: 'banner warn' },
        state.migrations + ' LoopBoard setting' + (state.migrations === 1 ? ' is' : 's are') + ' out of date in your user settings. ',
        h('button', { class: 'btn warn', type: 'button', onclick: () => vscode.postMessage({ type: 'settingsScanStale' }) }, 'Review migration')));
    }
    const migrateBox = migrationPanel();
    if (migrateBox) wrap.append(migrateBox);

    for (const section of state.form.sections) {
      wrap.append(h('h2', { id: sectionId(section) },
        sectionLabel(section), section.beta ? h('span', { class: 'tag' }, 'experimental') : null));
      if (section.grid) for (const node of gridTable()) if (node) wrap.append(node);
      for (const control of section.controls) wrap.append(settingRow(control));
    }

    wrap.append(h('div', { class: 'foot' },
      'This page is drawn from LoopBoard’s own ', h('code', {}, 'contributes.configuration'),
      ' — these are ordinary VSCode settings, so ', h('code', {}, 'settings.json'),
      ' and Settings Sync keep working. Every change here is written to your USER settings.'));

    root.append(h('div', { class: 'page' }, topicList(), wrap));
  }

  vscode.postMessage({ type: 'settingsReady' });
})();
