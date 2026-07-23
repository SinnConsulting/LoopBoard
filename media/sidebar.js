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
      header.append(h('div', { class: 'sb-attn-title' }, h('span', { class: 'attn-dot pulse' }), b.count + ' item' + (b.count === 1 ? '' : 's') + ' need you'));
    } else {
      header.append(h('div', { class: 'sb-attn-title clear' }, 'Nothing needs you 🎉'));
    }
    sb.append(header);

    if (board.todoMissing) {
      sb.append(h('div', { class: 'setup-wrap' },
        h('div', { class: 'setup-text' }, 'No TODO.md in this workspace yet.'),
        h('button', { class: 'btn-primary', type: 'button', onclick: () => vscode.postMessage({ type: 'createFiles' }) },
          'Create TODO.md & DONE.md')));
    }

    const list = h('div', { class: 'attn-list sb-section' });
    const rows = [];
    if (b.feedbackUnanswered > 0) rows.push({ icon: '❓', text: b.feedbackUnanswered + ' unanswered question' + (b.feedbackUnanswered === 1 ? '' : 's') + ' — Feedback', phase: 'feedback' });
    if (b.reviewCount > 0) rows.push({ icon: '👀', text: b.reviewCount + ' task' + (b.reviewCount === 1 ? '' : 's') + ' awaiting review', phase: 'review' });
    if (b.newCount > 0) rows.push({ icon: '🆕', text: b.newCount + ' proposal' + (b.newCount === 1 ? '' : 's') + ' to approve', phase: 'new' });
    for (const r of rows) {
      list.append(h('button', { class: 'attn-row', type: 'button', onclick: () => vscode.postMessage({ type: 'reveal', phase: r.phase }) },
        h('span', { class: 'ico' }, r.icon), h('span', { class: 'txt' }, r.text)));
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
      const spawnLabel = l.running ? 'Focus terminal' : 'Start loop';
      loops.append(h('div', { class: 'sb-row loop' },
        h('span', { class: 'loop-dot ' + (l.running ? 'on' : 'off') }),
        h('span', { class: 'label' }, l.name),
        h('span', { class: 'loop-hint' }, l.hint),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': spawnLabel, title: spawnLabel, onclick: () => vscode.postMessage({ type: 'spawnLoop', model: l.id }) }, icon(SVG.play)),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Restart with fresh context', title: 'Restart with fresh context', disabled: !l.running,
          onclick: l.running ? () => vscode.postMessage({ type: 'recycleLoop', model: l.id }) : null,
        }, icon(SVG.recycle)),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Stop loop', title: 'Stop loop', disabled: !l.running,
          onclick: l.running ? () => vscode.postMessage({ type: 'stopLoop', model: l.id }) : null,
        }, icon(SVG.stop))));
    }
    sb.append(loops);

    sb.append(h('div', { class: 'spacer' }));
    sb.append(h('div', { class: 'open-wrap' },
      h('button', { class: 'sb-row click', type: 'button', 'aria-label': 'Open extension settings', title: 'Open LoopBoard settings', onclick: () => vscode.postMessage({ type: 'openSettings' }) },
        icon(SVG.gear), h('span', { class: 'label' }, 'Settings')),
      h('button', { class: 'btn-primary', type: 'button', onclick: () => vscode.postMessage({ type: 'reveal', phase: 'new' }) }, 'New Story')));
    root.append(sb);
  }

  window.addEventListener('message', (event) => {
    if (event.data.type === 'board') { board = event.data.board; render(); }
  });
  render();
  vscode.postMessage({ type: 'ready' });
})();
