# Decisions

The decision log lives in [`decisions/`](decisions/), split by topic so concurrent task branches
rarely append to the same file. One line each: what, why; append at the bottom of the closest
matching category file. No new entries go here.

- [decisions/format.md](decisions/format.md) — index/task-file grammar, parser/writer, fixpoint, `rev:`, field semantics.
- [decisions/board-ui.md](decisions/board-ui.md) — webview board/sidebar: cards, markdown, search/filter, notes, attachments, scroll/focus.
- [decisions/loops.md](decisions/loops.md) — terminals, bootstrap prompt, model slots/config, schedules, nudges.
- [decisions/storage.md](decisions/storage.md) — store/merge/gates, `.loopboard/` layout, patch routing, init/scaffold, task-file lifecycle.
- [decisions/tooling.md](decisions/tooling.md) — Docker toolchain, tests/tsconfig split, packaging, release pipeline.
- [decisions/docs.md](decisions/docs.md) — compress skills/rules, line budgets, LOOP.md/CLAUDE.md conventions, renames.
