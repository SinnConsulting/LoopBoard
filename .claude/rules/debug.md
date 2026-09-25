---
description: Every LoopBoard feature declares its debug-trace events and their level, whatever it reads or acts on. Covers the info/verbose split, the single store sink, logging only at the boundary, and the wording of a log line.
paths:
  - "src/**"
---

# Rules for the debug trace (`loopBoard.debug` = `off | info | verbose`)

## The obligation

* **Every new feature declares its debug events and their level**, whatever it reads or acts on.
  Writing a `.loopboard/` file, reading or acting on VSCode configuration and showing a popup are
  examples, not the list: reading `~/.claude/**` session and transcript files matched none of them,
  and so subagents went unlogged until t-aglg. An external surface you read, an automatic decision
  you make, a hold you do NOT take: each gets a line.

## `info` vs `verbose`

* **`info` is the lifecycle trail**, readable on its own by someone who never turned on `verbose`:
  gates and their request/cancel, loop spawn/recycle/stop/clear, scheduled and automatic restarts
  (fire, defer, skip, cancel), disk-wins conflicts, activation, toast `warning`s, native popups and
  the user's choice on interactive modals, discrete edges of external state (`agents-start` /
  `agents-gone`). A trail that exists only at `verbose` is invisible to a workspace running at
  `info`.
* **`verbose` is per-event detail**: per-patch, attachment, config-read, webview message, refresh
  trigger, template preview, routine toast `success`/`info`, and per-poll snapshots (`agents-read`,
  `context-read`). If it fires on every poll or every keystroke, it is `verbose`.
* `off` writes nothing.

## One sink, at the boundary

* **All lines go through `store.debugLog(level, event, detail)`** (`src/store.ts`) into the
  gitignored `.loopboard/debug.log`. Never a private `console.log`, never an ad-hoc file.
* The only forwarders are the injected `log(level, event, detail)` sinks of `src/terminals.ts` and
  `src/contextreader.ts`, both wired to the store sink.
* **Pure modules stay vscode/store-free.** Log at the store/controller/terminals boundary, never
  thread a logger into a pure module. A pure module that has something worth logging returns it:
  a value, an OUT array (`computeNudges`'s `skipped`), or a rendered detail string
  (`describeAgentEdge`, `describeAgentSide`), and the caller logs it.

## Wording

* **State what was OBSERVED, not what is assumed.** A polled snapshot sees an agent disappear, not
  finish; it says `no longer live`, never `finished`. An edge inferred from two snapshots is an
  edge, not an event.
* **Name a fail-open as a fail-open.** A failed read that the code treats as "nothing there" must
  never log like a confident "nothing there": `no live subagents (session unreadable)`, not
  `no live subagents`. "The log says nothing" must never be indistinguishable from "the check never
  ran".
* **An automatic action that went ahead says why it was allowed to**, not only one that was held.
  `restart-fire`, `context-fire`, `auto-recycle` and `clear-session` carry their agent side, just
  as the `*-defer` lines carry `describeBusy`.
* Use an existing event namespace (`agents-*`, `restart-*`, `context-*`, `loop-*`) before inventing
  a new one, and keep the detail's first token the slot/model or task id it concerns.
