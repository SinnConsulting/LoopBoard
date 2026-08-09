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
    check: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8.5l3.2 3.2L13 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    robot: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="10" height="8" rx="1.5"/><path d="M8 5V3" stroke-linecap="round"/><line x1="6" y1="8.5" x2="6" y2="9.5" stroke-linecap="round"/><line x1="10" y1="8.5" x2="10" y2="9.5" stroke-linecap="round"/></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"/></svg>',
    chevron: '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    undo: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4v4h4M4 8a5 5 0 1 1 1.5 3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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
  // Composer draft is persisted in vscode state (same blob as `phase`) so it survives the webview
  // being hidden/recreated on tab/window switch (retainContextWhenHidden is false) — see t-ntx1.
  let composerOpen = !!saved.composerOpen;
  let composerText = saved.composerText || '';
  let composerGroomer = saved.composerGroomer || ''; // '' = default model
  let composerModel = saved.composerModel || '';     // '' = default model
  let composerNeedsFocus = false;
  let composerCaret = null; // caret offset to restore into the composer textarea after a repaint
  // Pending composer attachments (t-att1 rework): a brand-new story has no id to stage bytes
  // under, so pasted/dropped images are held here ({token, filename, dataBase64}); pasting
  // inserts `[filename](loopboard-pending:<n>)` at the caret so the reference sits in the story
  // text, and Save Draft stages the bytes and rewrites each placeholder to the real cache path
  // (host-side) — pasting never auto-saves the draft anymore.
  // Deliberately NOT persisted via saveState: base64 image payloads can exceed the webview
  // state budget; pending images live only as long as the webview does.
  let composerAttachments = [];
  const ui = {}; // per-task UI state, keyed by task id
  // Collapse state: `collapsedDefault` covers cards with no explicit entry (so global
  // collapse-all/expand-all applies to future cards too); `collapsed` holds per-card overrides
  // set by the per-card toggle. Persisted via vscode.getState/setState (same blob as `phase`).
  let collapsedDefault = !!saved.collapsedDefault;
  let collapsed = Object.assign({}, saved.collapsed);
  let toasts = [];
  let toastSeq = 1;
  let lastSyncTs = Date.now();
  let flashSet = new Set(); // task ids to flash on next render
  let pendingBoard = null;
  let pendingRender = false; // an async/external repaint deferred while a field is focused
  // Local in-tab search (Cmd/Ctrl+F while the board webview is focused): filters ONLY the current
  // tab's cards by id/title/description — no cross-phase search, no next/prev nav (filter-only).
  // The bar is always visible and cannot be dismissed — searchOpen stays true forever.
  let searchOpen = true;
  let searchQuery = '';
  let searchNeedsFocus = false; // refocus the search input after the next full repaint
  let searchCaret = null;       // caret offset to restore into the search input

  function getUi(id) {
    if (!ui[id]) ui[id] = {};
    return ui[id];
  }
  function saveState() {
    vscode.setState({ phase, collapsedDefault, collapsed, composerOpen, composerText, composerGroomer, composerModel });
  }

  // ---- collapse/expand ----
  function isCollapsed(id) {
    return Object.prototype.hasOwnProperty.call(collapsed, id) ? collapsed[id] : collapsedDefault;
  }
  function toggleCollapse(id) {
    collapsed[id] = !isCollapsed(id);
    saveState();
    render();
  }
  function collapseAll() {
    collapsedDefault = true;
    collapsed = {};
    saveState();
    render();
  }
  function expandAll() {
    collapsedDefault = false;
    collapsed = {};
    saveState();
    render();
  }
  function post(msg) {
    vscode.postMessage(msg);
  }
  function pushToast(level, text, action, iconName) {
    const id = toastSeq++;
    toasts.push({ id, level, text, action, icon: iconName });
    scheduleRender();
    setTimeout(() => dismissToast(id), level === 'warning' ? 8000 : 4000);
  }
  function dismissToast(id) {
    toasts = toasts.filter((t) => t.id !== id);
    scheduleRender();
  }

  function isEditing() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && el.closest('#root');
  }

  // Repaints from async/external events (toasts, conflict-clear timers) must not wipe a field the
  // user is mid-typing in — a full render() does `root.textContent = ''`. Defer them while editing;
  // the focusout handler flushes the pending one. Synchronous user-initiated renders (tab switch,
  // click-to-edit, Escape-to-close, blur) stay immediate — they call render() directly.
  function scheduleRender() {
    if (isEditing()) { pendingRender = true; return; }
    render();
  }

  // ---- local in-tab search ----
  function matchesQuery(t) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (t.id || '').toLowerCase().includes(q)
      || (t.title || '').toLowerCase().includes(q)
      || (t.description || '').toLowerCase().includes(q);
  }
  function filterList(list) {
    return searchQuery.trim() ? list.filter(matchesQuery) : list;
  }
  function openSearch() {
    if (!board || board.todoMissing || composerOpen) return;
    searchOpen = true;
    searchNeedsFocus = true;
    searchCaret = searchQuery.length;
    render();
  }
  // Reset without rendering — for callers (tab switch, reveal) that render themselves. The search
  // bar itself is always on; this only clears the typed query when leaving the current tab.
  function resetSearch() {
    searchQuery = '';
    searchNeedsFocus = false;
    searchCaret = null;
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

  // ---- model select options (data-driven from the board's enabled model list) ----
  // The leading "default (<model>)" option maps to '' (no explicit model:); the rest are the
  // enabled model slots the extension sends in board.models. Disabled slots simply don't appear.
  // The leading "default (<model>)" label differs by select: worker-model selects show the default
  // WORKER model, groomer selects show the default GROOMER model (the two settings are independent).
  function defaultOpt(model) { return 'default (' + (model || 'opus') + ')'; }
  function workerDefaultOpt() { return defaultOpt(board && board.defaultWorkerModel); }
  function groomerDefaultOpt() { return defaultOpt(board && board.defaultGroomerModel); }
  function modelOptions(leadOpt) { return [leadOpt].concat((board && board.models) || []); }
  function normModelValue(v, leadOpt) { return v === leadOpt ? '' : v; }

  // ---- field patch helper ----
  function sendPatch(taskId, field, value, base, questionIndex) {
    if (value === base) return; // no-op
    post({ type: 'patch', patch: { taskId, field, value, base, questionIndex } });
  }

  // Explicit-save model (Rule: no field patches on blur or on typing) — every editable field
  // commits only via its Save button or this Cmd/Ctrl+S shortcut while the field is focused.
  function isSaveShortcut(e) {
    return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S');
  }

  // ============ RENDER ============
  function render() {
    const root = document.getElementById('root');
    const scrollPane = root.querySelector('.pane');
    const scrollTop = scrollPane ? scrollPane.scrollTop : 0;
    // Capture which card field (and its caret) held focus BEFORE the wipe, so a repaint that lands
    // mid-edit can put focus + caret back afterward instead of blurring the field / jumping the caret.
    const activeField = captureActiveField();
    root.textContent = '';
    if (!board) {
      root.append(h('div', { class: 'pane-inner muted' }, 'Loading…'));
      return;
    }
    root.append(renderTopbar(), renderPane(scrollTop), renderToasts());
    // Textareas can only measure their scrollHeight once attached to the DOM.
    requestAnimationFrame(() => {
      root.querySelectorAll('textarea.desc, textarea.field').forEach(autoGrow);
    });
    // A full repaint drops focus; restore it to the search box so typing a query is uninterrupted.
    if (searchOpen && searchNeedsFocus) {
      searchNeedsFocus = false;
      requestAnimationFrame(() => {
        const si = document.getElementById('search-input');
        if (!si) return;
        si.focus();
        if (searchCaret != null) { try { si.setSelectionRange(searchCaret, searchCaret); } catch (e) { /* ignore */ } }
      });
    } else if (activeField) {
      // Same idea for a card field: any render() caller (loop write, toast, conflict-clear, reveal)
      // is now safe to fire while a field is focused — focus + caret return to that same field.
      requestAnimationFrame(() => restoreActiveField(activeField));
    }
    // Focus the composer textarea on open so an immediate Cmd/Ctrl+V paste (before the user
    // clicks into it) lands on it — clipboard paste only fires on the focused element (t-att1
    // feedback: pasting right after "New Story" did nothing since nothing was focused yet).
    if (composerOpen && composerNeedsFocus) {
      composerNeedsFocus = false;
      const caret = composerCaret;
      composerCaret = null;
      requestAnimationFrame(() => {
        const ta = document.querySelector('.composer-area');
        if (!ta) return;
        ta.focus();
        // Restore the caret after a paste-triggered repaint so typing continues right after
        // the just-inserted link instead of jumping to the end.
        if (caret != null) { try { ta.setSelectionRange(caret, caret); } catch (e) { /* detached */ } }
      });
    }
  }

  // ---- generic focus/caret restore across a full repaint ----
  // render() rebuilds #root from scratch (`textContent = ''`), which drops DOM focus and the text
  // caret. captureActiveField() records the focused card field by task id + field name (+ question
  // index for answers) and its selection; restoreActiveField() looks the field back up after the
  // rebuild and restores focus + caret. Generalises the search-input restore above so mid-edit
  // repaints never blur a card field or move its caret. Cards carry `data-task`; each editable
  // input/textarea carries `data-field` (+ `data-qindex` for per-question answers).
  function captureActiveField() {
    const el = document.activeElement;
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return null;
    const field = el.getAttribute('data-field');
    if (!field) return null;
    const card = el.closest('[data-task]');
    if (!card) return null;
    let start = null;
    let end = null;
    try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* ignore */ }
    return { taskId: card.getAttribute('data-task'), field, qindex: el.getAttribute('data-qindex'), start, end };
  }
  function restoreActiveField(a) {
    let sel = '[data-task="' + a.taskId + '"] [data-field="' + a.field + '"]';
    if (a.qindex != null) sel += '[data-qindex="' + a.qindex + '"]';
    const el = document.querySelector(sel);
    if (!el) return;
    el.focus();
    if (a.start != null) { try { el.setSelectionRange(a.start, a.end); } catch (e) { /* ignore */ } }
  }

  // Deterministic Escape-to-close+blur for editors that toggle between a "view" and an editing
  // textarea/input (description, title, draft, note). Blurring BEFORE render() matters: render()'s
  // captureActiveField() reads document.activeElement at the very start, still pointing at the
  // about-to-be-removed field if we haven't blurred yet — so it recaptures a field that edit mode
  // just closed, and restoreActiveField() then either re-opens it or (since the post-close view has
  // no `data-field`) silently no-ops, leaving focus stranded on the now-tabindex=0 view element
  // instead of released — the "needs a second ESC" bug (t-esc1). Blurring first means
  // captureActiveField() finds nothing to recapture.
  function exitFieldEdit(clearFn) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    clearFn();
    render();
  }

  function renderSearchBar(shownCount, totalCount) {
    const input = h('input', {
      class: 'search-input', id: 'search-input', type: 'text', 'aria-label': 'Filter tasks in this tab',
      placeholder: 'Filter this tab by id, title or description…',
    });
    input.value = searchQuery;
    input.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      searchCaret = e.target.selectionStart;
      searchNeedsFocus = true;
      render();
    });
    const count = searchQuery.trim()
      ? h('span', { class: 'search-count muted-11' }, shownCount + ' of ' + totalCount + ' match' + (shownCount === 1 ? '' : 'es'))
      : h('span', { class: 'search-count muted-11' }, 'Searching this tab');
    return h('div', { class: 'search-bar' }, input, count);
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
        onclick: () => { phase = meta.key; composerOpen = false; resetSearch(); saveState(); render(); },
      });
      tab.append(h('span', { class: 'codicon codicon-split-horizontal tab-icon' }));
      tab.append(h('span', { class: 'tab-label' }, meta.label));
      if (phaseAttention(meta.key)) {
        tab.append(h('span', { class: 'attn-dot pulse' }));
        tab.append(h('span', { class: 'sr-only' }, 'needs your attention'));
      }
      tab.append(h('span', { class: 'phase-count' }, String(count)));
      tabs.append(tab);
    }
    bar.append(tabs);

    bar.append(h('button', {
      class: 'btn-secondary tb-collapse-all', type: 'button',
      onclick: () => (collapsedDefault ? expandAll() : collapseAll()),
    }, collapsedDefault ? 'Expand all' : 'Collapse all'));

    // Reopen the composer WITHOUT clearing its draft: a non-empty composerText only ever survives
    // as a genuinely-unsaved draft (Cancel and Save draft both reset it), so wiping here would lose
    // text the user typed before switching phase tabs and clicking New Story again — see t-ntx1.
    // composerNeedsFocus stays set so the textarea auto-focuses on open (t-att1), letting an
    // immediate paste land on it.
    bar.append(h('button', { class: 'btn-primary tb-new', type: 'button', onclick: () => { composerOpen = true; composerNeedsFocus = true; resetSearch(); saveState(); render(); } },
      'New Story'));
    return bar;
  }

  function renderPane(scrollTop) {
    const pane = h('div', { class: 'pane' });
    const inner = h('div', { class: 'pane-inner' });
    if (board.todoMissing) {
      inner.append(h('div', { class: 'pane-title' }, 'No LoopBoard workspace yet'));
      inner.append(h('div', { class: 'pane-explainer' }, 'This workspace has no .loopboard/ tracker. Initialize it to scaffold TODO.md, LOOP.md and tasks/ and get started.'));
      inner.append(h('button', { class: 'btn-primary', type: 'button', style: { width: 'auto', padding: '0 16px' }, onclick: () => post({ type: 'createFiles' }) },
        'Initialize LoopBoard workspace'));
    } else if (composerOpen) {
      inner.append(renderComposer());
    } else {
      const meta = PHASE_META.find((m) => m.key === phase);
      inner.append(h('div', { class: 'pane-title' }, meta.label));
      inner.append(h('div', { class: 'pane-explainer' }, meta.explainer));
      const full = board.phases[phase] || [];
      const list = filterList(full);
      if (searchOpen) inner.append(renderSearchBar(list.length, full.length));
      if (phase === 'done') {
        inner.append(renderDone(list));
      } else {
        const cards = h('div', { class: 'cards' });
        if (full.length === 0) inner.append(h('div', { class: 'muted-11' }, 'Nothing here.'));
        else if (list.length === 0) inner.append(h('div', { class: 'muted-11' }, 'No matches in this tab for “' + searchQuery.trim() + '”.'));
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
      oninput: (e) => { composerText = e.target.value; saveBtn.disabled = composerText.trim().length === 0; saveState(); },
    });
    area.value = composerText;
    // Groomer + worker model selectors ('' = default model), mirroring the card selects.
    const modelSelect = (label, value, defOpt, onchange) => {
      const sel = h('select', { class: 'model-select', 'aria-label': label });
      for (const opt of modelOptions(defOpt)) {
        const o = h('option', { value: opt }, opt);
        if (opt === (value || defOpt)) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', (e) => onchange(normModelValue(e.target.value, defOpt)));
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
        h('span', { class: 'muted-11' }, label), sel);
    };
    const closeComposer = () => { composerOpen = false; composerText = ''; composerGroomer = ''; composerModel = ''; composerAttachments = []; phase = 'new'; resetSearch(); saveState(); render(); };
    // Committing on pointerdown (not click) beats a mid-gesture board refresh that tears the button
    // down via render()'s `root.textContent = ''` — waiting for `click` risks it being swallowed
    // when the composer textarea is unfocused (see t-d3dd). onclick stays wired for keyboard
    // (Enter/Space) activation, which dispatches a synthetic click with no pointerdown.
    const commitDraft = () => {
      const t = composerText.trim();
      if (!t) return;
      if (composerAttachments.length) {
        post({
          type: 'createDraftWithAttach', text: t, groomer: composerGroomer, model: composerModel,
          attachments: composerAttachments.map((a) => ({ token: a.token, filename: a.filename, dataBase64: a.dataBase64 })),
        });
      } else {
        post({ type: 'createDraft', text: t, groomer: composerGroomer, model: composerModel });
      }
      closeComposer();
    };
    const saveBtn = h('button', {
      class: 'btn-primary', type: 'button', disabled: composerText.trim().length === 0, style: { width: 'auto', padding: '8px 16px' },
      onpointerdown: (e) => { e.preventDefault(); commitDraft(); },
      onclick: commitDraft,
    }, 'Save Draft');
    // t-att1 rework: pasting/dropping an image no longer auto-saves the draft (that ended the
    // typing flow mid-thought). The image is held in memory, `[filename](loopboard-pending:<n>)`
    // is inserted at the caret so the reference sits in the story text where you're typing, and
    // Save Draft stages the bytes and rewrites the placeholder to the real cache path host-side
    // (no id/path exists before the draft is saved). The list below the textarea carries a
    // remove × per pending image, which also strips its placeholder from the text.
    const addPendingAttachment = (file) => {
      readImageFile(file, (filename, dataBase64) => {
        const token = 'loopboard-pending:' + attachReqSeq++;
        insertLinkAtCursor(area, '[' + filename + '](' + token + ')');
        composerText = area.value;
        composerAttachments.push({ token, filename, dataBase64 });
        composerNeedsFocus = true; // render() rebuilds the textarea — hand focus back so typing continues
        composerCaret = area.selectionStart;
        saveState();
        render();
      });
    };
    area.addEventListener('dragover', (e) => e.preventDefault());
    area.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) { e.preventDefault(); addPendingAttachment(files[0]); }
    });
    area.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.indexOf('image/') === 0) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); addPendingAttachment(file); }
          break;
        }
      }
    });
    const pendingEl = composerAttachments.length === 0 ? null : h('div', { style: { marginTop: '8px' } },
      h('div', { class: 'muted-11', style: { marginBottom: '4px' } }, 'Attachments'),
      composerAttachments.map((a, i) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' } },
        h('span', { class: 'muted-11' }, a.filename),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Remove attachment', title: 'Remove attachment',
          onclick: () => {
            // Strip the placeholder link from the text too, so a discarded image leaves no trace.
            composerText = composerText.split('[' + a.filename + '](' + a.token + ')').join('').replace(/[ \t]{2,}/g, ' ');
            composerAttachments.splice(i, 1);
            saveState();
            render();
          },
        }, icon(SVG.x)))));
    return h('div', {},
      h('div', { class: 'composer-header' }, 'New story'),
      h('div', { class: 'pane-explainer' }, 'Describe the story in your own words — an agent structures it for you.'),
      area,
      pendingEl,
      h('div', { class: 'composer-actions' },
        saveBtn,
        h('button', { class: 'btn-secondary', type: 'button', onclick: () => { composerOpen = false; composerText = ''; composerGroomer = ''; composerModel = ''; composerAttachments = []; saveState(); render(); } }, 'Cancel'),
        modelSelect('Groom with', composerGroomer, groomerDefaultOpt(), (v) => { composerGroomer = v; saveState(); }),
        modelSelect('Work with', composerModel, workerDefaultOpt(), (v) => { composerModel = v; saveState(); }),
        h('span', { class: 'muted-11' }, 'Saved into the New column as a draft. No formatting needed.'))
    );
  }

  function renderDone(list) {
    const wrap = h('div', {});
    if (list.length === 0 && searchQuery.trim()) {
      wrap.append(h('div', { class: 'muted-11' }, 'No matches in this tab for “' + searchQuery.trim() + '”.'));
      return wrap;
    }
    for (const t of list) {
      const u = getUi(t.id);
      const hasDetail = !!((t.description && t.description.trim()) || (t.delivered && t.delivered.trim()));
      const toggleOpen = () => { u.doneOpen = !u.doneOpen; render(); };
      const row = h('div', {
        class: 'done-row-item' + (hasDetail ? ' clickable' : ''),
        onclick: hasDetail ? toggleOpen : undefined,
      },
        icon(SVG.checkGreen),
        h('span', { class: 'done-title' }, t.title.replace(/^\[x\]\s*/, '')),
        idChip(t.id),
        h('span', { class: 'chip mono', style: { background: 'none', opacity: 1, padding: 0 } }, t.completed || ''));
      if (t.links && t.links.length) row.append(linkAnchor(t.links[0]));
      if (hasDetail) {
        row.append(h('button', {
          class: 'icon-btn done-chevron' + (u.doneOpen ? ' open' : ''), type: 'button',
          'aria-expanded': u.doneOpen ? 'true' : 'false',
          'aria-label': u.doneOpen ? 'Collapse details' : 'Expand details',
          title: u.doneOpen ? 'Collapse details' : 'Expand details',
          onclick: (e) => { e.stopPropagation(); toggleOpen(); },
        }, icon(SVG.chevron)));
      }
      // Delete an accepted row from the archive (distinct path: removes only the DONE.md line).
      row.append(h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Delete from archive', title: 'Delete from archive',
        onclick: (e) => { e.stopPropagation(); post({ type: 'gate', taskId: t.id, action: 'deleteDone' }); },
      }, icon(SVG.x)));
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

  function idChip(id) {
    return h('button', {
      class: 'chip mono id', type: 'button', title: 'Copy ' + id, 'aria-label': 'Copy task id ' + id,
      onclick: (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(id).then(() => pushToast('info', 'Copied ' + id));
      },
    }, id);
  }

  function linkAnchor(url) {
    const label = prLabel(url);
    return h('a', { class: 'link', href: '#', onclick: (e) => { e.preventDefault(); e.stopPropagation(); post({ type: 'openLink', url }); } }, label + ' ', h('span', { class: 'codicon codicon-link-external' }));
  }
  function prLabel(url) {
    const m = String(url).match(/(\d+)(?:\/?$)/);
    if (/\/pull\/|\/pr\/|#/.test(url) && m) return '#' + m[1];
    if (m && url.length > 24) return '#' + m[1];
    return url.length > 28 ? url.slice(0, 26) + '…' : url;
  }

  function renderDraft(t) {
    const u = getUi(t.id);
    const isCollapsedCard = isCollapsed(t.id);
    let textEl;
    if (u.editingDraft) {
      const ta = h('textarea', { class: 'field draft-edit', rows: '2', 'aria-label': 'Edit draft text' });
      ta.value = u.draftText != null ? u.draftText : t.title;
      autoGrow(ta);
      const commitDraft = () => {
        const val = ta.value.trim();
        u.editingDraft = false;
        u.draftText = null;
        sendPatch(t.id, 'title', val, t.title);
        render();
      };
      const saveBtn = h('button', {
        class: 'btn-sm primary field-save-btn', type: 'button',
        disabled: ta.value.trim() === t.title,
        title: 'Save (Cmd/Ctrl+S)', onclick: commitDraft,
      }, 'Save');
      ta.addEventListener('input', () => { u.draftText = ta.value; autoGrow(ta); saveBtn.disabled = ta.value.trim() === t.title; });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { exitFieldEdit(() => { u.editingDraft = false; u.draftText = null; }); return; }
        if (isSaveShortcut(e)) { e.preventDefault(); commitDraft(); }
      });
      // t-att1 rework: no caret-insert into the raw draft text (links crammed into the title made
      // it unreadable) — a paste/drop while editing bubbles to the card handler, which stages the
      // image into the description, so it shows in the attachments area like everywhere else.
      textEl = h('div', { class: 'field-col' }, ta, saveBtn);
      // One-shot: only grab focus when the editor first opens — refocusing on every render
      // re-selects the card after the user already clicked outside (t-att1 feedback).
      if (u.draftNeedsFocus) { u.draftNeedsFocus = false; requestAnimationFrame(() => ta.focus()); }
    } else {
      textEl = h('button', { class: 'draft-text draft-text-btn', type: 'button', title: 'Click to edit',
        onclick: () => { u.editingDraft = true; u.draftText = t.title; u.draftNeedsFocus = true; render(); } }, t.title);
    }
    // "Groom with" selector: which model expands this draft into a story (absent = default).
    const groomDefOpt = groomerDefaultOpt();
    const groomVal = t.groomer || groomDefOpt;
    const groomSel = h('select', { class: 'model-select', 'aria-label': 'Groom with' });
    for (const opt of modelOptions(groomDefOpt)) {
      const o = h('option', { value: opt }, opt);
      if (opt === groomVal) o.selected = true;
      groomSel.append(o);
    }
    groomSel.addEventListener('change', (e) => sendPatch(t.id, 'groomer', normModelValue(e.target.value, groomDefOpt), t.groomer || ''));

    // Draft attachments (t-att1): a drop/paste on a draft stages image bytes and appends their
    // markdown links to the draft's task-file ## Description; the shared attachments area lists
    // them with an open link and a remove × each.
    const attachEl = renderAttachmentsArea(t);

    let cls = 'card draft';
    if (isCollapsedCard) cls += ' collapsed';

    const card = h('div', { class: cls, 'data-task': t.id },
      t._flash ? h('div', { class: 'flash-overlay flash' }) : null,
      h('div', { class: 'card-head' },
        h('button', {
          class: 'icon-btn collapse-toggle', type: 'button',
          'aria-expanded': isCollapsedCard ? 'false' : 'true',
          'aria-label': isCollapsedCard ? 'Expand draft' : 'Collapse draft',
          title: isCollapsedCard ? 'Expand draft' : 'Collapse draft',
          onclick: () => toggleCollapse(t.id),
        }, icon(SVG.chevron)),
        icon(SVG.robot, 'muted'),
        h('div', { style: { flex: '1' } },
          h('div', { class: 'draft-head-row', style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { class: 'draft-badge' }, 'Draft'),
            idChip(t.id),
            h('span', { class: 'muted-11' }, 'the loop will structure this into a story')),
          isCollapsedCard ? null : textEl,
          isCollapsedCard ? null : attachEl,
          isCollapsedCard ? null : h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' } },
            h('span', { class: 'muted-11' }, 'Groom with'),
            groomSel),
          isCollapsedCard ? null : h('div', { class: 'muted-11', style: { marginTop: '8px' } }, 'added ' + (t.added || ''))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete draft', title: 'Delete draft', onclick: () => post({ type: 'gate', taskId: t.id, action: 'delete' }) }, icon(SVG.x))));
    wireAttachDropAndPaste(card, t.id);
    return card;
  }

  // ---- attachments (t-att1): drag-drop / clipboard paste only, no attach button — read bytes in
  // the webview and base64-encode them for postMessage (the only path bytes can cross that
  // boundary). v1 scope is images only. A whole-card drop/paste (no field open) appends straight
  // to Description (attachFile/wireAttachDropAndPaste below); a drop/paste inside an
  // already-open Description, answer, or draft-text field instead folds the link into that
  // field's own value (wireFieldAttach, below) so it saves through the normal field-patch path.
  const ATTACH_MIME_EXT = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
  };
  // Read an image File/Blob to {filename, dataBase64}, or null (with a toast) if it isn't one.
  function readImageFile(file, cb) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      pushToast('warning', 'Only image attachments are supported.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return;
      const filename = file.name && file.name.trim() ? file.name : ('pasted-image.' + (ATTACH_MIME_EXT[file.type] || 'png'));
      cb(filename, dataUrl.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  }
  function attachFile(taskId, file) {
    readImageFile(file, (filename, dataBase64) => {
      const reqId = 'a' + attachReqSeq++;
      pendingAttach[reqId] = (msg) => applyAttachedMirror(taskId, msg);
      post({ type: 'attach', reqId, taskId, filename, dataBase64 });
    });
  }
  // Whole-card attach (t-att1 feedback): the host's board refresh is deferred while any field is
  // focused, so apply the store's post-append text locally and repaint just this card — the
  // attachment shows immediately instead of after the next outside click. The text comes from
  // the host verbatim; the store is the single owner of the append format. Full cards carry
  // their links in `description`; drafts carry them in the raw draft text (`title`).
  function findBoardTask(taskId) {
    if (!board) return null;
    for (const key in board.phases) for (const t of board.phases[key]) if (t.id === taskId) return t;
    return null;
  }
  function applyAttachedMirror(taskId, msg) {
    const t = findBoardTask(taskId);
    if (!t) return;
    if (typeof msg.description !== 'string' && typeof msg.title !== 'string') { scheduleRender(); return; }
    if (typeof msg.description === 'string') t.description = msg.description;
    if (typeof msg.title === 'string') t.title = msg.title;
    repaintCard(t);
  }
  function repaintCard(t) {
    const old = document.querySelector('[data-task="' + t.id + '"]');
    if (!old) { scheduleRender(); return; }
    const active = document.activeElement;
    let restore = null;
    if (active && active.tagName === 'TEXTAREA' && old.contains(active)) {
      restore = {
        field: active.getAttribute('data-field') || (active.classList.contains('draft-edit') ? 'draft' : null),
        qindex: active.getAttribute('data-qindex'),
        start: active.selectionStart,
        end: active.selectionEnd,
      };
    }
    const fresh = t.isDraft ? renderDraft(t) : renderCard(t);
    old.replaceWith(fresh);
    if (!restore || !restore.field) return;
    const sel = restore.field === 'draft' ? 'textarea.draft-edit'
      : restore.qindex != null ? 'textarea[data-field="answer"][data-qindex="' + restore.qindex + '"]'
      : 'textarea[data-field="' + restore.field + '"]';
    const ta = fresh.querySelector(sel);
    if (ta) { ta.focus(); try { ta.setSelectionRange(restore.start, restore.end); } catch (e) { /* detached */ } }
  }
  function wireAttachDropAndPaste(card, taskId) {
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) attachFile(taskId, files[0]);
    });
    card.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.indexOf('image/') === 0) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); attachFile(taskId, file); }
          break;
        }
      }
    });
  }

  // Field-scoped attach (t-att1 feedback: description edits and question answers — "story
  // comments" — need the same drag-drop/paste attach, folded into that specific field's own
  // value rather than always the Description). Stages the bytes via the host, then the caller's
  // `onStaged(path, filename)` inserts the link and saves through the normal field-patch path.
  let attachReqSeq = 1;
  const pendingAttach = {};
  // Insert at the caret (replacing any selection), padded with single spaces so the link lands
  // inline where the user is typing — not appended at the end (t-att1 feedback).
  function insertLinkAtCursor(ta, link) {
    const v = ta.value;
    const start = ta.selectionStart != null ? ta.selectionStart : v.length;
    const end = ta.selectionEnd != null ? ta.selectionEnd : start;
    const before = v.slice(0, start);
    const after = v.slice(end);
    const pre = before && !/\s$/.test(before) ? ' ' : '';
    const post = after && !/^\s/.test(after) ? ' ' : '';
    ta.value = before + pre + link + post + after;
    const caret = before.length + pre.length + link.length;
    ta.setSelectionRange(caret, caret);
  }
  function wireFieldAttach(el, taskId, field, questionIndex, onStaged) {
    const stage = (file) => {
      readImageFile(file, (filename, dataBase64) => {
        const reqId = 'a' + attachReqSeq++;
        pendingAttach[reqId] = (msg) => onStaged(msg.path, msg.filename);
        post({ type: 'attach', reqId, taskId, filename, dataBase64, field, questionIndex });
      });
    };
    el.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) { e.preventDefault(); e.stopPropagation(); stage(files[0]); }
    });
    el.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.indexOf('image/') === 0) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); e.stopPropagation(); stage(file); }
          break;
        }
      }
    });
  }

  // Attachments area (t-att1 rework): a consistent block on drafts and full cards listing every
  // staged `.loopboard/cache/...` link found in the description — click opens the file, the ×
  // on the right deletes it from the story AND the cache folder (store-owned `detach`).
  function extractAttachments(description) {
    const items = [];
    const re = /\[([^\]]+)\]\((\.loopboard\/cache\/[^)\s]+)\)/g;
    let m;
    // Label with the on-disk filename (path basename), not the link label — dedupe may have
    // renamed the staged file (image.png → image-2.png) and the area must show the real name.
    while ((m = re.exec(String(description || ''))) !== null) items.push({ label: m[2].split('/').pop(), path: m[2] });
    return items;
  }
  function detachAttachment(taskId, path) {
    const reqId = 'a' + attachReqSeq++;
    pendingAttach[reqId] = (msg) => applyAttachedMirror(taskId, msg);
    post({ type: 'detach', reqId, taskId, path });
  }
  function renderAttachmentsArea(t) {
    // Drafts carry their links in the raw draft text (title); scan the description too for
    // drafts staged before the rework (legacy).
    const items = extractAttachments(t.isDraft ? (t.title || '') + '\n' + (t.description || '') : t.description);
    if (!items.length) return null;
    return h('div', { style: { marginTop: '8px' } },
      h('div', { class: 'muted-11', style: { marginBottom: '4px' } }, 'Attachments'),
      items.map((it) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' } },
        h('a', {
          href: '#', 'data-mdlink': it.path,
          onclick: (e) => { e.preventDefault(); e.stopPropagation(); post({ type: 'openLink', url: it.path }); },
        }, it.label),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Delete attachment', title: 'Delete attachment (removes the file and its link)',
          onclick: () => detachAttachment(t.id, it.path),
        }, icon(SVG.x)))));
  }

  function renderCard(t) {
    const u = getUi(t.id);
    const variant = t.phase;
    const isCollapsedCard = isCollapsed(t.id);
    let cls = 'card';
    if (variant === 'feedback') cls += ' feedback';
    else if (variant === 'review') cls += ' review';
    if (u.conflict) cls += ' conflict';
    if (isCollapsedCard) cls += ' collapsed';
    const card = h('div', { class: cls, 'data-task': t.id });
    if (t._flash) card.append(h('div', { class: 'flash-overlay flash' }));

    // head: collapse toggle, title, model select
    const head = h('div', { class: 'card-head' });

    head.append(h('button', {
      class: 'icon-btn collapse-toggle', type: 'button',
      'aria-expanded': isCollapsedCard ? 'false' : 'true',
      'aria-label': isCollapsedCard ? 'Expand card' : 'Collapse card',
      title: isCollapsedCard ? 'Expand card' : 'Collapse card',
      onclick: () => toggleCollapse(t.id),
    }, icon(SVG.chevron)));

    head.append(h('span', { class: 'codicon codicon-project card-type-icon' }));

    const titleWrap = h('div', { class: 'card-title-wrap' });
    if (u.editingTitle) {
      const input = h('input', { class: 'card-title-input', type: 'text', 'aria-label': 'Title', 'data-field': 'title' });
      input.value = u.titleDraft != null ? u.titleDraft : t.title;
      const commitTitle = () => {
        const val = input.value.trim();
        u.editingTitle = false;
        u.titleDraft = null;
        sendPatch(t.id, 'title', val, t.title);
        render();
      };
      const saveBtn = h('button', {
        class: 'btn-sm primary field-save-btn', type: 'button',
        disabled: input.value.trim() === t.title,
        title: 'Save (Cmd/Ctrl+S)', 'aria-label': 'Save title', onclick: commitTitle,
      }, 'Save');
      input.addEventListener('input', (e) => { u.titleDraft = e.target.value; saveBtn.disabled = e.target.value.trim() === t.title; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { exitFieldEdit(() => { u.editingTitle = false; u.titleDraft = null; }); return; }
        if (isSaveShortcut(e)) { e.preventDefault(); commitTitle(); }
      });
      titleWrap.append(h('div', { class: 'field-row' }, input, saveBtn));
      requestAnimationFrame(() => input.focus());
    } else {
      titleWrap.append(h('button', { class: 'card-title', type: 'button', onclick: () => { u.editingTitle = true; u.titleDraft = t.title; render(); } }, t.title));
    }
    head.append(titleWrap);

    const modelDefOpt = workerDefaultOpt();
    const modelVal = t.model || modelDefOpt;
    const sel = h('select', { class: 'model-select', 'aria-label': 'Model' });
    for (const opt of modelOptions(modelDefOpt)) {
      const o = h('option', { value: opt }, opt);
      if (opt === modelVal) o.selected = true;
      sel.append(o);
    }
    // Store represents "no model" as ''; map the display "default (<model>)" value to '' so
    // base matches the on-disk value and we don't trip a false conflict.
    sel.addEventListener('change', (e) => sendPatch(t.id, 'model', normModelValue(e.target.value, modelDefOpt), t.model || ''));
    head.append(sel);
    if (variant === 'new') {
      head.append(h('button', {
        class: 'btn-sm primary approve-btn', type: 'button',
        'aria-label': 'Approve — moves to Backlog', title: 'Approve — moves to Backlog',
        onclick: () => {
          // Unanswered questions mean the host may pop a confirm modal before promoting (Rule 1's
          // override guard) — fading the card immediately would hide it behind that dialog and
          // then un-hide it on cancel, which reads as a confusing flicker. Only fade optimistically
          // on the zero-friction path (no unanswered questions), where promotion is unconditional;
          // otherwise wait for the host's outcome to arrive via the next board refresh.
          if (t.questions.some((q) => !q.answered)) {
            post({ type: 'gate', taskId: t.id, action: 'promote' });
          } else {
            card.style.opacity = '0';
            setTimeout(() => post({ type: 'gate', taskId: t.id, action: 'promote' }), 150);
          }
        },
      }, icon(SVG.check), 'Approve'));
    }
    // Demote (Backlog -> New, third board action alongside promote/accept — CLAUDE.md
    // Non-negotiable #5): Backlog cards only, an active/owned task must never be yankable out
    // from under a worker. Fires immediately (no confirm modal, non-destructive/reversible) and
    // does NOT fade the card optimistically — a race-refused demote (the store re-checks the
    // on-disk phase) would otherwise flicker on the refresh that restores it.
    if (variant === 'backlog') {
      head.append(h('button', {
        class: 'btn-sm primary demote-btn', type: 'button',
        'aria-label': 'Demote — moves back to New', title: 'Demote — moves back to New',
        onclick: () => post({ type: 'gate', taskId: t.id, action: 'demote' }),
      }, icon(SVG.undo), 'Demote'));
    }
    // Accept gate (Rule 1) in the header row, matching New's Approve / Backlog's Demote —
    // visible even collapsed since `head` always renders (see the removed bottom .approve-row).
    if (variant === 'review') {
      head.append(h('button', {
        class: 'btn-sm primary approve-btn', type: 'button',
        'aria-label': 'Approve — accept and archive to DONE.md', title: 'Approve — accept and archive to DONE.md',
        onclick: () => { card.style.opacity = '0'; setTimeout(() => post({ type: 'gate', taskId: t.id, action: 'accept' }), 150); },
      }, icon(SVG.check), 'Approve'));
    }
    // Delete affordance on every editable-phase card (renderCard is only ever used for non-Done
    // phases). The extension shows a native confirmation modal before removing anything.
    head.append(h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete task', title: 'Delete task', onclick: () => post({ type: 'gate', taskId: t.id, action: 'delete' }) }, icon(SVG.x)));
    card.append(head);
    wireAttachDropAndPaste(card, t.id);

    // chips (always shown, even collapsed)
    card.append(renderChips(t));

    if (!isCollapsedCard) {
      // no detail file yet (task file is created lazily on the first detail edit / loop write)
      if (!t.hasDetailFile) {
        card.append(h('div', { class: 'muted-11', style: { marginTop: '6px' } }, 'No detail file yet — tasks/' + t.id + '.md is created on the first edit.'));
      }

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

      // attachments area (t-att1 rework: same block as on drafts, with per-image delete)
      const attArea = renderAttachmentsArea(t);
      if (attArea) card.append(attArea);

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
    }

    return card;
  }

  function renderChips(t) {
    const chips = h('div', { class: 'chips' });
    chips.append(idChip(t.id));
    if (t.owner) chips.append(h('span', { class: 'chip owner' }, icon(SVG.robot), t.owner));
    else chips.append(h('span', { class: 'chip unassigned' }, 'unassigned'));
    if (t.added) chips.append(h('span', { class: 'chip mono' }, 'added ' + t.added));
    if (t.started) chips.append(h('span', { class: 'chip mono' }, 'started ' + t.started));
    if (t.worklog && t.worklog.length) {
      chips.append(h('span', { class: 'chip mono help', title: t.worklog.join(', ') }, t.worklog.length + ' active day' + (t.worklog.length === 1 ? '' : 's')));
    }
    for (const link of t.links || []) chips.append(linkAnchor(link));
    for (const dep of t.dependsOn || []) {
      chips.append(h('button', {
        class: 'chip dep' + (dep.met ? '' : ' unmet'), type: 'button',
        title: 'Go to ' + dep.id, 'aria-label': 'Go to ' + dep.id,
        onclick: () => {
          const exists = board && Object.values(board.phases || {}).some((list) => (list || []).some((c) => c.id === dep.id));
          if (!exists) { pushToast('warning', dep.id + ' not found'); return; }
          revealTask(dep.id);
        },
      }, 'depends on ' + dep.id + ' ', h('span', { class: 'codicon codicon-' + (dep.met ? 'check' : 'warning') })));
    }
    return chips;
  }

  // ---- minimal, XSS-clean markdown for descriptions ----
  // Supports **bold**, *italic*/_italic_, `code`, [text](http(s)://url), line breaks.
  // All user text is HTML-escaped first, so the only tags in the output are the ones we emit;
  // link hrefs are limited to http/https or a staged-attachment `.loopboard/cache/...` relative
  // path (t-att1), carried on data-mdlink (wired to openLink on render).
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function renderInlineMd(text) {
    // `text` is already HTML-escaped. Links first, then bold, then italic.
    let out = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
      /^https?:\/\//i.test(url) || url.startsWith('.loopboard/cache/') ? '<a href="#" data-mdlink="' + url + '">' + label + '</a>' : m);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    return out;
  }
  // Inline pass for a single block's text (heading, list item, or paragraph run). `text` is raw
  // user input: escape FIRST, then MASK `code` spans as index tokens so emphasis delimiters can
  // pair across a code span (e.g. **`x`**), run the inline renderer, then restore the chips — so
  // code content is never emphasis-processed and the only tags reaching the DOM are the ones we
  // emit (escape-first XSS invariant). Index-based restore keeps that invariant: a forged token
  // can only ever restore to an already-escaped <code> chip, never inject raw HTML.
  function renderInline(text) {
    const codes = [];
    const masked = escapeHtml(text).replace(/`[^`]+`/g, (m) => {
      codes.push(m.slice(1, -1));
      return '\x00' + (codes.length - 1) + '\x00';
    });
    return renderInlineMd(masked).replace(/\x00(\d+)\x00/g, (m, i) =>
      codes[i] !== undefined ? '<code>' + codes[i] + '</code>' : m);
  }
  // Block-level pass: classifies each line as an ATX heading (#..######), an unordered (- / *) or
  // ordered (1.) list item, or paragraph text, and delegates each block's content to renderInline.
  // The classifier only inspects RAW markers; user text is always escaped before it lands in a tag.
  // Plain (marker-free) descriptions keep the legacy soft-wrap behaviour: single newline = space,
  // blank line = paragraph break (<br><br>), no <p> wrapper.
  function mdToHtml(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const parts = [];
    let para = [];
    let listType = null;
    let listItems = [];
    const flushPara = () => {
      if (para.length) { parts.push({ t: 'p', html: renderInline(para.join('\n')).replace(/\n/g, ' ') }); para = []; }
    };
    const flushList = () => {
      if (listItems.length) {
        parts.push({ t: 'block', html: '<' + listType + '>'
          + listItems.map((it) => '<li>' + renderInline(it) + '</li>').join('') + '</' + listType + '>' });
        listItems = []; listType = null;
      }
    };
    for (const line of lines) {
      const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
      const ul = /^\s*[-*]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (heading) {
        flushPara(); flushList();
        const level = heading[1].length;
        parts.push({ t: 'block', html: '<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>' });
      } else if (ul || ol) {
        flushPara();
        const type = ul ? 'ul' : 'ol';
        if (listType && listType !== type) flushList();
        listType = type;
        listItems.push(ul ? ul[1] : ol[1]);
      } else if (line.trim() === '') {
        flushList(); flushPara();
      } else {
        flushList(); para.push(line);
      }
    }
    flushPara(); flushList();
    // Assemble: consecutive paragraphs (always blank-line separated) get <br><br>; headings/lists
    // are block elements and rely on their own CSS margins for spacing.
    let html = '';
    let prevWasP = false;
    for (const part of parts) {
      if (part.t === 'p' && prevWasP) html += '<br><br>';
      html += part.html;
      prevWasP = part.t === 'p';
    }
    return html;
  }

  function renderDescription(t) {
    const u = getUi(t.id);
    const wrap = h('div', { class: 'desc-wrap' });
    if (u.editingDesc) {
      const ta = h('textarea', { class: 'desc', rows: '2', placeholder: 'Add a description…', 'data-field': 'description' });
      ta.value = u.descDraft != null ? u.descDraft : (t.description || '');
      autoGrow(ta);
      const commitDesc = () => {
        const val = ta.value;
        u.editingDesc = false;
        u.descDraft = null;
        sendPatch(t.id, 'description', val, t.description || '');
        render();
      };
      const saveBtn = h('button', {
        class: 'btn-sm primary field-save-btn', type: 'button',
        disabled: ta.value === (t.description || ''),
        title: 'Save (Cmd/Ctrl+S)', onclick: commitDesc,
      }, 'Save');
      ta.addEventListener('input', () => { u.descDraft = ta.value; autoGrow(ta); saveBtn.disabled = ta.value === (t.description || ''); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { exitFieldEdit(() => { u.editingDesc = false; u.descDraft = null; }); return; }
        if (isSaveShortcut(e)) { e.preventDefault(); commitDesc(); }
      });
      wireFieldAttach(ta, t.id, 'description', undefined, (path, filename) => {
        insertLinkAtCursor(ta, '[' + filename + '](' + path + ')');
        commitDesc();
      });
      wrap.append(ta, saveBtn);
      // One-shot: only grab focus when the editor first opens — refocusing on every render
      // re-selects the card after the user already clicked outside (t-att1 feedback).
      if (u.descNeedsFocus) { u.descNeedsFocus = false; requestAnimationFrame(() => ta.focus()); }
    } else {
      const hasDesc = !!(t.description && t.description.trim());
      const view = hasDesc
        ? h('div', { class: 'desc-rendered', role: 'button', tabindex: '0', html: mdToHtml(t.description) })
        : h('div', { class: 'desc-rendered desc-empty', role: 'button', tabindex: '0' }, 'Add a description…');
      view.addEventListener('click', () => { u.editingDesc = true; u.descNeedsFocus = true; render(); });
      view.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); u.editingDesc = true; u.descNeedsFocus = true; render(); } });
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
    const u = getUi(t.id);
    if (!u.answerDrafts) u.answerDrafts = {};
    const isNew = t.phase === 'new';
    const wrap = h('div', { class: 'qa-list' });
    let answered = 0;
    let progressEl;
    const progressText = () => isNew
      ? `${answered} of ${t.questions.length} questions answered.`
      : `${answered} of ${t.questions.length} questions answered — worker resumes at ${t.questions.length} of ${t.questions.length}.`;
    // Save All (t-f86b): commits every question whose draft differs from its saved answer, in one
    // click. Enabled whenever at least one question has an unsaved draft — even just one, since
    // the user may reach for Save All after already saving other answers individually (t-623d);
    // it then overlaps that lone question's own per-question Save, which is fine, both do the
    // same thing.
    const commits = [];
    let updateSaveAll = () => {}; // replaced below once the button exists (only when >1 question)
    t.questions.forEach((q, i) => {
      if (q.answered) answered++;
      const block = h('div', {});
      const qText = h('div', { class: 'q-text', html: mdToHtml(q.text) });
      qText.querySelectorAll('a[data-mdlink]').forEach((a) => {
        a.addEventListener('click', (e) => { e.preventDefault(); post({ type: 'openLink', url: a.getAttribute('data-mdlink') }); });
      });
      block.append(h('div', { class: 'question' }, h('span', { class: 'codicon codicon-question' }), qText));
      const aw = h('div', { class: 'answer-wrap' });
      const ta = h('textarea', { class: 'field', 'data-field': 'answer', 'data-qindex': String(i), rows: '2', placeholder: isNew
        ? 'Type your answer — it guides how this story is groomed and executed.'
        : 'Type your answer — the worker resumes when every question is answered.' });
      ta.value = u.answerDrafts[i] != null ? u.answerDrafts[i] : q.answer;
      autoGrow(ta);
      const commitAnswer = () => {
        const val = ta.value;
        sendPatch(t.id, 'answer', val, q.answer, i);
        delete u.answerDrafts[i];
        saveBtn.disabled = true;
        // Targeted in-place update (no render()): a full repaint here would destroy the
        // still-focused textarea/caret, which is exactly what the isEditing()/pendingBoard
        // deferral exists to prevent — see t-2b96.
        const isAnswered = val.trim().length > 0;
        if (isAnswered !== q.answered) {
          q.answered = isAnswered;
          answered += isAnswered ? 1 : -1;
          if (progressEl) progressEl.textContent = progressText();
        }
        const existingChip = aw.querySelector('.answered');
        if (isAnswered && !existingChip) {
          aw.append(h('div', { class: 'answered' }, icon(SVG.check), 'answered'));
        } else if (!isAnswered && existingChip) {
          existingChip.remove();
        }
        updateSaveAll();
      };
      const saveBtn = h('button', {
        class: 'btn-sm primary field-save-btn', type: 'button',
        disabled: ta.value === q.answer,
        title: 'Save (Cmd/Ctrl+S)', onclick: commitAnswer,
      }, 'Save');
      ta.addEventListener('input', () => { u.answerDrafts[i] = ta.value; autoGrow(ta); saveBtn.disabled = ta.value === q.answer; updateSaveAll(); });
      ta.addEventListener('keydown', (e) => {
        // Answer has no separate view mode to close — Escape discards the unsaved draft back to
        // the last-saved answer and releases focus (it was previously a dead key here, t-esc1).
        if (e.key === 'Escape') { ta.value = q.answer; delete u.answerDrafts[i]; autoGrow(ta); saveBtn.disabled = true; updateSaveAll(); ta.blur(); return; }
        if (isSaveShortcut(e)) { e.preventDefault(); commitAnswer(); }
      });
      wireFieldAttach(ta, t.id, 'answer', i, (path, filename) => {
        insertLinkAtCursor(ta, '[' + filename + '](' + path + ')');
        commitAnswer();
      });
      commits.push({ commit: commitAnswer, isDirty: () => ta.value !== q.answer });
      // Groomer suggestions (Rule 14): a clear-cut proposed answer the human can accept with one
      // click, no AI in the loop — accept just fills the textarea and reuses commitAnswer, i.e. the
      // ordinary answer field-patch path (`sendPatch(..., 'answer', ...)`); the writer clears a
      // question's suggestions once it has an answer (merge.ts), so they naturally disappear on the
      // next board refresh.
      if (!q.answered && q.suggestions && q.suggestions.length) {
        const suggWrap = h('div', { class: 'suggestions' });
        q.suggestions.forEach((s) => {
          const acceptSuggestion = () => { ta.value = s + ' accepted'; commitAnswer(); suggWrap.remove(); };
          suggWrap.append(h('div', { class: 'suggestion-row' },
            h('span', { class: 'suggestion-text' }, s),
            h('button', {
              class: 'btn-sm primary suggestion-accept-btn', type: 'button',
              title: 'Accept suggestion', 'aria-label': 'Accept suggestion: ' + s,
              // Commit on pointerdown (not just click): while the search box is focused a background
              // loop refresh queues pendingBoard; waiting for `click` lets the focusout flush fire
              // render()'s `root.textContent=''` and tear this button down before the answer patch
              // posts, so the accept silently no-ops (t-157b feedback). preventDefault also keeps the
              // prior field focused so no focusout flush runs mid-gesture. Same race the composer's
              // Save Draft dodges (t-d3dd); onclick stays wired for keyboard (Enter/Space) activation.
              onpointerdown: (e) => { e.preventDefault(); acceptSuggestion(); },
              onclick: acceptSuggestion,
            }, icon(SVG.check), 'Accept')));
        });
        block.append(suggWrap);
      }
      aw.append(ta, saveBtn);
      if (q.answered) aw.append(h('div', { class: 'answered' }, icon(SVG.check), 'answered'));
      block.append(aw);
      wrap.append(block);
    });
    progressEl = h('div', { class: 'progress' }, progressText());
    wrap.append(progressEl);
    if (t.questions.length > 1) {
      const saveAllBtn = h('button', {
        class: 'btn-sm primary field-save-btn', type: 'button',
        disabled: true,
        title: 'Save every question whose answer changed',
        onclick: () => { commits.filter((c) => c.isDirty()).forEach((c) => c.commit()); updateSaveAll(); },
      }, 'Save All');
      updateSaveAll = function () { saveAllBtn.disabled = commits.filter((c) => c.isDirty()).length < 1; };
      updateSaveAll();
      wrap.append(h('div', { class: 'approve-row' }, saveAllBtn));
    }
    return wrap;
  }

  function renderReview(t) {
    const u = getUi(t.id);
    const wrap = h('div', { class: 'review-block' });
    if (t.delivered) {
      wrap.append(h('div', {}, h('div', { class: 'section-title' }, 'Delivered'), h('div', { style: { fontSize: '13px', lineHeight: '1.5' } }, t.delivered)));
    }
    if (t.feedback) {
      wrap.append(h('div', { class: 'amber-block' },
        h('div', { class: 'amber-label' }, 'Your pending feedback'),
        h('div', { style: { fontSize: '13px', lineHeight: '1.5' } }, h('span', { class: 'codicon codicon-warning' }), ' ' + t.feedback)));
    }
    const ta = h('textarea', { class: 'field', 'data-field': 'feedback', rows: '2', placeholder: 'Write review feedback…' });
    ta.value = u.feedbackDraft || '';
    autoGrow(ta);
    const commitFeedback = () => {
      const val = ta.value.trim();
      if (!val) return;
      sendPatch(t.id, 'feedback', val, t.feedback || '');
      u.feedbackDraft = '';
      ta.value = '';
      saveBtn.disabled = true;
    };
    const saveBtn = h('button', {
      class: 'btn-sm primary field-save-btn', type: 'button',
      disabled: (u.feedbackDraft || '').trim().length === 0,
      title: 'Save (Cmd/Ctrl+S)', onclick: commitFeedback,
    }, 'Save');
    ta.addEventListener('input', () => { u.feedbackDraft = ta.value; autoGrow(ta); saveBtn.disabled = ta.value.trim().length === 0; });
    ta.addEventListener('keydown', (e) => {
      // Feedback has no separate view mode to close — Escape discards the draft (there is no
      // saved value to revert to) and releases focus (previously a dead key here, t-esc1).
      if (e.key === 'Escape') { ta.value = ''; u.feedbackDraft = ''; autoGrow(ta); saveBtn.disabled = true; ta.blur(); return; }
      if (isSaveShortcut(e)) { e.preventDefault(); commitFeedback(); }
    });
    wrap.append(h('div', {}, ta, saveBtn));
    return wrap;
  }

  function renderNote(t) {
    const u = getUi(t.id);
    const wrap = h('div', { class: 'note-wrap' });
    if (u.noteOpen) {
      const ta = h('textarea', { class: 'field', 'data-field': 'note', rows: '2', placeholder: "Instruction for the worker's next pass…" });
      ta.value = u.noteDraft || '';
      const commitNote = () => {
        const d = (u.noteDraft || '').trim();
        if (!d) return;
        u.noteOpen = false;
        u.noteDraft = '';
        sendPatch(t.id, 'note', d, t.note || '');
        render();
      };
      ta.addEventListener('input', (e) => { u.noteDraft = e.target.value; sendBtn.disabled = e.target.value.trim().length === 0; });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { exitFieldEdit(() => { u.noteOpen = false; u.noteDraft = ''; }); return; }
        if (isSaveShortcut(e)) { e.preventDefault(); commitNote(); }
      });
      const sendBtn = h('button', {
        class: 'btn-sm primary', type: 'button', disabled: (u.noteDraft || '').trim().length === 0,
        title: 'Send (Cmd/Ctrl+S)', onclick: commitNote,
      }, 'Send');
      wrap.append(ta);
      wrap.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' } },
        sendBtn,
        h('span', { class: 'muted-11' }, 'The worker applies this instruction on its next pass, then removes the note.')));
    } else if (t.note) {
      wrap.append(h('div', { class: 'note-chip' },
        h('span', {}, 'Note: ', h('span', { class: 'codicon codicon-clock' }), ' ' + t.note),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Retract note', title: 'Retract note', style: { width: '20px', height: '20px' }, onclick: () => sendPatch(t.id, 'note', '', t.note) }, icon(SVG.x))));
    } else {
      wrap.append(h('button', { class: 'link-btn', type: 'button', onclick: () => { u.noteOpen = true; render(); } }, '＋ Note to worker'));
    }
    return wrap;
  }

  function renderToasts() {
    const wrap = h('div', { class: 'toasts' });
    for (const t of toasts) {
      const el = h('div', { class: 'toast ' + t.level, role: 'status' },
        t.icon ? h('span', { class: 'codicon codicon-' + t.icon }) : null,
        h('span', {}, t.text));
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
      if (msg.taskId) { getUi(msg.taskId).conflict = true; setTimeout(() => { getUi(msg.taskId).conflict = false; scheduleRender(); }, 3000); }
      const action = msg.taskId ? { label: 'Review', onClick: () => { revealTask(msg.taskId); } } : null;
      pushToast(msg.level, msg.text, action, msg.icon);
    } else if (msg.type === 'reveal') {
      revealTask(msg.taskId, msg.phase, msg.composer);
    } else if (msg.type === 'attachStaged' || msg.type === 'attachRemoved') {
      // Reply to an attach (field-scoped wireFieldAttach, or whole-card attachFile) or to the
      // attachments area's × (detach) — resolved outside the normal board repaint so it works
      // while a field is still focused/mid-edit.
      const onStaged = pendingAttach[msg.reqId];
      delete pendingAttach[msg.reqId];
      if (!onStaged) return;
      if (msg.status !== 'applied') {
        pushToast('warning', msg.message || (msg.type === 'attachRemoved' ? 'Could not delete that attachment.' : 'Could not attach that file.'));
        return;
      }
      onStaged(msg);
    }
  });

  function applyBoard(incoming) {
    // A freshly applied board supersedes any board that was deferred while editing;
    // otherwise the stale snapshot gets flushed on the next focusout and clobbers newer state.
    pendingBoard = null;
    pendingRender = false; // a full render happens below, covering any deferred async repaint
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

  function revealTask(taskId, targetPhase, openComposer) {
    if (!board) return;
    if (openComposer) {
      phase = targetPhase || 'new';
      composerOpen = true;
      composerText = '';
      composerGroomer = '';
      composerModel = '';
      composerAttachments = [];
      composerNeedsFocus = true;
      saveState();
      render();
      return;
    }
    let found = targetPhase;
    if (!found) {
      for (const key in board.phases) if ((board.phases[key] || []).some((t) => t.id === taskId)) { found = key; break; }
    }
    if (found) { phase = found; composerOpen = false; resetSearch(); saveState(); }
    getUi(taskId).conflict = true;
    render();
    setTimeout(() => {
      const el = document.querySelector('[data-task="' + taskId + '"]');
      if (el) el.scrollIntoView({ block: 'center' });
    }, 30);
    setTimeout(() => { getUi(taskId).conflict = false; scheduleRender(); }, 3000);
  }

  // Cmd/Ctrl+F opens the local in-tab filter. The panel is created without enableFindWidget, so this
  // chord otherwise does nothing inside the focused webview; preventDefault stops it bubbling to the
  // workbench. Shift+Cmd+F is intentionally NOT hijacked (no cross-phase search — local scope only).
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      if (!board || board.todoMissing || composerOpen) return;
      e.preventDefault();
      openSearch();
    }
  });

  // Apply a deferred board once the user stops editing.
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (isEditing()) return; // focus moved to another field — keep deferring
      if (pendingBoard) { const b = pendingBoard; pendingBoard = null; applyBoard(b); }
      else if (pendingRender) { pendingRender = false; render(); }
    }, 50);
  });

  render();
  post({ type: 'ready' });
})();
