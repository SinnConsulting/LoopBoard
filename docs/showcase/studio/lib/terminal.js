/* The loop terminals in the panel. VS Code gives an extension no way to read a terminal, and the
 * GIFs cannot run a real `claude` session, so this is an illustration of what a loop terminal
 * shows: the exact spawn line LoopBoard sends (built with the shipped buildClaudeBase +
 * buildLoopCommand), then a Claude Code session working the board. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../server');
const { buildClaudeBase, buildLoopCommand } = require(path.join(ROOT, 'out-test', 'loop.js'));
const { NAMES } = require('./host');

const LOOP_TEXT = fs.readFileSync(path.join(ROOT, 'media', 'template-loop.md'), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SUFFIX = { opus: 'k3f9', sonnet: 'q7d2', fable: 'm1x8' };

function spawnLine(model) {
  const base = buildClaudeBase('auto', model, `loopboard-${model}-${SUFFIX[model]}`, 'medium');
  const cmd = buildLoopCommand(LOOP_TEXT, model, '5m', 3, false, true);
  return { base, cmd, shell: `${base} '${cmd}'` };
}

class Terminals {
  constructor(rec) {
    this.rec = rec;
    this.tabs = []; // { id, label, lines, status, busy }
    this.active = null;
  }

  find(id) { return this.tabs.find((t) => t.id === id); }

  open(model) {
    let t = this.find(model);
    if (!t) {
      const { shell } = spawnLine(model);
      t = { id: model, label: `Claude ${NAMES[model]}`, lines: [], status: null, busy: false, input: '' };
      t.lines.push(`<span class="t-prompt">acme-api</span> <span class="t-dim">$</span> <span class="t-cmd">${esc(shell)}</span>`);
      this.tabs.push(t);
    }
    this.active = model;
    return t;
  }

  // What the session shows once the TUI has booted and the seeded /loop prompt was submitted.
  boot(model) {
    const t = this.find(model);
    const { cmd } = spawnLine(model);
    t.lines.push('');
    t.lines.push('<span class="t-box">╭─────────────────────────────────╮</span>');
    t.lines.push('<span class="t-box">│</span> <span class="t-accent">✻</span> <span class="t-bold">Welcome to Claude Code!</span>        <span class="t-box">│</span>');
    t.lines.push('<span class="t-box">╰─────────────────────────────────╯</span>');
    t.lines.push(`<span class="t-dim">&gt;</span> ${esc(cmd)}`);
    t.input = '';
  }

  say(model, text) { this.find(model).lines.push(`<span class="t-bold">⏺</span> ${text}`); }
  tool(model, name, arg, result) {
    const t = this.find(model);
    t.lines.push(`<span class="t-green">⏺</span> <span class="t-bold">${esc(name)}</span>(${esc(arg)})`);
    if (result) t.lines.push(`  <span class="t-dim">⎿  ${result}</span>`);
  }
  raw(model, html) { this.find(model).lines.push(html); }
  status(model, text) { this.find(model).status = text ? `✻ ${text} <span class="t-dim">(esc to interrupt)</span>` : null; }
  busy(model, on) { this.find(model).busy = !!on; }
  close(model) {
    this.tabs = this.tabs.filter((t) => t.id !== model);
    if (this.active === model) this.active = this.tabs.length ? this.tabs[this.tabs.length - 1].id : null;
  }

  async render(rows) {
    const t = this.find(this.active);
    const list = this.tabs.map((x) => ({ label: x.label, active: x.id === this.active, busy: x.busy }));
    const max = rows || 8;
    const screen = t ? {
      lines: t.lines.slice(-max),
      status: t.status,
      input: t.lines.length > 1 ? (t.input || '') : null,
      footer: t.lines.length > 1 ? '  <span class="t-dim">⏵⏵ auto mode on</span>' : null,
    } : { lines: [] };
    await this.rec.stage(([l, s]) => window.stage.term(l, s), [list, screen]);
  }
}

module.exports = { Terminals, spawnLine };
