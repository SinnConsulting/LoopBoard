/* LoopBoard webview. Vanilla JS. Renders the board and speaks the
   field-patch / gate / draft protocol back to the extension. */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();

  // ---- tiny DOM helper ----
  function h(tag, props) {
    const e = document.createElement(tag);
    props = props || {};
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style') Object.assign(e.style, v);
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
  function icon(svg, cls) {
    return h('span', { class: cls || '', html: svg, style: { display: 'inline-flex' } });
  }
  const SVG = {
    plus: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v10M3 8h10" stroke-linecap="round"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8.5l3.2 3.2L13 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    robot: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="10" height="8" rx="1.5"/><path d="M8 5V3" stroke-linecap="round"/><line x1="6" y1="8.5" x2="6" y2="9.5" stroke-linecap="round"/><line x1="10" y1="8.5" x2="10" y2="9.5" stroke-linecap="round"/></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"/></svg>',
    chevron: '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    checkGreen: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--vscode-testing-iconPassed, #73c991)" stroke-width="1.5"><path d="M3 8.5l3.2 3.2L13 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const PHASE_META = [
    { key: 'new', label: 'New', explainer: 'Proposed tasks — approve to move into the Backlog' },
    { key: 'backlog', label: 'Backlog', explainer: 'Approved and waiting for a worker' },
    { key: 'inprogress', label: 'In Progress', explainer: 'Being worked right now' },
    { key: 'feedback', label: 'Feedback', explainer: 'The worker is blocked on your answers' },
    { key: 'review', label: 'Review', explainer: 'Finished work — tick to accept' },
    { key: 'done', label: 'Done', explainer: 'Accepted work, read-only archive' },
  ];

  // ---- state ----
  const saved = vscode.getState() || {};
  let board = null;
  let phase = saved.phase || 'new';
  let composerOpen = false;
  let composerText = '';
  let composerGroomer = ''; // '' = default model
  let composerModel = '';   // '' = default model
  const ui = {}; // per-task UI state, keyed by task id
  let toasts = [];
  let toastSeq = 1;
  let lastSyncTs = Date.now();
  let flashSet = new Set(); // task ids to flash on next render
  let pendingBoard = null;

  function getUi(id) {
    if (!ui[id]) ui[id] = {};
    return ui[id];
  }
  function saveState() {
    vscode.setState({ phase });
  }
  function post(msg) {
    vscode.postMessage(msg);
  }
  function pushToast(level, text, action) {
    const id = toastSeq++;
    toasts.push({ id, level, text, action });
    render();
    setTimeout(() => dismissToast(id), level === 'warning' ? 8000 : 4000);
  }
  function dismissToast(id) {
    toasts = toasts.filter((t) => t.id !== id);
    render();
  }

  function isEditing() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.closest('#root');
  }

  // ---- attention ----
  function phaseAttention(key) {
    if (!board) return false;
    const list = board.phases[key] || [];
    if (key === 'new') return list.some((t) => !t.isDraft);
    if (key === 'feedback') return list.some((t) => t.questions.some((q) => !q.answered));
    if (key === 'review') return list.length > 0;
    return false;
  }

  // ---- field patch helper ----
  function sendPatch(taskId, field, value, base, questionIndex) {
    if (value === base) return; // no-op
    post({ type: 'patch', patch: { taskId, field, value, base, questionIndex } });
  }

  // ============ RENDER ============
  function render() {
    const root = document.getElementById('root');
    const scrollPane = root.querySelector('.pane');
    const scrollTop = scrollPane ? scrollPane.scrollTop : 0;
    root.textContent = '';
    if (!board) {
      root.append(h('div', { class: 'pane-inner muted' }, 'Loading TODO.md…'));
      return;
    }
    root.append(renderTopbar(), renderPane(scrollTop), renderToasts());
    // Textareas can only measure their scrollHeight once attached to the DOM.
    requestAnimationFrame(() => {
      root.querySelectorAll('textarea.desc, textarea.field').forEach(autoGrow);
    });
  }

  function renderTopbar() {
    const bar = h('div', { class: 'topbar' });
    bar.append(h('div', { class: 'tb-heading' },
      h('div', { class: 'rail-title' }, 'TODO — ' + board.workspaceName),
      h('div', { class: 'rail-sync', id: 'sync-line' }, syncText())));

    const tabs = h('div', { class: 'tabs' });
    for (const meta of PHASE_META) {
      const selected = phase === meta.key && !composerOpen;
      const count = (board.phases[meta.key] || []).length;
      const tab = h('button', {
        class: 'tab' + (selected ? ' selected' : '') + (meta.key === 'done' ? ' done-tab' : ''),
        type: 'button',
        'aria-current': selected ? 'true' : 'false',
        onclick: () => { phase = meta.key; composerOpen = false; saveState(); render(); },
      });
      tab.append(h('span', { class: 'tab-label' }, meta.label));
      if (phaseAttention(meta.key)) {
        tab.append(h('span', { class: 'attn-dot pulse' }));
        tab.append(h('span', { class: 'sr-only' }, 'needs your attention'));
      }
      tab.append(h('span', { class: 'phase-count' }, String(count)));
      tabs.append(tab);
    }
    bar.append(tabs);

    bar.append(h('button', { class: 'btn-primary tb-new', type: 'button', onclick: () => { composerOpen = true; composerText = ''; composerGroomer = ''; composerModel = ''; render(); } },
      icon(SVG.plus), 'New story'));
    return bar;
  }

  function renderPane(scrollTop) {
    const pane = h('div', { class: 'pane' });
    const inner = h('div', { class: 'pane-inner' });
    if (board.todoMissing) {
      inner.append(h('div', { class: 'pane-title' }, 'No TODO.md yet'));
      inner.append(h('div', { class: 'pane-explainer' }, 'This workspace has no tracker. Create the initial TODO.md and DONE.md to get started.'));
      inner.append(h('button', { class: 'btn-primary', type: 'button', style: { width: 'auto', padding: '0 16px' }, onclick: () => post({ type: 'createFiles' }) },
        'Create TODO.md & DONE.md'));
    } else if (composerOpen) {
      inner.append(renderComposer());
    } else {
      const meta = PHASE_META.find((m) => m.key === phase);
      inner.append(h('div', { class: 'pane-title' }, meta.label));
      inner.append(h('div', { class: 'pane-explainer' }, meta.explainer));
      if (phase === 'done') {
        inner.append(renderDone());
      } else {
        const cards = h('div', { class: 'cards' });
        const list = board.phases[phase] || [];
        if (list.length === 0) inner.append(h('div', { class: 'muted-11' }, 'Nothing here.'));
        for (const t of list) cards.append(t.isDraft ? renderDraft(t) : renderCard(t));
        inner.append(cards);
      }
    }
    pane.append(inner);
    requestAnimationFrame(() => { pane.scrollTop = scrollTop; });
    return pane;
  }

  function renderComposer() {
    const area = h('textarea', {
      class: 'composer-area', rows: '10',
      placeholder: 'Describe the story in your own words — goal, context, anything you know. An agent will structure it into title, description and tasks.',
      oninput: (e) => { composerText = e.target.value; saveBtn.disabled = composerText.trim().length === 0; },
    });
    area.value = composerText;
    // Groomer + worker model selectors ('' = default model), mirroring the card selects.
    const modelSelect = (label, value, onchange) => {
      const sel = h('select', { class: 'model-select', 'aria-label': label });
      for (const opt of ['default (opus)', 'opus', 'sonnet', 'fable']) {
        const o = h('option', { value: opt }, opt);
        if (opt === (value || 'default (opus)')) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', (e) => onchange(e.target.value === 'default (opus)' ? '' : e.target.value));
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
        h('span', { class: 'muted-11' }, label), sel);
    };
    const saveBtn = h('button', {
      class: 'btn-primary', type: 'button', disabled: composerText.trim().length === 0, style: { width: 'auto', padding: '8px 16px' },
      onclick: () => { const t = composerText.trim(); if (!t) return; post({ type: 'createDraft', text: t, groomer: composerGroomer, model: composerModel }); composerOpen = false; composerText = ''; composerGroomer = ''; composerModel = ''; phase = 'new'; saveState(); render(); },
    }, 'Save draft');
    return h('div', {},
      h('div', { class: 'composer-header' }, 'New story'),
      h('div', { class: 'pane-explainer' }, 'Describe the story in your own words — an agent structures it for you.'),
      area,
      h('div', { class: 'composer-actions' },
        saveBtn,
        h('button', { class: 'btn-secondary', type: 'button', onclick: () => { composerOpen = false; composerText = ''; composerGroomer = ''; composerModel = ''; render(); } }, 'Cancel'),
        modelSelect('Groom with', composerGroomer, (v) => { composerGroomer = v; }),
        modelSelect('Model', composerModel, (v) => { composerModel = v; }),
        h('span', { class: 'muted-11' }, 'Saved into the New column as a draft. No formatting needed.'))
    );
  }

  function renderDone() {
    const wrap = h('div', {});
    const list = board.phases.done || [];
    for (const t of list) {
      const u = getUi(t.id);
      const hasDetail = !!((t.description && t.description.trim()) || (t.delivered && t.delivered.trim()));
      const row = h('div', { class: 'done-row-item' },
        icon(SVG.checkGreen),
        h('span', { class: 'done-title' }, t.title.replace(/^\[x\]\s*/, '')),
        h('span', { class: 'chip mono', style: { background: 'none', opacity: 1, padding: 0 } }, t.completed || ''));
      if (t.links && t.links.length) row.append(linkAnchor(t.links[0]));
      if (hasDetail) {
        row.append(h('button', {
          class: 'icon-btn done-chevron' + (u.doneOpen ? ' open' : ''), type: 'button',
          'aria-expanded': u.doneOpen ? 'true' : 'false',
          'aria-label': u.doneOpen ? 'Collapse details' : 'Expand details',
          title: u.doneOpen ? 'Collapse details' : 'Expand details',
          onclick: () => { u.doneOpen = !u.doneOpen; render(); },
        }, icon(SVG.chevron)));
      }
      wrap.append(row);
      if (hasDetail && u.doneOpen) {
        const detail = h('div', { class: 'done-detail' });
        if (t.delivered && t.delivered.trim()) {
          detail.append(h('div', {}, h('div', { class: 'section-title' }, 'Delivered'),
            h('div', { class: 'done-detail-text' }, t.delivered)));
        }
        if (t.description && t.description.trim()) {
          const desc = h('div', { class: 'done-detail-text', html: mdToHtml(t.description) });
          desc.querySelectorAll('a[data-mdlink]').forEach((a) => {
            a.addEventListener('click', (e) => { e.preventDefault(); post({ type: 'openLink', url: a.getAttribute('data-mdlink') }); });
          });
          detail.append(h('div', {}, h('div', { class: 'section-title' }, 'Description'), desc));
        }
        wrap.append(detail);
      }
    }
    wrap.append(h('div', { class: 'muted-11', style: { padding: '12px 0' } }, 'Showing last 50'));
    return wrap;
  }

  function linkAnchor(url) {
    const label = prLabel(url);
    return h('a', { class: 'link', href: '#', onclick: (e) => { e.preventDefault(); post({ type: 'openLink', url }); } }, label + ' ↗');
  }
  function prLabel(url) {
    const m = String(url).match(/(\d+)(?:\/?$)/);
    if (/\/pull\/|\/pr\/|#/.test(url) && m) return '#' + m[1];
    if (m && url.length > 24) return '#' + m[1];
    return url.length > 28 ? url.slice(0, 26) + '…' : url;
  }

  function renderDraft(t) {
    const u = getUi(t.id);
    let textEl;
    if (u.editingDraft) {
      const ta = h('textarea', { class: 'field draft-edit', rows: '2', 'aria-label': 'Edit draft text' });
      ta.value = u.draftText != null ? u.draftText : t.title;
      autoGrow(ta);
      ta.addEventListener('input', () => { u.draftText = ta.value; autoGrow(ta); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { u.editingDraft = false; u.draftText = null; render(); } });
      ta.addEventListener('blur', () => {
        if (!u.editingDraft) return;
        u.editingDraft = false;
        sendPatch(t.id, 'title', (u.draftText != null ? u.draftText : t.title).trim(), t.title);
        u.draftText = null;
      });
      textEl = ta;
      requestAnimationFrame(() => ta.focus());
    } else {
      textEl = h('button', { class: 'draft-text draft-text-btn', type: 'button', title: 'Click to edit',
        onclick: () => { u.editingDraft = true; u.draftText = t.title; render(); } }, t.title);
    }
    // "Groom with" selector: which model expands this draft into a story (absent = default).
    const groomVal = t.groomer || 'default (opus)';
    const groomSel = h('select', { class: 'model-select', 'aria-label': 'Groom with' });
    for (const opt of ['default (opus)', 'opus', 'sonnet', 'fable']) {
      const o = h('option', { value: opt }, opt);
      if (opt === groomVal) o.selected = true;
      groomSel.append(o);
    }
    const normGroom = (v) => (v === 'default (opus)' ? '' : v);
    groomSel.addEventListener('change', (e) => sendPatch(t.id, 'groomer', normGroom(e.target.value), t.groomer || ''));

    return h('div', { class: 'card draft', 'data-task': t.id },
      t._flash ? h('div', { class: 'flash-overlay flash' }) : null,
      h('div', { class: 'card-head' },
        icon(SVG.robot, 'muted'),
        h('div', { style: { flex: '1' } },
          h('div', { class: 'draft-head-row', style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { class: 'draft-badge' }, 'Draft'),
            h('span', { class: 'muted-11' }, 'the loop will structure this into a story')),
          textEl,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' } },
            h('span', { class: 'muted-11' }, 'Groom with'),
            groomSel),
          h('div', { class: 'muted-11', style: { marginTop: '8px' } }, 'added ' + (t.added || ''))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete draft', title: 'Delete draft', onclick: () => post({ type: 'gate', taskId: t.id, action: 'delete' }) }, icon(SVG.x))));
  }

  function renderCard(t) {
    const u = getUi(t.id);
    const variant = t.phase;
    let cls = 'card';
    if (variant === 'feedback') cls += ' feedback';
    else if (variant === 'review') cls += ' review';
    if (u.conflict) cls += ' conflict';
    const card = h('div', { class: cls, 'data-task': t.id });
    if (t._flash) card.append(h('div', { class: 'flash-overlay flash' }));

    // head: title, model select
    const head = h('div', { class: 'card-head' });

    const titleWrap = h('div', { class: 'card-title-wrap' });
    if (u.editingTitle) {
      const input = h('input', { class: 'card-title-input', type: 'text' });
      input.value = u.titleDraft != null ? u.titleDraft : t.title;
      input.addEventListener('input', (e) => { u.titleDraft = e.target.value; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { u.editingTitle = false; render(); } });
      input.addEventListener('blur', () => { if (!u.editingTitle) return; u.editingTitle = false; sendPatch(t.id, 'title', (u.titleDraft != null ? u.titleDraft : t.title).trim(), t.title); });
      titleWrap.append(input);
      requestAnimationFrame(() => input.focus());
    } else {
      titleWrap.append(h('button', { class: 'card-title', type: 'button', onclick: () => { u.editingTitle = true; u.titleDraft = t.title; render(); } }, t.title));
    }
    head.append(titleWrap);

    const modelVal = t.model || 'default (opus)';
    const sel = h('select', { class: 'model-select', 'aria-label': 'Model' });
    for (const opt of ['default (opus)', 'opus', 'sonnet', 'fable']) {
      const o = h('option', { value: opt }, opt);
      if (opt === modelVal) o.selected = true;
      sel.append(o);
    }
    // Store represents "no model" as ''; map the display value 'default (opus)' to '' so
    // base matches the on-disk value and we don't trip a false conflict.
    const normModel = (v) => (v === 'default (opus)' ? '' : v);
    sel.addEventListener('change', (e) => sendPatch(t.id, 'model', normModel(e.target.value), t.model || ''));
    head.append(sel);
    if (variant === 'new') {
      head.append(h('button', {
        class: 'btn-sm primary approve-btn', type: 'button',
        'aria-label': 'Approve — moves to Backlog', title: 'Approve — moves to Backlog',
        onclick: () => { card.style.opacity = '0'; setTimeout(() => post({ type: 'gate', taskId: t.id, action: 'promote' }), 150); },
      }, icon(SVG.check), 'Approve'));
    }
    card.append(head);

    // chips
    card.append(renderChips(t));

    // unparsed
    if (t.unparsedLines) {
      const btn = h('button', { class: 'chip button', type: 'button', onclick: () => { u.unparsedOpen = !u.unparsedOpen; render(); } },
        t.unparsedLines.length + ' unparsed line' + (t.unparsedLines.length === 1 ? '' : 's'), icon(SVG.chevron));
      const chipRow = card.querySelector('.chips');
      chipRow.append(btn);
      if (u.unparsedOpen) {
        card.append(h('div', { class: 'unparsed-box' },
          h('div', { class: 'unparsed-text' }, t.unparsedLines.join('\n')),
          h('div', { class: 'unparsed-help' }, 'Kept verbatim in TODO.md — edit the file directly to fix them.')));
      }
    }

    // description
    card.append(renderDescription(t));

    // working indicator
    if (variant === 'inprogress') {
      card.append(h('div', { class: 'working' }, h('span', { class: 'loop-dot on pulse' }), (t.owner || 'Worker') + ' is on it · last activity today'));
    }

    // questions: Feedback always; New too, when the groomer left open decisions
    if (variant === 'feedback' || (variant === 'new' && t.questions && t.questions.length)) card.append(renderQuestions(t));

    // review blocks
    if (variant === 'review') card.append(renderReview(t));

    // note
    card.append(renderNote(t));

    // accept gate (Rule 1): single Approve button, bottom-right
    if (variant === 'review') {
      card.append(h('div', { class: 'approve-row' },
        h('button', {
          class: 'btn-sm primary approve-btn', type: 'button',
          'aria-label': 'Approve — accept and archive to DONE.md', title: 'Approve — accept and archive to DONE.md',
          onclick: () => { card.style.opacity = '0'; setTimeout(() => post({ type: 'gate', taskId: t.id, action: 'accept' }), 150); },
        }, icon(SVG.check), 'Approve')));
    }
    return card;
  }

  function renderChips(t) {
    const chips = h('div', { class: 'chips' });
    if (t.owner) chips.append(h('span', { class: 'chip owner' }, icon(SVG.robot), t.owner));
    else chips.append(h('span', { class: 'chip unassigned' }, 'unassigned'));
    if (t.added) chips.append(h('span', { class: 'chip mono' }, 'added ' + t.added));
    if (t.started) chips.append(h('span', { class: 'chip mono' }, 'started ' + t.started));
    if (t.worklog && t.worklog.length) {
      chips.append(h('span', { class: 'chip mono help', title: t.worklog.join(', ') }, t.worklog.length + ' active day' + (t.worklog.length === 1 ? '' : 's')));
    }
    for (const link of t.links || []) chips.append(linkAnchor(link));
    for (const dep of t.dependsOn || []) {
      chips.append(h('span', { class: 'chip dep' + (dep.met ? '' : ' unmet') }, 'depends on ' + dep.id + (dep.met ? ' ✓' : ' ⚠')));
    }
    return chips;
  }

  // ---- minimal, XSS-clean markdown for descriptions ----
  // Supports **bold**, *italic*/_italic_, `code`, [text](http(s)://url), line breaks.
  // All user text is HTML-escaped first, so the only tags in the output are the ones we emit;
  // link hrefs are limited to http/https and carried on data-mdlink (wired to openLink on render).
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function renderInlineMd(text) {
    // `text` is already HTML-escaped. Links first, then bold, then italic.
    let out = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
      /^https?:\/\//i.test(url) ? '<a href="#" data-mdlink="' + url + '">' + label + '</a>' : m);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    return out;
  }
  function mdToHtml(src) {
    const escaped = escapeHtml(src);
    const html = escaped.split(/(`[^`]+`)/).map((p) =>
      p.length >= 2 && p[0] === '`' && p[p.length - 1] === '`'
        ? '<code>' + p.slice(1, -1) + '</code>'
        : renderInlineMd(p)).join('');
    // Markdown soft-wrap: a single newline is a soft wrap (space) so hard-wrapped source flows to
    // the full card width; a blank line is a paragraph break (<br><br>).
    return html
      .replace(/\n{2,}/g, '<br><br>')
      .replace(/\n/g, ' ');
  }

  function renderDescription(t) {
    const u = getUi(t.id);
    const wrap = h('div', { class: 'desc-wrap' });
    if (u.editingDesc) {
      const ta = h('textarea', { class: 'desc', rows: '2', placeholder: 'Add a description…' });
      ta.value = t.description || '';
      autoGrow(ta);
      ta.addEventListener('input', () => autoGrow(ta));
      ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { u.editingDesc = false; render(); } });
      ta.addEventListener('blur', () => { if (!u.editingDesc) return; u.editingDesc = false; sendPatch(t.id, 'description', ta.value, t.description || ''); render(); });
      wrap.append(ta);
      requestAnimationFrame(() => ta.focus());
    } else {
      const hasDesc = !!(t.description && t.description.trim());
      const view = hasDesc
        ? h('div', { class: 'desc-rendered', role: 'button', tabindex: '0', html: mdToHtml(t.description) })
        : h('div', { class: 'desc-rendered desc-empty', role: 'button', tabindex: '0' }, 'Add a description…');
      view.addEventListener('click', () => { u.editingDesc = true; render(); });
      view.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); u.editingDesc = true; render(); } });
      view.querySelectorAll('a[data-mdlink]').forEach((a) => {
        a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); post({ type: 'openLink', url: a.getAttribute('data-mdlink') }); });
      });
      wrap.append(view);
    }
    return wrap;
  }

  function renderQuestions(t) {
    // Shared by Feedback and New cards; only the copy differs (nothing "resumes" on a New card —
    // answers there guide grooming/promotion instead of unblocking a paused worker).
    const isNew = t.phase === 'new';
    const wrap = h('div', { class: 'qa-list' });
    let answered = 0;
    t.questions.forEach((q, i) => {
      if (q.answered) answered++;
      const block = h('div', {});
      block.append(h('div', { class: 'question' }, h('span', {}, '❓'), h('span', { style: { fontSize: '13px', lineHeight: '1.5' } }, q.text)));
      const aw = h('div', { class: 'answer-wrap' });
      const ta = h('textarea', { class: 'field', rows: '2', placeholder: isNew
        ? 'Type your answer — it guides how this story is groomed and executed.'
        : 'Type your answer — the worker resumes when every question is answered.' });
      ta.value = q.answer;
      autoGrow(ta);
      ta.addEventListener('input', () => autoGrow(ta));
      ta.addEventListener('blur', () => sendPatch(t.id, 'answer', ta.value, q.answer, i));
      aw.append(ta);
      if (q.answered) aw.append(h('div', { class: 'answered' }, icon(SVG.check), 'answered'));
      block.append(aw);
      wrap.append(block);
    });
    wrap.append(h('div', { class: 'progress' }, isNew
      ? `${answered} of ${t.questions.length} questions answered.`
      : `${answered} of ${t.questions.length} questions answered — worker resumes at ${t.questions.length} of ${t.questions.length}.`));
    return wrap;
  }

  function renderReview(t) {
    const wrap = h('div', { class: 'review-block' });
    if (t.delivered) {
      wrap.append(h('div', {}, h('div', { class: 'section-title' }, 'Delivered'), h('div', { style: { fontSize: '13px', lineHeight: '1.5' } }, t.delivered)));
    }
    if (t.feedback) {
      wrap.append(h('div', { class: 'amber-block' },
        h('div', { class: 'amber-label' }, 'Your pending feedback'),
        h('div', { style: { fontSize: '13px', lineHeight: '1.5' } }, '⚠️ ' + t.feedback)));
    }
    const ta = h('textarea', { class: 'field', rows: '2', placeholder: 'Write review feedback…' });
    ta.value = '';
    autoGrow(ta);
    ta.addEventListener('input', () => autoGrow(ta));
    ta.addEventListener('blur', () => { if (ta.value.trim()) sendPatch(t.id, 'feedback', ta.value.trim(), t.feedback || ''); });
    wrap.append(h('div', {}, ta, h('div', { class: 'helper' }, 'Writing feedback sends the task back to In Progress.')));
    return wrap;
  }

  function renderNote(t) {
    const u = getUi(t.id);
    const wrap = h('div', { class: 'note-wrap' });
    if (u.noteOpen) {
      const ta = h('textarea', { class: 'field', rows: '2', placeholder: "Instruction for the worker's next pass…" });
      ta.value = u.noteDraft || '';
      ta.addEventListener('input', (e) => { u.noteDraft = e.target.value; });
      wrap.append(ta);
      wrap.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' } },
        h('button', { class: 'btn-sm primary', type: 'button', onclick: () => { const d = (u.noteDraft || '').trim(); if (!d) return; u.noteOpen = false; u.noteDraft = ''; sendPatch(t.id, 'note', d, t.note || ''); } }, 'Send'),
        h('span', { class: 'muted-11' }, 'The worker applies this instruction on its next pass, then removes the note.')));
    } else if (t.note) {
      wrap.append(h('div', { class: 'note-chip' },
        h('span', {}, 'Note: ⏳ ' + t.note),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Retract note', title: 'Retract note', style: { width: '20px', height: '20px' }, onclick: () => sendPatch(t.id, 'note', '', t.note) }, icon(SVG.x))));
    } else {
      wrap.append(h('button', { class: 'link-btn', type: 'button', onclick: () => { u.noteOpen = true; render(); } }, '＋ Note to worker'));
    }
    return wrap;
  }

  function renderToasts() {
    const wrap = h('div', { class: 'toasts' });
    for (const t of toasts) {
      const el = h('div', { class: 'toast ' + t.level, role: 'status' }, h('span', {}, t.text));
      if (t.action) el.append(h('button', { class: 'toast-action', type: 'button', onclick: t.action.onClick }, t.action.label));
      el.append(h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', style: { width: '20px', height: '20px' }, onclick: () => dismissToast(t.id) }, icon(SVG.x)));
      wrap.append(el);
    }
    return wrap;
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 34) + 'px';
  }

  function syncText() {
    const secs = Math.round((Date.now() - lastSyncTs) / 1000);
    return 'last synced ' + secs + 's ago';
  }
  setInterval(() => {
    const el = document.getElementById('sync-line');
    if (el) el.textContent = syncText();
  }, 1000);

  // ---- inbound messages ----
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'board') {
      const prev = board;
      const incoming = msg.board;
      // Flag changed cards for the refresh flash.
      flashSet = computeChanged(prev, incoming);
      if (isEditing()) {
        pendingBoard = incoming;
        return;
      }
      applyBoard(incoming);
    } else if (msg.type === 'toast') {
      if (msg.taskId) { getUi(msg.taskId).conflict = true; setTimeout(() => { getUi(msg.taskId).conflict = false; render(); }, 3000); }
      const action = msg.taskId ? { label: 'Review', onClick: () => { revealTask(msg.taskId); } } : null;
      pushToast(msg.level, msg.text, action);
    } else if (msg.type === 'reveal') {
      revealTask(msg.taskId, msg.phase);
    }
  });

  function applyBoard(incoming) {
    // A freshly applied board supersedes any board that was deferred while editing;
    // otherwise the stale snapshot gets flushed on the next focusout and clobbers newer state.
    pendingBoard = null;
    board = incoming;
    lastSyncTs = Date.now();
    // Attach transient flash flags.
    for (const key in board.phases) for (const t of board.phases[key]) t._flash = flashSet.has(t.id);
    render();
    // Clear flash flags after the animation.
    if (flashSet.size) setTimeout(() => { for (const key in board.phases) for (const t of board.phases[key]) t._flash = false; }, 650);
  }

  function computeChanged(prev, next) {
    const changed = new Set();
    if (!prev) return changed;
    const index = {};
    for (const key in prev.phases) for (const t of prev.phases[key]) index[t.id] = JSON.stringify(stripFlash(t));
    for (const key in next.phases) for (const t of next.phases[key]) {
      const before = index[t.id];
      if (before && before !== JSON.stringify(stripFlash(t))) changed.add(t.id);
    }
    return changed;
  }
  function stripFlash(t) { const { _flash, ...rest } = t; return rest; }

  function revealTask(taskId, targetPhase) {
    if (!board) return;
    let found = targetPhase;
    if (!found) {
      for (const key in board.phases) if ((board.phases[key] || []).some((t) => t.id === taskId)) { found = key; break; }
    }
    if (found) { phase = found; composerOpen = false; saveState(); }
    getUi(taskId).conflict = true;
    render();
    setTimeout(() => {
      const el = document.querySelector('[data-task="' + taskId + '"]');
      if (el) el.scrollIntoView({ block: 'center' });
    }, 30);
    setTimeout(() => { getUi(taskId).conflict = false; render(); }, 3000);
  }

  // Apply a deferred board once the user stops editing.
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (pendingBoard && !isEditing()) { const b = pendingBoard; pendingBoard = null; applyBoard(b); }
    }, 50);
  });

  render();
  post({ type: 'ready' });
})();
