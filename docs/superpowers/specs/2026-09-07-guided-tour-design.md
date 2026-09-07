# Trousseau — guided tour and the example wedding

Date: 2026-09-07
Status: approved, ready for implementation planning
Scope: a new subsystem. An in-app guided tour across the five tools and the
shell, plus a loadable example wedding for it to run against.

## Why

Trousseau is now something other couples are meant to use, and it opens on an
empty document with five unfamiliar tools across the top. Nothing in the
interface explains what any of them are for, which of them to open first, or
that the tools are connected at all — the connection is the entire point of the
product and it is invisible until you have already done enough work to see it.

The README explains all of this. Almost nobody reads a README before using a
web app, and a non-technical user planning their own wedding certainly will
not.

Two specific things are worth teaching because they are genuinely
non-obvious and nothing on screen hints at them:

- **The tools share one document.** Seat someone, and the place cards already
  know their table. New users have no reason to expect this and will re-enter
  the same guest list twice.
- **A block of the day is either pinned to a time or follows the block before
  it.** That distinction is what makes the timeline ripple when the ceremony
  moves, and it looks like an ordinary field.

## What this is not

- Not a replacement for the README or `docs/SELF-HOSTING.md`.
- Not a feature tour of every control. It covers what a tool is *for* and the
  two or three things that are not self-evident.
- Not a blocker. The tour is never forced, never traps the user, and never
  gates progress on performing an action correctly.

## Decisions

**In-app, not written.** A guided overlay running against the real interface
with real data. Written guides drift out of date the moment the UI moves — the
README had to be rewritten this week for exactly that reason — and a tour
anchored to live controls cannot silently disagree with the app.

**Explain and invite; `Next` always works.** Each step highlights a real
control, says in plain language what it does, and invites the action ("try
dragging a Round table onto the canvas"). It never waits for the user to
perform it. Gating each step on a real action is more engaging and much more
brittle: every gate is somewhere a nervous first-time user can get stuck, and
being trapped in a tutorial you cannot leave is a worse outcome than a tour
that is merely skippable.

**Six chapters, four to six steps each.** One per tool, plus a short shell
chapter covering the Data panel, saving, and what an account adds. Around
twenty-five steps end to end — roughly five minutes. Longer tours get
abandoned, and the abandonment usually happens partway through the first
chapter, which teaches nothing.

**Hand-rolled, no tour library.** The overlay is a highlight ring and a
positioned card. `driver.js` and Shepherd solve positioning and focus-trapping
properly, but they cost a runtime dependency and a styling fight to stop them
looking bolted on, in a codebase that has been deliberate about both. Because
steps never gate on actions, the hard parts of those libraries are not needed.

**The example wedding is a committed fixture, not generated at runtime.** One
`.trousseau.json` file, produced by driving the real application once and
exporting it, so it is genuinely valid rather than hand-assembled and plausible.

**Loading the example offers a backup first.** If the current wedding is not
empty, the user is told exactly what will be replaced and offered **Export
backup** — the button already exists in the Data panel — before anything is
overwritten.

**The tour does not require the example.** Explain-and-invite works against
whatever is on screen. The user is offered the example and may decline and tour
their own wedding.

## Architecture

Three pieces with one responsibility each.

| Unit | Responsibility | Depends on |
|---|---|---|
| `suite/lib/tour/steps.ts` | The step definitions. Pure data, no React. | nothing |
| `suite/lib/tour/useTour.tsx` | A React context provider plus its hook: which chapter and step, next/back/skip, completion. A context rather than a plain hook because the overlay and the entry-point buttons are in different parts of the tree and must share one state. | `steps.ts` |
| `suite/components/tour/TourOverlay.tsx` | The highlight ring and the card. | both above |

A step is:

```ts
interface TourStep {
  /** Matches a `data-tour` attribute on a real control. */
  anchor: string;
  title: string;
  body: string;
  /** Where this step lives. The overlay navigates if the user is elsewhere. */
  route: string;
}
```

**Mount point.** `suite/app/(app)/layout.tsx` — it already wraps the front page
and all five tools, and persists across client-side navigation. Tour state
lives above the route content, so moving from Seating to Timeline mid-chapter
survives without any extra machinery. Nothing is mounted on `/seat/[token]`,
which sits deliberately outside that layout: a guest following a seat link must
never be offered a tour of a planning tool they cannot open.

**Anchors.** Real controls gain a `data-tour="seating.toolbar.round"`
attribute. That is the only change inside the five tools — no wrapper elements,
no restructuring, no new props threaded through. An attribute is inert: it
cannot change behaviour, and it survives a component being restyled.

**A missing anchor is not an error.** If a step's anchor is not on the page,
the overlay shows the card centred with no highlight rather than pointing at
nothing or throwing. A tour is not worth a white screen.

**Entry points.** Two, and no others:

1. A **"Take a tour"** action on the front page, below the tool cards, which
   starts at chapter one and runs through all six.
2. A **"How this works"** item in the header, which starts the chapter for the
   tool currently open — so somebody who only wants to understand Place cards
   is not made to sit through Seating first. On the front page it starts the
   shell chapter.

Both live in `components/shell/`, alongside the existing header and front-page
chrome, and both read the same context the overlay does.

**Persistence.** Completion and dismissal are per browser, in `localStorage`,
wrapped so a browser that refuses storage degrades to offering the tour every
time rather than failing. The tour is never auto-started; it is always the
user's choice.

## The example wedding

One file: `suite/fixtures/example-wedding.trousseau.json`.

It carries a full document — event, guests, seating, timeline, day, crew and
shots — so every chapter has something real to point at. The guests are the
existing synthetic `guests-150.csv` names, which are already in the repo and
already fictional.

**It is produced by driving the real application and exporting**, not written
by hand. A hand-assembled fixture is a second, unvalidated opinion about the
document format; an exported one is by definition something the app can
produce and read.

**Nothing in it may resemble real data.** The names are invented, the venue is
invented, and the date is in the future so the front page does not read "279
days ago" in a screenshot or a demo.

## Fixing a related hazard

`suite/apps/cadence/ui/ProjectButtons.tsx` has a **Sample day** button that
replaces the current day with no confirmation, sitting immediately beside a
**New** button that does confirm. That inconsistency is a data-loss trap
already, and this subsystem makes it worse by making sample data a headline
feature.

Sample day gains the same confirmation New already has. This is in scope
because it is the same hazard this spec is otherwise careful about, and leaving
it would be inconsistent with the loader built here.

## Testing

- **The anchor invariant.** A test asserting that every `anchor` referenced in
  `steps.ts` appears as a `data-tour` attribute somewhere in the source. This
  follows the grep-based pattern in Plaque's `invariants.test.ts`, which the
  architecture audit singled out as a live guardrail against drift. Without it,
  renaming a control silently turns a tour step into a card pointing at
  nothing — the exact failure this design otherwise tolerates at runtime, which
  is fine for a user and unacceptable for a maintainer.
- **Step definitions.** Every chapter has at least one step; every step has a
  non-empty title and body; every `route` is a route that exists.
- **The example wedding parses.** It validates against the contract package's
  schema and passes the cross-slice validator, so a broken fixture fails here
  rather than in front of a new user.
- **The loader.** Refuses to overwrite a non-empty wedding without
  confirmation; leaves the document untouched when declined.
- **No component tests.** The codebase has none, and this spec does not
  introduce the first: `@testing-library/react` is installed but imported by
  zero files. The overlay is verified by hand, as every other panel in this
  project is.

## Explicitly deferred

- **Gating steps on real actions.** Revisit only if the invite-only tour
  demonstrably fails to teach.
- **Translation.** Step text is English, inline. If Trousseau is ever
  translated, the step list is the easy part.
- **A docs page generated from the step definitions.** Attractive, but it needs
  screenshots to be worth reading, and screenshots are the thing that goes
  stale.
- **Auto-starting on first visit.** Deliberately not done. It can be added
  later if real users never find the entry point, which is a question only real
  usage answers.
