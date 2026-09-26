/* Minimal, XSS-clean markdown renderer shared by every LoopBoard webview (t-mkd1, extracted in
   t-sgrp). Loaded as a plain classic script under the page's CSP nonce BEFORE the page script, and
   exposed as one global — the webviews have no module loader and zero runtime dependencies.

   Supports ATX headings, - / * and 1. lists (one nesting level, t-c7e3), **bold**, italic in either
   *asterisk* or _underscore_ form, `code`, [text](scheme://url), and blank-line paragraph breaks.

   All user text is HTML-escaped FIRST, so the only tags in the output are the ones we emit; link
   hrefs are limited to any absolute `scheme://...` URL (t-adf2 — matches the `link:` meta chip's
   scheme-agnostic handling, so custom schemes like `tool://` are clickable here too) or a
   staged-attachment `.loopboard/cache/...` relative path (t-att1), carried on data-mdlink (wired to
   openLink on render). Requiring `://` (not just a leading scheme + colon) keeps non-URL forms like
   `javascript:...` out, since those have no `//`.

   The settings page (t-sgrp) renders every `markdownDescription` from package.json through this,
   because those descriptions were written for a markdown renderer: raw backticks and `**bold**`
   markers on a settings page look broken. */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function renderInlineMd(text) {
    // `text` is already HTML-escaped. Links first, then bold, then italic.
    let out = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) || url.startsWith('.loopboard/cache/') ? '<a href="#" data-mdlink="' + url + '">' + label + '</a>' : m);
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
  //
  // Lists nest ONE level (t-c7e3): a list line indented deeper than the list's first item opens a
  // list of its own type inside the previous item's <li>, and a line back at (or left of) that
  // indent continues the outer list — so `1. a` / `   - x` / `2. b` is one <ol> counting 1, 2 with
  // x under a, instead of an <ol>, a <ul> and a second <ol> restarting at 1. Deeper indents stay at
  // the nested level. A flat list renders exactly as before (an item with no nested lists adds
  // nothing between its text and </li>).
  function mdToHtml(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const parts = [];
    let para = [];
    let listType = null;
    let listIndent = 0;
    let listItems = []; // [{ text, subs: [{ type, items: [text] }] }]
    const flushPara = () => {
      if (para.length) { parts.push({ t: 'p', html: renderInline(para.join('\n')).replace(/\n/g, ' ') }); para = []; }
    };
    const renderLis = (texts) => texts.map((x) => '<li>' + renderInline(x) + '</li>').join('');
    const flushList = () => {
      if (listItems.length) {
        parts.push({ t: 'block', html: '<' + listType + '>'
          + listItems.map((it) => '<li>' + renderInline(it.text)
            + it.subs.map((s) => '<' + s.type + '>' + renderLis(s.items) + '</' + s.type + '>').join('')
            + '</li>').join('')
          + '</' + listType + '>' });
        listItems = []; listType = null;
      }
    };
    for (const line of lines) {
      const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
      const ul = /^(\s*)[-*]\s+(.*)$/.exec(line);
      const ol = /^(\s*)\d+\.\s+(.*)$/.exec(line);
      if (heading) {
        flushPara(); flushList();
        const level = heading[1].length;
        parts.push({ t: 'block', html: '<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>' });
      } else if (ul || ol) {
        flushPara();
        const type = ul ? 'ul' : 'ol';
        const m = ul || ol;
        const indent = m[1].length;
        if (listType && indent > listIndent) {
          const last = listItems[listItems.length - 1];
          const sub = last.subs[last.subs.length - 1];
          if (sub && sub.type === type) sub.items.push(m[2]);
          else last.subs.push({ type, items: [m[2]] });
        } else {
          if (listType && listType !== type) flushList();
          if (!listType) listIndent = indent;
          listType = type;
          listItems.push({ text: m[2], subs: [] });
        }
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

  window.LoopBoardMarkdown = { escapeHtml, renderInline, mdToHtml };
})();
