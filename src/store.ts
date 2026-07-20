// Single owner of all TODO.md / DONE.md file IO: load, watch, and (M4) merge-save.
import * as vscode from 'vscode';
import { Board, Task } from './model';
import { parseTodo, parseDone, EDITABLE_PHASES } from './parser';
import { serializeTodo, serializeDone } from './writer';
import { FieldPatch, applyPatch, normalizeModel } from './merge';
import { promote, accept } from './gates';

export interface LoadedBoard {
  board: Board;
  workspaceName: string;
}

export type SaveOutcome = { status: 'applied' | 'conflict' | 'notfound' | 'error'; message?: string };

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

export class Store {
  private root: vscode.Uri;
  private todoUri: vscode.Uri;
  private doneUri: vscode.Uri;
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners: (() => void)[] = [];
  private lastCache: Board | undefined;
  todoMissing = false;

  constructor(private folder: vscode.WorkspaceFolder) {
    this.root = folder.uri;
    this.todoUri = vscode.Uri.joinPath(this.root, 'TODO.md');
    this.doneUri = vscode.Uri.joinPath(this.root, 'DONE.md');
  }

  get workspaceName(): string {
    return this.folder.name;
  }

  dispose(): void {
    for (const w of this.watchers) w.dispose();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  startWatching(): void {
    const pattern = new vscode.RelativePattern(this.folder, '{TODO.md,DONE.md}');
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

  async load(): Promise<Board> {
    const todoText = await this.readFile(this.todoUri);
    this.todoMissing = todoText === undefined;
    const doneText = (await this.readFile(this.doneUri)) ?? '';
    const board = parseTodo(todoText ?? '');
    board.done = parseDone(doneText);
    this.lastCache = board;
    return board;
  }

  // Atomic write: temp file in the same dir, then rename over the target.
  private async atomicWrite(uri: vscode.Uri, text: string): Promise<void> {
    const tmp = uri.with({ path: uri.path + `.tmp-${Date.now()}` });
    await vscode.workspace.fs.writeFile(tmp, ENCODER.encode(text));
    await vscode.workspace.fs.rename(tmp, uri, { overwrite: true });
  }

  // Re-read -> re-parse -> apply one field patch -> serialize whole file -> atomic write.
  async applyFieldPatch(patch: FieldPatch): Promise<SaveOutcome> {
    const board = await this.load();
    const result = applyPatch(board, patch);
    if (result.status !== 'applied') return { status: result.status };
    await this.atomicWrite(this.todoUri, serializeTodo(board));
    return { status: 'applied' };
  }

  // Promote a New task to Backlog.
  async promote(taskId: string, today: string): Promise<SaveOutcome> {
    const board = await this.load();
    if (!promote(board, taskId, today)) return { status: 'notfound' };
    await this.atomicWrite(this.todoUri, serializeTodo(board));
    return { status: 'applied' };
  }

  // Accept a Review task: cut from TODO.md, prepend to DONE.md (newest first).
  async acceptToDone(taskId: string, today: string): Promise<SaveOutcome> {
    const board = await this.load();
    const task = accept(board, taskId, today);
    if (!task) return { status: 'notfound' };
    const newDone = [task, ...(board.done ?? [])];
    await this.atomicWrite(this.todoUri, serializeTodo(board));
    await this.atomicWrite(this.doneUri, serializeDone(newDone));
    return { status: 'applied' };
  }

  async createDraft(text: string, today: string, groomer?: string, model?: string): Promise<SaveOutcome> {
    const board = await this.load();
    const draft: Task = {
      id: '',
      title: 'DRAFT: ' + text.trim().replace(/\s+/g, ' '),
      phase: 'new',
      checked: false,
      isDraft: true,
      model: normalizeModel(model ?? ''),
      groomer: normalizeModel(groomer ?? ''),
      added: today,
      worklog: [],
      links: [],
      dependsOn: [],
      questions: [],
      unknownLines: [],
      raw: '',
    };
    board.tasks.push(draft);
    await this.atomicWrite(this.todoUri, serializeTodo(board));
    return { status: 'applied' };
  }

  // Scaffold TODO.md / DONE.md; never overwrites an existing file.
  async createInitialFiles(todoText: string, doneText: string): Promise<boolean> {
    let created = false;
    if ((await this.readFile(this.todoUri)) === undefined) {
      await this.atomicWrite(this.todoUri, todoText);
      created = true;
    }
    if ((await this.readFile(this.doneUri)) === undefined) {
      await this.atomicWrite(this.doneUri, doneText);
      created = true;
    }
    return created;
  }

  async deleteTask(taskId: string): Promise<SaveOutcome> {
    const board = await this.load();
    const idx = board.tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return { status: 'notfound' };
    board.tasks.splice(idx, 1);
    await this.atomicWrite(this.todoUri, serializeTodo(board));
    return { status: 'applied' };
  }
}

export { EDITABLE_PHASES };
