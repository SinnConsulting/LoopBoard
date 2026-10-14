# FAQ

### Can tasks run on Haiku?

Yes. `haiku` is a full task model: pick it for **Groom with**, **Work with** or **Review with** on
a card or in the composer, or make it a role default on the settings page. It is also the
Orchestrator's own default model. The Haiku slot was dropped once because the Claude Code CLI
refused `--permission-mode auto` for a Haiku *loop session*. With Claude Code 2.1.296 a Haiku
session starts under every permission mode LoopBoard offers, and a Haiku subagent writing and
editing files under `--permission-mode auto` was verified with 2.1.295 (decisions/loops.md). One
catch: under `--permission-mode plan` the CLI itself runs a `haiku` session on Sonnet.

LoopBoard never picks Haiku (or any model or effort) for you. If Haiku needs more effort to match
Sonnet or Opus on your work, raise its **lowest effort** on the settings page: every spawn on Haiku
is then clamped up to it.

An existing `TODO.md` entry with `model: haiku` or `groomer: haiku`, which older versions showed as
a flagged unparsed line, now parses as a valid value.
