/* LoopBoard's own settings page (t-sgrp). Vanilla JS, no framework.

   This file draws NOTHING of its own: the host derives the whole form from the extension's
   `contributes.configuration` (src/settingsform.ts) plus the hand-built model grid
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
      apply({ form: msg.form, grid: msg.grid, extensionId: msg.extensionId, problem: msg.problem });
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

  // ---- the one hand-built block: the model grid ----
  function gridTable() {
    const grid = state.grid;
    const head = h('tr', {},
      h('th', { class: 'left' }, 'Slot'), h('th', {}, 'on'), h('th', {}, 'worker'), h('th', {}, 'groomer'),
      h('th', { class: 'left' }, '--model'), h('th', {}, 'effort'), h('th', {}, 'groomers'));
    const body = h('tbody', {});

    for (const row of grid.rows) {
      const modelInput = h('input', {
        type: 'text', value: row.model, placeholder: 'default', 'aria-label': row.label + ' --model string',
      });
      const modelError = h('div', { class: 'err' }, errors[row.id + '/model'] || '');
      modelInput.addEventListener('input', () => {
        const bad = modelInput.value.trim() !== '' && !VALID_MODEL.test(modelInput.value.trim());
        modelInput.classList.toggle('invalid', bad);
        modelError.textContent = bad
          ? 'not a valid --model string — it would be ignored and ' + row.id + ' spawned instead'
          : '';
      });
      modelInput.addEventListener('change', () => gridEdit(row.id, 'model', modelInput.value));

      const effort = h('select', { 'aria-label': row.label + ' effort ceiling' });
      for (const level of grid.efforts) {
        effort.append(h('option', { value: level, selected: level === row.effort }, level));
      }
      effort.addEventListener('change', () => gridEdit(row.id, 'effort', effort.value));

      const groomers = h('input', {
        type: 'number', min: '1', value: String(row.groomConcurrency),
        'aria-label': row.label + ' grooming concurrency',
      });
      groomers.addEventListener('change', () => gridEdit(row.id, 'groomConcurrency', Number(groomers.value)));

      body.append(h('tr', { class: row.enabled ? '' : 'disabled' },
        h('td', { class: 'left always' }, h('span', { class: 'slot' }, row.label)),
        h('td', { class: 'always' }, toggle(row.enabled, row.label + ' slot enabled', (v) => gridEdit(row.id, 'enabled', v))),
        h('td', {}, h('button', {
          class: 'radio', type: 'button', role: 'radio', 'aria-checked': row.worker ? 'true' : 'false',
          'aria-label': row.label + ' is the default worker',
          onclick: () => gridEdit(row.id, 'worker', true),
        })),
        h('td', {}, h('button', {
          class: 'radio', type: 'button', role: 'radio', 'aria-checked': row.groomer ? 'true' : 'false',
          'aria-label': row.label + ' is the default groomer',
          onclick: () => gridEdit(row.id, 'groomer', true),
        })),
        h('td', { class: 'left model' }, modelInput, modelError),
        h('td', {}, effort),
        h('td', {}, groomers)));
    }

    const slotErrors = ['enabled', 'worker', 'groomer', 'effort', 'groomConcurrency']
      .flatMap((field) => grid.rows.map((r) => errors[r.id + '/' + field]))
      .filter(Boolean);

    return [
      h('div', { class: 'grid-head' },
        h('span', { class: 'subtle' }, 'Which slots exist, who they spawn, and how hard they think.'),
        // Same marker as a `restart` row's: the grid stands in for those rows, so it must not say
        // their fact in a second voice. `grid.note` names the three columns it covers.
        appliesMarker(grid.note)),
      h('table', {}, h('thead', {}, head), body),
      slotErrors.length ? h('div', { class: 'err' }, slotErrors[0]) : null,
    ];
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
      h('button', {
        class: 'btn', type: 'button',
        title: 'Open the same settings in VSCode’s own Settings editor',
        onclick: () => vscode.postMessage({ type: 'openNativeSettings' }),
      }, 'Open in VSCode Settings')));
    wrap.append(h('div', { class: 'subtle' },
      'All LoopBoard settings are global (user) settings — they are not configurable per repository.'));

    if (state.problem) wrap.append(h('div', { class: 'banner' }, state.problem));

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
