/* LoopBoard sidebar summary. Vanilla JS. */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  let board = null;

  function h(tag, props) {
    const e = document.createElement(tag);
    props = props || {};
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = Array.isArray(arguments[i]) ? arguments[i] : [arguments[i]];
      for (const kid of kids) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    }
    return e;
  }

  function icon(svg) {
    const e = h('span', { class: 'ico-svg' });
    e.innerHTML = svg;
    return e;
  }
  const SVG = {
    play: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 3l9 5-9 5V3z" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    recycle: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 4.2A5.5 5.5 0 1 0 14 8" stroke-linecap="round"/><path d="M13 1.5V4.5H10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    stop: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>',
    gear: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" stroke-linecap="round"/></svg>',
    sync: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 4.2A5.5 5.5 0 1 0 14 8" stroke-linecap="round"/><path d="M13 1.5V4.5H10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    help: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M6 6.2a2 2 0 1 1 2.8 1.8c-.6.3-1 .8-1 1.5v.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="11.6" r="0.15" fill="currentColor" stroke-width="0.6"/></svg>',
  };

  const PHASES = [
    { key: 'new', label: 'New' }, { key: 'backlog', label: 'Backlog' }, { key: 'inprogress', label: 'In Progress' },
    { key: 'feedback', label: 'Feedback' }, { key: 'review', label: 'Review' }, { key: 'done', label: 'Done' },
  ];

  // ---- scheduled loop restart (t-77d1) ----
  // Mirrors PRESET_MINUTES in src/schedule.ts. The webview cannot import from src/ (vanilla JS, no
  // bundler), so the list is duplicated; the host re-validates every armed value regardless, so a
  // drift here can only affect which one-click choices are offered, never what gets armed.
  const PRESET_MINUTES = [15, 30, 60, 120, 240];
  // Popover draft state, kept OUTSIDE render() because render() rebuilds #root from scratch on
  // every board message — without this the popover would vanish mid-edit on any refresh.
  // null = closed; otherwise { model, action, minutes, custom, repeat, force, error }.
  let restartDraft = null;

  // Wording per scheduled action. `force` only exists for the two that can kill a working
  // terminal — a scheduled start interrupts nothing, so its checkbox is not rendered at all.
  const ACTION_COPY = {
    start: { title: 'Start', arm: 'Schedule start', force: null },
    restart: { title: 'Restart', arm: 'Schedule restart', force: 'Force (restart even mid-task)' },
    stop: { title: 'Stop', arm: 'Schedule stop', force: 'Force (stop even mid-task)' },
  };

  function openRestartPopover(loop, action) {
    // Only prefill from the armed schedule when it belongs to the button being right-clicked;
    // one schedule exists per loop, so opening a different action starts from defaults.
    const armed = loop.restart && loop.restart.action === action ? loop.restart : null;
    restartDraft = {
      model: loop.id,
      action: action,
      // Re-opening a loop that already has a schedule shows its current settings (the story's
      // "re-opening the popover shows its current settings and offers to clear it").
      minutes: armed ? armed.minutes : PRESET_MINUTES[0],
      custom: armed && PRESET_MINUTES.indexOf(armed.minutes) === -1 ? String(armed.minutes) : '',
      repeat: !!(armed && armed.repeat),
      force: !!(armed && armed.force),
      error: '',
    };
    render();
  }
  // Right-click on any of the three row buttons: toggle that button's scheduling popover.
  function bindScheduleMenu(btn, loop, action) {
    btn.addEventListener('contextmenu', (e) => {
      // Suppress the host's own menu so the popover is the only thing that opens.
      e.preventDefault();
      const open = restartDraft && restartDraft.model === loop.id && restartDraft.action === action;
      if (open) closeRestartPopover(); else openRestartPopover(loop, action);
    });
  }
  function closeRestartPopover() {
    if (!restartDraft) return;
    restartDraft = null;
    render();
  }
  // Custom… is selected by having a non-empty custom field; otherwise a preset is active.
  function draftMinutes(d) {
    if (d.custom.trim() === '') return d.minutes;
    return /^\d+$/.test(d.custom.trim()) ? Number(d.custom.trim()) : NaN;
  }

  function renderRestartPopover(loop) {
    const d = restartDraft;
    const copy = ACTION_COPY[d.action];
    const pop = h('div', { class: 'restart-pop', role: 'dialog', 'aria-label': 'Schedule a ' + d.action + ' for ' + loop.name });
    pop.append(h('div', { class: 'restart-title' }, copy.title + ' ' + loop.name));

    const presets = h('div', { class: 'restart-presets' });
    for (const m of PRESET_MINUTES) {
      const active = d.custom.trim() === '' && d.minutes === m;
      presets.append(h('button', {
        class: 'restart-preset' + (active ? ' selected' : ''), type: 'button', 'aria-pressed': active ? 'true' : 'false',
        onclick: () => { d.minutes = m; d.custom = ''; d.error = ''; render(); },
      }, m + 'm'));
    }
    pop.append(presets);

    const custom = h('input', {
      class: 'restart-custom', type: 'text', inputmode: 'numeric', placeholder: 'Custom… minutes',
      'aria-label': 'Custom delay in minutes',
    });
    custom.value = d.custom;
    // No re-render per keystroke — that would rebuild the popover and drop the caret.
    custom.addEventListener('input', (e) => { d.custom = e.target.value; d.error = ''; });
    pop.append(custom);

    pop.append(checkRow('Repeat', d.repeat, (v) => { d.repeat = v; }));
    if (copy.force) pop.append(checkRow(copy.force, d.force, (v) => { d.force = v; }));
    if (d.error) pop.append(h('div', { class: 'restart-error' }, d.error));

    const actions = h('div', { class: 'restart-actions' });
    actions.append(h('button', {
      class: 'btn-sm primary', type: 'button',
      onclick: () => {
        const minutes = draftMinutes(d);
        // Validated here for an immediate in-popover message; the host re-validates before arming.
        if (!Number.isInteger(minutes) || minutes < 1) {
          d.error = 'Enter a whole number of minutes.';
          render();
          return;
        }
        vscode.postMessage({ type: 'armRestart', model: d.model, action: d.action, minutes: String(minutes), repeat: d.repeat, force: copy.force ? d.force : false });
        closeRestartPopover();
      },
    }, loop.restart && loop.restart.action === d.action ? 'Update' : copy.arm));
    if (loop.restart) {
      actions.append(h('button', {
        class: 'btn-sm secondary', type: 'button',
        onclick: () => { vscode.postMessage({ type: 'clearRestart', model: d.model }); closeRestartPopover(); },
      }, 'Clear'));
    }
    actions.append(h('button', { class: 'btn-sm secondary', type: 'button', onclick: closeRestartPopover }, 'Cancel'));
    pop.append(actions);
    return pop;
  }

  function checkRow(label, checked, onChange) {
    const box = h('input', { type: 'checkbox' });
    box.checked = checked;
    box.addEventListener('change', (e) => onChange(e.target.checked));
    return h('label', { class: 'restart-check' }, box, h('span', {}, label));
  }

  function render() {
    const root = document.getElementById('root');
    root.textContent = '';
    if (!board) { root.append(h('div', { class: 'sb-section' }, 'Loading…')); return; }
    const sb = h('div', { class: 'sb' });
    const b = board.badge;

    if (board.todoMissing) {
      sb.append(h('div', { class: 'setup-wrap' },
        h('div', { class: 'setup-text' }, 'No TODO.md in this workspace yet.'),
        h('button', { class: 'btn-primary', type: 'button', onclick: () => vscode.postMessage({ type: 'createFiles' }) },
          'Create TODO.md & DONE.md')));
    } else {
      const header = h('div', { class: 'sb-attn-header' });
      if (b.count > 0) {
        header.append(h('div', { class: 'sb-attn-title' }, h('span', { class: 'attn-dot pulse' }), b.count + ' - Items require your attention'));
      } else {
        header.append(h('div', { class: 'sb-attn-title clear' }, 'You are all set', h('span', { class: 'codicon codicon-pass' })));
      }
      sb.append(header);

      // When a category has exactly one task, name its id — otherwise the count stands alone.
      function soleId(phaseKey, match) {
        const tasks = (board.phases[phaseKey] || []).filter(match);
        return tasks.length === 1 ? tasks[0].id : null;
      }

      const list = h('div', { class: 'attn-list sb-section' });
      const rows = [];
      if (b.feedbackUnanswered > 0) {
        rows.push({ icon: 'comment-discussion', text: b.feedbackUnanswered + ' unanswered question' + (b.feedbackUnanswered === 1 ? '' : 's') + ' (Feedback)', phase: 'feedback', search: 'is:unanswered' });
      }
      if (b.newUnanswered > 0) {
        rows.push({ icon: 'issues', text: b.newUnanswered + ' unanswered question' + (b.newUnanswered === 1 ? '' : 's') + ' (New)', phase: 'new', search: 'is:unanswered' });
      }
      if (b.reviewCount > 0) {
        const id = soleId('review', () => true);
        // search: '' is an EXPLICIT EMPTY VIEW (t-1cdb), not "no search" — the row advertises a
        // count, so its tab must show exactly those N cards with any typed filter suppressed,
        // the same parity rule `is:proposal` and `is:draft` follow.
        rows.push({ icon: 'eye', text: b.reviewCount + ' task' + (b.reviewCount === 1 ? '' : 's') + ' awaiting review' + (id ? ' (' + id + ')' : ''), phase: 'review', search: '' });
      }
      if (b.newCount > 0) {
        const id = soleId('new', (t) => !t.isDraft);
        rows.push({ icon: 'check-all', text: b.newCount + ' proposal' + (b.newCount === 1 ? '' : 's') + ' to approve' + (id ? ' (' + id + ')' : ''), phase: 'new', search: 'is:proposal' });
      }
      if (b.draftCount > 0) {
        rows.push({ icon: 'wand', text: b.draftCount + ' draft' + (b.draftCount === 1 ? '' : 's') + ' will be groomed', phase: 'new', search: 'is:draft' });
      }
      for (const r of rows) {
        list.append(h('button', { class: 'attn-row', type: 'button', onclick: () => vscode.postMessage({ type: 'reveal', phase: r.phase, search: r.search }) },
          h('span', { class: 'ico codicon codicon-' + r.icon }), h('span', { class: 'txt' }, r.text)));
      }
      if (rows.length) sb.append(list);

      const counts = h('div', { class: 'sb-section' });
      counts.append(h('div', { class: 'sb-label' }, 'Phases'));
      for (const p of PHASES) {
        counts.append(h('button', { class: 'sb-row click', type: 'button', onclick: () => vscode.postMessage({ type: 'reveal', phase: p.key }) },
          h('span', { class: 'label' }, p.label), h('span', { class: 'count' }, String((board.phases[p.key] || []).length))));
      }
      sb.append(counts);

      sb.append(h('div', { class: 'divider' }));
      const loops = h('div', { class: 'sb-section' });
      loops.append(h('div', { class: 'sb-label' }, 'Loops'));
      for (const l of board.loops) {
        // Actively working = this loop is running AND owns the single In-Progress task (LOOP.md
        // Rule 2's GLOBAL SINGLE-TASK LIMIT), derived from board.concurrency.inProgress by model.
        const owns = !!(board.concurrency && board.concurrency.inProgress.some((t) => t.model === l.id));
        const working = l.running && owns;
        const dotClass = 'loop-dot ' + (l.running ? 'on' : 'off') + (working ? ' working pulse' : '');
        // Play is disabled while running (the row body handles focusing it instead) — its label
        // must not claim an action the disabled button no longer performs.
        const spawnLabel = l.running ? 'Loop running' : 'Start loop';
        // Only a running loop's row body reveals+focuses its terminal on click; a stopped loop's row
        // stays inert (starting one is the play button's job, not a body click).
        const bodyProps = l.running
          ? { class: 'loop-body click', role: 'button', tabindex: '0', 'aria-label': 'Reveal ' + l.name + ' terminal', onclick: () => vscode.postMessage({ type: 'revealTerminal', model: l.id }) }
          : { class: 'loop-body' };
        const body = h('span', bodyProps,
          h('span', { class: dotClass }),
          h('span', { class: 'label' }, l.name),
          h('span', { class: 'loop-hint' }, l.hint));
        if (l.running) {
          body.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vscode.postMessage({ type: 'revealTerminal', model: l.id }); }
          });
        }
        // Each of the three buttons keeps its original LEFT-click meaning — act now (t-77d1
        // feedback) — and schedules the same action on RIGHT-click (contextmenu). Keyboard users
        // reach it the way they reach any context menu (Menu key / Shift+F10 while focused).
        //
        // Scheduling is available on ALL THREE buttons whatever the loop's current state, because
        // a schedule is armed against the state it will be in LATER ("stop it in 4h" on a loop you
        // are about to start). That is why an inapplicable button uses `aria-disabled` + `.off`
        // rather than the real `disabled` attribute: a disabled button fires no mouse events at
        // all, which would take the right-click away with the left. The left-click stays inert
        // exactly as before, and the host swallows a scheduled action that no longer applies when
        // its timer elapses (`appliesTo` in src/schedule.ts).
        const armedFor = (action) => (l.restart && l.restart.action === action ? l.restart : null);
        const withSchedule = (base, action) => {
          const armed = armedFor(action);
          return (armed ? 'Scheduled ' + action + ' — ' + armed.label : base) + ' (right-click to schedule)';
        };
        const actionBtn = (action, enabled, label, message, glyph) => {
          const btn = h('button', {
            class: 'icon-btn' + (armedFor(action) ? ' armed' : '') + (enabled ? '' : ' off'),
            type: 'button', 'aria-label': label, title: label,
            'aria-disabled': enabled ? null : 'true',
            onclick: enabled ? () => vscode.postMessage({ type: message, model: l.id }) : null,
          }, icon(glyph));
          bindScheduleMenu(btn, l, action);
          return btn;
        };

        const playBtn = actionBtn('start', !l.running, withSchedule(spawnLabel, 'start'), 'spawnLoop', SVG.play);
        const recycleBtn = actionBtn('restart', l.running, withSchedule('Restart with fresh context', 'restart'), 'recycleLoop', SVG.recycle);
        const stopBtn = actionBtn('stop', l.running, withSchedule('Stop loop', 'stop'), 'stopLoop', SVG.stop);

        const row = h('div', { class: 'sb-row loop' }, body, playBtn, recycleBtn, stopBtn);
        // The popover is anchored inside the row's wrapper so it sits under its own button row.
        const wrap = h('div', { class: 'loop-wrap' }, row);
        // Context usage (t-2b89): a thin bar + the host-rendered label. Only present when the host
        // actually measured this loop's session — a stopped loop, or one whose transcript cannot be
        // located, shows nothing at all rather than a misleading 0%.
        if (l.context) {
          const bar = h('div', { class: 'ctx-bar' + (l.context.pending ? ' pending' : '') });
          const fill = h('div', { class: 'ctx-fill' });
          fill.style.width = l.context.percent + '%';
          bar.append(fill);
          wrap.append(h('div', { class: 'ctx-wrap', title: l.context.label },
            bar, h('span', { class: 'ctx-label' }, l.context.label)));
        }
        // An armed or pending restart is never invisible — the row states it for the whole wait.
        if (l.restart) {
          wrap.append(h('div', { class: 'restart-indicator' + (l.restart.pending ? ' pending' : '') }, l.restart.label));
        }
        if (restartDraft && restartDraft.model === l.id) wrap.append(renderRestartPopover(l));
        loops.append(wrap);
      }
      // Global single-task limit (LOOP.md Rule 2): surface when a task is In Progress so a human
      // sees the limit holding back prepared work — or being breached (>1 In Progress at once).
      const c = board.concurrency;
      if (c && c.inProgress.length) {
        const inProg = c.inProgress.map((t) => (t.title || t.id) + ' (' + t.id + ')').join(', ');
        // Clicking the status lands the board directly on the In-Progress task (by id when there's the
        // usual single one; otherwise just the In Progress tab, which shows the breached set).
        const revealMsg = c.inProgress.length === 1
          ? { type: 'reveal', taskId: c.inProgress[0].id, phase: 'inprogress' }
          : { type: 'reveal', phase: 'inprogress' };
        const revealLabel = c.inProgress.length === 1 ? 'Open the in-progress task on the board' : 'Show the In Progress tab';
        // The title marquee-scrolls (see setupMarquees) rather than truncating with an ellipsis, so a
        // long title stays fully readable without widening the sidebar.
        loops.append(h('button', { class: 'sb-row loop-status click', type: 'button', title: revealLabel, 'aria-label': revealLabel, onclick: () => vscode.postMessage(revealMsg) },
          h('span', { class: 'loop-status-label' },
            c.breached ? h('span', { class: 'codicon codicon-warning' }) : null,
            (c.breached ? ' limit breached — ' : '') + 'In Progress:'),
          h('div', { class: 'loop-marquee' }, h('span', { class: 'loop-marquee-inner' }, inProg))));
        if (c.message) {
          loops.append(h('div', { class: 'sb-row loop-status' }, h('span', { class: 'loop-hint' }, c.message)));
        }
      }
      sb.append(loops);
    }

    sb.append(h('div', { class: 'spacer' }));
    sb.append(h('div', { class: 'open-wrap' },
      h('button', { class: 'sb-row click', type: 'button', 'aria-label': 'Open LoopBoard help', title: 'Open LoopBoard help', onclick: () => vscode.postMessage({ type: 'openLink', url: board.helpUrl }) },
        icon(SVG.help), h('span', { class: 'label' }, 'Help')),
      h('button', { class: 'sb-row click', type: 'button', 'aria-label': 'Open extension settings', title: 'Open LoopBoard settings', onclick: () => vscode.postMessage({ type: 'openSettings' }) },
        icon(SVG.gear), h('span', { class: 'label' }, 'Settings')),
      h('button', { class: 'sb-row click' + (board.templatesOutOfDate ? ' sync-pulse pulse' : ''), type: 'button', 'aria-label': 'Synchronise templates', title: 'Refresh TODO.md/LOOP.md scaffolding from the shipped templates', onclick: () => vscode.postMessage({ type: 'syncTemplates' }) },
        icon(SVG.sync), h('span', { class: 'label' }, 'Synchronise Templates')),
      board.todoMissing ? null : h('button', { class: 'btn-primary', type: 'button', onclick: () => vscode.postMessage({ type: 'reveal', phase: 'new', composer: true }) }, 'New Story')));
    root.append(sb);
    setupMarquees();
  }

  // A long In-Progress title scrolls (marquee) instead of truncating — but only when it actually
  // overflows its row. Measured after paint; the shift distance + duration scale with the overflow.
  function setupMarquees() {
    requestAnimationFrame(() => {
      document.querySelectorAll('.loop-marquee').forEach((box) => {
        const inner = box.firstElementChild;
        if (!inner) return;
        const overflow = inner.scrollWidth - box.clientWidth;
        if (overflow > 2) {
          box.classList.add('scrolling');
          box.style.setProperty('--marquee-shift', -overflow + 'px');
          box.style.setProperty('--marquee-dur', Math.max(4, overflow / 25) + 's');
        } else {
          box.classList.remove('scrolling');
          box.style.removeProperty('--marquee-shift');
        }
      });
    });
  }

  window.addEventListener('message', (event) => {
    if (event.data.type === 'board') { board = event.data.board; render(); }
  });

  // Popover dismissal (t-77d1): Escape anywhere, or a pointer press outside it. Bound once on the
  // document rather than per-render, since render() rebuilds every node it would otherwise hang on.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && restartDraft) { e.preventDefault(); closeRestartPopover(); }
  });
  document.addEventListener('mousedown', (e) => {
    if (!restartDraft) return;
    // The ♻ button toggles the popover itself; letting this handler also close it would make the
    // click reopen-then-close and the popover would never appear.
    if (e.target.closest('.restart-pop') || e.target.closest('.icon-btn')) return;
    closeRestartPopover();
  });
  render();
  vscode.postMessage({ type: 'ready' });
})();
