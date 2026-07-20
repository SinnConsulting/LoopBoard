// Pure loop-command builder. No vscode imports so it is unit-testable in Docker.
import { Board, Model } from './model';

// Build the tiny bootstrap prompt pasted into a loop terminal: it only names the model and the
// interval; the worker reads the full standing instructions from TODO.md's ## Automation section
// on every pass (so editing that section changes running loops without a terminal restart).
// The Automation section must still contain a fenced instructions block — if it is missing there
// is nothing for the worker to follow, so no command is built (caller warns).
export function buildLoopCommand(board: Board, model: Model, interval: string): string | undefined {
  const m = board.automation.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!m) return undefined;
  return (
    `/loop ${interval} You are running as model ${model}. Open TODO.md, read the loop worker ` +
    `instructions in its ## Automation section, and follow them exactly for this and every pass.`
  );
}
