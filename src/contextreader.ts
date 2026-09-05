// Thin vscode wrapper around src/context.ts (t-2b89): locates a loop slot's live Claude Code
// session and reads its transcript tail. All the parsing lives in the pure module; this file only
// knows where the files are and how to read them.
//
// These paths are OUTSIDE the workspace, so they deliberately do not go through `store.ts` (which
// owns `.loopboard/` paths and nothing else). `vscode.workspace.fs` works on any local path.
import * as vscode from 'vscode';
import { Model } from './model';
import {
  ContextUsage, encodeProjectDir, matchesSlot, parseSessionPointer, parseTranscriptUsage,
  contextPercent, windowSizeFor,
} from './context';

// The extension host is Node, so the environment is available at runtime — but `@types/node` is
// forbidden (zero devDependencies beyond typescript + @types/vscode), hence this minimal ambient
// declaration. Nothing else in `src/` touches `process`.
declare const process: { env: Record<string, string | undefined> };

// Transcripts grow to tens of MB and only the LAST assistant line matters, so decode just the tail.
// 256 KB comfortably spans several turns even with large tool results.
const TAIL_BYTES = 256 * 1024;

const DECODER = new TextDecoder();

export interface ContextReading {
  sessionId: string;
  used: number;
  window: number;
  percent: number;
}

export class ContextReader {
  // sessionId -> last transcript size + the usage parsed at that size, so an unchanged transcript
  // costs one stat() instead of a multi-MB read.
  private cache = new Map<string, { size: number; usage: ContextUsage }>();

  constructor(
    private getCwd: () => string,
    private log: (level: 'info' | 'verbose', event: string, detail?: string) => void = () => {}
  ) {}

  // `~/.claude`, or wherever CLAUDE_CONFIG_DIR points. Undefined when neither the override nor a
  // home directory is known — the caller then reports no measurement.
  private claudeDir(): vscode.Uri | undefined {
    const override = process.env.CLAUDE_CONFIG_DIR;
    if (override) return vscode.Uri.file(override);
    const home = process.env.HOME || process.env.USERPROFILE;
    return home ? vscode.Uri.joinPath(vscode.Uri.file(home), '.claude') : undefined;
  }

  // The session file for this slot: one `<pid>.json` per LIVE process, matched on our `--name` plus
  // the workspace cwd. The `<pid>.<hash>.key` sidecars in the same directory are a messaging secret
  // — never read them.
  private async findSessionId(model: Model, dir: vscode.Uri): Promise<string | undefined> {
    const sessionsDir = vscode.Uri.joinPath(dir, 'sessions');
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(sessionsDir);
    } catch {
      return undefined;
    }
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
      let text: string;
      try {
        text = DECODER.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(sessionsDir, name)));
      } catch {
        continue;
      }
      const pointer = parseSessionPointer(text);
      if (pointer && matchesSlot(pointer, this.getCwd(), model)) return pointer.sessionId;
    }
    return undefined;
  }

  private async readUsage(dir: vscode.Uri, sessionId: string): Promise<ContextUsage | undefined> {
    const uri = vscode.Uri.joinPath(dir, 'projects', encodeProjectDir(this.getCwd()), `${sessionId}.jsonl`);
    let size: number;
    try {
      size = (await vscode.workspace.fs.stat(uri)).size;
    } catch {
      return undefined;
    }
    const cached = this.cache.get(sessionId);
    if (cached && cached.size === size) return cached.usage;
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      return undefined;
    }
    const whole = bytes.byteLength <= TAIL_BYTES;
    const usage = parseTranscriptUsage(DECODER.decode(whole ? bytes : bytes.slice(bytes.byteLength - TAIL_BYTES)), whole);
    if (!usage) {
      this.log('verbose', 'context-read', `${sessionId} -> no usage line in the transcript tail`);
      return undefined;
    }
    this.cache.set(sessionId, { size, usage });
    return usage;
  }

  // One measurement for one slot. Undefined whenever anything is missing — no session file, no
  // transcript, an unreadable path, a reshaped schema: the feature degrades to showing nothing.
  async read(model: Model, modelString: string): Promise<ContextReading | undefined> {
    const dir = this.claudeDir();
    if (!dir) return undefined;
    const sessionId = await this.findSessionId(model, dir);
    if (!sessionId) return undefined;
    const usage = await this.readUsage(dir, sessionId);
    if (!usage) return undefined;
    const window = windowSizeFor(modelString);
    const percent = contextPercent(usage.used, window);
    this.log('verbose', 'context-read', `${model} ${usage.used}/${window} (${percent}%) session ${sessionId}`);
    return { sessionId, used: usage.used, window, percent };
  }
}
