// Pure loop-command builder. No vscode imports so it is unit-testable in Docker.
import { Board, Model } from './model';

// Extract the first fenced code block from the Automation section, substitute {MODEL},
// and honor the configured interval by rewriting the template's leading "/loop <interval>".
export function buildLoopCommand(board: Board, model: Model, interval: string): string | undefined {
  const m = board.automation.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!m) return undefined;
  let prompt = m[1].trim();
  prompt = prompt.replace(/\{MODEL\}/g, model);
  prompt = prompt.replace(/^\/loop\s+\S+/, `/loop ${interval}`);
  return prompt;
}
