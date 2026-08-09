// Single owner of all `.loopboard/` file IO: load, watch, and merge-save. This is the only module
// that knows paths. Layout (v2):
//   <workspace>/.loopboard/TODO.md          slim task index (grammar v5)
//   <workspace>/.loopboard/DONE.md          accepted index, newest first (lazy)
//   <workspace>/.loopboard/LOOP.md          rules + loop worker instructions
//   <workspace>/.loopboard/tasks/<id>.md    per-task detail
import * as vscode from 'vscode';
import { Board, DoneEntry, IndexEntry, Task, TaskDetail } from './model';
import { parseTodo, parseDone, EDITABLE_PHASES } from './parser';
import { serializeTodo, serializeDone, serializeEntry } from './writer';
import { parseTaskFile, serializeTaskFile } from './taskfile';
import { FieldPatch, applyPatch, applyDetailPatch, patchTarget, normalizeModel } from './merge';
import { promoteIndex, promoteDetail, demoteIndex, demoteDetail, acceptDetail, acceptDoneEntry } from './gates';
import { syncMarkedSections, syncTodoPreamble, hasMarkers, isEmptyOrMissing } from './sync';
import { Mutex } from './serialize';

export type SaveOutcome = { status: 'applied' | 'conflict' | 'notfound' | 'error'; message?: string };
export type AttachOutcome = SaveOutcome & { path?: string; description?: string; title?: string };
export type DraftOutcome = SaveOutcome & { id?: string };

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

// v1 scope (t-att1, human decision): images only. Size cap is configurable (loopBoard.maxAttachmentSizeMB);
// this default is only used if a caller doesn't pass one.
const ALLOWED_ATTACHMENT_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Keep only the basename, drop anything not alphanumeric/dot/dash/underscore (blocks path
// traversal and shell-hostile characters), and fall back to a safe default if that empties it.
function sanitizeAttachmentFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, '').trim();
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned || 'attachment';
}

function emptyDetail(): TaskDetail {
  return { worklog: [], links: [], dependsOn: [], unknownLines: [], raw: '' };
}

// Canonical serialization of an index entry with `rev:` EXCLUDED — the input to the rev bump
// decision so bumping rev never counts as a content change (avoids a self-perpetuating bump).
function indexFingerprint(entry: IndexEntry): string {
  return serializeEntry({ ...entry, rev: undefined }).join('\n');
}

// Increment the writer-managed change marker. Absent (pre-existing tracker) counts as 0.
function bumpRev(entry: IndexEntry): void {
  entry.rev = (entry.rev ?? 0) + 1;
}

export class Store {
  private loopboardUri: vscode.Uri;
  private todoUri: vscode.Uri;
  private doneUri: vscode.Uri;
  private loopUri: vscode.Uri;
  private tasksDir: vscode.Uri;
  private cacheDir: vscode.Uri;
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners: (() => void)[] = [];
  private _loopText = '';
  // Serializes every mutating file operation so their read -> parse -> apply -> write cycles
  // never interleave. Without this a Save All fan-out (N concurrent applyFieldPatch calls, which
  // VSCode does not serialize) races on TODO.md: a stale read clobbers a just-saved field, and
  // two same-instant writes collide on the shared temp file — data loss (t-rac1).
  private writeLock = new Mutex();
  // Monotonic counter feeding atomicWrite's temp-file name so two writes in the same millisecond
  // never target the same temp path.
  private tmpSeq = 0;
  todoMissing = false;

  constructor(private folder: vscode.WorkspaceFolder) {
    this.loopboardUri = vscode.Uri.joinPath(folder.uri, '.loopboard');
    this.todoUri = vscode.Uri.joinPath(this.loopboardUri, 'TODO.md');
    this.doneUri = vscode.Uri.joinPath(this.loopboardUri, 'DONE.md');
    this.loopUri = vscode.Uri.joinPath(this.loopboardUri, 'LOOP.md');
    this.tasksDir = vscode.Uri.joinPath(this.loopboardUri, 'tasks');
    this.cacheDir = vscode.Uri.joinPath(this.loopboardUri, 'cache');
  }

  get workspaceName(): string {
    return this.folder.name;
  }

  // Resolve a workspace-relative path (e.g. an attachment link's `.loopboard/cache/<id>/<file>`)
  // to a full Uri — keeps path knowledge inside store per the module's one-job charter.
  resolveWorkspacePath(relative: string): vscode.Uri {
    return vscode.Uri.joinPath(this.folder.uri, relative);
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

  private taskCacheDir(id: string): vscode.Uri {
    return vscode.Uri.joinPath(this.cacheDir, id);
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
    const done: DoneEntry[] = [];
    const doneEntries = parseDone(doneText);
    for (const entry of doneEntries) {
      const detailText = await this.readFile(this.taskUri(entry.id));
      const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
      done.push({ ...entry, description: detail.description, delivered: detail.delivered });
    }
    // Once per session: prune cache dirs whose task exists in neither index nor DONE (a task
    // removed outside the board strands its attachments — cleanup otherwise only fires on
    // acceptance or board-side delete). Skipped when TODO.md is missing: an empty index then
    // means "unreadable", not "no tasks", and pruning would wipe every live cache dir.
    if (!this.prunedOrphans && !this.todoMissing) {
      this.prunedOrphans = true;
      const liveIds = new Set<string>([...doc.entries.map((e) => e.id), ...doneEntries.map((e) => e.id)]);
      void this.pruneOrphanedCacheDirs(liveIds);
    }
    return { preamble: doc.preamble, tasks, done };
  }

  private prunedOrphans = false;
  private async pruneOrphanedCacheDirs(liveIds: Set<string>): Promise<void> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(this.cacheDir);
    } catch {
      return; // no cache dir yet
    }
    for (const [name, type] of entries) {
      // Conservative: only id-shaped directories, and only when the id is live nowhere.
      if (type !== vscode.FileType.Directory) continue;
      if (!/^t-[a-z0-9]{4}$/.test(name)) continue;
      if (liveIds.has(name)) continue;
      await this.clearAttachments(name);
    }
  }

  // Atomic write: temp file in the same dir, then rename over the target. The temp name mixes a
  // monotonic counter and a random suffix (not just a millisecond timestamp) so concurrent writes
  // — even in the same millisecond, or from another Store instance — never collide on one temp
  // path (which would let the second rename consume a temp the first already moved, losing the
  // target file).
  private async atomicWrite(uri: vscode.Uri, text: string): Promise<void> {
    const suffix = `${Date.now()}-${this.tmpSeq++}-${Math.random().toString(36).slice(2, 8)}`;
    const tmp = uri.with({ path: `${uri.path}.tmp-${suffix}` });
    await vscode.workspace.fs.writeFile(tmp, ENCODER.encode(text));
    await vscode.workspace.fs.rename(tmp, uri, { overwrite: true });
  }

  private async ensureTasksDir(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.tasksDir);
  }

  // Stage an attachment's bytes under .loopboard/cache/<id>/ (t-att1: images only, ephemeral,
  // cleared on acceptance — see clearAttachments). No task-file grammar change; a returned
  // markdown link reuses the existing description-link rendering.
  // `appendToDescription`: true (default) appends the link to the task's Description directly —
  // used when the caller has no specific field open (whole-card drop, or a brand-new draft).
  // false only stages the bytes and returns the path/link, leaving the caller (a description or
  // answer field already open in the webview) to fold it into that field's own value and persist
  // it via the normal field-patch path, so field-scoped inserts land in the right place.
  async stageAttachment(taskId: string, filename: string, bytes: Uint8Array, maxBytes = DEFAULT_MAX_ATTACHMENT_BYTES, appendToDescription = true): Promise<AttachOutcome> {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_ATTACHMENT_EXT.includes(ext)) {
      return { status: 'error', message: `Only image attachments are supported (${ALLOWED_ATTACHMENT_EXT.join(', ')}).` };
    }
    if (bytes.byteLength > maxBytes) {
      return { status: 'error', message: `Attachment is too large (max ${Math.round(maxBytes / (1024 * 1024))}MB).` };
    }
    const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
    const entry = doc.entries.find((e) => e.id === taskId);
    if (!entry) return { status: 'notfound' };

    const taskCacheDir = this.taskCacheDir(taskId);
    await vscode.workspace.fs.createDirectory(taskCacheDir);
    const safeName = await this.dedupeAttachmentName(taskCacheDir, sanitizeAttachmentFilename(filename));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(taskCacheDir, safeName), bytes);
    const relPath = `.loopboard/cache/${taskId}/${safeName}`;
    if (!appendToDescription) return { status: 'applied', path: relPath };

    // Drafts (t-att1 rework): the raw draft text IS the story the groomer structures, so the
    // link must land there — a link only in the task-file Description never shows in the text
    // and can be lost when grooming rewrites ## Description. Append to the index title instead,
    // as `[name](path)` (image name, then the path in brackets).
    if (entry.isDraft) {
      entry.title = `${entry.title} [${safeName}](${relPath})`;
      bumpRev(entry);
      await this.atomicWrite(this.todoUri, serializeTodo(doc));
      return { status: 'applied', path: relPath, title: entry.title };
    }

    const detailText = await this.readFile(this.taskUri(entry.id));
    const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
    const link = `[${safeName}](${relPath})`;
    detail.description = detail.description ? `${detail.description}\n\n${link}` : link;
    await this.ensureTasksDir();
    await this.atomicWrite(this.taskUri(entry.id), serializeTaskFile(detail, entry.title, entry.id));
    bumpRev(entry);
    await this.atomicWrite(this.todoUri, serializeTodo(doc));
    // Return the task's new Description so the webview can mirror it verbatim — the store stays
    // the single owner of the append format.
    return { status: 'applied', path: relPath, description: detail.description };
  }

  // Rewrite a fresh draft's pending-attachment placeholders (t-att1 rework: the composer inserts
  // `[name](loopboard-pending:<n>)` at the caret while typing — no id/path exists until Save
  // Draft stages the bytes) to the real staged cache paths. A placeholder the user deleted from
  // the text gets its link appended at the end instead, so a staged file is never unreferenced.
  async resolvePendingLinks(taskId: string, files: { token: string; name: string; path: string }[]): Promise<void> {
    if (!files.length) return;
    await this.writeLock.run(async () => {
      const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
      const entry = doc.entries.find((e) => e.id === taskId);
      if (!entry) return;
      let title = entry.title;
      for (const f of files) {
        // Rewrite the whole `[label](token)` link, not just the path: dedupe may have renamed
        // the staged file (image.png → image-2.png) and the label must show the on-disk name.
        const escapedToken = f.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const linkRe = f.token ? new RegExp(`\\[[^\\]]*\\]\\(${escapedToken}\\)`, 'g') : null;
        title = linkRe && linkRe.test(title)
          ? title.replace(linkRe, `[${f.name}](${f.path})`)
          : `${title} [${f.name}](${f.path})`;
      }
      if (title !== entry.title) {
        entry.title = title;
        bumpRev(entry);
        await this.atomicWrite(this.todoUri, serializeTodo(doc));
      }
    });
  }

  // Avoid clobbering an existing file with the same name: name, name-2, name-3, ...
  private async dedupeAttachmentName(dir: vscode.Uri, name: string): Promise<string> {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    let n = 2;
    while (await this.fileExists(vscode.Uri.joinPath(dir, candidate))) {
      candidate = `${stem}-${n}${ext}`;
      n++;
    }
    return candidate;
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  // Remove ONE staged attachment (t-att1 rework: the attachments area's × on a card): delete the
  // file under .loopboard/cache/<id>/ and strip its markdown link(s) from the task's Description.
  // The path must point inside this task's own cache dir (no separators/.. in the filename). The
  // store owns both the delete and the link removal so the webview and disk can't diverge; the
  // returned description lets the webview mirror the result verbatim (same as stageAttachment).
  async removeAttachment(taskId: string, relPath: string): Promise<AttachOutcome> {
    const prefix = `.loopboard/cache/${taskId}/`;
    const name = relPath.startsWith(prefix) ? relPath.slice(prefix.length) : '';
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
      return { status: 'error', message: 'Not a staged attachment of this task.' };
    }
    return this.writeLock.run(async () => {
      const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
      const entry = doc.entries.find((e) => e.id === taskId);
      if (!entry) return { status: 'notfound' as const };
      try {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.taskCacheDir(taskId), name));
      } catch {
        // file already gone — still strip the dangling link below
      }
      const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const linkRe = new RegExp(`[ \\t]*\\[[^\\]]*\\]\\(${escaped}\\)`, 'g');
      // Drafts carry their links in the raw draft text (the index title); strip there too —
      // but never down to an empty title.
      const strippedTitle = entry.title.replace(linkRe, '').replace(/[ \t]{2,}/g, ' ').trim();
      const titleChanged = strippedTitle !== entry.title && strippedTitle.length > 0;
      if (titleChanged) entry.title = strippedTitle;
      const detailText = await this.readFile(this.taskUri(entry.id));
      const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
      const strippedDesc = (detail.description ?? '')
        .replace(linkRe, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const descChanged = strippedDesc !== (detail.description ?? '');
      if (descChanged) {
        detail.description = strippedDesc;
        await this.ensureTasksDir();
        await this.atomicWrite(this.taskUri(entry.id), serializeTaskFile(detail, entry.title, entry.id));
      }
      if (descChanged || titleChanged) {
        bumpRev(entry);
        await this.atomicWrite(this.todoUri, serializeTodo(doc));
      }
      return { status: 'applied' as const, description: detail.description, title: entry.title };
    });
  }

  // Delete a task's staged attachments (t-att1: fires on acceptance to DONE; deleteTask also
  // calls this opportunistically). Best-effort — a missing cache dir is not an error.
  private async clearAttachments(taskId: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.taskCacheDir(taskId), { recursive: true });
    } catch {
      // no cache dir for this task — nothing to clean up
    }
  }

  // Re-read -> re-parse -> apply one field patch -> serialize whole file -> atomic write.
  // Index fields patch TODO.md; detail fields patch tasks/<id>.md (created if absent).
  async applyFieldPatch(patch: FieldPatch): Promise<SaveOutcome> {
    return this.writeLock.run(async () => {
      if (patchTarget(patch.field) === 'index') {
        const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
        const entry = doc.entries.find((e) => e.id === patch.taskId);
        const before = entry ? indexFingerprint(entry) : undefined;
        const result = applyPatch(doc, patch);
        if (result.status !== 'applied') return { status: result.status };
        if (entry && before !== undefined && indexFingerprint(entry) !== before) bumpRev(entry);
        await this.atomicWrite(this.todoUri, serializeTodo(doc));
        return { status: 'applied' };
      }
      // Detail patch: need the index entry for its id + title (writer rewrites the H1).
      const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
      const entry = doc.entries.find((e) => e.id === patch.taskId);
      if (!entry) return { status: 'notfound' };
      const detailText = await this.readFile(this.taskUri(entry.id));
      const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
      const beforeDetail = serializeTaskFile(detail, entry.title, entry.id);
      const result = applyDetailPatch(detail, patch);
      if (result.status !== 'applied') return { status: result.status };
      await this.ensureTasksDir();
      const afterDetail = serializeTaskFile(detail, entry.title, entry.id);
      await this.atomicWrite(this.taskUri(entry.id), afterDetail);
      // A detail-file change bumps the index entry's rev so a loop that reads only TODO.md still
      // sees the task changed (the original miss this feature fixes). Readers never write.
      if (afterDetail !== beforeDetail) {
        bumpRev(entry);
        await this.atomicWrite(this.todoUri, serializeTodo(doc));
      }
      return { status: 'applied' };
    });
  }

  // Promote a New task to Backlog: index patch (phase/checkbox) then detail patch (promoted/worklog).
  async promote(taskId: string, today: string): Promise<SaveOutcome> {
    return this.writeLock.run(async () => {
      const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
      const entry = doc.entries.find((e) => e.id === taskId);
      if (!entry) return { status: 'notfound' };

      const detailText = await this.readFile(this.taskUri(entry.id));
      const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
      const before = indexFingerprint(entry) + '\0' + serializeTaskFile(detail, entry.title, entry.id);
      promoteIndex(entry);
      promoteDetail(detail, today);
      if (indexFingerprint(entry) + '\0' + serializeTaskFile(detail, entry.title, entry.id) !== before) bumpRev(entry);
      await this.atomicWrite(this.todoUri, serializeTodo(doc));

      await this.ensureTasksDir();
      await this.atomicWrite(this.taskUri(entry.id), serializeTaskFile(detail, entry.title, entry.id));
      return { status: 'applied' };
    });
  }

  // Demote a Backlog task back to New: inverse of promote. Re-checks the on-disk phase after
  // re-parsing — a loop may have claimed the task between render and click — and refuses
  // (status: 'conflict') if it's no longer Backlog, so a race never yanks work out from under
  // a worker (Disk wins, same conflict model as field patches).
  async demote(taskId: string, today: string): Promise<SaveOutcome> {
    const doc = parseTodo((await this.readFile(this.todoUri)) ?? '');
    const entry = doc.entries.find((e) => e.id === taskId);
    if (!entry) return { status: 'notfound' };
    if (entry.phase !== 'backlog') return { status: 'conflict' };

    const detailText = await this.readFile(this.taskUri(entry.id));
    const detail = detailText === undefined ? emptyDetail() : parseTaskFile(detailText);
    const before = indexFingerprint(entry) + '\0' + serializeTaskFile(detail, entry.title, entry.id);
    demoteIndex(entry);
    demoteDetail(detail, today);
    if (indexFingerprint(entry) + '\0' + serializeTaskFile(detail, entry.title, entry.id) !== before) bumpRev(entry);
    await this.atomicWrite(this.todoUri, serializeTodo(doc));

    await this.ensureTasksDir();
    await this.atomicWrite(this.taskUri(entry.id), serializeTaskFile(detail, entry.title, entry.id));
    return { status: 'applied' };
  }

  // Accept a Review task: (1) set completed: in the task file; (2) prepend to DONE.md; (3) remove
  // from TODO.md. DONE is written before the index removal so a crash leaves a visible duplicate
  // rather than a lost task. The task file stays in place.
  async acceptToDone(taskId: string, today: string): Promise<SaveOutcome> {
    return this.writeLock.run(async () => {
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
      await this.clearAttachments(entry.id);

      doc.entries.splice(idx, 1);
      await this.atomicWrite(this.todoUri, serializeTodo(doc));
      return { status: 'applied' };
    });
  }

  async createDraft(text: string, _today: string, groomer?: string, model?: string): Promise<DraftOutcome> {
    return this.writeLock.run(async () => {
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
        feedback: [],
        unknownLines: [],
        raw: '',
      };
      doc.entries.push(draft);
      // serializeTodo assigns missing ids in place, so `draft.id` is populated by the time it
      // returns — the id a caller needs to immediately act on this draft (e.g. stage an attachment)
      // without a second read/parse round trip.
      await this.atomicWrite(this.todoUri, serializeTodo(doc));
      return { status: 'applied', id: draft.id };
    });
  }

  // Scaffold `.loopboard/` (TODO.md + LOOP.md + tasks/). Refuses (created: false, no error) if
  // `.loopboard/` already exists — the caller offers syncTemplates()/previewSync() instead.
  async createInitialFiles(todoText: string, loopText: string): Promise<{ created: boolean; error?: string }> {
    return this.writeLock.run(async () => {
      try {
        await vscode.workspace.fs.stat(this.loopboardUri);
        return { created: false };
      } catch {
        // does not exist — scaffold it
      }
      try {
        await vscode.workspace.fs.createDirectory(this.loopboardUri);
        await this.atomicWrite(this.todoUri, todoText);
        await this.atomicWrite(this.loopUri, loopText);
        await vscode.workspace.fs.createDirectory(this.tasksDir);
        return { created: true };
      } catch (err) {
        return { created: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  // Preview what `syncTemplates` would change, without writing anything: whether TODO.md/LOOP.md
  // are missing/empty (full template write), TODO.md's intro/heading scaffold vs. the shipped
  // template, and LOOP.md's marker-fenced sections (or, for a legacy LOOP.md with no markers yet,
  // the one-time full-file replacement).
  async previewSync(todoTemplate: string, loopTemplate: string): Promise<{ summary: string[]; upToDate: boolean }> {
    const todoText = await this.readFile(this.todoUri);
    const loopText = await this.readFile(this.loopUri);
    const summary: string[] = [];

    if (isEmptyOrMissing(todoText)) {
      summary.push('TODO.md is missing or empty and will be created from the template.');
    } else {
      const { changed: todoChanged, legacy: todoLegacy } = syncTodoPreamble(todoText as string, todoTemplate);
      if (todoLegacy) {
        summary.push('TODO.md predates the current format and will be fully replaced (no markers yet).');
      } else if (todoChanged) {
        summary.push('TODO.md: intro out of date.');
      }
    }

    if (isEmptyOrMissing(loopText)) {
      summary.push('LOOP.md is missing or empty and will be created from the template.');
    } else if (!hasMarkers(loopText as string)) {
      summary.push('LOOP.md predates the current format and will be fully replaced (a backup will be saved to LOOP.md.bkp).');
    } else {
      const { changedIds } = syncMarkedSections(loopText as string, loopTemplate);
      if (changedIds.length) summary.push(`LOOP.md: ${changedIds.length} section(s) out of date (${changedIds.join(', ')}).`);
    }

    return { summary, upToDate: summary.length === 0 };
  }

  // Refresh the extension-owned scaffolding of TODO.md and LOOP.md from the shipped templates.
  // A missing/empty file (either) is always fully (re)created from its template. Otherwise never
  // touches task entries (TODO.md) or content outside the markers (LOOP.md), except for a legacy
  // unmarked non-empty LOOP.md, which is backed up to LOOP.md.bkp and fully replaced exactly once.
  async syncTemplates(todoTemplate: string, loopTemplate: string): Promise<SaveOutcome> {
    return this.writeLock.run(async () => {
      try {
        const todoText = await this.readFile(this.todoUri);
        if (isEmptyOrMissing(todoText)) {
          await this.atomicWrite(this.todoUri, todoTemplate);
        } else {
          const { text: newTodo, changed: todoChanged } = syncTodoPreamble(todoText as string, todoTemplate);
          if (todoChanged) await this.atomicWrite(this.todoUri, newTodo);
        }

        const loopText = await this.readFile(this.loopUri);
        if (isEmptyOrMissing(loopText)) {
          await this.atomicWrite(this.loopUri, loopTemplate);
        } else if (!hasMarkers(loopText as string)) {
          await this.atomicWrite(this.loopUri.with({ path: this.loopUri.path + '.bkp' }), loopText as string);
          await this.atomicWrite(this.loopUri, loopTemplate);
        } else {
          const { text: newLoop, changedIds } = syncMarkedSections(loopText as string, loopTemplate);
          if (changedIds.length) await this.atomicWrite(this.loopUri, newLoop);
        }
        return { status: 'applied' };
      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  // Create-only auto-heal: run automatically on activation against an EXISTING `.loopboard/`
  // (a missing directory is the init flow's job, not this). Recreates TODO.md/LOOP.md from their
  // shipped templates only when missing or whitespace-only — a non-empty, user-edited file is left
  // byte-for-byte untouched. Shares `isEmptyOrMissing` with `syncTemplates` so the two paths agree
  // on what counts as "missing or empty".
  async autoHeal(todoTemplate: string, loopTemplate: string): Promise<void> {
    return this.writeLock.run(async () => {
      try {
        await vscode.workspace.fs.stat(this.loopboardUri);
      } catch {
        return; // no .loopboard/ yet — nothing to heal
      }
      if (isEmptyOrMissing(await this.readFile(this.todoUri))) await this.atomicWrite(this.todoUri, todoTemplate);
      if (isEmptyOrMissing(await this.readFile(this.loopUri))) await this.atomicWrite(this.loopUri, loopTemplate);
    });
  }

  // Delete an unaccepted task: remove the index entry AND its task file.
  async deleteTask(taskId: string): Promise<SaveOutcome> {
    return this.writeLock.run(async () => {
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
      await this.clearAttachments(taskId);
      return { status: 'applied' };
    });
  }

  // Delete an accepted task's archive row from DONE.md ONLY. Unlike deleteTask this KEEPS the task
  // file tasks/<id>.md — a Done deletion erases just the accepted-history line, not the detail.
  async deleteDone(taskId: string): Promise<SaveOutcome> {
    return this.writeLock.run(async () => {
      const done = parseDone((await this.readFile(this.doneUri)) ?? '');
      const idx = done.findIndex((e) => e.id === taskId);
      if (idx < 0) return { status: 'notfound' };
      done.splice(idx, 1);
      await this.atomicWrite(this.doneUri, serializeDone(done));
      return { status: 'applied' };
    });
  }
}

export { EDITABLE_PHASES };
