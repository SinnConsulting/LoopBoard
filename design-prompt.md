# Prompt for Claude Design — "LoopBoard" VSCode extension UI

Design the complete UI for a VSCode extension called **LoopBoard**. It renders a
markdown task tracker (`TODO.md`) as an interactive board so a human can tick approval
boxes, answer an AI worker's questions, and review finished work — without touching
markdown syntax. The AI workers are Claude Code loops running in terminals; the human
is the gatekeeper. The tool is stared at many times a day in short bursts; the core
job of the design is to answer **"what needs ME right now?"** in under a second.

---

## 1. Deliverables

1. `board.html` — a single self-contained HTML/CSS/JS mockup (inline `<style>` and
   `<script>`, no external assets) of the full board view. Interactive enough to click
   through: phase switching, expanding collapsed inputs, checkbox confirm flows, the
   composer, and toasts must actually work with the sample data below.
2. `sidebar.html` — a second self-contained mockup of the activity-bar sidebar view,
   rendered at 300px width.
3. `design-notes.md` — max 1 page: layout rationale, the attention-color system,
   typography scale, and a list of every CSS custom property you introduced.

Both HTML files must open correctly via `file://` in a browser, and must include a
floating dev-only toggle (top-right corner, clearly marked as mockup-only) that
switches light/dark theme fallbacks so both can be reviewed.

## 2. Hard constraints

- **Vanilla HTML/CSS/JS only.** No React/Vue/Tailwind/Bootstrap, no icon fonts, no CDN
  links, no Google Fonts. Icons are inline SVG (stroke style, 16×16 viewBox, 1.5px
  stroke, `currentColor`). Font stack: `var(--vscode-font-family, -apple-system,
  "Segoe UI", sans-serif)`; code-ish values (dates, ids, branch/PR text) use
  `var(--vscode-editor-font-family, ui-monospace, monospace)`.
- **Theming:** every color MUST be `var(--vscode-*, <fallback>)`. Core mapping:
  - Page background `--vscode-editor-background`; default text `--vscode-foreground`;
    secondary text `--vscode-descriptionForeground`.
  - Cards `--vscode-editorWidget-background` with 1px `--vscode-widget-border`.
  - Inputs `--vscode-input-background` / `--vscode-input-foreground` /
    `--vscode-input-border`, focus ring `--vscode-focusBorder`.
  - Primary buttons `--vscode-button-background`/`-foreground`, secondary
    `--vscode-button-secondaryBackground`.
  - Counts/badges `--vscode-badge-background`/`-foreground`.
  - Attention/warning accents `--vscode-inputValidation-warningBorder` (amber family),
    errors `--vscode-errorForeground`, success/running
    `--vscode-testing-iconPassed` (green family), links `--vscode-textLink-foreground`.
  - Never hardcode a hex except inside the fallback of a `var()`.
- **Type scale (exactly three sizes):** 13px body / 11px meta & chips / 15px semibold
  card titles and pane headers. Line-height 1.5 for body, 1.3 for meta.
- **Spacing on a 4px grid.** Card padding 16px; gap between cards 12px; left-rail item
  height 36px; content pane max-width 860px, centered, 24px pane padding.
- **Radii & elevation:** 6px card radius, 4px inputs/chips/buttons. Flat design —
  borders over shadows; at most one subtle shadow on toasts and open dropdowns.
- **Motion:** 120–150ms ease-out transitions on hover/expand/selection only.
  Exactly two keyframe animations allowed: (a) a 1.6s gentle opacity pulse on
  attention dots, (b) the disk-refresh flash defined in §8. Nothing else moves.
  Honor `prefers-reduced-motion: reduce` by disabling both.
- **Accessibility:** real `<button>/<input>/<textarea>/<select>` elements everywhere;
  visible 2px focus outline using `--vscode-focusBorder`; `aria-label` on icon-only
  buttons; the attention dot has visually-hidden text ("needs your attention");
  checkbox gates are labeled with their consequence, not just "done".

## 3. Board layout (full editor tab)

Two columns: **left rail fixed 25% (min 220px, max 300px)**, content pane the rest.
Rail and pane scroll independently; rail is `position: sticky`.

### 3.1 Left rail, top → bottom

1. **Header (48px):** board title "TODO — {workspace name}" (use `wpc-ol`) + a muted
   "last synced 12s ago" line that updates via the mock script.
2. **Phase list**, workflow order: `New, Backlog, In Progress, Feedback, Review, Done`.
   Each row (36px): phase name · right-aligned count badge · amber attention dot
   (8px, pulsing) shown when the phase needs the human (rules: New = any non-DRAFT
   task; Feedback = any blank answer; Review = any task). Selected row: 3px left
   accent bar `--vscode-focusBorder` + `--vscode-list-activeSelectionBackground`.
   Hover: `--vscode-list-hoverBackground`. Done row is visually muted (archive).
3. **Divider**, then section label "LOOPS" (11px uppercase, letterspaced 0.08em).
   Three rows — `Opus`, `Sonnet`, `Fable` — each: 8px status dot (green =
   `--vscode-testing-iconPassed` when running, grey `--vscode-disabledForeground`
   when stopped) · model name · monospace hint of what it works (`default` on Opus,
   `model: sonnet` etc.) · on the right two 24px icon buttons: ▶ (spawn/focus,
   tooltip "Start loop / focus terminal") and ♻ (recycle, tooltip "Restart with
   fresh context"). ♻ is disabled (40% opacity + not-allowed cursor) when stopped.
   In the mock: Opus running, Sonnet stopped, Fable running.
4. **Divider**, then a full-width primary button **"＋ New story"** (36px).

### 3.2 Content pane

Header row: phase title + one-line phase explainer in muted text (New: "Proposed
tasks — tick to approve into the Backlog" · Backlog: "Approved and waiting for a
worker" · In Progress: "Being worked right now" · Feedback: "The worker is blocked
on your answers" · Review: "Finished work — tick to accept" · Done: "Accepted work,
read-only archive"). Below: task cards in file order, vertical stack.

## 4. Task card anatomy

Base card: 16px padding, header row = 18px checkbox (only where §5 says so) ·
15px semibold title · right-aligned model select. Second row = metadata chips.
Then description, then phase-specific blocks, then footer.

- **Title:** inline-editable — renders as text, on click becomes a borderless input
  with a bottom border in `--vscode-focusBorder`; Enter or blur saves (§7), Esc cancels.
- **Metadata chips (11px, 4px radius, `--vscode-badge-background` at reduced
  opacity):** owner (`@claude` with a tiny robot SVG, or `unassigned` in muted
  italic) · `added 2026-07-08` · `started 2026-07-09` · worklog rendered as
  "3 active days" with the dates in a `title` tooltip · PR links as
  `#142 ↗` anchors in `--vscode-textLink-foreground` · `depends on` as
  `t-3f9a`-style monospace chips (amber-bordered when the dependency is not Done).
- **Model select:** native `<select>` styled to look like a chip; options
  `default (opus)`, `opus`, `sonnet`, `fable`. Saves on change.
- **Description:** auto-growing `<textarea>` (min 2 rows) that looks like plain text
  until hover/focus reveals its input border. Plain text only, no markdown rendering.
- **Note to worker:** collapsed footer link "＋ Note to worker" (11px, muted). Click
  expands an input + "Send" button; helper text: "The worker applies this instruction
  on its next pass, then removes the note." A card with an existing pending note shows
  it as an amber-tinted chip row "Note: ⏳ {text}" with an ✕ to retract.
- **Unparsed-lines chip:** when present, a muted chip "2 unparsed lines" with a
  chevron; expanding shows the raw lines in a monospace block with helper text
  "Kept verbatim in TODO.md — edit the file directly to fix them."

## 5. Phase-specific card variants (mock ALL of these)

- **New:** checkbox labeled via tooltip/aria "Approve → moves to Backlog". Ticking
  animates the card out (150ms fade+collapse) and toasts `Promoted to Backlog ✓`.
  Include one **DRAFT card**: dashed border, muted text of the raw idea, small
  "DRAFT — the loop will structure this into a story" note, robot SVG, no checkbox,
  only a delete (✕) affordance.
- **Backlog:** no checkbox. Show one card with a satisfied dependency chip and one
  with an unmet one (amber).
- **In Progress:** no checkbox. Owner chip emphasized; a subtle "working" indicator
  (green dot + "Opus is on it · last activity today") derived from worklog.
- **Feedback — the centerpiece.** Card gets a 3px amber left border. Each question:
  read-only block (❓ icon, question text on `--vscode-textBlockQuote-background`)
  with an editable **answer** textarea directly beneath, placeholder "Type your answer —
  the worker resumes when every question is answered." Mock one card with two
  questions: first answered (shows saved text + small green check "answered"),
  second blank (amber border + the pulse). A per-card progress line: "1 of 2
  questions answered — worker resumes at 2 of 2."
- **Review:** 3px blue-ish left border (`--vscode-focusBorder`). Blocks in order:
  **DELIVERED** (label + text), PR link row, then **Review feedback** textarea with
  helper "Writing feedback sends the task back to In Progress." Checkbox = accept:
  ticking flips the card footer into an inline confirm — "Accept and archive to
  DONE.md? [Accept] [Cancel]" — only [Accept] performs the move + toast. Mock two
  cards: one clean, one that already carries a ⚠️ feedback text (shown as an amber
  block above the textarea, labeled "Your pending feedback").
- **Done:** compact read-only rows, not cards — 32px each: ✓ icon · title ·
  completed date · PR link. Newest first, "Showing last 50" footer. No hover editing.

## 6. Composer (＋ New story)

Replaces the content pane. 15px header "New story", one large textarea (min 10 rows,
max-width 860px), placeholder: *"Describe the story in your own words — goal, context,
anything you know. An agent will structure it into title, description and tasks."*
Footer: primary **Save draft** (disabled while empty) + secondary Cancel, and a muted
reassurance line "Saved into the New column as a draft. No formatting needed."
On save: return to the New phase with the fresh DRAFT card visible + toast
`Draft saved — the loop will groom it into a story.`

## 7. Save feedback & conflicts

- Field save on blur/Enter: the field's border flashes green once (400ms) and an 11px
  "saved" fades in/out beside it. No global save button, no dirty state.
- Conflict (task changed on disk during the edit): warning toast — amber left border,
  text `"Add price sync": task changed on disk — your edit to Description was not
  applied.` with an inline **Review** action that jumps to the card, which shows a
  one-time amber outline.
- Toasts: bottom-right, 320px wide, stack max 3, auto-dismiss 4s (8s for warnings),
  ✕ to dismiss, `role="status"`.

## 8. Live refresh (loop writes the file ~every minute)

When the file changes on disk, changed cards get a barely-visible refresh flash:
background lightens ~4% and fades back over 600ms. It must be ignorable —
demonstrate it in the mock with a button in the dev toggle ("simulate loop write")
that updates a worklog date and flashes that card.

## 9. Sidebar mockup (`sidebar.html`, 300px)

Top → bottom:
1. **Attention header:** big count "3 items need you", amber dot; or the all-clear
   state "Nothing needs you 🎉" in green.
2. **Attention list**, grouped, each row clickable (mock: highlights): `❓ 1 unanswered
   question — Feedback`, `👀 1 task awaiting review`, `🆕 1 proposal to approve`.
   Row: icon · text · right chevron.
3. **Phase counts:** six compact rows mirroring the rail (name + count only).
4. **Loops:** the three status rows from §3.1 without the hint text.
5. Full-width **Open Board** primary button pinned at the bottom.

## 10. Sample data (use exactly this — software-engineering tasks)

- New: `Add rate limiting middleware to the public REST API` (owner unassigned ·
  added 2026-07-09 · model –) and DRAFT: `"the /orders endpoint sometimes returns 500
  when pagination cursor is stale — maybe we should validate cursors and return 400
  with a hint instead? also add a test for it"` (added 2026-07-10).
- Backlog: `Migrate integration tests from Jest to node:test` (model sonnet ·
  depends on t-9c2e ✓) and `Refactor OrderService: extract pricing into a pure module`
  (model fable · depends on t-11ab, unmet ⚠).
- In Progress: `Fix flaky CI: e2e suite times out on cold Docker cache` (@claude ·
  added 2026-07-08 · started 2026-07-09 · worklog 07-09, 07-10 · model opus ·
  link #138).
- Feedback: `Add retry logic to the webhook dispatcher` (@claude · model opus) —
  Q1 ❓ "Exponential backoff with jitter, or fixed 30s intervals? Backoff risks
  ordering issues for the same target." answered: "Exponential with jitter, cap at
  5 attempts — consumers must be idempotent anyway, ordering is not guaranteed today
  either."; Q2 ❓ "Dead-letter failed webhooks to a DB table or just log and drop
  after the last retry?" unanswered.
- Review: `Fix N+1 queries in the order list endpoint` (@claude · worklog 3 days ·
  link #142 · DELIVERED: "Replaced per-row lookups with a batched JOIN + dataloader;
  p95 latency 840ms → 95ms; added a query-count regression test.") clean — and
  `Add structured logging (pino) to the worker processes` (link #140) with pending
  feedback ⚠️ "Please redact the auth token from the request log fields before I
  accept."
- Done: `Upgrade TypeScript to 5.6 + enable strict mode` (07-07 · #135), `Add
  pre-commit hook running eslint --fix on staged files` (07-05 · #131), `Pin Docker
  base images by digest` (07-01 · #127).

## 11. Out of scope

No settings UI, no drag-and-drop between phases (moves happen via checkboxes and the
loop), no markdown rendering in descriptions, no mobile/responsive below 900px
(assume an editor tab), no real persistence — mock interactions may reset on reload.

## 12. Self-check before you finish

Walk this list and fix anything that fails: both themes legible · every color goes
through `var(--vscode-*)` · exactly 3 font sizes · all interactive elements
keyboard-reachable with visible focus · attention dot visible from 2m squint-test on
the Feedback row · Review accept requires the inline confirm · composer Save disabled
when empty · conflict toast + card highlight demonstrable · reduced-motion kills both
animations.
