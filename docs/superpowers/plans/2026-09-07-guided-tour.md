# Guided Tour and Example Wedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a first-time user an in-app guided tour of the five tools and the
shell, running against a loadable example wedding, so the thing that makes
Trousseau worth using — that the tools share one document — is visible before
they have done enough work to discover it themselves.

**Architecture:** Three separated pieces. `lib/tour/steps.ts` is pure step data
with no React. `lib/tour/useTour.tsx` is a context provider holding which
chapter and step are open. `components/tour/TourOverlay.tsx` draws a highlight
ring and a card, mounted once in `app/(app)/layout.tsx` so tour state survives
navigation between tools. Steps point at real controls through `data-tour`
attributes, which are the only change made inside the five tools.

**Tech Stack:** TypeScript, Next.js App Router, React context, `framer-motion`
(already used by `DataManager`), Tailwind with the project's existing design
tokens, Vitest. **No new dependencies.**

**Spec:** [docs/superpowers/specs/2026-09-07-guided-tour-design.md](../specs/2026-09-07-guided-tour-design.md)

## Global Constraints

- **No new runtime dependencies.** No `driver.js`, no Shepherd, no
  `react-joyride`. The overlay is hand-rolled.
- **`Next` always works.** No step ever waits for the user to perform an
  action. There is no gating anywhere in this plan.
- **A missing anchor is never an error.** If a step's anchor is not on the
  page, the card renders centred with no highlight. It must not throw and must
  not show an empty ring somewhere arbitrary.
- **`data-tour` attributes are the only change inside the five tools.** No
  wrapper elements, no restructuring, no new props threaded through a tool.
- **Nothing mounts on `/seat/[token]`.** That route sits outside
  `app/(app)/layout.tsx` deliberately — a guest following a seat link must
  never be offered a tour of tools they cannot open.
- **The tour never auto-starts.** It is always the user's choice.
- **No component tests.** The codebase has none and this plan does not
  introduce the first; `@testing-library/react` is installed but imported by
  zero files. The overlay is verified by hand, as every other panel here is.
- **The example wedding contains nothing resembling real data.** Invented
  names, invented venue, and a date in the future.

## Verified before writing this plan

Checked in the repo, not assumed.

- `app/(app)/layout.tsx` wraps the front page and all five tools, and is where
  `StoreHydrator`, `Header` and `Footer` already mount. It persists across
  client-side navigation, so a provider placed there keeps tour state when the
  user moves from Seating to Timeline.
- `components/shell/DataManager.tsx` is the house pattern for an overlay:
  `AnimatePresence` + `motion.div`, `fixed inset-0 z-50`, `bg-charcoal/40`
  scrim, and an inner `role="dialog"` panel using `rounded-lg border
  border-charcoal/10 bg-parchment shadow-2xl`. The tour card follows it so it
  looks like part of the app.
- `lib/tools.ts` exports `TOOLS`, whose `href` union is exactly
  `"/seating" | "/place-cards" | "/timeline" | "/delegation" | "/group-shots"`.
  Step routes are validated against this plus `"/"`.
- The two genuinely non-obvious controls the spec names both exist:
  `apps/plaque/ui/panels/DataPanel.tsx:115` renders **Use the room**, and
  `apps/cadence/ui/panels/InspectorPanel.tsx:135` renders a field labelled
  **Anchored at**.
- `components/shell/QuickStats.tsx` renders both the four stat tiles
  (`Guests`, `Seated`, `Tables`, `Day blocks`) and the grid of tool cards built
  from `TOOLS`.
- `apps/cadence/ui/ProjectButtons.tsx` has a **Sample day** button calling
  `loadDoc(sampleDoc())` with **no confirmation**, directly beside a **New**
  button that does confirm with
  `confirm("Start a new day? The current one will be replaced.")`.
- `suite/fixtures/guests-150.csv` is synthetic — invented names, with `Table`,
  `Dietary` and `Entree` columns. Safe to base the example wedding on.
- The real wedding files (`wedding.trousseau.json`,
  `data/wedding.trousseau.json`) are gitignored and **must never be read by
  anything in this plan**.

## File Structure

| File | Responsibility |
|---|---|
| `suite/lib/tour/steps.ts` | **Create.** Chapters and steps. Pure data, no React. |
| `suite/lib/tour/steps.test.ts` | **Create.** Shape checks, and the anchor invariant. |
| `suite/lib/tour/useTour.tsx` | **Create.** The context provider and its hook. |
| `suite/lib/tour/exampleWedding.ts` | **Create.** Loading the fixture, and the backup prompt. |
| `suite/lib/tour/exampleWedding.test.ts` | **Create.** The guard: never replaces work without a yes. |
| `suite/public/fixtures/example-wedding.trousseau.json` | **Create.** The same fixture, where the browser can fetch it. |
| `suite/fixtures/example-wedding.trousseau.json` | **Create.** The example wedding, exported from the real app. |
| `suite/components/tour/TourOverlay.tsx` | **Create.** Highlight ring and card. |
| `suite/components/shell/TourButtons.tsx` | **Create.** The two entry points. |
| `suite/app/(app)/layout.tsx` | **Modify.** Wrap in the provider, mount the overlay. |
| `suite/components/shell/Header.tsx` | **Modify.** The "How this works" entry point, and `data-tour` on Data. |
| `suite/components/shell/QuickStats.tsx` | **Modify.** "Take a tour" action, and `data-tour` anchors. |
| Eleven tool files | **Modify.** One `data-tour` attribute each. Listed in Task 4. |
| `suite/apps/cadence/ui/ProjectButtons.tsx` | **Modify.** Sample day gains a confirmation. |

---

## Task 1: The example wedding fixture

**Files:**
- Create: `suite/fixtures/example-wedding.trousseau.json`

**Interfaces:**
- Produces: the fixture file, read by `lib/tour/exampleWedding.ts` (Task 5).

The fixture is **exported from the running application**, not hand-written. A
hand-assembled document is a second, unvalidated opinion about the format; an
exported one is by definition something the app can produce and read.

- [ ] **Step 1: Start the dev server**

```bash
cd suite && npx next dev --port 3300
```

- [ ] **Step 2: Build the wedding in the browser**

Open <http://localhost:3300> and, in this order:

1. **Timeline → Sample day.** Do this first: the sample day carries its own
   event details and will overwrite anything set before it. Then **Save day**.
2. **Seating.** Drag thirteen **Round** tables from the toolbar onto the
   canvas. They are drag-and-drop — clicking the toolbar button does nothing.
3. **Seating → Import CSV**, choosing `suite/fixtures/guests-150.csv`. Accept
   the column mapping and confirm. Then **Save**.
4. **Data.** Set Names to `Alex & Sam`, Venue to `The Old Granary`, and the
   Date to **1 June in two years' time** — a future date, so the front page
   never reads "279 days ago" in a demo.

- [ ] **Step 3: Export it**

Press **Data → Export backup**. Move the downloaded file to
`suite/fixtures/example-wedding.trousseau.json`.

- [ ] **Step 4: Check it contains nothing real**

Do **not** grep for guest names: `guests-150.csv` opens with `Charis,Smith`,
so searching for names from the real wedding produces a false alarm and teaches
you to ignore the check.

Check the two things that actually distinguish the example from real data — the
couple and the venue you just typed:

```bash
node -e "const d=require('./suite/fixtures/example-wedding.trousseau.json');const e=d.event||{};if(e.coupleNames!=='Alex & Sam'||e.venueName!=='The Old Granary'){console.error('NOT the example wedding:',e);process.exit(1)}console.log('ok — example wedding')"
```
Expected: `ok — example wedding`. A non-zero exit means the browser exported a
different document than the one built in Step 2 — most likely a stale profile
holding other work. Do not commit it.

Then confirm it is a complete document:

```bash
node -e "const d=require('./suite/fixtures/example-wedding.trousseau.json');console.log(Object.keys(d),'guests',Object.keys(d.guests||{}).length,'blocks',(d.day&&d.day.blocks||[]).length)"
```
Expected: a `guests` count near 100 and a non-zero block count.

- [ ] **Step 5: Commit**

```bash
git add suite/fixtures/example-wedding.trousseau.json
git commit -m "Add the example wedding, exported from the running app"
```

---

## Task 2: The step definitions

**Files:**
- Create: `suite/lib/tour/steps.ts`
- Create: `suite/lib/tour/steps.test.ts`

**Interfaces:**
- Consumes: `TOOLS` from `@/lib/tools` (for route validation in the test only).
- Produces: `interface TourStep { anchor, title, body, route }`,
  `interface TourChapter { id, title, steps }`,
  `const CHAPTERS: readonly TourChapter[]`,
  `type ChapterId`, and `chapterForRoute(route: string): ChapterId`.
  All consumed by Tasks 3, 6 and 7.

- [ ] **Step 1: Write the failing tests**

Create `suite/lib/tour/steps.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAPTERS, chapterForRoute } from "./steps";

const ROUTES = new Set(["/", "/seating", "/place-cards", "/timeline", "/delegation", "/group-shots"]);

describe("the chapters", () => {
  it("has one chapter per tool, plus the shell", () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual([
      "shell",
      "seating",
      "timeline",
      "place-cards",
      "delegation",
      "group-shots",
    ]);
  });

  it("gives every chapter between four and six steps", () => {
    for (const chapter of CHAPTERS) {
      expect(chapter.steps.length, chapter.id).toBeGreaterThanOrEqual(4);
      expect(chapter.steps.length, chapter.id).toBeLessThanOrEqual(6);
    }
  });

  it("gives every step words to say and a route that exists", () => {
    for (const chapter of CHAPTERS) {
      for (const step of chapter.steps) {
        expect(step.title.length, `${chapter.id}/${step.anchor}`).toBeGreaterThan(0);
        expect(step.body.length, `${chapter.id}/${step.anchor}`).toBeGreaterThan(20);
        expect(ROUTES.has(step.route), `${chapter.id}/${step.anchor} route`).toBe(true);
      }
    }
  });

  it("never repeats an anchor", () => {
    const all = CHAPTERS.flatMap((c) => c.steps.map((s) => s.anchor));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("chapterForRoute", () => {
  it("maps each tool route to its own chapter", () => {
    expect(chapterForRoute("/seating")).toBe("seating");
    expect(chapterForRoute("/group-shots")).toBe("group-shots");
  });

  it("falls back to the shell chapter for anything else", () => {
    expect(chapterForRoute("/")).toBe("shell");
    expect(chapterForRoute("/account")).toBe("shell");
  });
});

/**
 * The invariant that matters.
 *
 * A step whose anchor no longer exists degrades quietly at runtime — the card
 * shows, centred, pointing at nothing. That is right for a user and useless
 * for a maintainer, so renaming a control has to fail here instead. Follows
 * the grep-based pattern in apps/plaque/core/invariants.test.ts.
 */
describe("every anchor exists in the source", () => {
  const roots = ["app", "components", "apps", "lib"];
  const sources: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx|jsx)$/.test(entry)) sources.push(readFileSync(path, "utf8"));
    }
  };
  for (const root of roots) walk(root);
  const haystack = sources.join("\n");

  for (const chapter of CHAPTERS) {
    for (const step of chapter.steps) {
      it(`${chapter.id}: ${step.anchor}`, () => {
        expect(
          haystack.includes(`data-tour="${step.anchor}"`),
          `No element carries data-tour="${step.anchor}". Either add it, or fix the step.`,
        ).toBe(true);
      });
    }
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run from `suite/`: `npx vitest run --project suite lib/tour/steps.test.ts`
Expected: FAIL — `steps.ts` does not exist, so the import throws.

- [ ] **Step 3: Write the step definitions**

Create `suite/lib/tour/steps.ts`:

```ts
/**
 * What the tour says, and what it points at.
 *
 * Pure data on purpose: the words are the part most likely to be edited, and
 * editing them should not mean reading any React. Each `anchor` matches a
 * `data-tour` attribute on a real control, and `steps.test.ts` fails if one
 * does not.
 *
 * Kept short deliberately. This covers what a tool is *for* and the two or
 * three things that are not self-evident — not every control. A tour long
 * enough to be complete is a tour people abandon in its first chapter.
 */

export interface TourStep {
  /** Matches a `data-tour` attribute on a real control. */
  anchor: string;
  title: string;
  body: string;
  route: string;
}

export interface TourChapter {
  id: ChapterId;
  title: string;
  steps: readonly TourStep[];
}

export type ChapterId =
  | "shell"
  | "seating"
  | "timeline"
  | "place-cards"
  | "delegation"
  | "group-shots";

export const CHAPTERS: readonly TourChapter[] = [
  {
    id: "shell",
    title: "The wedding at a glance",
    steps: [
      {
        anchor: "shell.countdown",
        title: "Your wedding",
        body: "Who is getting married, where, and when. Everything else in Trousseau hangs off these three facts, so it is worth filling them in first.",
        route: "/",
      },
      {
        anchor: "shell.stats",
        title: "Where things stand",
        body: "Guests, how many are seated, tables, and blocks of the day. These count the one shared wedding — not four separate copies of it.",
        route: "/",
      },
      {
        anchor: "shell.tools",
        title: "Five tools, one wedding",
        body: "Each tool owns one part of the day and reads what the others own. Seat someone in Seating and the place cards already know their table. You never type the same guest twice.",
        route: "/",
      },
      {
        anchor: "shell.whatisleft",
        title: "What is left",
        body: "Problems that no single tool can see on its own — a guest seated at a table that no longer exists, a job in a lane that was deleted. Each tool reports its own problems itself.",
        route: "/",
      },
      {
        anchor: "shell.pack",
        title: "The wedding pack",
        body: "One button, one PDF: the floor plan, the run sheet, the job list and the shot list, printed from the wedding as it stands right now.",
        route: "/",
      },
      {
        anchor: "shell.data",
        title: "Your data lives here",
        body: "Everything is saved in this browser as you work. Export a backup from here — without an account, it is the only copy that survives clearing your browser.",
        route: "/",
      },
    ],
  },
  {
    id: "seating",
    title: "Building the room",
    steps: [
      {
        anchor: "seating.toolbar",
        title: "Start with the tables",
        body: "Drag a table shape from here onto the canvas — dragging, not clicking. The room is drawn to scale, so a table that does not fit here will not fit on the day either.",
        route: "/seating",
      },
      {
        anchor: "seating.guests",
        title: "Your guest list",
        body: "Everyone you are inviting, with filters for the ones you tend to look for: unseated, each side, and every dietary requirement.",
        route: "/seating",
      },
      {
        anchor: "seating.import",
        title: "Bring a list you already have",
        body: "Import a CSV from Joy, Zola, The Knot or your own spreadsheet. Trousseau guesses the columns and asks about anything it cannot. Re-importing updates people rather than duplicating them.",
        route: "/seating",
      },
      {
        anchor: "seating.canvas",
        title: "Put people in seats",
        body: "Drag a guest from the list onto a seat. This is the moment the rest of the suite starts being useful — the place cards and the pack read these table numbers.",
        route: "/seating",
      },
      {
        anchor: "seating.overview",
        title: "Who is still standing",
        body: "How many are seated, and the dietary breakdown for your caterer. It updates as you go, so you can stop counting spreadsheet rows.",
        route: "/seating",
      },
    ],
  },
  {
    id: "timeline",
    title: "Planning the day",
    steps: [
      {
        anchor: "timeline.lanes",
        title: "The day, in lanes",
        body: "One lane per strand of the day — the main run of things, suppliers, transport. Lanes let two things happen at once without pretending they are one queue.",
        route: "/timeline",
      },
      {
        anchor: "timeline.add",
        title: "Add what happens",
        body: "A block is anything with a duration: the ceremony, the drinks, the band's setup. Give it a length and a name.",
        route: "/timeline",
      },
      {
        anchor: "timeline.anchor",
        title: "The one thing worth understanding",
        body: "A block is either anchored to a clock time or it simply follows the block before it. Anchor the ceremony, let the rest follow, and moving the ceremony moves the whole afternoon with it. Nothing is recalculated by hand.",
        route: "/timeline",
      },
      {
        anchor: "timeline.problems",
        title: "What collides",
        body: "Two things booked at once, or the day running past your curfew, are flagged while you work rather than discovered on the morning.",
        route: "/timeline",
      },
      {
        anchor: "timeline.export",
        title: "The run sheet",
        body: "Print the day as a timeline or a run sheet. Delegation reads the same times, so a job hanging off the ceremony moves when the ceremony does.",
        route: "/timeline",
      },
    ],
  },
  {
    id: "place-cards",
    title: "Printing the cards",
    steps: [
      {
        anchor: "placecards.useroom",
        title: "Use the room",
        body: "This pulls your guest list in with the table numbers already attached, straight from Seating. This is the button that saves you typing a hundred names again.",
        route: "/place-cards",
      },
      {
        anchor: "placecards.elements",
        title: "Design the card once",
        body: "Add text and images, then bind a text box to a field. Type {{First Name}} or {{Table}} and every card fills itself in with that guest's own details.",
        route: "/place-cards",
      },
      {
        anchor: "placecards.geometry",
        title: "Real millimetres",
        body: "Card size and sheet layout in real units, so what comes out of your printer is the size you asked for. The default is 85 by 55mm, nine to an A4 sheet.",
        route: "/place-cards",
      },
      {
        anchor: "placecards.problems",
        title: "Before you print",
        body: "Missing fonts, images that have not loaded, guests with no table. Trousseau refuses to print a broken card, which is cheaper than finding out after the good card stock has gone through.",
        route: "/place-cards",
      },
      {
        anchor: "placecards.export",
        title: "Print a test first",
        body: "Export the PDF, then print two cards on plain paper and hold them against your real stock before committing the whole sheet.",
        route: "/place-cards",
      },
    ],
  },
  {
    id: "delegation",
    title: "Handing out the jobs",
    steps: [
      {
        anchor: "delegation.day",
        title: "The day, again",
        body: "These are the blocks you made in Timeline, read straight from the same wedding. Change a time there and it changes here — Delegation never keeps its own copy of the schedule.",
        route: "/delegation",
      },
      {
        anchor: "delegation.jobs",
        title: "Jobs hang off the day",
        body: "Add a job to a block: buttonholes before the ceremony, cars after the photos. A job knows when it happens because the block does.",
        route: "/delegation",
      },
      {
        anchor: "delegation.crew",
        title: "Who is doing it",
        body: "Add teams and people, then assign a job by clicking. Someone already on your guest list is picked rather than retyped, so their name is only ever corrected in one place.",
        route: "/delegation",
      },
      {
        anchor: "delegation.export",
        title: "Call sheets",
        body: "Print a sheet per person or per team, so everyone gets their own jobs and their own times instead of the whole plan.",
        route: "/delegation",
      },
    ],
  },
  {
    id: "group-shots",
    title: "The photo list",
    steps: [
      {
        anchor: "groupshots.list",
        title: "Every shot, in order",
        body: "The list your photographer works through on the day. Drag to reorder — group the ones sharing people together and you spend less of the drinks reception rounding up relatives.",
        route: "/group-shots",
      },
      {
        anchor: "groupshots.cast",
        title: "Who's who",
        body: "Name the people who appear again and again — the parents, the siblings, the best man — once. Then a shot is built by picking them rather than typing names.",
        route: "/group-shots",
      },
      {
        anchor: "groupshots.inspector",
        title: "Who is in this one",
        body: "Add people from your guest list or from the cast. Trousseau can also propose the usual shots from families you have already set up in Seating.",
        route: "/group-shots",
      },
      {
        anchor: "groupshots.print",
        title: "A sheet for the photographer",
        body: "Print the list as a PDF or a CSV. It also warns about a shot naming someone who is no longer on the guest list.",
        route: "/group-shots",
      },
    ],
  },
];

const BY_ROUTE = new Map<string, ChapterId>([
  ["/seating", "seating"],
  ["/timeline", "timeline"],
  ["/place-cards", "place-cards"],
  ["/delegation", "delegation"],
  ["/group-shots", "group-shots"],
]);

/** The chapter for wherever the user currently is. Anything unknown gets the shell. */
export function chapterForRoute(route: string): ChapterId {
  return BY_ROUTE.get(route) ?? "shell";
}
```

- [ ] **Step 4: Run the tests**

Run from `suite/`: `npx vitest run --project suite lib/tour/steps.test.ts`
Expected: the four `describe("the chapters")` blocks and both `chapterForRoute`
tests PASS. **The 29 anchor tests FAIL** — no `data-tour` attributes exist yet.
That is correct: Task 4 adds them and turns this suite green.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/tour/steps.ts suite/lib/tour/steps.test.ts
git commit -m "Add the tour's step definitions and the anchor invariant"
```

---

## Task 3: The tour context

**Files:**
- Create: `suite/lib/tour/useTour.tsx`

**Interfaces:**
- Consumes: `CHAPTERS`, `chapterForRoute`, `type ChapterId`, `type TourStep`
  from `./steps` (Task 2).
- Produces: `<TourProvider>`, and `useTour(): TourState` where `TourState` is
  `{ step: TourStep | null; chapterTitle: string; index: number; total: number;
  start(chapter: ChapterId): void; next(): void; back(): void; stop(): void;
  hasSeenTour: boolean }`. Consumed by Tasks 6 and 7.

A context rather than a plain hook because the overlay and the entry-point
buttons sit in different parts of the tree and must share one state.

- [ ] **Step 1: Write the provider**

Create `suite/lib/tour/useTour.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CHAPTERS, type ChapterId, type TourStep } from "./steps";

/**
 * Which chapter and step are open.
 *
 * Held in a context mounted in `app/(app)/layout.tsx`, which persists across
 * client-side navigation — so a chapter that moves the user from Seating to
 * Timeline keeps its place without any extra machinery.
 */

const SEEN_KEY = "trousseau.tour.seen";

/** Storage can throw outright in a private window, so every touch is wrapped. */
function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // A browser refusing storage means the tour is offered again next time,
    // which is a far better failure than not opening at all.
  }
}

export interface TourState {
  /** Null when the tour is closed. */
  step: TourStep | null;
  chapterTitle: string;
  /** One-based, for "3 of 5". */
  index: number;
  total: number;
  start: (chapter: ChapterId) => void;
  next: () => void;
  back: () => void;
  stop: () => void;
  hasSeenTour: boolean;
}

const TourContext = createContext<TourState | null>(null);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ chapter: ChapterId; index: number } | null>(null);
  const [seen, setSeen] = useState(false);

  const chapter = open ? CHAPTERS.find((c) => c.id === open.chapter) : undefined;
  const step = chapter?.steps[open?.index ?? 0] ?? null;

  const go = useCallback(
    (next: { chapter: ChapterId; index: number } | null) => {
      setOpen(next);
      if (!next) return;
      const target = CHAPTERS.find((c) => c.id === next.chapter)?.steps[next.index];
      // Steps carry their own route so a chapter can walk between tools.
      if (target && window.location.pathname !== target.route) router.push(target.route);
    },
    [router],
  );

  const start = useCallback(
    (id: ChapterId) => {
      setSeen(true);
      writeSeen();
      go({ chapter: id, index: 0 });
    },
    [go],
  );

  const next = useCallback(() => {
    if (!open || !chapter) return;
    // The last step of a chapter ends the tour rather than rolling into the
    // next one. Somebody who opened "How this works" on Place cards asked
    // about Place cards, not about everything.
    if (open.index + 1 >= chapter.steps.length) go(null);
    else go({ chapter: open.chapter, index: open.index + 1 });
  }, [chapter, go, open]);

  const back = useCallback(() => {
    if (!open || open.index === 0) return;
    go({ chapter: open.chapter, index: open.index - 1 });
  }, [go, open]);

  const stop = useCallback(() => go(null), [go]);

  const value = useMemo<TourState>(
    () => ({
      step,
      chapterTitle: chapter?.title ?? "",
      index: (open?.index ?? 0) + 1,
      total: chapter?.steps.length ?? 0,
      start,
      next,
      back,
      stop,
      hasSeenTour: seen || (typeof window !== "undefined" && readSeen()),
    }),
    [back, chapter, next, open, seen, start, step, stop],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

/** Throws outside the provider, which is a wiring mistake rather than a user-facing one. */
export function useTour(): TourState {
  const value = useContext(TourContext);
  if (!value) throw new Error("useTour must be used inside <TourProvider>");
  return value;
}
```

- [ ] **Step 2: Type-check**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. If `Cannot find name 'LayoutProps'` appears in
`app/layout.tsx`, that is a phantom from Next's generated `.next/types` — run
`npx next build` once, then re-check.

- [ ] **Step 3: Commit**

```bash
git add suite/lib/tour/useTour.tsx
git commit -m "Add the tour context, which survives moving between tools"
```

---

## Task 4: The anchors

**Files:** eleven tool and shell files, one attribute each. No logic changes.

**Interfaces:**
- Consumes: the anchor names in `CHAPTERS` (Task 2).
- Produces: nothing importable. Turns Task 2's anchor tests green.

Add `data-tour="<name>"` to the outermost element of each control or panel
named below. **Change nothing else** — no wrappers, no restructuring, no props.
An attribute is inert: it cannot alter behaviour and survives restyling.

Where a panel is a component with its own root element, put the attribute on
that root. Where the target is a button, put it on the `<button>`.

- [ ] **Step 1: Shell anchors**

| File | Element | `data-tour` |
| --- | --- | --- |
| `components/shell/Countdown.tsx` | the `<header>` it renders | `shell.countdown` |
| `components/shell/QuickStats.tsx` | the `<dl>`/row holding the four `<Stat>` tiles | `shell.stats` |
| `components/shell/QuickStats.tsx` | the grid wrapping `TOOLS.map(...)` | `shell.tools` |
| `components/shell/WhatIsLeft.tsx` | its root element | `shell.whatisleft` |
| `components/shell/WeddingPack.tsx` | its root element | `shell.pack` |
| `components/shell/Header.tsx` | the `<button>` opening the Data panel | `shell.data` |

- [ ] **Step 2: Seating anchors**

| File | Element | `data-tour` |
| --- | --- | --- |
| `apps/tableaux/components/toolbar/TablePalette.jsx` | its root | `seating.toolbar` |
| `apps/tableaux/components/guestPanel/GuestPanel.jsx` | its root | `seating.guests` |
| `apps/tableaux/components/guestPanel/GuestPanel.jsx` | the **Import CSV** `<button>` inside it | `seating.import` |
| `apps/tableaux/components/canvas/RoomCanvas.jsx` | its root | `seating.canvas` |
| `apps/tableaux/components/sidebar/StatsPanel.jsx` | its root | `seating.overview` |

- [ ] **Step 3: Timeline anchors**

| File | Element | `data-tour` |
| --- | --- | --- |
| `apps/cadence/ui/panels/BlocksPanel.tsx` | its root (it holds the lanes) | `timeline.lanes` |
| `apps/cadence/ui/panels/BlocksPanel.tsx` | the **+ Add** `<button>` (line 65) | `timeline.add` |
| `apps/cadence/ui/panels/InspectorPanel.tsx` | the field labelled **Anchored at** (line 135) | `timeline.anchor` |
| `apps/cadence/ui/WarningsList.tsx` | its root | `timeline.problems` |
| `apps/cadence/ui/ExportBar.tsx` | its root | `timeline.export` |

- [ ] **Step 4: Place cards anchors**

| File | Element | `data-tour` |
| --- | --- | --- |
| `apps/plaque/ui/panels/DataPanel.tsx` | the **Use the room** button (line 115) | `placecards.useroom` |
| `apps/plaque/ui/panels/ElementsPanel.tsx` | its root | `placecards.elements` |
| `apps/plaque/ui/panels/GeometryPanel.tsx` | its root | `placecards.geometry` |
| `apps/plaque/ui/Preflight.tsx` | its root | `placecards.problems` |
| `apps/plaque/ui/ExportBar.tsx` | its root | `placecards.export` |

- [ ] **Step 5: Delegation and Group shots anchors**

| File | Element | `data-tour` |
| --- | --- | --- |
| `apps/brigade/ui/panels/DayPanel.tsx` | its root | `delegation.day` |
| `apps/brigade/ui/panels/JobPanel.tsx` | its root | `delegation.jobs` |
| `apps/brigade/ui/panels/CrewPanel.tsx` | its root | `delegation.crew` |
| `apps/brigade/ui/ExportBar.tsx` | its root | `delegation.export` |
| `components/ensemble/ShotList.tsx` | its root | `groupshots.list` |
| `components/ensemble/CastPanel.tsx` | its root | `groupshots.cast` |
| `components/ensemble/ShotInspector.tsx` | its root | `groupshots.inspector` |
| `components/ensemble/PrintPanel.tsx` | its root | `groupshots.print` |

- [ ] **Step 6: Turn the invariant green**

Run from `suite/`: `npx vitest run --project suite lib/tour/steps.test.ts`
Expected: PASS, all 29 anchor tests included.

**If an anchor cannot be placed** because the control genuinely does not exist
or is not a single element, change the step in `steps.ts` to point at something
that does exist — do not invent a wrapper element to satisfy a step. The tour
describes the app; the app does not bend to the tour.

- [ ] **Step 7: Confirm nothing else moved**

Run from `suite/`: `npx vitest run --project tableaux --project cadence --project plaque --project brigade`
Expected: PASS with the counts unchanged. Attributes cannot change behaviour,
and this proves it.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Anchor the tour to real controls with data-tour attributes"
```

---

## Task 5: Loading the example wedding

**Files:**
- Create: `suite/lib/tour/exampleWedding.ts`

**Interfaces:**
- Consumes: `useTrousseauStore` from `@/lib/store/useTrousseauStore`;
  the fixture from Task 1.
- Produces: `isWeddingEmpty(): boolean` and
  `loadExampleWedding(): Promise<"loaded" | "cancelled">`. Consumed by Task 7.

- [ ] **Step 1: Write it**

Create `suite/lib/tour/exampleWedding.ts`:

```ts
"use client";

import { useTrousseauStore } from "@/lib/store/useTrousseauStore";

/**
 * The example wedding, and the guard in front of it.
 *
 * Replacing somebody's real work with a demo is the worst thing this feature
 * could do, so a non-empty wedding is never overwritten without being told
 * exactly what is about to go and being offered a backup first.
 */

/** Nothing worth losing: no guests and no blocks. */
export function isWeddingEmpty(): boolean {
  const { doc } = useTrousseauStore.getState();
  return Object.keys(doc.guests).length === 0 && (doc.day?.blocks.length ?? 0) === 0;
}

export async function loadExampleWedding(): Promise<"loaded" | "cancelled"> {
  if (!isWeddingEmpty()) {
    const { doc } = useTrousseauStore.getState();
    const guests = Object.keys(doc.guests).length;
    const blocks = doc.day?.blocks.length ?? 0;
    const confirmed = window.confirm(
      `This replaces the wedding in this browser — ${guests} guests and ${blocks} blocks of the day — with the example one.\n\n` +
        `Export a backup first from the Data button if you want to keep it. This cannot be undone.\n\n` +
        `Load the example wedding?`,
    );
    if (!confirmed) return "cancelled";
  }

  const response = await fetch("/fixtures/example-wedding.trousseau.json");
  if (!response.ok) throw new Error("The example wedding could not be loaded.");
  const document: unknown = await response.json();

  // `silent` keeps it out of the undo stack: the user did not make this change
  // by editing, and offering to undo it would offer to restore what they were
  // just warned they were replacing.
  useTrousseauStore.getState().replaceDocument(document, { silent: true });
  return "loaded";
}
```

- [ ] **Step 2: Make the fixture fetchable**

`fetch("/fixtures/...")` serves from `suite/public/`, not `suite/fixtures/`.
Copy it:

```bash
mkdir -p suite/public/fixtures
cp suite/fixtures/example-wedding.trousseau.json suite/public/fixtures/
```

Both copies are committed. `suite/fixtures/` is where the tests read it from,
`suite/public/fixtures/` is what the browser fetches.

- [ ] **Step 3: Add a test that the fixture is a real wedding**

Append to `suite/lib/tour/steps.test.ts`:

```ts
describe("the example wedding", () => {
  it("is a document the app can actually read", async () => {
    const { migrate } = await import("@jfrusher/trousseau");
    const raw = JSON.parse(
      readFileSync("fixtures/example-wedding.trousseau.json", "utf8"),
    ) as unknown;
    const doc = migrate(raw);
    expect(Object.keys(doc.guests).length).toBeGreaterThan(20);
    expect(doc.event.coupleNames.length).toBeGreaterThan(0);
  });

  it("is served to the browser as well as read by tests", () => {
    const served = readFileSync("public/fixtures/example-wedding.trousseau.json", "utf8");
    const source = readFileSync("fixtures/example-wedding.trousseau.json", "utf8");
    expect(served).toBe(source);
  });
});
```

- [ ] **Step 4: Test the guard, which is the whole point of this file**

Create `suite/lib/tour/exampleWedding.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: async () => undefined,
  del: async () => undefined,
}));

const { useTrousseauStore } = await import("@/lib/store/useTrousseauStore");
const { isWeddingEmpty, loadExampleWedding } = await import("./exampleWedding");
const { emptyTrousseau } = await import("@jfrusher/trousseau");

const example = { event: { coupleNames: "Alex & Sam" }, guests: { g1: { id: "g1" } } };

beforeEach(() => {
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "ready",
    error: null,
    raw: doc as unknown as Record<string, unknown>,
    doc,
    past: [],
    future: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => example })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("an untouched wedding is empty, and loads without asking anything", async () => {
  const confirmed = vi.fn(() => false);
  vi.stubGlobal("confirm", confirmed);

  expect(isWeddingEmpty()).toBe(true);
  await expect(loadExampleWedding()).resolves.toBe("loaded");
  // Nothing to lose, so nothing to ask about.
  expect(confirmed).not.toHaveBeenCalled();
});

test("a wedding with guests in it is never replaced without a yes", async () => {
  const doc = { ...emptyTrousseau(), guests: { a: { id: "a" } } };
  useTrousseauStore.setState({ raw: doc as unknown as Record<string, unknown>, doc });
  vi.stubGlobal("confirm", vi.fn(() => false));

  expect(isWeddingEmpty()).toBe(false);
  await expect(loadExampleWedding()).resolves.toBe("cancelled");
  // The refusal has to leave the document exactly as it was.
  expect(Object.keys(useTrousseauStore.getState().doc.guests)).toEqual(["a"]);
});

test("saying yes replaces it, without becoming an undo step", async () => {
  const doc = { ...emptyTrousseau(), guests: { a: { id: "a" } } };
  useTrousseauStore.setState({ raw: doc as unknown as Record<string, unknown>, doc, past: [] });
  vi.stubGlobal("confirm", vi.fn(() => true));

  await expect(loadExampleWedding()).resolves.toBe("loaded");
  expect(useTrousseauStore.getState().doc.event.coupleNames).toBe("Alex & Sam");
  // Silent: offering to undo would offer to restore what the user was just
  // warned they were replacing.
  expect(useTrousseauStore.getState().past).toEqual([]);
});
```

- [ ] **Step 5: Run both test files**

Run from `suite/`: `npx vitest run --project suite lib/tour`
Expected: PASS — the step definitions, the fixture checks and the three guard
tests.

- [ ] **Step 6: Commit**

```bash
git add suite/lib/tour/exampleWedding.ts suite/lib/tour/exampleWedding.test.ts suite/public/fixtures suite/lib/tour/steps.test.ts
git commit -m "Load the example wedding, never over unsaved work without asking"
```

---

## Task 6: The overlay

**Files:**
- Create: `suite/components/tour/TourOverlay.tsx`

**Interfaces:**
- Consumes: `useTour` (Task 3).
- Produces: `<TourOverlay />`, mounted in Task 7.

Follows `components/shell/DataManager.tsx`'s pattern so it looks like part of
the app: `AnimatePresence`, `fixed inset-0 z-50`, and a panel styled
`rounded-lg border border-charcoal/10 bg-parchment shadow-2xl`.

- [ ] **Step 1: Write it**

Create `suite/components/tour/TourOverlay.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useTour } from "@/lib/tour/useTour";

/**
 * The highlight and the card.
 *
 * The anchor is found by attribute rather than by ref, so a tool never has to
 * know the tour exists — the only thing added to the five tools is an inert
 * `data-tour` attribute.
 *
 * A missing anchor is deliberately not an error: the card shows centred with
 * no ring. A control that moved should cost a slightly worse explanation, not
 * a broken page. `steps.test.ts` is what makes sure that never ships silently.
 */

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 6;

export function TourOverlay() {
  const { step, chapterTitle, index, total, next, back, stop } = useTour();
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!step) {
      setBox(null);
      return;
    }

    const locate = () => {
      const target = document.querySelector(`[data-tour="${step.anchor}"]`);
      if (!target) {
        setBox(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setBox({
        top: rect.top - PADDING,
        left: rect.left - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
      });
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    };

    // The route may still be settling after a step that navigates, so look
    // once now and once shortly after rather than assuming the element is
    // already mounted.
    locate();
    const retry = setTimeout(locate, 350);
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => {
      clearTimeout(retry);
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
    };
  }, [step]);

  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, next, step, stop]);

  return (
    <AnimatePresence>
      {step ? (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* The scrim. Clicking it leaves the tour, as the Data panel does. */}
          <div className="absolute inset-0 bg-charcoal/40" onClick={stop} />

          {box ? (
            <motion.div
              className="pointer-events-none absolute rounded-md ring-2 ring-gold ring-offset-2 ring-offset-transparent"
              style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            />
          ) : null}

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${chapterTitle}: ${step.title}`}
            className="absolute bottom-6 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-charcoal/10 bg-parchment p-5 shadow-2xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <p className="text-xs tracking-widest text-slate uppercase">{chapterTitle}</p>
              <button
                type="button"
                onClick={stop}
                aria-label="Close the tour"
                className="-mt-1 -mr-1 rounded p-1 text-slate hover:text-charcoal"
              >
                <X size={16} />
              </button>
            </div>

            <h2 className="font-display text-xl text-charcoal">{step.title}</h2>
            <p className="mt-2 text-sm text-slate">{step.body}</p>

            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs text-slate">
                {index} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={back}
                  disabled={index === 1}
                  className="rounded border border-charcoal/15 px-3 py-1.5 text-sm text-slate transition hover:border-gold hover:text-charcoal disabled:opacity-40 disabled:hover:border-charcoal/15"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="rounded border border-gold bg-gold/15 px-3 py-1.5 text-sm text-charcoal transition hover:bg-gold/25"
                >
                  {index === total ? "Done" : "Next"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Type-check**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add suite/components/tour/TourOverlay.tsx
git commit -m "Add the tour overlay: a ring, a card, and no way to get stuck"
```

---

## Task 7: Wiring it up

**Files:**
- Create: `suite/components/shell/TourButtons.tsx`
- Modify: `suite/app/(app)/layout.tsx`
- Modify: `suite/components/shell/Header.tsx`
- Modify: `suite/components/shell/QuickStats.tsx`

**Interfaces:**
- Consumes: `TourProvider`, `useTour` (Task 3); `TourOverlay` (Task 6);
  `loadExampleWedding`, `isWeddingEmpty` (Task 5); `chapterForRoute` (Task 2).
- Produces: `<TakeTheTour />` and `<HowThisWorks />`.

- [ ] **Step 1: Write the entry points**

Create `suite/components/shell/TourButtons.tsx`:

```tsx
"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Compass, HelpCircle } from "lucide-react";
import { chapterForRoute } from "@/lib/tour/steps";
import { useTour } from "@/lib/tour/useTour";
import { isWeddingEmpty, loadExampleWedding } from "@/lib/tour/exampleWedding";

/**
 * The two ways in.
 *
 * Deliberately only two. A tour offered from everywhere is an interruption;
 * one offered nowhere is never found.
 */

/** The front page: start at the beginning, optionally on the example wedding. */
export function TakeTheTour() {
  const { start, hasSeenTour } = useTour();
  const [busy, setBusy] = useState(false);

  async function begin(withExample: boolean) {
    setBusy(true);
    try {
      if (withExample && (await loadExampleWedding()) === "cancelled") return;
      start("shell");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void begin(false)}
        className="inline-flex items-center gap-2 rounded border border-gold bg-gold/15 px-3 py-2 text-sm text-charcoal transition hover:bg-gold/25 disabled:opacity-50"
      >
        <Compass size={15} />
        {hasSeenTour ? "Take the tour again" : "Take a tour"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void begin(true)}
        className="inline-flex items-center gap-2 rounded border border-charcoal/15 px-3 py-2 text-sm text-slate transition hover:border-gold hover:text-charcoal disabled:opacity-50"
      >
        {isWeddingEmpty() ? "Fill it with an example wedding" : "Replace this with the example wedding"}
      </button>
    </div>
  );
}

/** The header: explain the tool currently open. */
export function HowThisWorks() {
  const { start } = useTour();
  const pathname = usePathname();

  return (
    <button
      type="button"
      onClick={() => start(chapterForRoute(pathname))}
      title="How this page works"
      aria-label="How this page works"
      className="inline-flex shrink-0 items-center rounded border border-charcoal/15 p-1.5 text-slate transition hover:border-gold hover:text-charcoal"
    >
      <HelpCircle size={15} />
    </button>
  );
}
```

- [ ] **Step 2: Mount the provider and the overlay**

Modify `suite/app/(app)/layout.tsx` so the body reads:

```tsx
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { StoreHydrator } from "@/lib/store/StoreHydrator";
import { TourProvider } from "@/lib/tour/useTour";
import { TourOverlay } from "@/components/tour/TourOverlay";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="[--shell-header-h:3.5rem]">
      <StoreHydrator />
      {/* Above the route content, so a chapter that walks from Seating to
          Timeline keeps its place across the navigation. */}
      <TourProvider>
        <Header />
        {children}
        <Footer />
        <TourOverlay />
      </TourProvider>
    </div>
  );
}
```

Leave the file's existing doc comment exactly as it is.

- [ ] **Step 3: Put the help button in the header**

In `suite/components/shell/Header.tsx`, add the import:

```tsx
import { HowThisWorks } from "./TourButtons";
```

and place `<HowThisWorks />` immediately before `<AccountStatus />` at the end
of the header row.

- [ ] **Step 4: Put the tour offer on the front page**

In `suite/components/shell/QuickStats.tsx`, add the import:

```tsx
import { TakeTheTour } from "./TourButtons";
```

and render `<TakeTheTour />` directly below the grid of tool cards, inside the
same container.

- [ ] **Step 5: Type-check and build**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json` then `npx next build`
Expected: both clean.

- [ ] **Step 6: Walk the whole tour by hand**

```bash
cd suite && npx next dev --port 3300
```

Confirm, in a browser:

1. The front page offers **Take a tour**. Pressing it opens the shell chapter
   at step 1 of 6, with a gold ring round the couple's name.
2. **Next** moves through the six shell steps; **Back** works; the counter is
   right; `Escape` closes it.
3. Pressing **Take a tour** with a non-empty wedding and choosing the example
   warns what will be replaced, and **Cancel** genuinely leaves the wedding
   alone.
4. On `/seating`, the header's **?** opens the Seating chapter, not the shell
   one.
5. A step whose control is off-screen scrolls it into view.
6. **Nothing appears on a `/seat/<token>` page.**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Wire the tour into the shell, with two ways in and no more"
```

---

## Task 8: Make Sample day ask first

**Files:**
- Modify: `suite/apps/cadence/ui/ProjectButtons.tsx`

**Interfaces:** none.

The **Sample day** button replaces the current day with no confirmation, beside
a **New** button that does confirm. That is a data-loss trap already, and this
subsystem makes sample data a headline feature, so it is fixed here.

- [ ] **Step 1: Add the confirmation**

In `suite/apps/cadence/ui/ProjectButtons.tsx`, change the Sample day button's
handler from:

```tsx
onClick={() => loadDoc(sampleDoc())}
```

to match the shape **New** already uses immediately above it:

```tsx
onClick={() => {
  // The same guard New has. Replacing a real day with a demo one silently is
  // the one thing this button must not do.
  if (doc.blocks.length > 0 && !confirm("Load the sample day? The current one will be replaced.")) return;
  loadDoc(sampleDoc());
}}
```

- [ ] **Step 2: Confirm Cadence still passes**

Run from `suite/`: `npx vitest run --project cadence`
Expected: PASS, count unchanged.

- [ ] **Step 3: Check it by hand**

With the dev server running, load a day with blocks in it, press **Sample
day**, and confirm it now asks. Press Cancel and confirm the day is untouched.

- [ ] **Step 4: Commit**

```bash
git add suite/apps/cadence/ui/ProjectButtons.tsx
git commit -m "Make Sample day confirm before replacing a day, as New already does"
```

---

## Task 9: Full regression check

**Files:** none created or modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Confirm the tools gained only attributes**

Run: `git diff main -- suite/apps ':(exclude)suite/apps/cadence/ui/ProjectButtons.tsx'`
Expected: every hunk adds a `data-tour="..."` attribute and nothing else. No
logic, no imports, no JSX structure. `ProjectButtons.tsx` is excluded because
Task 8 changes it deliberately.

- [ ] **Step 2: No new dependencies**

Run: `git diff main -- suite/package.json package.json`
Expected: empty.

- [ ] **Step 3: The anchor invariant**

Run from `suite/`: `npx vitest run --project suite lib/tour`
Expected: PASS, every anchor test included.

- [ ] **Step 4: Every project**

Run from `suite/`: `npx vitest run`
Expected: PASS across `suite`, `plaque`, `brigade`, `tableaux` and `cadence`.
The count is the pre-existing 1,588 plus this plan's new tests.

- [ ] **Step 5: The contract package**

Run from the repo root: `npm test`
Expected: PASS, 7 files / 98 tests.

- [ ] **Step 6: Type-check and build**

Run from `suite/`: `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit -p tsconfig.json`
then `npx next build`
Expected: both clean. The `tsbuildinfo` is cleared because it is `incremental`
and can hide changes arriving through the `file:..` symlink to the contract
package.

- [ ] **Step 7: Nothing to commit**

A gate, not a change. If everything passed the branch is ready for review; if
anything failed, fix it, re-run that check, then re-run Steps 1-6 in full.
