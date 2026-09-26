/* A miniature extension host for the recordings.
 *
 * It owns an in-memory `.loopboard/` (TODO.md, DONE.md, tasks/<id>.md) and answers the webviews'
 * messages with the SAME pure modules the extension ships (compiled to out-test/): parser +
 * taskfile to load, merge to apply field patches, gates for promote/demote/accept, writer to
 * serialize, view.toWebviewBoard for the payload, settingsform/settingsgrid for the settings page.
 * So a click in a GIF really rewrites the markdown the way the extension would — only the disk and
 * the VS Code API are simulated.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../server');

const OUT = path.join(ROOT, 'out-test');
const req = (m) => require(path.join(OUT, m));
const { parseTodo, parseDone } = req('parser.js');
const { serializeTodo, serializeDone } = req('writer.js');
const { parseTaskFile, serializeTaskFile } = req('taskfile.js');
const { applyPatch, applyDetailPatch, patchTarget, normalizeModel, normalizeGroomer } = req('merge.js');
const gates = req('gates.js');
const { toWebviewBoard } = req('view.js');
const { buildSettingsForm, formKeys, findControl, toConfigPatch } = req('settingsform.js');
const { buildModelGrid, gridPatch } = req('settingsgrid.js');
const { describeContext, describeThreshold } = req('context.js');
const { computeNudges, formatNudge } = req('nudge.js');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const LOOP_ORDER = ['fable', 'opus', 'sonnet'];
const NAMES = { opus: 'Opus', sonnet: 'Sonnet', fable: 'Fable' };

function emptyDetail() {
  return parseTaskFile('');
}

class Host {
  constructor(opts) {
    this.today = opts.today || '2026-09-25';
    this.files = new Map(Object.entries(opts.files || {}));
    this.todoMissing = !this.files.has('TODO.md');
    this.loops = {};
    for (const id of LOOP_ORDER) this.loops[id] = { running: false, context: null, agents: [], restart: null };
    this.settings = {}; // loopBoard.* user values (globalValue)
    this.frames = {};
    this.handlers = {};
    this.log = [];
    this.fileListeners = [];
    this.stage = null; // async (fn, arg) => page.evaluate on the stage
    this.pending = new Set();
    this.nudges = {}; // model -> last nudge line
    this.lastTasks = undefined;
    this.autoPromote = new Set(); // task ids armed by a right-click on Promote (session-only, t-39e2)
    this.canonicalize();
  }

  // Start from exactly what the writers would produce, so the first human edit only changes the
  // lines it is about (the markdown pane highlights the diff).
  canonicalize() {
    const todo = this.read('TODO.md');
    if (todo === undefined) return;
    const doc = parseTodo(todo);
    this.files.set('TODO.md', serializeTodo(doc));
    for (const e of doc.entries) {
      const t = this.read(`tasks/${e.id}.md`);
      if (t !== undefined) this.files.set(`tasks/${e.id}.md`, serializeTaskFile(parseTaskFile(t), e.title, e.id));
    }
    const done = this.read('DONE.md');
    if (done !== undefined) this.files.set('DONE.md', serializeDone(parseDone(done)));
  }

  track(p) {
    const q = Promise.resolve(p).catch((err) => { console.error('host error:', err); });
    this.pending.add(q);
    q.finally(() => this.pending.delete(q));
    return q;
  }
  async idle() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  // ---------------------------------------------------------------- files
  read(p) { return this.files.get(p); }
  write(p, text) {
    const before = this.files.get(p);
    this.files.set(p, text);
    if (p === 'TODO.md') this.todoMissing = false;
    for (const fn of this.fileListeners) fn(p, before, text);
  }
  onWrite(fn) { this.fileListeners.push(fn); }

  // ---------------------------------------------------------------- board
  load() {
    const doc = parseTodo(this.read('TODO.md') || '');
    const tasks = doc.entries.map((entry) => {
      const text = this.read(`tasks/${entry.id}.md`);
      const detail = text === undefined ? emptyDetail() : parseTaskFile(text);
      return {
        ...detail, ...entry, completed: detail.completed,
        unknownLines: [...entry.unknownLines, ...detail.unknownLines], raw: entry.raw, detailRaw: detail.raw,
        hasDetailFile: text !== undefined,
      };
    });
    const done = parseDone(this.read('DONE.md') || '').map((entry) => {
      const text = this.read(`tasks/${entry.id}.md`);
      const detail = text === undefined ? emptyDetail() : parseTaskFile(text);
      return { ...entry, problem: detail.problem, description: detail.description, goals: detail.goals, delivered: detail.delivered };
    });
    return { preamble: doc.preamble, tasks, done };
  }

  setting(key, dflt) {
    return key in this.settings ? this.settings[key] : dflt;
  }
  modelsCfg() {
    const cfg = {};
    for (const id of LOOP_ORDER) {
      cfg[id] = {
        enabled: this.setting(`models.${id}.enabled`, true),
        model: this.setting(`models.${id}.model`, ''),
        effort: this.setting(`models.${id}.effort`, 'medium'),
        groomConcurrency: this.setting(`models.${id}.groomConcurrency`, 3),
      };
    }
    return cfg;
  }

  webBoard() {
    const board = this.load();
    const models = this.modelsCfg();
    const enabled = LOOP_ORDER.filter((id) => models[id].enabled);
    const loops = enabled.map((id) => {
      const l = this.loops[id];
      const custom = models[id].model;
      return {
        id, name: NAMES[id], running: l.running, hint: custom ? `model: ${custom}` : '',
        restart: l.restart,
        context: l.running && l.context ? {
          used: l.context.used, window: l.context.window, percent: Math.round((l.context.used / l.context.window) * 100),
          pending: false, label: describeContext(l.context.used, l.context.window, false),
          threshold: this.setting('contextLimit.percent', 0),
          thresholdLabel: describeThreshold(this.setting('contextLimit.percent', 0), this.setting('contextLimit.action', 'recycle')),
        } : null,
        agents: l.running ? l.agents : [],
      };
    });
    const worker = this.setting('defaultWorkerModel', 'sonnet');
    const groomer = this.setting('defaultGroomerModel', 'opus');
    const web = toWebviewBoard(board, 'acme-api', worker, loops, enabled, groomer, this.autoPromote);
    web.todoMissing = this.todoMissing;
    web.helpUrl = 'https://github.com/SinnConsulting/LoopBoard#get-started';
    web.maxAttachmentSizeMB = 10;
    web.sidebarMarquee = false;
    return web;
  }

  async post(page, msg) {
    const frame = this.frames[page];
    if (!frame) return;
    await frame.evaluate((m) => window.postMessage(m, '*'), msg);
  }

  async refresh() {
    // Steering nudges exactly as the controller computes them (computeNudges on the previous vs
    // the fresh board, formatNudge for the pasted line); scenes print them into loop terminals.
    const tasks = this.load().tasks;
    for (const route of computeNudges(this.lastTasks, tasks, { worker: this.setting('defaultWorkerModel', 'sonnet'), groomer: this.setting('defaultGroomerModel', 'opus') })) {
      this.nudges[route.model] = formatNudge(route.items);
    }
    this.lastTasks = tasks;
    const web = this.webBoard();
    await this.post('board', { type: 'board', board: web });
    await this.post('sidebar', { type: 'board', board: web });
    if (this.stage) await this.stage((n) => window.stage.badge(n), web.badge.count);
    return web;
  }

  toast(level, text, icon, taskId) {
    return this.post('board', { type: 'toast', level, text, icon, taskId });
  }

  // ---------------------------------------------------------------- settings page
  settingsSections() {
    const c = MANIFEST.contributes.configuration;
    return Array.isArray(c) ? c : [c];
  }
  async postSettings() {
    const sections = this.settingsSections();
    const values = {};
    for (const key of formKeys(sections)) {
      const short = key.replace(/^loopBoard\./, '');
      const prop = sections.flatMap((s) => Object.entries(s.properties || {})).find(([k]) => k === key);
      values[key] = { defaultValue: prop ? prop[1].default : undefined, globalValue: short in this.settings ? this.settings[short] : undefined };
    }
    const grid = buildModelGrid(this.modelsCfg(), this.setting('defaultWorkerModel', 'sonnet'), this.setting('defaultGroomerModel', 'opus'));
    await this.post('settings', { type: 'settings', form: buildSettingsForm(sections, values), grid, extensionId: 'SinnConsulting.loopboard-todo' });
  }
  applyConfigPatch(patch) {
    const short = patch.key.replace(/^loopBoard\./, '');
    if (patch.value === undefined) delete this.settings[short];
    else this.settings[short] = patch.value;
  }

  // ---------------------------------------------------------------- messages
  on(type, fn) { this.handlers[type] = fn; }

  async receive(page, msg) {
    this.log.push({ page, msg });
    const custom = this.handlers[msg.type];
    if (custom && (await custom(msg, page)) !== undefined) return;
    switch (msg.type) {
      case 'ready':
        return this.refresh();
      case 'settingsReady':
        return this.postSettings();
      case 'patch':
        return this.onPatch(msg.patch);
      case 'gate':
        return this.onGate(msg.taskId, msg.action);
      // Right-click Promote (controller.onArmPromote / disarmPromote): only the arm set changes;
      // the auto-promote itself is fired by the scene, since its quiet period is scripted time.
      case 'armPromote':
        this.autoPromote.add(msg.taskId);
        return this.refresh();
      case 'disarmPromote':
        this.autoPromote.delete(msg.taskId);
        return this.refresh();
      case 'createDraft':
        this.createDraft(msg.text, msg.groomer || this.setting('defaultGroomerModel', 'opus'), msg.model || this.setting('defaultWorkerModel', 'sonnet'));
        await this.toast('info', 'Draft saved — the loop will groom it into a story.');
        return this.refresh();
      case 'reveal':
        return this.post('board', { type: 'reveal', taskId: msg.taskId, phase: msg.phase, composer: !!msg.composer, search: msg.search });
      case 'settingsPatch': {
        const control = findControl(buildSettingsForm(this.settingsSections()), msg.key);
        const r = control && toConfigPatch(control, msg.value);
        if (r && r.ok) this.applyConfigPatch(r.patch);
        await this.postSettings();
        return this.refresh();
      }
      case 'gridPatch': {
        const grid = buildModelGrid(this.modelsCfg(), this.setting('defaultWorkerModel', 'sonnet'), this.setting('defaultGroomerModel', 'opus'));
        const r = gridPatch(grid, msg.slot, msg.field, msg.value);
        if (r.ok) for (const p of r.patches) this.applyConfigPatch(p);
        await this.postSettings();
        return this.refresh();
      }
      default:
        return undefined;
    }
  }

  async onPatch(patch) {
    if (patchTarget(patch.field) === 'index') {
      const doc = parseTodo(this.read('TODO.md') || '');
      const r = applyPatch(doc, patch);
      if (r.status === 'applied') this.write('TODO.md', serializeTodo(doc));
    } else {
      const doc = parseTodo(this.read('TODO.md') || '');
      const entry = doc.entries.find((e) => e.id === patch.taskId);
      const text = this.read(`tasks/${entry.id}.md`);
      const detail = text === undefined ? emptyDetail() : parseTaskFile(text);
      const r = applyDetailPatch(detail, patch);
      if (r.status === 'applied') this.write(`tasks/${entry.id}.md`, serializeTaskFile(detail, entry.title, entry.id));
    }
    return this.refresh();
  }

  async onGate(taskId, action) {
    const doc = parseTodo(this.read('TODO.md') || '');
    const idx = doc.entries.findIndex((e) => e.id === taskId);
    const entry = doc.entries[idx];
    const text = this.read(`tasks/${taskId}.md`);
    const detail = text === undefined ? emptyDetail() : parseTaskFile(text);
    if (action === 'promote') {
      this.autoPromote.delete(taskId);
      gates.promoteIndex(entry);
      gates.promoteDetail(detail, this.today);
      this.write('TODO.md', serializeTodo(doc));
      this.write(`tasks/${taskId}.md`, serializeTaskFile(detail, entry.title, entry.id));
      await this.toast('success', 'Promoted to Backlog', 'check');
    } else if (action === 'demote') {
      gates.demoteIndex(entry);
      gates.demoteDetail(detail, this.today);
      this.write('TODO.md', serializeTodo(doc));
      this.write(`tasks/${taskId}.md`, serializeTaskFile(detail, entry.title, entry.id));
      await this.toast('success', 'Demoted to New', 'check');
    } else if (action === 'accept') {
      gates.acceptDetail(detail, this.today);
      this.write(`tasks/${taskId}.md`, serializeTaskFile(detail, entry.title, entry.id));
      const done = parseDone(this.read('DONE.md') || '');
      this.write('DONE.md', serializeDone([gates.acceptDoneEntry(entry, this.today), ...done]));
      doc.entries.splice(idx, 1);
      this.write('TODO.md', serializeTodo(doc));
      await this.toast('success', 'Accepted — archived to DONE.md', 'check');
    }
    return this.refresh();
  }

  createDraft(text, groomer, model) {
    const doc = parseTodo(this.read('TODO.md') || '');
    const draft = {
      id: '', title: 'DRAFT: ' + text.trim().replace(/\s+/g, ' '), phase: 'new', checked: false, isDraft: true,
      model: normalizeModel(model || ''), groomer: normalizeGroomer(groomer || ''),
      questions: [], notes: [], feedback: [], unknownLines: [], raw: '',
    };
    doc.entries.push(draft);
    this.write('TODO.md', serializeTodo(doc));
    const skeleton = emptyDetail();
    skeleton.added = this.today;
    this.write(`tasks/${draft.id}.md`, serializeTaskFile(skeleton, draft.title, draft.id));
    return draft.id;
  }

  // ---------------------------------------------------------------- what a LOOP would write
  // Loops edit the markdown directly (they are Claude Code sessions following LOOP.md); these
  // helpers make the same edits through the same parser/writer so the files stay canonical.
  editIndex(taskId, fn) {
    const doc = parseTodo(this.read('TODO.md') || '');
    const entry = doc.entries.find((e) => e.id === taskId);
    fn(entry, doc);
    this.write('TODO.md', serializeTodo(doc));
  }
  editDetail(taskId, fn) {
    const doc = parseTodo(this.read('TODO.md') || '');
    const entry = doc.entries.find((e) => e.id === taskId);
    const text = this.read(`tasks/${taskId}.md`);
    const detail = text === undefined ? emptyDetail() : parseTaskFile(text);
    fn(detail, entry);
    this.write(`tasks/${taskId}.md`, serializeTaskFile(detail, entry.title, entry.id));
  }
}

module.exports = { Host, NAMES };
