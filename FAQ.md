# FAQ

### Why isn't there a Haiku model slot?

The Claude Code CLI does not support `--permission-mode auto` for Haiku, and `auto` is
LoopBoard's default `loopBoard.permissionMode`. A Haiku slot could never run under LoopBoard's
default configuration, so it was dropped. The built-in slots are `opus`, `sonnet`, `fable`.

An existing `TODO.md` entry with `model: haiku` or `groomer: haiku` still parses without
error — the line shows as a flagged unparsed line on its card, and the task routes to the
default worker/groomer model, exactly as if `model:`/`groomer:` were absent.
