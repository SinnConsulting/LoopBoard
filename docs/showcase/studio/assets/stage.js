/* Stage controller: the recorder drives everything here through page.evaluate — layout, the
 * markdown editor, the terminal panel and the overlays (cursor, ripple, caption, title card). All
 * state is set explicitly per frame; nothing here animates on its own timer, so every captured
 * frame is deterministic. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Editor-tab icon = panel.ts's iconPath (the fixed-colour dark variant).
  const LOOPBOARD_ICON = '<img src="/media/icon-dark.svg" alt="" />';
  const TAB_ICONS = {
    loopboard: LOOPBOARD_ICON,
    md: '<span class="codicon codicon-markdown md"></span>',
    settings: '<img src="/media/icon-dark.svg" alt="" />',
  };

  function layout(o) {
    sidebar(o.sidebar !== false);
    $('panel').classList.toggle('hidden', !o.panel);
    if (o.panelHeight) $('panel').style.height = o.panelHeight + 'px';
    $('editor-body').classList.toggle('split', !!o.split);
    if (o.splitHeight) $('group-right').style.flex = '0 0 ' + o.splitHeight + 'px';
    if (o.title) $('window-title').textContent = o.title;
    if (o.feature != null) $('band-feature').textContent = o.feature;
    // A cropped scene narrows the caption band to its crop, so the caption stays centred in it.
    if (o.band) { $('band').style.left = o.band.left + 'px'; $('band').style.right = 'auto'; $('band').style.width = o.band.width + 'px'; }
    for (const v of document.querySelectorAll('#group-left .view')) v.classList.toggle('shown', v.dataset.view === (o.view || 'board'));
    $('md-editor').classList.toggle('shown', !!o.split);
    tabs($('tabs'), o.tabs || [{ label: 'LoopBoard', icon: 'loopboard', active: true }]);
    tabs($('tabs-right'), o.rightTabs || []);
  }

  function tabs(bar, list) {
    bar.innerHTML = '';
    for (const t of list) {
      const el = document.createElement('div');
      el.className = 'etab' + (t.active ? ' active' : '') + (t.dirty ? ' dirty' : '');
      el.innerHTML = '<span class="ico">' + (TAB_ICONS[t.icon] || '') + '</span><span>' + esc(t.label) + '</span><span class="x codicon codicon-close"></span>';
      bar.append(el);
    }
  }

  // Toggle the primary side bar alone (what a click on the activity-bar icon does).
  function sidebar(on) {
    $('sidebar').classList.toggle('hidden', !on);
    $('ab-loopboard').classList.toggle('active', !!on);
  }

  function badge(n) {
    const b = $('ab-badge');
    b.textContent = n ? String(n) : '';
    b.classList.toggle('on', !!n);
  }

  // ---- markdown editor ----
  function mdLine(raw) {
    const s = esc(raw);
    if (/^#{1,6}\s/.test(raw)) return '<span class="md-h">' + s + '</span>';
    if (/^\s*&lt;!--/.test(s) || /--&gt;\s*$/.test(s)) return '<span class="md-cm">' + s + '</span>';
    let m = /^(\s*- )(\[[ x]\])( .*)$/.exec(s);
    if (m) return m[1] + '<span class="md-box">' + m[2] + '</span><span class="md-q">' + m[3] + '</span>';
    m = /^(\s*- )([a-z]+:)(.*)$/.exec(s);
    if (m) return m[1] + '<span class="md-key">' + m[2] + '</span><span class="md-val">' + m[3] + '</span>';
    return s;
  }
  function md(text, opts) {
    const o = opts || {};
    const hl = new Set(o.hl || []);
    const lines = text.split('\n');
    const first = o.first || 1;
    const out = [];
    for (let i = first - 1; i < lines.length && out.length < 60; i++) {
      const n = i + 1;
      out.push('<div class="ln' + (hl.has(n) ? ' hl' : '') + (o.caret === n ? ' caret' : '') + '" style="' + (hl.has(n) && o.hlAlpha != null ? 'background:rgba(35,134,54,' + (0.26 * o.hlAlpha).toFixed(3) + ')' : '') + '"><span class="no">' + n + '</span><span class="tx">' + (mdLine(lines[i]) || ' ') + '</span></div>');
    }
    $('md-lines').innerHTML = out.join('');
  }

  // ---- terminal ----
  // `screen` = { lines: [html], status: html|null, input: html|null, footer: html|null }
  function term(list, screen) {
    $('term-list').innerHTML = (list || []).map((t) =>
      '<div class="tl-item' + (t.active ? ' active' : '') + '"><span class="codicon codicon-terminal"></span><span>' + esc(t.label) + '</span>' +
      (t.busy ? '<span class="spin codicon codicon-circle-filled"></span>' : '') + '</div>').join('');
    const sc = screen || {};
    let html = (sc.lines || []).map((l) => '<div class="t-line">' + (l || ' ') + '</div>').join('');
    if (sc.status) html += '<div class="t-line t-status">' + sc.status + '</div>';
    if (sc.input != null) html += '<div class="t-input"><span class="t-dim">&gt;</span> ' + sc.input + '</div>';
    if (sc.footer) html += '<div class="t-line t-footer">' + sc.footer + '</div>';
    $('term-screen').innerHTML = html;
  }

  // ---- overlays ----
  function cursor(x, y, scale) {
    const c = $('cursor');
    c.style.left = x - 2 + 'px';
    c.style.top = y - 2 + 'px';
    c.style.transform = 'scale(' + (scale || 1) + ')';
  }
  function ripple(x, y, t) {
    const r = $('ripple');
    r.style.left = x + 'px';
    r.style.top = y + 'px';
    if (t == null || t >= 1) { r.style.opacity = '0'; return; }
    r.style.opacity = String(1 - t);
    r.style.transform = 'scale(' + (0.4 + t * 0.9) + ')';
  }
  function spotlight(rect, alpha) {
    const s = $('spotlight');
    if (!rect) { s.style.opacity = '0'; return; }
    const pad = 4;
    s.style.left = rect.x - pad + 'px';
    s.style.top = rect.y - pad + 'px';
    s.style.width = rect.width + pad * 2 + 'px';
    s.style.height = rect.height + pad * 2 + 'px';
    s.style.opacity = String(alpha == null ? 1 : alpha);
  }
  function caption(step, html, alpha, bottom) {
    $('cap-step').textContent = step || '';
    $('cap-text').innerHTML = html || '';
    const c = $('caption');
    c.style.opacity = String(alpha || 0);
    c.style.transform = 'translateX(-50%) translateY(' + ((1 - (alpha || 0)) * 6).toFixed(1) + 'px)';
  }
  function keycap(text, x, y, alpha) {
    const k = $('keycap');
    k.textContent = text || '';
    k.style.left = x + 'px';
    k.style.top = y + 'px';
    k.style.opacity = String(alpha || 0);
  }
  function titleCard(kicker, title, sub, alpha) {
    $('tc-kicker').textContent = kicker || '';
    $('tc-title').textContent = title || '';
    $('tc-sub').textContent = sub || '';
    $('title-card').style.opacity = String(alpha || 0);
  }
  function xfade(src, alpha) {
    const img = $('xfade');
    if (!src) { img.removeAttribute('src'); return; }
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    img.style.opacity = String(alpha);
    return img.decode ? img.decode().then(() => true) : true;
  }
  function notify(text, alpha) {
    $('notification-text').textContent = text || '';
    const n = $('notification');
    n.style.opacity = String(alpha || 0);
    n.style.transform = 'translateY(' + ((1 - (alpha || 0)) * 10).toFixed(1) + 'px)';
  }
  // `o` = { message, detail (html), buttons: [label, …] — the first is primary, optional
  // left/top (px) of the dialog's top centre } or null to hide.
  function modal(o, alpha) {
    const m = $('modal');
    if (!o) { m.style.opacity = '0'; return; }
    const box = m.querySelector('.md-box');
    box.style.left = o.left != null ? o.left + 'px' : '';
    box.style.top = o.top != null ? o.top + 'px' : '';
    $('modal-msg').textContent = o.message;
    $('modal-detail').innerHTML = o.detail || '';
    $('modal-buttons').innerHTML = o.buttons.map((b, i) => '<span class="md-btn' + (i === 0 ? ' primary' : '') + '">' + esc(b) + '</span>').join('');
    m.style.opacity = String(alpha == null ? 1 : alpha);
  }
  function statusLoops(html) { $('sb-loops').innerHTML = html || ''; }

  // Pause every running animation (CSS animations + transitions) in this document and each frame,
  // then step them by hand: the recorder calls advance(dt) once per captured frame.
  function docs() {
    const out = [document];
    for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument) out.push(f.contentDocument); } catch (e) { /* cross-origin */ } }
    return out;
  }
  function advance(dt) {
    for (const d of docs()) {
      for (const a of d.getAnimations()) {
        if (a.playState !== 'paused') a.pause();
        a.currentTime = (a.currentTime || 0) + dt;
      }
    }
  }

  window.stage = { layout, sidebar, badge, md, term, cursor, ripple, spotlight, caption, keycap, titleCard, xfade, statusLoops, notify, modal, advance };
})();
