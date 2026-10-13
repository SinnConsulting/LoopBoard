# FAQ

### Can tasks run on Haiku?

Yes. `haiku` is a full task model: pick it for **Groom with**, **Work with** or **Review with** on
a card or in the composer, or make it a default on the settings page. The Haiku slot was dropped
once because the Claude Code CLI refused `--permission-mode auto` for a Haiku *loop session*. Haiku
now runs as a subagent of the one Orchestrator loop, inside the Orchestrator's own session and
permission mode, and a Haiku subagent writing and editing files under `auto` was verified with
Claude Code 2.1.295 (decisions/loops.md).

`auto` never picks Haiku (or Fable): it is chosen by hand only. Because Haiku needs more effort to
match Sonnet or Opus, an effort the Orchestrator derives for a Haiku subagent (the rubric for an
`auto` effort, or the implementer's effort for a review) runs one step higher, at most `xhigh`; an
effort you set on the task is used as set.

An existing `TODO.md` entry with `model: haiku` or `groomer: haiku`, which older versions showed as
a flagged unparsed line, now parses as a valid value.
