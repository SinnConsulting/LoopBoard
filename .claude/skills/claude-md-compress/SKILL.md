---
name: claude-md-compress
description: Produce a token-reduced, meaning-preserving rewrite of CLAUDE.md — the project instructions loaded into every Claude Code session in this repo — and land it on a task branch once the self-check passes. Always runs in an Opus subagent. Use only when asked to compress, shrink, tighten or reduce the size of CLAUDE.md. Never engages for any other file.
---

# claude-md-compress

## Always run this skill in an Opus subagent

Whoever triggers this skill delegates the actual work to a subagent (Agent tool) with
`model: opus`. Never compress inline in the model currently running — Sonnet, Haiku, or any other
loop worker that happens to hit this file hands the job off. This mirrors `.loopboard/LOOP.md`
Rule 14, which routes New-task grooming to a subagent of the task's `groomer:` model instead of
running it in the main loop.

The subagent does everything below: read the file, compress, run the self-check, and — only on a
pass — write the file and land it on a `task/**` branch (a PR is optional, Rule 7).

## Why this file is different from ordinary docs

`CLAUDE.md` is not documentation. It is the project instruction file Claude Code loads into EVERY
session in this repo, before any work starts — so its length is a fixed token cost paid on every
conversation, and its content is what every agent working here believes about the project. It also
`@`-includes other instruction files, so a dropped or reworded include line silently unloads a
whole ruleset.

"No information loss" is therefore a correctness requirement, not a style nicety. A dropped
negation, a softened "NEVER", a lost scope qualifier, a mangled path, or a renumbered
Non-negotiable is a behavioural change in every future session — including sessions that will
never read the diff that caused it.

**Lossless only.** This pass preserves meaning. Content that has gone obsolete — a stale Critical
learning, a superseded convention — is NOT yours to delete: that is a separate, human-reviewed
edit. If you believe something is obsolete, say so in your report and leave it in the file.

## Untouchable, verbatim

Never alter, reorder, renumber, or drop any of the following. If a proposed compression would
touch one of these, leave that span byte-identical and compress only the prose around it.

1. **Every `@`-include line** (e.g. `@.claude/rules/branch.md`). These load other instruction
   files; a reworded, moved, or dropped include silently unloads a whole ruleset, and the failure
   is invisible — no error, just missing rules.
2. **The Non-negotiable list's numbering.** Its items are referred to by number ("Non-negotiable
   2", "the zero-dependency rule") across tasks, PRs and DECISIONS.md. Renumbering or merging
   items breaks every reference silently.
3. **The Commands fenced code block.** Those are literal `make` targets an agent copies and runs;
   the fence is a contract, not prose.
4. **Every rule cross-reference** — "Rules 1-17", "Rule 2", "Rule 14", and any other pointer into
   `.loopboard/LOOP.md`'s numbering. The numbers are load-bearing and are asserted by the sibling
   `template-loop-compress` skill's own self-check.
5. **Every normative clause.** MUST / NEVER / ONLY statements, exact counts, literal paths,
   filenames, identifiers, settings keys, and command strings.

Code fences, inline code spans, and URLs anywhere in the file are byte-identical in output —
never reflowed, reworded, or re-cased.

## Compression technique

Terseness rules adapted from the `caveman` skill's "full" intensity tier, applied to the
**redundant prose only** — the untouchable list above outranks every rule here.

Drop:
- Articles (a/an/the).
- Filler: just, really, basically, actually, simply.
- Pleasantries and hedging.
- Restated explanations that say the same thing twice; separate sentences stating one constraint
  merge into one.
- Wordy transitions and throat-clearing.

Allowed:
- Sentence fragments.
- Short synonyms — "big" not "extensive", "fix" not "implement a solution for".
- Standard well-known tech acronyms (DB, API, HTTP, PR, CLI).

Never:
- Invent new abbreviations (cfg, impl, req, res, fn). The tokenizer splits them the same as the
  full word: zero tokens saved, reader still decodes. Full word is cheaper AND clearer.
- Use causal arrows (→) — own token, saves nothing.
- Add decorative tables or emoji.
- Narrate tool calls or add meta-commentary.
- Add a word to sound terse. Compression only; style never grows output.

Never remove, soften, or reorder:
- A negation ("never", "not", "no", "except") — a flipped meaning is worse than any token saved.
- A scope qualifier ("only", "exactly", "at most", "regardless of").
- A count, unit, literal path, filename, setting key, or identifier — exact.
- A technical term — exact.
- An example a rule or piece of code depends on for meaning.
- A "Critical learnings" entry. That section exists so a fact is not rediscovered the hard way;
  its entries compress as prose but none of them disappears.

## Writing the result: the self-check gates the write

**Pass:** write the compressed text to `CLAUDE.md` and land it through the normal repo flow —
fetch `main`, branch off `main`, commit and push to a `task/**` branch. No chat-level approval
needed first. `.loopboard/LOOP.md` Rule 7 forbids committing to `main` and makes the PR OPTIONAL:
open one when review is wanted, otherwise the branch is the delivery.

**Fail:** write nothing. Report the failing check(s) and stop. No partial write, no "mostly
passing" candidate, no backup-and-overwrite.

## Self-check before writing

Before writing anything, verify against the input:

- Every `@`-include line present and byte-identical.
- The Non-negotiable list is numbered exactly as in the input, with no gaps, merges, or reorders.
- The Commands fenced block is byte-identical.
- Every code fence, inline code span, and URL in the input still appears, byte-identical, in the
  output.
- Every rule cross-reference ("Rule N", "Rules 1-17") still present, same numbers.
- Every "Critical learnings" entry still present as an entry — count them in and out.
- Spot-check a sample of MUST/NEVER/ONLY clauses, counts, settings keys and paths from the input
  against the output — each must still be present with the same force.
- Report a line-count and section-count delta as a sanity signal; a large unexplained drop is a
  smell, not a win.

Structural validation (fences/headings/includes preserved) is not the same as semantic validation
(meaning preserved); this self-check must reason about meaning, not just shape. If any check
fails, do not write the file and do not commit anything — report the failing check(s) and stop
rather than paper over the gap.

## Relationship to the sibling skill

`template-loop-compress` compresses `media/template-loop.md` and explicitly never engages for any
other file; this skill is its CLAUDE.md counterpart and likewise never engages for any other file.
Two single-file skills, not one generalized compressor — each keeps a tight, auditable untouchable
list, and neither can be pointed at a file it was not written for.

## Provenance

The compression technique is adapted from the `caveman` skill's "full" intensity tier
(https://github.com/JuliusBrussee/caveman) — its drop-articles/filler/hedging rules, fragments,
short synonyms, no-invented-abbreviations reasoning, and no-causal-arrows rule. Adaptation, not a
vendored dependency: only the terseness rules carry over, layered under this skill's own
untouchable list, which always wins. No code, script, or dependency from that project is vendored,
installed, or executed — it is a technique reference only. This skill is markdown instructions,
run by the Opus subagent, matching this repo's Docker-only, zero-runtime-dependency rules.
