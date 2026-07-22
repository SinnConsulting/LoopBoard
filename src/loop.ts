// Pure loop-command builder. No vscode imports so it is unit-testable in Docker.
import { Model } from './model';

// Build the tiny bootstrap prompt pasted into a loop terminal: it only names the model and the
// interval; the worker reads the full standing instructions from `.loopboard/LOOP.md`'s
// ## Automation section on every pass (so editing that section retunes running loops).
//
// LOOP.md contains several fenced blocks (layout, workflow, grammars), so we must NOT grab the
// first fence: slice from the `## Automation` heading to the next `## ` heading (or EOF), and
// require a fenced block inside that slice. No block -> undefined (caller warns).
export function buildLoopCommand(loopText: string, model: Model, interval: string): string | undefined {
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

  return (
    `/loop ${interval} You are running as model ${model}. Open .loopboard/LOOP.md, read the loop ` +
    `worker instructions in its Automation section, and follow them exactly for this and every pass.`
  );
}
