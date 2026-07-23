// Single owner of all `.loopboard/` file IO: load, watch, and merge-save. This is the only module
// that knows paths. Layout (v2):
//   <workspace>/.loopboard/TODO.md          slim task index (grammar v4)
//   <workspace>/.loopboard/DONE.md          accepted index, newest first (lazy)
//   <workspace>/.loopboard/LOOP.md          rules + loop worker instructions
//   <workspace>/.loopboard/tasks/<id>.md    per-task detail
import * as vscode from 'vscode';
import { Board, IndexEntry, Task, TaskDetail } from './model';
import { parseTodo, parseDone, EDITABLE_PHASES } from './parser';
import { serializeTodo, serializeDone } from './writer';
import { parseTaskFile, serializeTaskFile } from './taskfile';
import { FieldPatch, applyPatch, applyDetailPatch, patchTarget, normalizeModel } from './merge';
import { promoteIndex, promoteDetail, acceptDetail, acceptDoneEntry } from './gates';

export type SaveOutcome = { status: 'applied' | 'conflict' | 'notfound' | 'error'; message?: string };

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

function emptyDetail(): TaskDetail {
  return { worklog: [], links: [], dependsOn: [], unknownLines: [], raw: '' };
}

export class Store {
  private loopboardUri: vscode.Uri;
  private todoUri: vscode.Uri;
  private doneUri: vscode.Uri;
  private loopUri: vscode.Uri;
  private tasksDir: vscode.Uri;
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners: (() => void)[] = [];
  private _loopText = '';
  todoMissing = false;

  constructor(private folder: vscode.WorkspaceFolder) {
    this.loopboardUri = vscode.Uri.joinPath(folder.uri, '.loopboard');
    this.todoUri = vscode.Uri.joinPath(this.loopboardUri, 'TODO.md');
    this.doneUri = vscode.Uri.joinPath(this.loopboardUri, 'DONE.md');
    this.loopUri = vscode.Uri.joinPath(this.loopboardUri, 'LOOP.md');
    this.tasksDir = vscode.Uri.joinPath(this.loopboardUri, 'tasks');
  }

  get workspaceName(): string {
    return this.folder.name;
  }

  // Raw `.loopboard/LOOP.md` text (empty if missing); consumed by buildLoopCommand.
  get loopText(): string {
    return this._loopText;
  }

  dispose(): void {
    for (const w of this.watchers) w.dispose();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  startWatching(): void {
    const pattern = new vscode.RelativePattern(this.folder, '.loopboard/**/*.md');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const fire = () => this.debouncedNotify();
    watcher.onDidChange(fire);
    watcher.onDidCreate(fire);
    watcher.onDidDelete(fire);
    this.watchers.push(watcher);
  }

  private debouncedNotify(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      for (const l of this.listeners) l();
    }, 300);
  }

  private async readFile(uri: vscode.Uri): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return DECODER.decode(bytes);
    } catch {
      return undefined;
    }
  }

  private taskUri(id: string): vscode.Uri {
    return vscode.Uri.joinPath(this.tasksDir, `${id}.md`);
  }

  // Compose a card view-model from an index entry + its (possibly empty) task file.
  private compose(entry: IndexEntry, detail: TaskDetail, hasDetailFile: boolean): Task {
    return {
      ...detail,
      ...entry,
      completed: detail.completed, // detail owns Meta.completed on active tasks
      unknownLines: [...entry.unknownLines, ...detail.unknownLines],
      raw: entry.raw,
      hasDetailFile,
    };
  }

  async load(): Promise<Board> {
    const todoText = await this.readFile(this.todoUri);
    this.todoMissing = todoText === undefined;
    const doneText = (await this.readFile(this.doneUri)) ?? '';
    this._loopText = (await this.readFile(this.loopUri)) ?? '';

    const doc = parseTodo(todoText ?? '');
    const tasks: Task[] = [];
    for (const entry of doc.entries) {
      const detailText = await this.readFile(this.taskUri(entry.id));
      const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
      tasks.push(this.compose(entry, detail, detailText !== undefined));
    }
    return { preamble: doc.preamble, tasks, done: parseDone(doneText) };
  }

  // Atomic write: temp file in the same dir, then rename over the target.
  private async atomicWrite(uri: vscode.Uri, text: string): Promise<void> {
    const tmp = uri.with({ path: uri.path + `.tmp-${Date.now()}` });
    await vscode.workspace.fs.writeFile(tmp, ENCODER.encode(text));
    await vscode.workspace.fs.rename(tmp, uri, { overwrite: true });
  }

  private async ensureTasksDir(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.tasksDir);
  }

  // Re-read -> re-parse -> apply one field patch -> serialize whole file -> atomic write.
  // Index fields patch TODO.md; detail fields patch tasks/<id>.md (created if absent).
  async applyFieldPatch(patch: FieldPatch): Promise<SaveOutcome> {
    if (patchTarget(patch.field) === 'index') {
      const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
      const result = applyPatch(doc, patch);
      if (result.status !== 'applied') return { status: result.status };
      await this.atomicWrite(this.todoUri, serializeTodo(doc));
      return { status: 'applied' };
    }
    // Detail patch: need the index entry for its id + title (writer rewrites the H1).
    const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
    const entry = doc.entries.find((e) => e.id === patch.taskId);
    if (!entry) return { status: 'notfound' };
    const detailText = await this.readFile(this.taskUri(entry.id));
    const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
    const result = applyDetailPatch(detail, patch);
    if (result.status !== 'applied') return { status: result.status };
    await this.ensureTasksDir();
    await this.atomicWrite(this.taskUri(entry.id), serializeTaskFile(detail, entry.title, entry.id));
    return { status: 'applied' };
  }

  // Promote a New task to Backlog: index patch (phase/checkbox) then detail patch (promoted/worklog).
  async promote(taskId: string, today: string): Promise<SaveOutcome> {
    const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
    const entry = doc.entries.find((e) => e.id === taskId);
    if (!entry) return { status: 'notfound' };
    promoteIndex(entry);
    await this.atomicWrite(this.todoUri, serializeTodo(doc));

    const detailText = await this.readFile(this.taskUri(entry.id));
    const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
    promoteDetail(detail, today);
    await this.ensureTasksDir();
    await this.atomicWrite(this.taskUri(entry.id), serializeTaskFile(detail, entry.title, entry.id));
    return { status: 'applied' };
  }

  // Accept a Review task: (1) set completed: in the task file; (2) prepend to DONE.md; (3) remove
  // from TODO.md. DONE is written before the index removal so a crash leaves a visible duplicate
  // rather than a lost task. The task file stays in place.
  async acceptToDone(taskId: string, today: string): Promise<SaveOutcome> {
    const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
    const idx = doc.entries.findIndex((e) => e.id === taskId);
    if (idx < 0) return { status: 'notfound' };
    const entry = doc.entries[idx];

    const detailText = await this.readFile(this.taskUri(entry.id));
    const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
    acceptDetail(detail, today);
    await this.ensureTasksDir();
    await this.atomicWrite(this.taskUri(entry.id), serializeTaskFile(detail, entry.title, entry.id));

    const doneEntry = acceptDoneEntry(entry, today);
    const done = parseDone((await this.readFile(this.doneUri)) ?? '');
    await this.atomicWrite(this.doneUri, serializeDone([doneEntry, ...done]));

    doc.entries.splice(idx, 1);
    await this.atomicWrite(this.todoUri, serializeTodo(doc));
    return { status: 'applied' };
  }

  async createDraft(text: string, _today: string, groomer?: string, model?: string): Promise<SaveOutcome> {
    const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
    const draft: IndexEntry = {
      id: '',
      title: 'DRAFT: ' + text.trim().replace(/\s+/g, ' '),
      phase: 'new',
      checked: false,
      isDraft: true,
      model: normalizeModel(model ?? ''),
      groomer: normalizeModel(groomer ?? ''),
      questions: [],
      notes: [],
      unknownLines: [],
      raw: '',
    };
    doc.entries.push(draft);
    await this.atomicWrite(this.todoUri, serializeTodo(doc));
    return { status: 'applied' };
  }

  // Scaffold `.loopboard/` (TODO.md + LOOP.md + tasks/). Refuses if `.loopboard/` already exists.
  async createInitialFiles(todoText: string, loopText: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.loopboardUri);
      return false; // already exists — never overwrite
    } catch {
      // does not exist — scaffold it
    }
    await vscode.workspace.fs.createDirectory(this.loopboardUri);
    await this.atomicWrite(this.todoUri, todoText);
    await this.atomicWrite(this.loopUri, loopText);
    await vscode.workspace.fs.createDirectory(this.tasksDir);
    return true;
  }

  // Delete an unaccepted task: remove the index entry AND its task file.
  async deleteTask(taskId: string): Promise<SaveOutcome> {
    const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
    const idx = doc.entries.findIndex((e) => e.id === taskId);
    if (idx < 0) return { status: 'notfound' };
    doc.entries.splice(idx, 1);
    await this.atomicWrite(this.todoUri, serializeTodo(doc));
    try {
      await vscode.workspace.fs.delete(this.taskUri(taskId));
    } catch {
      // no task file yet — nothing to delete
    }
    return { status: 'applied' };
  }
}

export { EDITABLE_PHASES };
