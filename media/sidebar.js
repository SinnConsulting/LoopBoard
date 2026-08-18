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

  function render() {
    const root = document.getElementById('root');
    root.textContent = '';
    if (!board) { root.append(h('div', { class: 'sb-section' }, 'Loading…')); return; }
    const sb = h('div', { class: 'sb' });
    const b = board.badge;

    const header = h('div', { class: 'sb-attn-header' });
    if (b.count > 0) {
      header.append(h('div', { class: 'sb-attn-title' }, h('span', { class: 'attn-dot pulse' }), b.count + ' - Items require your attention'));
    } else {
      header.append(h('div', { class: 'sb-attn-title clear' }, 'You are all set', h('span', { class: 'codicon codicon-pass' })));
    }
    sb.append(header);

    if (board.todoMissing) {
      sb.append(h('div', { class: 'setup-wrap' },
        h('div', { class: 'setup-text' }, 'No TODO.md in this workspace yet.'),
        h('button', { class: 'btn-primary', type: 'button', onclick: () => vscode.postMessage({ type: 'createFiles' }) },
          'Create TODO.md & DONE.md')));
    }

    // When a category has exactly one task, name its id — otherwise the count stands alone.
    function soleId(phaseKey, match) {
      const tasks = (board.phases[phaseKey] || []).filter(match);
      return tasks.length === 1 ? tasks[0].id : null;
    }

    const list = h('div', { class: 'attn-list sb-section' });
    const rows = [];
    if (b.feedbackUnanswered > 0) {
      rows.push({ icon: 'comment-discussion', text: b.feedbackUnanswered + ' unanswered question' + (b.feedbackUnanswered === 1 ? '' : 's') + ' — Feedback', phase: 'feedback', search: 'is:unanswered' });
    }
    if (b.newUnanswered > 0) {
      rows.push({ icon: 'issues', text: b.newUnanswered + ' unanswered question' + (b.newUnanswered === 1 ? '' : 's') + ' — New', phase: 'new', search: 'is:unanswered' });
    }
    if (b.reviewCount > 0) {
      const id = soleId('review', () => true);
      rows.push({ icon: 'eye', text: b.reviewCount + ' task' + (b.reviewCount === 1 ? '' : 's') + ' awaiting review' + (id ? ' (' + id + ')' : ''), phase: 'review' });
    }
    if (b.newCount > 0) {
      const id = soleId('new', () => true);
      rows.push({ icon: 'check-all', text: b.newCount + ' proposal' + (b.newCount === 1 ? '' : 's') + ' to approve' + (id ? ' (' + id + ')' : ''), phase: 'new' });
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
      loops.append(h('div', { class: 'sb-row loop' }, body,
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': spawnLabel, title: spawnLabel, disabled: l.running,
          onclick: l.running ? null : () => vscode.postMessage({ type: 'spawnLoop', model: l.id }),
        }, icon(SVG.play)),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Restart with fresh context', title: 'Restart with fresh context', disabled: !l.running,
          onclick: l.running ? () => vscode.postMessage({ type: 'recycleLoop', model: l.id }) : null,
        }, icon(SVG.recycle)),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Stop loop', title: 'Stop loop', disabled: !l.running,
          onclick: l.running ? () => vscode.postMessage({ type: 'stopLoop', model: l.id }) : null,
        }, icon(SVG.stop))));
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

    sb.append(h('div', { class: 'spacer' }));
    sb.append(h('div', { class: 'open-wrap' },
      h('button', { class: 'sb-row click', type: 'button', 'aria-label': 'Open LoopBoard help', title: 'Open LoopBoard help', onclick: () => vscode.postMessage({ type: 'openLink', url: board.helpUrl }) },
        icon(SVG.help), h('span', { class: 'label' }, 'Help')),
      h('button', { class: 'sb-row click', type: 'button', 'aria-label': 'Open extension settings', title: 'Open LoopBoard settings', onclick: () => vscode.postMessage({ type: 'openSettings' }) },
        icon(SVG.gear), h('span', { class: 'label' }, 'Settings')),
      h('button', { class: 'sb-row click', type: 'button', 'aria-label': 'Synchronise templates', title: 'Refresh TODO.md/LOOP.md scaffolding from the shipped templates', onclick: () => vscode.postMessage({ type: 'syncTemplates' }) },
        icon(SVG.sync), h('span', { class: 'label' }, 'Synchronise Templates')),
      h('button', { class: 'btn-primary', type: 'button', onclick: () => vscode.postMessage({ type: 'reveal', phase: 'new', composer: true }) }, 'New Story')));
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
  render();
  vscode.postMessage({ type: 'ready' });
})();
