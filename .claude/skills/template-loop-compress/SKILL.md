---
name: template-loop-compress
description: Produce a token-reduced, meaning-preserving rewrite of media/template-loop.md — LoopBoard's upstream source for the standing loop-worker instructions — and land it as a PR once the self-check passes. Always runs in an Opus subagent. Use only when asked to compress, shrink, tighten or reduce the size of media/template-loop.md. Never engages for any other file.
---

# template-loop-compress

## Always run this skill in an Opus subagent

Whoever triggers this skill delegates the actual work to a subagent (Agent tool) with
`model: opus`. Never compress inline in the model currently running — Sonnet, Haiku, or any other
loop worker that happens to hit this file hands the job off. This mirrors `.loopboard/LOOP.md`
Rule 14, which routes New-task grooming to a subagent of the task's `groomer:` model instead of
running it in the main loop.

The subagent does everything below: read the file, compress, run the self-check, and — only on a
pass — write the file and open the PR.

## Why this file is different from ordinary docs

`media/template-loop.md` is not documentation. It is the upstream source of the standing
instructions autonomous loop workers execute. `src/controller.ts:322` reads it, and
`store.syncTemplates` / `store.autoHeal` (`src/store.ts`) push its marked sections into every
user's live `.loopboard/LOOP.md` via `syncMarkedSections` (`src/sync.ts`) on every Sync and on
activation auto-heal. A compression of this file is not local doc drift — it rewrites the
instructions every running loop reads next. "No information loss" is a correctness requirement,
not a style nicety: a dropped negation, a softened "never", a lost scope qualifier, or a
renumbered rule is a behavioural regression in every loop that reads the result.

## Untouchable, verbatim

Never alter, reorder, renumber, or drop any of the following. If a proposed compression would
touch one of these, leave that span byte-identical and compress only the prose around it.

1. **The six sync marker comments**, in order and unmodified: `<!-- loopboard:sync:loop-intro:begin/end -->`,
   `task-index-format`, `task-file-format`, `done-index`, `rules`, `automation`. A missing or
   reordered begin/end pair breaks `extractBlock` (`src/sync.ts`) and forces a full-overwrite sync
   path instead of a marked-section merge — both mutate live user files.
2. **The `## Automation` heading and the first fenced code block inside it.** `src/loop.ts`
   matches `/^##\s+Automation\b/i` and requires a fenced block in that slice to build the
   ~200-char bootstrap prompt that spawns every loop terminal. That block's text must also stay
   apostrophe-free (it rides as single-quoted shell argv).
3. **Rule numbering 1–17.** CLAUDE.md, TODO.md entries, task files, and LOOP.md itself
   cross-reference rules by number ("Rule 16", "Rule 9"). Renumbering or merging rules breaks
   every reference silently.
4. **The task-index-format and task-file-format fenced code blocks.** Field names, their fixed
   order, the phase vocabulary, and the heading names are the contract `parser.ts` / `writer.ts` /
   `taskfile.ts` implement.
5. **Every normative clause.** MUST / NEVER / ONLY statements, exact counts ("at most ONE", "up
   to 3"), date-field semantics, and literal paths/filenames.

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
- Add a word to sound terse. Compression only; style never grows output. No inserted pronoun or
  copula to fake broken grammar. Keep the correct verb form when it costs the same.

Never remove, soften, or reorder:
- A negation ("never", "not", "no", "except") — a flipped meaning is worse than any token saved.
- A scope qualifier ("only", "exactly", "at most", "regardless of").
- A count, unit, date-field name, literal path, filename, or identifier — exact.
- A technical term — exact.
- An example that a rule or piece of code depends on for meaning.

Compressing "never promote a New task yourself" into "never promote New" is fine; dropping
"never" is not.

## Writing the result: self-check gates a write + PR

The self-check below is a hard gate.

**Pass:** write the compressed text to `media/template-loop.md` and land it through the normal
repo flow — fetch `main`, branch off `main`, commit, `gh pr create`. No chat-level approval
needed first. `.loopboard/LOOP.md` Rule 7 already requires every change to arrive via PR and
forbids committing to `main`; the PR review is the human review point, same as every other change
in this repo.

**Fail:** write nothing. Report the failing check(s) and stop. No partial write, no "mostly
passing" candidate, no backup-and-overwrite.

The discipline is non-negotiable because of propagation: this file's marked sections are pushed
into every user's live `.loopboard/LOOP.md` by `store.syncTemplates` / `store.autoHeal`
(`src/sync.ts`). A bad compression that skips the self-check or skips the PR is an unattended
edit of other people's agent instructions.

## Self-check before writing

Before writing anything, verify against the input:

- All six marker comments present, unmodified, and in the same order.
- The `## Automation` heading and its first fenced block are intact, byte-identical, and still
  apostrophe-free.
- Rules are still numbered 1–17 with no gaps, merges, or reorders.
- The task-index-format and task-file-format fenced blocks are byte-identical to the input.
- Every code fence, inline code span, and URL in the input still appears, byte-identical, in the
  output.
- Spot-check a sample of MUST/NEVER/ONLY clauses and counts from the input against the output —
  each must still be present with the same force.
- Report a bullet-count / line-count delta as a sanity signal (a large unexplained drop in bullet
  count is a smell, per the caveman-compress project's own regression history — see below).

If any check fails, do not write the file and do not open a PR — report the failing check(s) and
stop rather than paper over the gap. Structural validation (fences/headings/markers preserved) is
not the same as semantic validation (meaning preserved); this self-check must reason about
meaning, not just shape.

## Provenance

The compression technique above is adapted from the `caveman` skill's "full" intensity tier
(https://github.com/JuliusBrussee/caveman) — its drop-articles/filler/hedging rules, fragments,
short synonyms, no-invented-abbreviations reasoning, and no-causal-arrows rule. Adaptation, not a
vendored dependency: only the terseness rules carry over, layered under this skill's own
untouchable list, which always wins. Caveman's ultra and wenyan tiers, and its persistence /
language / boundary machinery, are out of scope — that is a chat-response style skill, this is a
document compressor.

The validation discipline is informed by a read-only audit of the `caveman-compress` project
(https://github.com/JuliusBrussee/caveman/tree/main/skills/caveman-compress): its lessons on
preserving fences/headings/paths, and its recorded false-pass (structural checks passing while
prose was reordered) and dropped-path regression are the reason the self-check above insists on
semantic checks, not just structural ones. No code, script, or dependency from either project is
vendored, installed, or executed — both are technique references only. This skill is markdown
instructions, run by the Opus subagent, matching this repo's Docker-only,
zero-runtime-dependency rules.
