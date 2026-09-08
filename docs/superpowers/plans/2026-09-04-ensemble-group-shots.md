# Ensemble (Group Shots) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ensemble — a fifth, suite-native tool that builds and prints the family/group photo shot list from the guest list, the room, and a small cast of named roles.

**Architecture:** A new `shots` slice (contract package + suite reader/writer), pure logic in `suite/lib/ensemble/` (resolve, propose, actions, PDF/CSV renderers), and a UI in `suite/components/ensemble/` that reads/writes the shared `useTrousseauStore` directly — no standalone app, no separate store, unlike the four existing tools.

**Tech Stack:** TypeScript, Next.js (suite), Zustand, Zod (contract package), pdf-lib (via Brigade's existing PDF kit), `@dnd-kit/core` + `@dnd-kit/sortable` (already a dependency, newly used), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-04-ensemble-group-shots.md](../specs/2026-09-04-ensemble-group-shots.md)

## Global Constraints

- Cast vocabulary is **bride/groom** (matches `Guest.side`), not partner-neutral.
- Reorder uses **`@dnd-kit/core` + `@dnd-kit/sortable`**, not native HTML5 `draggable`.
- Both suite-wide integrations are in scope: **readiness.ts** rows and the **Wedding Pack** section.
- Ensemble is **suite-native**: no `suite/apps/ensemble/`, no separate Zustand store, no `sliceBridge`, no `toolGeneration` write-guard. It reads/writes `useTrousseauStore` through `useSuite.ts`, exactly like the suite's own chrome does.
- No component-level (React Testing Library) tests are added anywhere in this plan — the codebase has none (`@testing-library/react` is installed but imported by zero files). UI tasks are verified by hand with the dev server, matching how every other tool's panels are actually verified here.
- `suite/lib/data/file.ts`'s `download(filename, data, type?)` takes the filename **first**. Brigade's own `download` (`apps/brigade/state/projectIO.ts`) takes `(bytes, filename)` — do not copy that arg order into suite-native code.
- Every new pure-logic file (`resolve.ts`, `propose.ts`, `actions.ts`, `shotSheet.ts`, `exports.ts`) gets a real Vitest file. Every new React component does not.
- Root package (`c:\Projects\Trousseau`) must be rebuilt (`npm run build`) after any change to `src/` before `suite/`'s typecheck or tests will see it — `@jfrusher/trousseau` resolves to `dist/`.

---

## Task 1: Contract package — `shots` and `timeline` become real slice names

**Files:**
- Modify: `src/slices.ts`
- Modify: `src/envelope.ts`
- Modify: `src/envelope.test.ts`
- Modify: `src/index.ts`
- Modify: `suite/lib/store/useTrousseauStore.ts` (the `SuiteSlice` import/comment/alias near the top, plus every use of `SuiteSlice` in the file)
- Modify: `suite/lib/sync/client.ts:39`
- Modify: `suite/lib/model/timeline.ts:15-18` (comment only)

**Interfaces:**
- Produces: `shotsSchema`, `timelineSchema` (from `src/slices.ts`), both `z.looseObject({}).default(() => ({}))`. `SLICE_NAMES` becomes `["event", "guests", "seating", "day", "crew", "stationery", "shots", "timeline"]`. `SliceName` widens to include `"shots"` and `"timeline"`.

- [ ] **Step 1: Write the failing test**

Add to `src/envelope.test.ts`, replacing the existing `SLICE_NAMES` describe block:

```ts
describe("SLICE_NAMES", () => {
  it("lists exactly the eight publishable slices", () => {
    expect([...SLICE_NAMES]).toEqual([
      "event",
      "guests",
      "seating",
      "day",
      "crew",
      "stationery",
      "shots",
      "timeline",
    ]);
  });

  it("does not include sources, which is not publishable", () => {
    expect(SLICE_NAMES).not.toContain("sources");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `c:\Projects\Trousseau`): `npm test -- envelope.test.ts`
Expected: FAIL — actual array is the six-name list.

- [ ] **Step 3: Add the schemas**

In `src/slices.ts`, add after `stationerySchema`:

```ts
export const shotsSchema = z.looseObject({}).default(() => ({}));
export const timelineSchema = z.looseObject({}).default(() => ({}));

export type Shots = z.infer<typeof shotsSchema>;
export type TimelineSlice = z.infer<typeof timelineSchema>;
```

(Named `TimelineSlice` here, not `Timeline`, so it doesn't collide with the suite's own richer `Timeline` type in `suite/lib/model/timeline.ts` — this package's `Timeline` is still just "an object", per the module's whole reason for existing.)

- [ ] **Step 4: Wire the schemas into the envelope**

In `src/envelope.ts`:

```ts
import { crewSchema, guestsSchema, seatingSchema, shotsSchema, stationerySchema, timelineSchema } from "./slices.js";

export const SLICE_NAMES = [
  "event",
  "guests",
  "seating",
  "day",
  "crew",
  "stationery",
  "shots",
  "timeline",
] as const;
```

And in `trousseauSchema`, after `stationery: stationerySchema,`:

```ts
  shots: shotsSchema,
  timeline: timelineSchema,
```

- [ ] **Step 5: Export the new schemas**

In `src/index.ts`, add `shotsSchema` and `timelineSchema` (and their inferred types) to the `export { ... } from "./slices.js"` block:

```ts
export {
  crewSchema,
  guestsSchema,
  seatingSchema,
  shotsSchema,
  stationerySchema,
  timelineSchema,
  type Crew,
  type Guests,
  type Seating,
  type Shots,
  type Stationery,
  type TimelineSlice,
} from "./slices.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- envelope.test.ts`
Expected: PASS. Also run `npm test` (full suite) — `src/preservation.test.ts` iterates `SLICE_NAMES` generically and should pick up the two new names with no edits needed; confirm it still passes.

- [ ] **Step 7: Rebuild the package**

Run: `npm run build`
This regenerates `dist/`, which `suite/`'s `@jfrusher/trousseau` dependency resolves to. Nothing in `suite/` will see the new slice names until this runs.

- [ ] **Step 8: Collapse `SuiteSlice` back to `SliceName`**

In `suite/lib/store/useTrousseauStore.ts`, find the import block together with the comment and type alias directly below it:

```ts
import {
  emptyTrousseau,
  mergeSlice,
  migrate,
  type SliceName,
  type Trousseau,
} from "@jfrusher/trousseau";

/**
 * The slices this app writes.
 *
 * `timeline` is not one of the contract package's `SLICE_NAMES`: the envelope
 * holds the *resolved* day, and editing needs the anchors and gaps it was
 * resolved from. The envelope is a `looseObject` at every level exactly so a
 * new slice can appear without a release of the package, so this is the
 * intended way in — but the package should gain the name when next touched.
 */
export type SuiteSlice = SliceName | "timeline";
```

and replace that whole block (import, comment, and alias together) with just:

```ts
import {
  emptyTrousseau,
  mergeSlice,
  migrate,
  type SliceName,
  type Trousseau,
} from "@jfrusher/trousseau";
```

Then replace every remaining use of `SuiteSlice` elsewhere in the file with `SliceName` — a search for `SuiteSlice` in this file after the edit above should turn up exactly these:

- `setSlice: (slice: SuiteSlice, value: unknown, options?: WriteOptions) => void;` → `setSlice: (slice: SliceName, value: unknown, options?: WriteOptions) => void;`
- `setSlices: (entries: Array<[SuiteSlice, unknown]>, options?: WriteOptions) => void;` → `setSlices: (entries: Array<[SliceName, unknown]>, options?: WriteOptions) => void;`
- `(acc, [slice, value]) => mergeSlice(acc, slice as SliceName, value),` → `(acc, [slice, value]) => mergeSlice(acc, slice, value),` — the cast is no longer needed since `slice` is now genuinely typed `SliceName`.

- [ ] **Step 9: Fix the sync client's slice list**

In `suite/lib/sync/client.ts`, replace:

```ts
/** The slices that sync. `timeline` is this app's own addition to the envelope. */
const SYNCED: SuiteSlice[] = [...SLICE_NAMES, "timeline"];
```

with:

```ts
const SYNCED: SliceName[] = [...SLICE_NAMES];
```

And update the import: `import { SLICE_NAMES, type SliceName } from "@jfrusher/trousseau";` (drop the `SuiteSlice` import from `@/lib/store/useTrousseauStore` if it's no longer used elsewhere in the file — check with a search for `SuiteSlice` in this file first). Every other use of `SuiteSlice` as a type annotation in this file (`entries: Array<[SuiteSlice, unknown]>`, `take: Array<[SuiteSlice, unknown]>`, the `as SuiteSlice` casts) becomes `SliceName` / drops the cast.

- [ ] **Step 10: Update the stale comment in `timeline.ts`**

In `suite/lib/model/timeline.ts`, replace the paragraph:

```
 * `timeline` is not one of the contract package's `SLICE_NAMES`. The envelope is
 * a `looseObject` at every level precisely so a new slice can appear without a
 * release, so this is the intended way in — but the package should gain the name
 * when it is next touched.
```

with:

```
 * `timeline` is now one of the contract package's `SLICE_NAMES` — it carries no
 * schema of its own there beyond "an object", exactly like `crew` and
 * `stationery`. This module is still where the suite's own richer, editable
 * shape lives.
```

- [ ] **Step 11: Run every affected test**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck && npm test`
Expected: PASS. Pay particular attention to `lib/sync/client.test.ts` and `lib/store/useTrousseauStore.test.ts`, which reference `SuiteSlice`/`SYNCED` indirectly.

- [ ] **Step 12: Commit**

```bash
git add src/slices.ts src/envelope.ts src/envelope.test.ts src/index.ts dist suite/lib/store/useTrousseauStore.ts suite/lib/sync/client.ts suite/lib/model/timeline.ts
git commit -m "feat: add shots and timeline as real contract slice names"
```

---

## Task 2: Suite model types for the shot list

**Files:**
- Modify: `suite/lib/model/types.ts`

**Interfaces:**
- Consumes: nothing new (uses existing `Side` for reasoning, not by reference).
- Produces: `CastRole`, `CAST_ROLES: readonly CastRole[]`, `ROLE_LABEL: Record<CastRole, string>`, `Cast`, `ShotMember`, `Shot`, `ShotSection`, `Shots` — all exported from `suite/lib/model/types.ts`. Every later task in this plan imports from here.

- [ ] **Step 1: Add the types**

In `suite/lib/model/types.ts`, add after the `Crew` interface at the end of the file:

```ts
// group shots ------------------------------------------------------------------

/** Where a shot's people come from — the couple, a parent, the wedding party. */
export type CastRole =
  | "bride"
  | "groom"
  | "brides-mother"
  | "brides-father"
  | "grooms-mother"
  | "grooms-father"
  | "bridal-party"
  | "groomsmen";

export const CAST_ROLES: readonly CastRole[] = [
  "bride",
  "groom",
  "brides-mother",
  "brides-father",
  "grooms-mother",
  "grooms-father",
  "bridal-party",
  "groomsmen",
];

export const ROLE_LABEL: Record<CastRole, string> = {
  bride: "Bride",
  groom: "Groom",
  "brides-mother": "Bride's mother",
  "brides-father": "Bride's father",
  "grooms-mother": "Groom's mother",
  "grooms-father": "Groom's father",
  "bridal-party": "Bridal party",
  groomsmen: "Groomsmen",
};

/** Guest ids per role. Singular roles hold 0 or 1; party roles hold many. */
export type Cast = Record<CastRole, string[]>;

/** Where one person in a shot comes from — pinned, or resolved live from another slice. */
export type ShotMember =
  | { kind: "guest"; ref: string }
  | { kind: "family"; ref: string }
  | { kind: "group"; ref: string }
  | { kind: "role"; ref: CastRole }
  | { kind: "text"; ref: string };

export interface Shot {
  id: string;
  /** Blank means the printed label is built from the members instead. */
  label: string;
  members: ShotMember[];
  notes: string;
}

export interface ShotSection {
  id: string;
  name: string;
  shots: Shot[];
}

/** The `shots` slice. Ensemble's model. */
export interface Shots {
  cast: Cast;
  sections: ShotSection[];
}
```

- [ ] **Step 2: Verify it typechecks**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck`
Expected: PASS (these are pure additive type/const exports; nothing consumes them yet).

- [ ] **Step 3: Commit**

```bash
git add suite/lib/model/types.ts
git commit -m "feat: add the group shots types"
```

---

## Task 3: Slice reader — `readShots`

**Files:**
- Modify: `suite/lib/model/slices.ts`
- Modify: `suite/lib/model/selectors.test.ts`

**Interfaces:**
- Consumes: `Cast`, `CastRole`, `CAST_ROLES`, `Shot`, `ShotMember`, `ShotSection`, `Shots` (Task 2).
- Produces: `emptyCast(): Cast`, `emptyShots(): Shots`, `readShots(doc: Trousseau): Shots` — cached per document, same contract as every other reader in this file.

- [ ] **Step 1: Write the failing test**

In `suite/lib/model/selectors.test.ts`, add `shots: { cast: {}, sections: [{ id: "sec1", name: "Family", shots: [] }] },` to the `doc` fixture's `migrate({...})` call, import `readShots` alongside the other readers, and add a row to the `test.each`:

```ts
  ["shots", () => readShots(doc)],
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `c:\Projects\Trousseau\suite`): `npm test -- selectors.test.ts`
Expected: FAIL — `readShots` is not exported from `./slices`.

- [ ] **Step 3: Implement the reader**

In `suite/lib/model/slices.ts`, add the import `Cast, CastRole, Shot, ShotMember, ShotSection, Shots` to the existing `import type { ... } from "./types"` block, then add at the end of the file:

```ts
// shots ------------------------------------------------------------------------

const CAST_ROLE_SET = new Set<CastRole>(CAST_ROLES);

export function emptyCast(): Cast {
  const cast = {} as Cast;
  for (const role of CAST_ROLES) cast[role] = [];
  return cast;
}

function readCast(raw: unknown): Cast {
  const cast = emptyCast();
  if (!isRecord(raw)) return cast;
  for (const role of CAST_ROLES) {
    cast[role] = list(raw[role], (id) => (typeof id === "string" ? id : null));
  }
  return cast;
}

function readMember(raw: unknown): ShotMember | null {
  if (!isRecord(raw)) return null;
  const kind = raw["kind"];
  const ref = raw["ref"];
  switch (kind) {
    case "guest":
    case "family":
    case "group":
    case "text":
      return typeof ref === "string" ? { kind, ref } : null;
    case "role":
      return typeof ref === "string" && CAST_ROLE_SET.has(ref as CastRole)
        ? { kind: "role", ref: ref as CastRole }
        : null;
    default:
      return null;
  }
}

function readShot(raw: unknown): Shot | null {
  if (!isRecord(raw) || typeof raw["id"] !== "string") return null;
  return {
    id: raw["id"],
    label: str(raw["label"]),
    members: list(raw["members"], readMember),
    notes: str(raw["notes"]),
  };
}

function readSection(raw: unknown): ShotSection | null {
  if (!isRecord(raw) || typeof raw["id"] !== "string") return null;
  return {
    id: raw["id"],
    name: str(raw["name"], "Section"),
    shots: list(raw["shots"], readShot),
  };
}

export function emptyShots(): Shots {
  return { cast: emptyCast(), sections: [] };
}

export function readShots(doc: Trousseau): Shots {
  return cached(doc, "shots", () => {
    const raw: Record<string, unknown> = isRecord((doc as Record<string, unknown>)["shots"])
      ? ((doc as Record<string, unknown>)["shots"] as Record<string, unknown>)
      : {};
    return {
      cast: readCast(raw["cast"]),
      sections: list(raw["sections"], readSection),
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- selectors.test.ts`
Expected: PASS, including the new `shots` row and the "a different document gets its own reading" case (already generic — no edit needed there).

- [ ] **Step 5: Commit**

```bash
git add suite/lib/model/slices.ts suite/lib/model/selectors.test.ts
git commit -m "feat: read the shots slice"
```

---

## Task 4: Store wiring — `useShots`, `setShots`

**Files:**
- Modify: `suite/lib/model/useSuite.ts`

**Interfaces:**
- Consumes: `readShots`, `emptyShots` (Task 3); `Shots` (Task 2).
- Produces: `useShots(): Shots` (hook), `setShots(next: Shots, options?: WriteOptions): void` (on the `SuiteWriters` interface and `useWriters()`'s return).

- [ ] **Step 1: Add the reader hook**

In `suite/lib/model/useSuite.ts`, add `readShots` to the `import { ... } from "./slices"` block and `Shots` to the `import type { ... } from "./types"` block, then add near `useCrew`:

```ts
export const useShots = (): Shots => useTrousseauStore((s) => readShots(s.doc));
```

- [ ] **Step 2: Add the writer**

Add `setShots` to the `SuiteWriters` interface:

```ts
  setShots: (next: Shots, options?: WriteOptions) => void;
```

And in `useWriters()`, alongside `setCrew`:

```ts
  const setShots = useCallback(
    (next: Shots, options: WriteOptions = { label: "the group shots" }) =>
      setSlice("shots", next, options),
    [setSlice],
  );
```

Add `setShots` to the final `return { setEvent, setGuests, setSeating, setTimeline, setCrew, setShots, setPlan };`.

- [ ] **Step 3: Verify it typechecks**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck`
Expected: PASS. `setSlice("shots", ...)` now type-checks against `SliceName` because Task 1 added `"shots"` to it.

- [ ] **Step 4: Commit**

```bash
git add suite/lib/model/useSuite.ts
git commit -m "feat: wire useShots/setShots into the suite store"
```

---

## Task 5: Pure actions — `lib/ensemble/actions.ts`

**Files:**
- Create: `suite/lib/ensemble/actions.ts`
- Test: `suite/lib/ensemble/actions.test.ts`

**Interfaces:**
- Consumes: `Cast`, `CastRole`, `Shot`, `ShotMember`, `ShotSection`, `Shots` (Task 2); `newId` (`@/lib/model/ids`, existing).
- Produces: `addSection`, `renameSection`, `removeSection`, `reorderSections`, `addShot`, `patchShot`, `removeShot`, `reorderShot`, `addMember`, `removeMember`, `setCastRole` — all `(shots: Shots, ...) => Shots`, pure. Consumed by every UI task from Task 10 onward.

- [ ] **Step 1: Write the failing tests**

Create `suite/lib/ensemble/actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Shots } from "@/lib/model/types";
import {
  addMember,
  addSection,
  addShot,
  patchShot,
  removeMember,
  removeSection,
  removeShot,
  renameSection,
  reorderSections,
  reorderShot,
  setCastRole,
} from "./actions";

const empty: Shots = { cast: {} as Shots["cast"], sections: [] };

describe("sections", () => {
  it("adds a section with the given name", () => {
    const shots = addSection(empty, "Bride's family");
    expect(shots.sections).toHaveLength(1);
    expect(shots.sections[0]!.name).toBe("Bride's family");
    expect(shots.sections[0]!.shots).toEqual([]);
  });

  it("renames a section by id", () => {
    const shots = addSection(empty, "Old");
    const id = shots.sections[0]!.id;
    expect(renameSection(shots, id, "New").sections[0]!.name).toBe("New");
  });

  it("removes a section by id", () => {
    const shots = addSection(empty, "Gone");
    const id = shots.sections[0]!.id;
    expect(removeSection(shots, id).sections).toEqual([]);
  });

  it("reorders sections", () => {
    let shots = addSection(empty, "A");
    shots = addSection(shots, "B");
    shots = addSection(shots, "C");
    const reordered = reorderSections(shots, 0, 2);
    expect(reordered.sections.map((s) => s.name)).toEqual(["B", "C", "A"]);
  });
});

describe("shots", () => {
  const withSection = () => addSection(empty, "Family");
  const sectionId = () => withSection().sections[0]!.id;

  it("adds a blank shot to a section", () => {
    const shots = addShot(withSection(), sectionId());
    expect(shots.sections[0]!.shots).toHaveLength(1);
    expect(shots.sections[0]!.shots[0]!).toMatchObject({ label: "", members: [], notes: "" });
  });

  it("patches a shot by id, wherever its section is", () => {
    const base = addShot(withSection(), sectionId());
    const shotId = base.sections[0]!.shots[0]!.id;
    const patched = patchShot(base, shotId, { label: "Couple, alone" });
    expect(patched.sections[0]!.shots[0]!.label).toBe("Couple, alone");
  });

  it("removes a shot by id", () => {
    const base = addShot(withSection(), sectionId());
    const shotId = base.sections[0]!.shots[0]!.id;
    expect(removeShot(base, shotId).sections[0]!.shots).toEqual([]);
  });

  it("reorders shots within their own section", () => {
    let shots = withSection();
    const id = shots.sections[0]!.id;
    shots = addShot(shots, id);
    shots = addShot(shots, id);
    shots = patchShot(shots, shots.sections[0]!.shots[0]!.id, { label: "first" });
    shots = patchShot(shots, shots.sections[0]!.shots[1]!.id, { label: "second" });
    const reordered = reorderShot(shots, id, 0, 1);
    expect(reordered.sections[0]!.shots.map((s) => s.label)).toEqual(["second", "first"]);
  });
});

describe("members", () => {
  it("adds and removes a member by index", () => {
    let shots = addSection(empty, "Family");
    shots = addShot(shots, shots.sections[0]!.id);
    const shotId = shots.sections[0]!.shots[0]!.id;

    shots = addMember(shots, shotId, { kind: "guest", ref: "g1" });
    shots = addMember(shots, shotId, { kind: "text", ref: "the dog" });
    expect(shots.sections[0]!.shots[0]!.members).toEqual([
      { kind: "guest", ref: "g1" },
      { kind: "text", ref: "the dog" },
    ]);

    shots = removeMember(shots, shotId, 0);
    expect(shots.sections[0]!.shots[0]!.members).toEqual([{ kind: "text", ref: "the dog" }]);
  });
});

describe("cast", () => {
  it("sets a role's guest ids, replacing whatever was there", () => {
    const withRole = setCastRole(empty, "bride", ["g1"]);
    expect(withRole.cast.bride).toEqual(["g1"]);
    expect(setCastRole(withRole, "bride", []).cast.bride).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `c:\Projects\Trousseau\suite`): `npm test -- lib/ensemble/actions.test.ts`
Expected: FAIL — `./actions` does not exist.

- [ ] **Step 3: Implement**

Create `suite/lib/ensemble/actions.ts`:

```ts
import { newId } from "@/lib/model/ids";
import type { Cast, CastRole, Shot, ShotMember, ShotSection, Shots } from "@/lib/model/types";

/**
 * The shot list: sections holding shots holding members. A shot lives inside
 * its section rather than in a flat record, so an orphaned shot is
 * unrepresentable and reordering is an array splice.
 */

export function addSection(shots: Shots, name = "New section"): Shots {
  const section: ShotSection = { id: newId("sec"), name, shots: [] };
  return { ...shots, sections: [...shots.sections, section] };
}

export function renameSection(shots: Shots, sectionId: string, name: string): Shots {
  return { ...shots, sections: shots.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)) };
}

export function removeSection(shots: Shots, sectionId: string): Shots {
  return { ...shots, sections: shots.sections.filter((s) => s.id !== sectionId) };
}

export function reorderSections(shots: Shots, fromIndex: number, toIndex: number): Shots {
  const sections = [...shots.sections];
  const [moved] = sections.splice(fromIndex, 1);
  if (!moved) return shots;
  sections.splice(toIndex, 0, moved);
  return { ...shots, sections };
}

export function addShot(shots: Shots, sectionId: string): Shots {
  const shot: Shot = { id: newId("shot"), label: "", members: [], notes: "" };
  return {
    ...shots,
    sections: shots.sections.map((s) => (s.id === sectionId ? { ...s, shots: [...s.shots, shot] } : s)),
  };
}

export function patchShot(shots: Shots, shotId: string, patch: Partial<Shot>): Shots {
  return {
    ...shots,
    sections: shots.sections.map((s) => ({
      ...s,
      shots: s.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)),
    })),
  };
}

export function removeShot(shots: Shots, shotId: string): Shots {
  return {
    ...shots,
    sections: shots.sections.map((s) => ({ ...s, shots: s.shots.filter((shot) => shot.id !== shotId) })),
  };
}

/** Moves a shot to an index within its own section. A cross-section move is two calls. */
export function reorderShot(shots: Shots, sectionId: string, fromIndex: number, toIndex: number): Shots {
  return {
    ...shots,
    sections: shots.sections.map((s) => {
      if (s.id !== sectionId) return s;
      const list = [...s.shots];
      const [moved] = list.splice(fromIndex, 1);
      if (!moved) return s;
      list.splice(toIndex, 0, moved);
      return { ...s, shots: list };
    }),
  };
}

export function addMember(shots: Shots, shotId: string, member: ShotMember): Shots {
  return patchShotMembers(shots, shotId, (members) => [...members, member]);
}

export function removeMember(shots: Shots, shotId: string, index: number): Shots {
  return patchShotMembers(shots, shotId, (members) => members.filter((_, i) => i !== index));
}

function patchShotMembers(
  shots: Shots,
  shotId: string,
  update: (members: ShotMember[]) => ShotMember[],
): Shots {
  return {
    ...shots,
    sections: shots.sections.map((s) => ({
      ...s,
      shots: s.shots.map((shot) => (shot.id === shotId ? { ...shot, members: update(shot.members) } : shot)),
    })),
  };
}

export function setCastRole(shots: Shots, role: CastRole, guestIds: string[]): Shots {
  return { ...shots, cast: { ...shots.cast, [role]: guestIds } as Cast };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/ensemble/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/ensemble/actions.ts suite/lib/ensemble/actions.test.ts
git commit -m "feat: pure actions for the shot list"
```

---

## Task 6: Resolver — `lib/ensemble/resolve.ts`

**Files:**
- Create: `suite/lib/ensemble/resolve.ts`
- Test: `suite/lib/ensemble/resolve.test.ts`

**Interfaces:**
- Consumes: `Cast`, `CastRole`, `Guest`, `RsvpStatus`, `Seating`, `Shot`, `ShotMember`, `ROLE_LABEL` (Task 2, plus existing `Guest`/`Seating`/`RsvpStatus`); `guestName` (`@/lib/model/slices`, existing).
- Produces: `ResolvedPerson`, `ShotProblem`, `ResolvedShot`, `resolveShot(shot, guests, seating, cast): ResolvedShot`. Consumed by `propose` is not needed, but by `ShotList`, `ShotInspector` (via labels), `PrintPanel`, `shotSheet.ts`, `exports.ts`, and `readiness.ts`.

- [ ] **Step 1: Write the failing tests**

Create `suite/lib/ensemble/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Cast, Guest, Seating, Shot } from "@/lib/model/types";
import { emptyCast } from "@/lib/model/slices";
import { resolveShot } from "./resolve";

const guest = (id: string, extra: Partial<Guest> = {}): Guest => ({
  id,
  firstName: id,
  lastName: "",
  email: "",
  rsvpStatus: "confirmed",
  dietary: "",
  entree: "",
  notes: "",
  side: "",
  groupId: null,
  subgroupId: null,
  familyId: null,
  assignedTableId: null,
  tags: [],
  plusOneOf: null,
  ...extra,
});

const seating = (extra: Partial<Seating> = {}): Seating => ({
  tables: {},
  groups: {},
  subgroups: {},
  families: {},
  zones: {},
  obstacles: {},
  constraints: [],
  snapshots: [],
  room: { widthUnits: 0, heightUnits: 0, width: 0, height: 0, backgroundColour: "", spaces: [] },
  settings: {
    defaultSeatMode: "table",
    pixelsPerUnit: 1,
    gridSnap: true,
    gridSize: 1,
    snapAlign: true,
    showChairs: true,
    chairSizeUnits: 1,
    showDietaryBadges: true,
    showGroupColours: true,
    unitSystem: "metric",
    customTablePresets: [],
  },
  ...extra,
});

const shot = (members: Shot["members"], extra: Partial<Shot> = {}): Shot => ({
  id: "sh1",
  label: "",
  members,
  notes: "",
  ...extra,
});

describe("resolveShot: member kinds", () => {
  it("resolves a guest member by id", () => {
    const guests = { g1: guest("g1", { firstName: "Charis" }) };
    const result = resolveShot(shot([{ kind: "guest", ref: "g1" }]), guests, seating(), emptyCast());
    expect(result.people).toEqual([{ guestId: "g1", name: "Charis", rsvpStatus: "confirmed" }]);
    expect(result.problems).toEqual([]);
  });

  it("resolves a family member to all its members", () => {
    const guests = { g1: guest("g1", { firstName: "A" }), g2: guest("g2", { firstName: "B" }) };
    const s = seating({ families: { fam1: { id: "fam1", name: "Hartley", memberIds: ["g1", "g2"] } } });
    const result = resolveShot(shot([{ kind: "family", ref: "fam1" }]), guests, s, emptyCast());
    expect(result.people.map((p) => p.name)).toEqual(["A", "B"]);
  });

  it("resolves a group member to every guest tagged with it, group or subgroup", () => {
    const guests = {
      g1: guest("g1", { firstName: "A", groupId: "grp1" }),
      g2: guest("g2", { firstName: "B", subgroupId: "grp1" }),
      g3: guest("g3", { firstName: "C" }),
    };
    const s = seating({ subgroups: { grp1: { id: "grp1", name: "University" } } });
    const result = resolveShot(shot([{ kind: "group", ref: "grp1" }]), guests, s, emptyCast());
    expect(result.people.map((p) => p.name).sort()).toEqual(["A", "B"]);
  });

  it("resolves a role member through the cast", () => {
    const guests = { g1: guest("g1", { firstName: "Charis" }) };
    const cast: Cast = { ...emptyCast(), bride: ["g1"] };
    const result = resolveShot(shot([{ kind: "role", ref: "bride" }]), guests, seating(), cast);
    expect(result.people.map((p) => p.name)).toEqual(["Charis"]);
  });

  it("resolves a text member with no guest id", () => {
    const result = resolveShot(shot([{ kind: "text", ref: "the dog" }]), {}, seating(), emptyCast());
    expect(result.people).toEqual([{ guestId: null, name: "the dog", rsvpStatus: null }]);
  });
});

describe("resolveShot: dedupe and order", () => {
  it("prints a guest once, at their first position, even named twice", () => {
    const guests = { g1: guest("g1", { firstName: "A" }), g2: guest("g2", { firstName: "B" }) };
    const s = seating({ families: { fam1: { id: "fam1", name: "F", memberIds: ["g1"] } } });
    const result = resolveShot(
      shot([{ kind: "guest", ref: "g2" }, { kind: "family", ref: "fam1" }, { kind: "guest", ref: "g1" }]),
      guests,
      s,
      emptyCast(),
    );
    expect(result.people.map((p) => p.name)).toEqual(["B", "A"]);
  });
});

describe("resolveShot: problems", () => {
  it("flags a guest member that does not exist", () => {
    const result = resolveShot(shot([{ kind: "guest", ref: "ghost" }]), {}, seating(), emptyCast());
    expect(result.problems).toEqual([{ kind: "dangling", detail: expect.stringContaining("no longer exists") }]);
  });

  it("flags a family member that does not exist", () => {
    const result = resolveShot(shot([{ kind: "family", ref: "ghost" }]), {}, seating(), emptyCast());
    expect(result.problems).toEqual([{ kind: "dangling", detail: expect.stringContaining("family") }]);
  });

  it("flags a role with nobody set", () => {
    const result = resolveShot(shot([{ kind: "role", ref: "bride" }]), {}, seating(), emptyCast());
    expect(result.problems).toEqual(
      expect.arrayContaining([{ kind: "dangling", detail: expect.stringContaining("Bride") }]),
    );
  });

  it("flags a declined guest without dropping them from the shot", () => {
    const guests = { g1: guest("g1", { firstName: "Charis", rsvpStatus: "declined" }) };
    const result = resolveShot(shot([{ kind: "guest", ref: "g1" }]), guests, seating(), emptyCast());
    expect(result.people).toHaveLength(1);
    expect(result.problems).toEqual([{ kind: "declined", name: "Charis" }]);
  });

  it("flags an empty shot when nothing resolves to a person", () => {
    const result = resolveShot(shot([]), {}, seating(), emptyCast());
    expect(result.problems).toEqual([{ kind: "empty" }]);
  });
});

describe("resolveShot: label", () => {
  it("keeps a typed label as-is", () => {
    const result = resolveShot(shot([], { label: "Couple, alone" }), {}, seating(), emptyCast());
    expect(result.label).toBe("Couple, alone");
  });

  it("builds a blank label from the resolved names", () => {
    const guests = { g1: guest("g1", { firstName: "A" }), g2: guest("g2", { firstName: "B" }) };
    const result = resolveShot(
      shot([{ kind: "guest", ref: "g1" }, { kind: "guest", ref: "g2" }]),
      guests,
      seating(),
      emptyCast(),
    );
    expect(result.label).toBe("A + B");
  });

  it("falls back to a placeholder when a blank label resolves to nobody", () => {
    const result = resolveShot(shot([]), {}, seating(), emptyCast());
    expect(result.label).toBe("Untitled shot");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `c:\Projects\Trousseau\suite`): `npm test -- lib/ensemble/resolve.test.ts`
Expected: FAIL — `./resolve` does not exist.

- [ ] **Step 3: Implement**

Create `suite/lib/ensemble/resolve.ts`:

```ts
import { guestName } from "@/lib/model/slices";
import { ROLE_LABEL, type Cast, type CastRole, type Guest, type RsvpStatus, type Seating, type Shot, type ShotMember } from "@/lib/model/types";

export interface ResolvedPerson {
  guestId: string | null;
  name: string;
  rsvpStatus: RsvpStatus | null;
}

export type ShotProblem =
  | { kind: "dangling"; detail: string }
  | { kind: "declined"; name: string }
  | { kind: "empty" };

export interface ResolvedShot {
  label: string;
  people: ResolvedPerson[];
  problems: ShotProblem[];
}

const rolePhrase = (role: CastRole): string => `the ${ROLE_LABEL[role].toLowerCase()}`;

/**
 * A shot's members, resolved to the people they name right now.
 *
 * Order is preserved as authored, and a guest named twice — once directly,
 * once through a family they belong to — is printed once, at its first
 * position. `guestId` is null for a free-text member, which cannot dedupe
 * against anything and never carries a declined warning.
 */
export function resolveShot(
  shot: Shot,
  guests: Record<string, Guest>,
  seating: Seating,
  cast: Cast,
): ResolvedShot {
  const people: ResolvedPerson[] = [];
  const seen = new Set<string>();
  const problems: ShotProblem[] = [];

  const addGuest = (guestId: string, source: string) => {
    const guest = guests[guestId];
    if (!guest) {
      problems.push({ kind: "dangling", detail: `${source} names a guest who no longer exists` });
      return;
    }
    if (seen.has(guestId)) return;
    seen.add(guestId);
    const name = guestName(guest) || "Unnamed guest";
    people.push({ guestId, name, rsvpStatus: guest.rsvpStatus });
    if (guest.rsvpStatus === "declined") problems.push({ kind: "declined", name });
  };

  for (const member of shot.members) {
    resolveMember(member, guests, seating, cast, addGuest, problems, people);
  }

  if (people.length === 0) problems.push({ kind: "empty" });

  const label =
    shot.label.trim() || (people.length > 0 ? people.map((p) => p.name).join(" + ") : "Untitled shot");

  return { label, people, problems };
}

function resolveMember(
  member: ShotMember,
  guests: Record<string, Guest>,
  seating: Seating,
  cast: Cast,
  addGuest: (guestId: string, source: string) => void,
  problems: ShotProblem[],
  people: ResolvedPerson[],
): void {
  switch (member.kind) {
    case "guest":
      addGuest(member.ref, "A shot member");
      return;
    case "family": {
      const family = seating.families[member.ref];
      if (!family) {
        problems.push({ kind: "dangling", detail: "A shot member names a family that no longer exists" });
        return;
      }
      for (const guestId of family.memberIds) addGuest(guestId, `"${family.name}"`);
      return;
    }
    case "group": {
      const group = seating.groups[member.ref] ?? seating.subgroups[member.ref];
      if (!group) {
        problems.push({ kind: "dangling", detail: "A shot member names a group that no longer exists" });
        return;
      }
      for (const guest of Object.values(guests)) {
        if (guest.groupId === member.ref || guest.subgroupId === member.ref) addGuest(guest.id, `"${group.name}"`);
      }
      return;
    }
    case "role": {
      const guestIds = cast[member.ref];
      if (guestIds.length === 0) {
        problems.push({ kind: "dangling", detail: `No one is set as ${rolePhrase(member.ref)} yet` });
        return;
      }
      for (const guestId of guestIds) addGuest(guestId, rolePhrase(member.ref));
      return;
    }
    case "text":
      people.push({ guestId: null, name: member.ref, rsvpStatus: null });
      return;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/ensemble/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/ensemble/resolve.ts suite/lib/ensemble/resolve.test.ts
git commit -m "feat: resolve a shot's members to people"
```

---

## Task 7: Proposer — `lib/ensemble/propose.ts`

**Files:**
- Create: `suite/lib/ensemble/propose.ts`
- Test: `suite/lib/ensemble/propose.test.ts`

**Interfaces:**
- Consumes: `CastRole`, `Guest`, `Seating`, `Shot`, `ShotSection`, `Side` (Task 2 / existing); `newId`.
- Produces: `propose(existing: ShotSection[], guests, seating, mode: "template" | "generate"): ShotSection[]`. Consumed by `EnsembleBoard` (Task 16).

- [ ] **Step 1: Write the failing tests**

Create `suite/lib/ensemble/propose.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Family, Guest, NamedGroup, Seating } from "@/lib/model/types";
import { propose } from "./propose";

const guest = (id: string, extra: Partial<Guest> = {}): Guest => ({
  id,
  firstName: id,
  lastName: "",
  email: "",
  rsvpStatus: "confirmed",
  dietary: "",
  entree: "",
  notes: "",
  side: "",
  groupId: null,
  subgroupId: null,
  familyId: null,
  assignedTableId: null,
  tags: [],
  plusOneOf: null,
  ...extra,
});

const seating = (extra: Partial<Seating> = {}): Seating => ({
  tables: {},
  groups: {},
  subgroups: {},
  families: {},
  zones: {},
  obstacles: {},
  constraints: [],
  snapshots: [],
  room: { widthUnits: 0, heightUnits: 0, width: 0, height: 0, backgroundColour: "", spaces: [] },
  settings: {
    defaultSeatMode: "table",
    pixelsPerUnit: 1,
    gridSnap: true,
    gridSize: 1,
    snapAlign: true,
    showChairs: true,
    chairSizeUnits: 1,
    showDietaryBadges: true,
    showGroupColours: true,
    unitSystem: "metric",
    customTablePresets: [],
  },
  ...extra,
});

describe("propose: template", () => {
  it("produces the five classic sections, every shot built from role members only", () => {
    const sections = propose([], {}, seating(), "template");
    expect(sections.map((s) => s.name)).toEqual([
      "The couple",
      "Bride's family",
      "Groom's family",
      "Both families",
      "Wedding party",
    ]);
    for (const section of sections) {
      for (const shot of section.shots) {
        expect(shot.members.every((m) => m.kind === "role")).toBe(true);
      }
    }
    expect(sections.flatMap((s) => s.shots).length).toBeGreaterThan(5);
  });

  it("is idempotent: proposing twice adds nothing the second time", () => {
    const first = propose([], {}, seating(), "template");
    const second = propose(first, {}, seating(), "template");
    expect(second).toEqual(first);
  });
});

describe("propose: generate", () => {
  it("adds one shot per family, sided by majority Guest.side", () => {
    const guests: Record<string, Guest> = {
      g1: guest("g1", { side: "bride" }),
      g2: guest("g2", { side: "bride" }),
    };
    const families: Record<string, Family> = { fam1: { id: "fam1", name: "The Hartleys", memberIds: ["g1", "g2"] } };
    const sections = propose([], guests, seating({ families }), "generate");
    const bridesFamily = sections.find((s) => s.name === "Bride's family")!;
    expect(bridesFamily.shots.some((s) => s.label === "The Hartleys")).toBe(true);
  });

  it("adds one shot per named group, groups and subgroups both", () => {
    const guests: Record<string, Guest> = { g1: guest("g1", { subgroupId: "grp1", side: "groom" }) };
    const subgroups: Record<string, NamedGroup> = { grp1: { id: "grp1", name: "University friends" } };
    const sections = propose([], guests, seating({ subgroups }), "generate");
    const groomsFamily = sections.find((s) => s.name === "Groom's family")!;
    expect(groomsFamily.shots.some((s) => s.label === "University friends")).toBe(true);
  });

  it("files an unsided family under Both families", () => {
    const families: Record<string, Family> = { fam1: { id: "fam1", name: "Neighbours", memberIds: [] } };
    const sections = propose([], {}, seating({ families }), "generate");
    const both = sections.find((s) => s.name === "Both families")!;
    expect(both.shots.some((s) => s.label === "Neighbours")).toBe(true);
  });

  it("is idempotent: generating twice adds each family once", () => {
    const guests: Record<string, Guest> = { g1: guest("g1", { side: "bride" }) };
    const families: Record<string, Family> = { fam1: { id: "fam1", name: "The Hartleys", memberIds: ["g1"] } };
    const first = propose([], guests, seating({ families }), "generate");
    const second = propose(first, guests, seating({ families }), "generate");
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `c:\Projects\Trousseau\suite`): `npm test -- lib/ensemble/propose.test.ts`
Expected: FAIL — `./propose` does not exist.

- [ ] **Step 3: Implement**

Create `suite/lib/ensemble/propose.ts`:

```ts
import { newId } from "@/lib/model/ids";
import type { CastRole, Guest, Seating, ShotSection, Side } from "@/lib/model/types";

/**
 * Starting points for the shot list. `generate` is `template` plus one shot
 * per family and named group, so there is exactly one place that builds the
 * classic sections. Takes the *current* sections and merges into them —
 * matched and reused by name, each shot added only if no shot with that exact
 * label already exists in its section — so pressing either button twice adds
 * nothing the second time.
 */

interface ClassicShot {
  label: string;
  roles: CastRole[];
}
interface ClassicSection {
  name: string;
  shots: ClassicShot[];
}

const CLASSIC: ClassicSection[] = [
  { name: "The couple", shots: [{ label: "The couple, alone", roles: ["bride", "groom"] }] },
  {
    name: "Bride's family",
    shots: [
      { label: "Couple with the bride's parents", roles: ["bride", "groom", "brides-mother", "brides-father"] },
      { label: "The bride with her parents", roles: ["bride", "brides-mother", "brides-father"] },
      { label: "The bride with her mother", roles: ["bride", "brides-mother"] },
      { label: "The bride with her father", roles: ["bride", "brides-father"] },
    ],
  },
  {
    name: "Groom's family",
    shots: [
      { label: "Couple with the groom's parents", roles: ["bride", "groom", "grooms-mother", "grooms-father"] },
      { label: "The groom with his parents", roles: ["groom", "grooms-mother", "grooms-father"] },
      { label: "The groom with his mother", roles: ["groom", "grooms-mother"] },
      { label: "The groom with his father", roles: ["groom", "grooms-father"] },
    ],
  },
  {
    name: "Both families",
    shots: [
      {
        label: "Couple with all four parents",
        roles: ["bride", "groom", "brides-mother", "brides-father", "grooms-mother", "grooms-father"],
      },
    ],
  },
  {
    name: "Wedding party",
    shots: [
      { label: "The full wedding party", roles: ["bride", "groom", "bridal-party", "groomsmen"] },
      { label: "The bride with her bridal party", roles: ["bride", "bridal-party"] },
      { label: "The groom with his groomsmen", roles: ["groom", "groomsmen"] },
    ],
  },
];

const SECTION_FOR: Record<"bride" | "groom" | "both", string> = {
  bride: "Bride's family",
  groom: "Groom's family",
  both: "Both families",
};

function sectionNamed(sections: ShotSection[], name: string): ShotSection {
  const found = sections.find((s) => s.name === name);
  if (found) return found;
  const created: ShotSection = { id: newId("sec"), name, shots: [] };
  sections.push(created);
  return created;
}

function sideOf(guestIds: string[], guests: Record<string, Guest>): Side | null {
  let brideCount = 0;
  let groomCount = 0;
  for (const id of guestIds) {
    const side = guests[id]?.side;
    if (side === "bride") brideCount += 1;
    else if (side === "groom") groomCount += 1;
  }
  if (brideCount === 0 && groomCount === 0) return null;
  if (brideCount === groomCount) return "both";
  return brideCount > groomCount ? "bride" : "groom";
}

function appendFamiliesAndGroups(sections: ShotSection[], guests: Record<string, Guest>, seating: Seating): void {
  for (const family of Object.values(seating.families)) {
    const side = sideOf(family.memberIds, guests) ?? "both";
    const section = sectionNamed(sections, SECTION_FOR[side as "bride" | "groom" | "both"]);
    if (section.shots.some((s) => s.label === family.name)) continue;
    section.shots.push({ id: newId("shot"), label: family.name, members: [{ kind: "family", ref: family.id }], notes: "" });
  }

  const namedGroups = { ...seating.groups, ...seating.subgroups };
  for (const group of Object.values(namedGroups)) {
    const memberIds = Object.values(guests)
      .filter((g) => g.groupId === group.id || g.subgroupId === group.id)
      .map((g) => g.id);
    const side = sideOf(memberIds, guests) ?? "both";
    const section = sectionNamed(sections, SECTION_FOR[side as "bride" | "groom" | "both"]);
    if (section.shots.some((s) => s.label === group.name)) continue;
    section.shots.push({ id: newId("shot"), label: group.name, members: [{ kind: "group", ref: group.id }], notes: "" });
  }
}

export function propose(
  existing: ShotSection[],
  guests: Record<string, Guest>,
  seating: Seating,
  mode: "template" | "generate",
): ShotSection[] {
  const sections = existing.map((s) => ({ ...s, shots: [...s.shots] }));

  for (const classic of CLASSIC) {
    const section = sectionNamed(sections, classic.name);
    for (const shot of classic.shots) {
      if (section.shots.some((s) => s.label === shot.label)) continue;
      section.shots.push({
        id: newId("shot"),
        label: shot.label,
        members: shot.roles.map((role) => ({ kind: "role" as const, ref: role })),
        notes: "",
      });
    }
  }

  if (mode === "generate") appendFamiliesAndGroups(sections, guests, seating);

  return sections;
}
```

Note: `sideOf`'s return is typed `Side | null` (`Side` includes `""` too), but `SECTION_FOR` is only keyed on `"bride" | "groom" | "both"` — the `?? "both"` fallback and the `as "bride" | "groom" | "both"` narrowing together are safe because `sideOf` only ever returns `null`, `"bride"`, `"groom"`, or `"both"` by construction (never `""`); the cast documents that rather than widening anything unsafely.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/ensemble/propose.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/ensemble/propose.ts suite/lib/ensemble/propose.test.ts
git commit -m "feat: propose the classic shot list, and generate from families and groups"
```

---

## Task 8: Register the tool — nav, route stub, design tokens

**Files:**
- Modify: `suite/lib/tools.ts`
- Modify: `suite/lib/design/tokens.css`
- Modify: `suite/lib/design/contrast.test.ts`

**Interfaces:**
- Produces: `Tool.href` union gains `"/group-shots"`; `TOOLS` gains a fifth entry with `tokens: "ensemble-tokens"`; `.ensemble-tokens` CSS block.

- [ ] **Step 1: Write the failing test**

In `suite/lib/design/contrast.test.ts`, add `".ensemble-tokens"` to the `SCOPES` array and `".ensemble-tokens": "--accent-soft"` to the `TINT` record:

```ts
const SCOPES = [".plaque-scope", ".cadence-scope", ".brigade-scope", ".tableaux-scope", ".ensemble-tokens"];

const TINT: Record<string, string> = {
  ".plaque-scope": "--accent-soft",
  ".cadence-scope": "--accent-soft",
  ".brigade-scope": "--accent-soft",
  ".tableaux-scope": "--accent-light",
  ".ensemble-tokens": "--accent-soft",
};
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `c:\Projects\Trousseau\suite`): `npm test -- contrast.test.ts`
Expected: FAIL — `--accent` is not defined for `.ensemble-tokens`.

- [ ] **Step 3: Add the token block**

In `suite/lib/design/tokens.css`, add after the `.tableaux-scope, .tableaux-tokens { --accent: ...; }` block (the "── Accents ──" section):

```css
.ensemble-tokens {
  --accent: #46617a;
  --accent-hover: #3a5166;
  --accent-soft: #e7ecf0;
  --accent-bright: #6b8aa6;
}
```

- [ ] **Step 4: Run the test to verify it passes; adjust the hex values if not**

Run: `npm test -- contrast.test.ts`
Expected: PASS. If any of the four `.ensemble-tokens` assertions fail (readable on the ground, readable on its own tint, carries white text, identity colour distinguishable at 3:1), nudge `--accent` and `--accent-bright` — darker for more contrast against `--t-1`, more saturated for the 3:1 identity check — and rerun until green, the same way `brigade`'s and `plaque`'s values were arrived at.

- [ ] **Step 5: Register the tool**

In `suite/lib/tools.ts`, add `Camera` to the `lucide-react` import, widen `Tool["href"]` to include `"/group-shots"`, and add a fifth entry to `TOOLS` after Delegation:

```ts
  {
    href: "/group-shots",
    tokens: "ensemble-tokens",
    name: "Group shots",
    tagline: "The family photo list, built from who's who.",
    icon: Camera,
  },
```

- [ ] **Step 6: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS. (`app/(app)/(tools)/group-shots/page.tsx` doesn't exist yet — that's fine, `tools.ts` doesn't import it.)

- [ ] **Step 7: Commit**

```bash
git add suite/lib/tools.ts suite/lib/design/tokens.css suite/lib/design/contrast.test.ts
git commit -m "feat: register group shots as the fifth tool"
```

---

## Task 9: `GuestPicker` component

**Files:**
- Create: `suite/components/ensemble/GuestPicker.tsx`

**Interfaces:**
- Consumes: `Guest` (existing); `guestName` (`@/lib/model/slices`); `TextField`, `IconButton` (`@/components/ui/controls`).
- Produces: `<GuestPicker guests exclude? onPick />`, `<GuestChip name onRemove />`. Consumed by Tasks 11 and 12.

- [ ] **Step 1: Implement**

Create `suite/components/ensemble/GuestPicker.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { IconButton, TextField } from "@/components/ui/controls";
import { guestName } from "@/lib/model/slices";
import type { Guest } from "@/lib/model/types";

/** A search-as-you-type list of guests, for picking one or several. */
export function GuestPicker({
  guests,
  exclude = [],
  onPick,
}: {
  guests: Record<string, Guest>;
  /** Ids already chosen elsewhere in this picker, hidden from the list. */
  exclude?: string[];
  onPick: (guestId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const excluded = useMemo(() => new Set(exclude), [exclude]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    return Object.values(guests)
      .filter((g) => !excluded.has(g.id))
      .filter((g) => guestName(g).toLowerCase().includes(q))
      .sort((a, b) => guestName(a).localeCompare(guestName(b)))
      .slice(0, 8);
  }, [guests, excluded, query]);

  return (
    <div>
      <TextField value={query} onChange={setQuery} placeholder="Search guests…" />
      {query.trim() !== "" && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-charcoal/10">
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-slate">No one matches.</li>
          ) : (
            matches.map((guest) => (
              <li key={guest.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(guest.id);
                    setQuery("");
                  }}
                  className="block w-full px-2 py-1.5 text-left text-sm text-charcoal hover:bg-stone"
                >
                  {guestName(guest) || "Unnamed guest"}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** One chosen guest, as a removable chip. */
export function GuestChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-charcoal/15 bg-stone px-2 py-0.5 text-xs text-charcoal">
      {name}
      <IconButton icon={X} label={`Remove ${name}`} onClick={onRemove} />
    </span>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Verify by hand**

There is nowhere to see this render yet (no page imports it). Skip manual verification until Task 16 assembles the board — note that and move on.

- [ ] **Step 4: Commit**

```bash
git add suite/components/ensemble/GuestPicker.tsx
git commit -m "feat: add a guest search picker for ensemble"
```

---

## Task 10: `ShotList` component (left panel, drag reorder)

**Files:**
- Create: `suite/components/ensemble/ShotList.tsx`

**Interfaces:**
- Consumes: `Guest`, `Seating`, `Shots` (Task 2); `resolveShot` (Task 6); `addSection`, `addShot`, `removeSection`, `removeShot`, `renameSection`, `reorderSections`, `reorderShot` (Task 5); `IconButton` (`@/components/ui/controls`); `DndContext`/`closestCenter` (`@dnd-kit/core`), `SortableContext`/`verticalListSortingStrategy`/`useSortable`/`arrayMove` (`@dnd-kit/sortable`), `CSS` (`@dnd-kit/utilities`).
- Produces: `<ShotList shots guests seating selectedId onSelect onChange />`. Consumed by Task 16.

- [ ] **Step 1: Implement**

Create `suite/components/ensemble/ShotList.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/controls";
import type { Cast, Guest, Seating, Shot, Shots } from "@/lib/model/types";
import { resolveShot } from "@/lib/ensemble/resolve";
import {
  addSection,
  addShot,
  removeSection,
  removeShot,
  renameSection,
  reorderSections,
  reorderShot,
} from "@/lib/ensemble/actions";

export function ShotList({
  shots,
  guests,
  seating,
  selectedId,
  onSelect,
  onChange,
}: {
  shots: Shots;
  guests: Record<string, Guest>;
  seating: Seating;
  selectedId: string | null;
  onSelect: (shotId: string) => void;
  onChange: (next: Shots) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {shots.sections.map((section, index) => (
        <div key={section.id} className="rounded border border-charcoal/10">
          <div className="flex items-center gap-1 border-b border-charcoal/10 bg-stone/60 px-2 py-1.5">
            <IconButton
              icon={collapsed.has(section.id) ? ChevronDown : ChevronUp}
              label={collapsed.has(section.id) ? "Expand section" : "Collapse section"}
              onClick={() => toggle(section.id)}
            />
            <input
              value={section.name}
              onChange={(e) => onChange(renameSection(shots, section.id, e.target.value))}
              className="min-w-0 flex-1 bg-transparent text-sm text-charcoal focus:outline-none"
            />
            <span className="shrink-0 text-xs text-slate">{section.shots.length}</span>
            <IconButton
              icon={ChevronUp}
              label="Move section up"
              onClick={() => index > 0 && onChange(reorderSections(shots, index, index - 1))}
            />
            <IconButton
              icon={ChevronDown}
              label="Move section down"
              onClick={() =>
                index < shots.sections.length - 1 && onChange(reorderSections(shots, index, index + 1))
              }
            />
            <IconButton
              icon={Trash2}
              label="Remove section"
              tone="danger"
              onClick={() => onChange(removeSection(shots, section.id))}
            />
          </div>

          {!collapsed.has(section.id) && (
            <div className="p-1.5">
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={(event: DragEndEvent) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  const from = section.shots.findIndex((s) => s.id === active.id);
                  const to = section.shots.findIndex((s) => s.id === over.id);
                  if (from !== -1 && to !== -1) onChange(reorderShot(shots, section.id, from, to));
                }}
              >
                <SortableContext items={section.shots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <ul className="flex flex-col gap-0.5">
                    {section.shots.map((shot, shotIndex) => (
                      <ShotRow
                        key={shot.id}
                        shot={shot}
                        index={shotIndex}
                        guests={guests}
                        seating={seating}
                        cast={shots.cast}
                        selected={shot.id === selectedId}
                        onSelect={() => onSelect(shot.id)}
                        onRemove={() => onChange(removeShot(shots, shot.id))}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>

              <button
                type="button"
                onClick={() => onChange(addShot(shots, section.id))}
                className="mt-1 flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-slate hover:text-charcoal"
              >
                <Plus size={13} /> Add shot
              </button>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange(addSection(shots))}
        className="flex items-center justify-center gap-1.5 rounded border border-dashed border-charcoal/20 py-2 text-sm text-slate hover:border-gold hover:text-charcoal"
      >
        <Plus size={14} /> Add section
      </button>
    </div>
  );
}

function ShotRow({
  shot,
  index,
  guests,
  seating,
  cast,
  selected,
  onSelect,
  onRemove,
}: {
  shot: Shot;
  index: number;
  guests: Record<string, Guest>;
  seating: Seating;
  cast: Cast;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: shot.id });
  const resolved = resolveShot(shot, guests, seating, cast);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-start gap-1.5 rounded px-1.5 py-1 ${selected ? "bg-gold/15" : "hover:bg-stone"}`}
    >
      <button {...attributes} {...listeners} className="mt-0.5 shrink-0 cursor-grab text-slate" aria-label="Reorder">
        <GripVertical size={13} />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm text-charcoal">
          {index + 1}. {resolved.label}
          {resolved.problems.length > 0 && <span className="ml-1 text-rose">●</span>}
        </div>
        <div className="truncate text-xs text-slate">
          {resolved.people.map((p) => p.name).join(", ") || "Nobody yet"}
        </div>
      </button>
      <IconButton icon={Trash2} label="Remove shot" tone="danger" onClick={onRemove} />
    </li>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add suite/components/ensemble/ShotList.tsx
git commit -m "feat: add the shot list panel with drag reorder"
```

---

## Task 11: `ShotInspector` component (right panel, tab 1)

**Files:**
- Create: `suite/components/ensemble/ShotInspector.tsx`

**Interfaces:**
- Consumes: `Guest`, `Seating`, `Shot`, `ShotMember`, `Shots`, `CAST_ROLES`, `ROLE_LABEL` (Task 2); `addMember`, `patchShot`, `removeMember` (Task 5); `GuestPicker` (Task 9); `Button`, `Panel`, `SelectField`, `TextArea`, `TextField` (`@/components/ui/controls`); `guestName` (`@/lib/model/slices`).
- Produces: `<ShotInspector shot shots guests seating onChange />`. Consumed by Task 16.

- [ ] **Step 1: Implement**

Create `suite/components/ensemble/ShotInspector.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button, Panel, SelectField, TextArea, TextField } from "@/components/ui/controls";
import { GuestPicker } from "./GuestPicker";
import { guestName } from "@/lib/model/slices";
import { CAST_ROLES, ROLE_LABEL, type Guest, type Seating, type Shot, type ShotMember, type Shots } from "@/lib/model/types";
import { addMember, patchShot, removeMember } from "@/lib/ensemble/actions";

type MemberKind = ShotMember["kind"];

export function ShotInspector({
  shot,
  shots,
  guests,
  seating,
  onChange,
}: {
  shot: Shot;
  shots: Shots;
  guests: Record<string, Guest>;
  seating: Seating;
  onChange: (next: Shots) => void;
}) {
  const [addKind, setAddKind] = useState<MemberKind>("guest");
  const [textValue, setTextValue] = useState("");

  const addPicked = (ref: string) => {
    if (!ref) return;
    const member: ShotMember =
      addKind === "family"
        ? { kind: "family", ref }
        : addKind === "group"
          ? { kind: "group", ref }
          : { kind: "role", ref: ref as (typeof CAST_ROLES)[number] };
    onChange(addMember(shots, shot.id, member));
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Panel title="Shot">
        <TextField
          label="Label"
          value={shot.label}
          onChange={(label) => onChange(patchShot(shots, shot.id, { label }))}
          placeholder="Leave blank to build it from who's in it"
        />
      </Panel>

      <Panel title="Who's in it">
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {shot.members.map((member, index) => (
            <li
              key={index}
              className="inline-flex items-center gap-1 rounded-full border border-charcoal/15 bg-stone px-2 py-0.5 text-xs text-charcoal"
            >
              {memberLabel(member, guests, seating)}
              <button type="button" aria-label="Remove" onClick={() => onChange(removeMember(shots, shot.id, index))}>
                <X size={11} />
              </button>
            </li>
          ))}
          {shot.members.length === 0 && <li className="text-sm text-slate">Nobody added yet.</li>}
        </ul>

        <SelectField
          value={addKind}
          onChange={setAddKind}
          options={[
            { value: "guest", label: "Guest" },
            { value: "family", label: "Family" },
            { value: "group", label: "Group" },
            { value: "role", label: "Role" },
            { value: "text", label: "Text" },
          ]}
        />

        {addKind === "guest" && (
          <GuestPicker
            guests={guests}
            exclude={shot.members.filter((m) => m.kind === "guest").map((m) => m.ref)}
            onPick={(guestId) => onChange(addMember(shots, shot.id, { kind: "guest", ref: guestId }))}
          />
        )}

        {addKind === "family" && (
          <SelectField
            value=""
            onChange={addPicked}
            options={[
              { value: "", label: "Choose a family…" },
              ...Object.values(seating.families).map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
        )}

        {addKind === "group" && (
          <SelectField
            value=""
            onChange={addPicked}
            options={[
              { value: "", label: "Choose a group…" },
              ...[...Object.values(seating.groups), ...Object.values(seating.subgroups)].map((g) => ({
                value: g.id,
                label: g.name,
              })),
            ]}
          />
        )}

        {addKind === "role" && (
          <SelectField
            value=""
            onChange={addPicked}
            options={[
              { value: "", label: "Choose a role…" },
              ...CAST_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] })),
            ]}
          />
        )}

        {addKind === "text" && (
          <div className="flex gap-2">
            <TextField value={textValue} onChange={setTextValue} placeholder="e.g. the dog" />
            <Button
              tone="quiet"
              onClick={() => {
                if (!textValue.trim()) return;
                onChange(addMember(shots, shot.id, { kind: "text", ref: textValue.trim() }));
                setTextValue("");
              }}
            >
              Add
            </Button>
          </div>
        )}
      </Panel>

      <Panel title="Notes">
        <TextArea value={shot.notes} onChange={(notes) => onChange(patchShot(shots, shot.id, { notes }))} />
      </Panel>
    </div>
  );
}

function memberLabel(member: ShotMember, guests: Record<string, Guest>, seating: Seating): string {
  switch (member.kind) {
    case "guest": {
      const guest = guests[member.ref];
      return guest ? guestName(guest) || "Unnamed guest" : "Deleted guest";
    }
    case "family":
      return seating.families[member.ref]?.name ?? "Deleted family";
    case "group":
      return (seating.groups[member.ref] ?? seating.subgroups[member.ref])?.name ?? "Deleted group";
    case "role":
      return ROLE_LABEL[member.ref];
    case "text":
      return member.ref;
  }
}
```

The three `SelectField`s that add-by-choosing (family/group/role) always render `value=""` — never a remembered selection — with a real placeholder option at `""`. That's deliberate: it forces React to keep the control visually reset to the placeholder after every pick, so choosing the same family twice in a row (e.g. after removing it) still fires `onChange` both times, rather than the browser treating a repeated identical pick as no change.

- [ ] **Step 2: Verify it typechecks**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add suite/components/ensemble/ShotInspector.tsx
git commit -m "feat: add the shot inspector panel"
```

---

## Task 12: `CastPanel` component (right panel, tab 2)

**Files:**
- Create: `suite/components/ensemble/CastPanel.tsx`

**Interfaces:**
- Consumes: `CAST_ROLES`, `ROLE_LABEL`, `Guest`, `Shots` (Task 2); `setCastRole` (Task 5); `GuestPicker` (Task 9); `Panel` (`@/components/ui/controls`); `guestName`.
- Produces: `<CastPanel shots guests onChange />`. Consumed by Task 16.

- [ ] **Step 1: Implement**

Create `suite/components/ensemble/CastPanel.tsx`:

```tsx
"use client";

import { X } from "lucide-react";
import { Panel } from "@/components/ui/controls";
import { GuestPicker } from "./GuestPicker";
import { guestName } from "@/lib/model/slices";
import { CAST_ROLES, ROLE_LABEL, type Guest, type Shots } from "@/lib/model/types";
import { setCastRole } from "@/lib/ensemble/actions";

/** Roles that hold at most one person. Everything else — the wedding party — holds many. */
const SINGLE_ROLES = new Set([
  "bride",
  "groom",
  "brides-mother",
  "brides-father",
  "grooms-mother",
  "grooms-father",
]);

export function CastPanel({
  shots,
  guests,
  onChange,
}: {
  shots: Shots;
  guests: Record<string, Guest>;
  onChange: (next: Shots) => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {CAST_ROLES.map((role) => {
        const chosen = shots.cast[role];
        const single = SINGLE_ROLES.has(role);
        return (
          <Panel key={role} title={ROLE_LABEL[role]}>
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {chosen.map((guestId) => (
                <li
                  key={guestId}
                  className="inline-flex items-center gap-1 rounded-full border border-charcoal/15 bg-stone px-2 py-0.5 text-xs text-charcoal"
                >
                  {guests[guestId] ? guestName(guests[guestId]!) || "Unnamed guest" : "Deleted guest"}
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => onChange(setCastRole(shots, role, chosen.filter((id) => id !== guestId)))}
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
              {chosen.length === 0 && <li className="text-sm text-slate">Not set yet.</li>}
            </ul>

            {(!single || chosen.length === 0) && (
              <GuestPicker
                guests={guests}
                exclude={chosen}
                onPick={(guestId) => onChange(setCastRole(shots, role, single ? [guestId] : [...chosen, guestId]))}
              />
            )}
          </Panel>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add suite/components/ensemble/CastPanel.tsx
git commit -m "feat: add the cast (who's who) panel"
```

---

## Task 13: PDF shot sheet — `lib/ensemble/render/pdf/shotSheet.ts`

**Files:**
- Create: `suite/lib/ensemble/render/pdf/shotSheet.ts`
- Test: `suite/lib/ensemble/render/pdf/shotSheet.test.ts`

**Interfaces:**
- Consumes: `Cast`, `Guest`, `Seating`, `ShotSection` (Task 2); `resolveShot` (Task 6); Brigade's PDF kit — `embedFamily` (`@/apps/brigade/render/pdf/embedFonts`), `FontSource` (`@/apps/brigade/render/pdf/fontSource`), `nodeFontSource` (test only), `addSheet`/`hexColour`/`Colour`/`Sheet` (`@/apps/brigade/render/pdf/page`), `paginate` (`@/apps/brigade/render/pdf/table`), `wrap` (`@/apps/brigade/render/pdf/text`), `contentBox`/`PAGE_SIZES`/`ptToMm` (`@/apps/brigade/render/pdf/units`), `textOf` (`@/apps/brigade/render/pdf/readPdf`, test only).
- Produces: `renderShotSheet(sections, guests, seating, cast, options): Promise<Uint8Array>`. Consumed by Task 15 (`PrintPanel`) and Task 18 (`WeddingPack`).

- [ ] **Step 1: Write the failing tests**

Create `suite/lib/ensemble/render/pdf/shotSheet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nodeFontSource } from "@/apps/brigade/render/pdf/nodeFontSource";
import { textOf } from "@/apps/brigade/render/pdf/readPdf";
import type { Cast, Guest, Seating, ShotSection } from "@/lib/model/types";
import { renderShotSheet } from "./shotSheet";

const guest = (id: string, extra: Partial<Guest> = {}): Guest => ({
  id,
  firstName: id,
  lastName: "",
  email: "",
  rsvpStatus: "confirmed",
  dietary: "",
  entree: "",
  notes: "",
  side: "",
  groupId: null,
  subgroupId: null,
  familyId: null,
  assignedTableId: null,
  tags: [],
  plusOneOf: null,
  ...extra,
});

const seating: Seating = {
  tables: {},
  groups: {},
  subgroups: {},
  families: {},
  zones: {},
  obstacles: {},
  constraints: [],
  snapshots: [],
  room: { widthUnits: 0, heightUnits: 0, width: 0, height: 0, backgroundColour: "", spaces: [] },
  settings: {
    defaultSeatMode: "table",
    pixelsPerUnit: 1,
    gridSnap: true,
    gridSize: 1,
    snapAlign: true,
    showChairs: true,
    chairSizeUnits: 1,
    showDietaryBadges: true,
    showGroupColours: true,
    unitSystem: "metric",
    customTablePresets: [],
  },
};

const emptyCast: Cast = {
  bride: [],
  groom: [],
  "brides-mother": [],
  "brides-father": [],
  "grooms-mother": [],
  "grooms-father": [],
  "bridal-party": [],
  groomsmen: [],
};

const options = { fontSource: nodeFontSource, generatedOn: "Generated for the test" };

describe("renderShotSheet", () => {
  it("prints every section heading and every shot's label and people", async () => {
    const guests = { g1: guest("g1", { firstName: "Charis" }) };
    const sections: ShotSection[] = [
      {
        id: "sec1",
        name: "Bride's family",
        shots: [{ id: "sh1", label: "Bride with her mother", members: [{ kind: "guest", ref: "g1" }], notes: "Outdoors if dry" }],
      },
    ];
    const { text } = await textOf(await renderShotSheet(sections, guests, seating, emptyCast, options));
    expect(text).toContain("BRIDE'S FAMILY");
    expect(text).toContain("Bride with her mother");
    expect(text).toContain("Charis");
    expect(text).toContain("Outdoors if dry");
  });

  it("numbers shots consecutively across sections", async () => {
    const sections: ShotSection[] = [
      { id: "s1", name: "A", shots: [{ id: "sh1", label: "One", members: [], notes: "" }] },
      { id: "s2", name: "B", shots: [{ id: "sh2", label: "Two", members: [], notes: "" }] },
    ];
    const { text } = await textOf(await renderShotSheet(sections, {}, seating, emptyCast, options));
    expect(text.indexOf("1. One")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("2. Two")).toBeGreaterThan(text.indexOf("1. One"));
  });

  it("skips a section with no shots rather than printing a bare heading", async () => {
    const sections: ShotSection[] = [{ id: "s1", name: "Nothing here", shots: [] }];
    const { text } = await textOf(await renderShotSheet(sections, {}, seating, emptyCast, options));
    expect(text).not.toContain("NOTHING HERE");
  });

  it("renders a document with no shots at all without falling over", async () => {
    const { pages } = await textOf(await renderShotSheet([], {}, seating, emptyCast, options));
    expect(pages).toBeGreaterThanOrEqual(1);
  });

  it("uses A5 when asked", async () => {
    const { pages } = await textOf(
      await renderShotSheet([], {}, seating, emptyCast, { ...options, pageSize: "A5" }),
    );
    expect(pages).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `c:\Projects\Trousseau\suite`): `npm test -- lib/ensemble/render/pdf/shotSheet.test.ts`
Expected: FAIL — `./shotSheet` does not exist.

- [ ] **Step 3: Implement**

Create `suite/lib/ensemble/render/pdf/shotSheet.ts`:

```ts
// ponytail: imports Brigade's page/table/text/units/font kit rather than making
// a third near-copy of it (Cadence already carries a second). Promote the
// shared parts to lib/pdf/ if a fourth tool ever needs this kit.
import { PDFDocument, type PDFFont } from "pdf-lib";
import { embedFamily } from "@/apps/brigade/render/pdf/embedFonts";
import type { FontSource } from "@/apps/brigade/render/pdf/fontSource";
import { addSheet, hexColour, type Colour, type Sheet } from "@/apps/brigade/render/pdf/page";
import { paginate } from "@/apps/brigade/render/pdf/table";
import { wrap } from "@/apps/brigade/render/pdf/text";
import { contentBox, PAGE_SIZES, ptToMm } from "@/apps/brigade/render/pdf/units";
import type { Cast, Guest, Seating, ShotSection } from "@/lib/model/types";
import { resolveShot } from "@/lib/ensemble/resolve";

export interface ShotSheetOptions {
  fontSource: FontSource;
  pageSize?: "A4" | "A5";
  coupleNames?: string;
  generatedOn?: string;
}

const MARGIN_MM = 15;
const HEADER_MM = 16;
const FOOTER_MM = 10;
const ACCENT = "#46617a";
const BODY_PT = 9;
const SECTION_PT = 11;
const LEADING = 1.35;
const NO_COL_MM = 10;
const NOTES_COL_MM = 40;

const MUTED: Colour = { r: 0.44, g: 0.43, b: 0.41 };
const RULE: Colour = { r: 0.84, g: 0.83, b: 0.82 };
const DANGER: Colour = { r: 0.64, g: 0.23, b: 0.17 };

type Line =
  | { kind: "heading"; text: string; heightMm: number }
  | {
      kind: "shot";
      number: number;
      labelLines: string[];
      peopleLines: string[];
      notesLines: string[];
      trouble: boolean;
      heightMm: number;
    };

/** The whole shot list as one flowing document: section names as headings, shots numbered. */
export async function renderShotSheet(
  sections: ShotSection[],
  guests: Record<string, Guest>,
  seating: Seating,
  cast: Cast,
  options: ShotSheetOptions,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const { regular, bold } = await embedFamily(pdf, await options.fontSource("Lato"));
  const accent = hexColour(ACCENT);
  const size = PAGE_SIZES[options.pageSize ?? "A4"];
  const box = contentBox(size, MARGIN_MM);

  const labelColMm = (box.widthMm - NO_COL_MM - NOTES_COL_MM * 2 - 8) / 2;
  const peopleColMm = labelColMm;

  const lines: Line[] = [];
  let shotNumber = 0;

  for (const section of sections) {
    if (section.shots.length === 0) continue;
    lines.push({ kind: "heading", text: section.name, heightMm: ptToMm(SECTION_PT * LEADING) + 3 });

    for (const shot of section.shots) {
      shotNumber += 1;
      const resolved = resolveShot(shot, guests, seating, cast);
      const labelLines = wrap(resolved.label, bold, BODY_PT, labelColMm);
      const peopleLines = wrap(resolved.people.map((p) => p.name).join(", ") || "—", regular, BODY_PT, peopleColMm);
      const notesLines = wrap(shot.notes, regular, BODY_PT, NOTES_COL_MM);
      const rowLines = Math.max(labelLines.length, peopleLines.length, notesLines.length, 1);
      lines.push({
        kind: "shot",
        number: shotNumber,
        labelLines,
        peopleLines,
        notesLines,
        trouble: resolved.problems.length > 0,
        heightMm: ptToMm(rowLines * BODY_PT * LEADING) + 2.4,
      });
    }
  }

  if (lines.length === 0) {
    lines.push({ kind: "heading", text: "No shots planned yet.", heightMm: ptToMm(SECTION_PT * LEADING) + 3 });
  }

  const available = box.heightMm - HEADER_MM - FOOTER_MM;
  const pages = paginate(lines, available);

  pages.forEach((indices, pageIndex) => {
    const sheet = addSheet(pdf, size);
    const y0 = box.yMm;

    sheet.text(options.coupleNames || "Group shots", { xMm: box.xMm, yMm: y0 + 6, font: bold, sizePt: 14 });
    sheet.text(`Page ${pageIndex + 1} of ${pages.length}`, {
      xMm: box.xMm + box.widthMm,
      yMm: y0 + 6,
      font: regular,
      sizePt: 8,
      colour: MUTED,
      alignRight: true,
    });
    sheet.line(box.xMm, y0 + 9, box.xMm + box.widthMm, y0 + 9, { widthPt: 1, colour: accent });

    let y = y0 + HEADER_MM;
    for (const index of indices) {
      const line = lines[index];
      if (!line) continue;
      y = drawLine(sheet, line, {
        xMm: box.xMm,
        widthMm: box.widthMm,
        noWidthMm: NO_COL_MM,
        labelWidthMm: labelColMm,
        peopleWidthMm: peopleColMm,
        y,
        bold,
        regular,
      });
    }

    const footerY = size.heightMm - MARGIN_MM + 4;
    sheet.text(options.generatedOn ?? "", { xMm: box.xMm, yMm: footerY, font: regular, sizePt: 8, colour: MUTED });
  });

  return pdf.save();
}

function drawLine(
  sheet: Sheet,
  line: Line,
  context: {
    xMm: number;
    widthMm: number;
    noWidthMm: number;
    labelWidthMm: number;
    peopleWidthMm: number;
    y: number;
    bold: PDFFont;
    regular: PDFFont;
  },
): number {
  const lineHeightMm = ptToMm(BODY_PT * LEADING);

  if (line.kind === "heading") {
    sheet.text(line.text.toUpperCase(), {
      xMm: context.xMm,
      yMm: context.y + ptToMm(SECTION_PT),
      font: context.bold,
      sizePt: SECTION_PT,
    });
    return context.y + line.heightMm;
  }

  const noX = context.xMm;
  const labelX = context.xMm + context.noWidthMm;
  const peopleX = labelX + context.labelWidthMm + 4;
  const notesX = peopleX + context.peopleWidthMm + 4;

  sheet.text(`${line.number}.`, { xMm: noX, yMm: context.y + lineHeightMm, font: context.regular, sizePt: BODY_PT });

  const draw = (cellLines: string[], xMm: number, font: PDFFont) => {
    cellLines.forEach((text, i) => {
      if (!text) return;
      sheet.text(text, { xMm, yMm: context.y + lineHeightMm * (i + 1), font, sizePt: BODY_PT });
    });
  };
  draw(line.labelLines, labelX, context.bold);
  draw(line.peopleLines, peopleX, context.regular);
  draw(line.notesLines, notesX, context.regular);

  if (line.trouble) {
    sheet.rect(context.xMm - 3.5, context.y + 1.2, 1.4, lineHeightMm * 0.8, { colour: DANGER });
  }

  const bottom = context.y + line.heightMm;
  sheet.line(context.xMm, bottom - 1, context.xMm + context.widthMm, bottom - 1, { widthPt: 0.5, colour: RULE });
  return bottom;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/ensemble/render/pdf/shotSheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/ensemble/render/pdf/shotSheet.ts suite/lib/ensemble/render/pdf/shotSheet.test.ts
git commit -m "feat: render the group shot sheet as a PDF"
```

---

## Task 14: CSV export — `lib/ensemble/exports.ts`

**Files:**
- Create: `suite/lib/ensemble/exports.ts`
- Test: `suite/lib/ensemble/exports.test.ts`

**Interfaces:**
- Consumes: `Cast`, `Guest`, `Seating`, `ShotSection` (Task 2); `resolveShot` (Task 6); `toCsv` (`@/lib/data/csv`, existing).
- Produces: `shotListCsv(sections, guests, seating, cast): string`. Consumed by Task 15.

- [ ] **Step 1: Write the failing test**

Create `suite/lib/ensemble/exports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/data/csv";
import type { Cast, Guest, Seating, ShotSection } from "@/lib/model/types";
import { shotListCsv } from "./exports";

const guests: Record<string, Guest> = {
  g1: {
    id: "g1",
    firstName: "Charis",
    lastName: "Smith",
    email: "",
    rsvpStatus: "confirmed",
    dietary: "",
    entree: "",
    notes: "",
    side: "",
    groupId: null,
    subgroupId: null,
    familyId: null,
    assignedTableId: null,
    tags: [],
    plusOneOf: null,
  },
};

const seating: Seating = {
  tables: {},
  groups: {},
  subgroups: {},
  families: {},
  zones: {},
  obstacles: {},
  constraints: [],
  snapshots: [],
  room: { widthUnits: 0, heightUnits: 0, width: 0, height: 0, backgroundColour: "", spaces: [] },
  settings: {
    defaultSeatMode: "table",
    pixelsPerUnit: 1,
    gridSnap: true,
    gridSize: 1,
    snapAlign: true,
    showChairs: true,
    chairSizeUnits: 1,
    showDietaryBadges: true,
    showGroupColours: true,
    unitSystem: "metric",
    customTablePresets: [],
  },
};

const emptyCast: Cast = {
  bride: [],
  groom: [],
  "brides-mother": [],
  "brides-father": [],
  "grooms-mother": [],
  "grooms-father": [],
  "bridal-party": [],
  groomsmen: [],
};

describe("shotListCsv", () => {
  it("numbers shots consecutively across sections, with the resolved names", () => {
    const sections: ShotSection[] = [
      { id: "s1", name: "Bride's family", shots: [{ id: "sh1", label: "With mum", members: [{ kind: "guest", ref: "g1" }], notes: "Quick one" }] },
      { id: "s2", name: "Both families", shots: [{ id: "sh2", label: "Everyone", members: [], notes: "" }] },
    ];
    const table = parseCsv(shotListCsv(sections, guests, seating, emptyCast));
    expect(table.headers).toEqual(["Section", "No", "Shot", "People", "Notes"]);
    expect(table.rows).toEqual([
      { Section: "Bride's family", No: "1", Shot: "With mum", People: "Charis Smith", Notes: "Quick one" },
      { Section: "Both families", No: "2", Shot: "Everyone", People: "", Notes: "" },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `c:\Projects\Trousseau\suite`): `npm test -- lib/ensemble/exports.test.ts`
Expected: FAIL — `./exports` does not exist.

- [ ] **Step 3: Implement**

Create `suite/lib/ensemble/exports.ts`:

```ts
import { toCsv } from "@/lib/data/csv";
import type { Cast, Guest, Seating, ShotSection } from "@/lib/model/types";
import { resolveShot } from "./resolve";

/** Section, number, shot, the resolved names, and the note. The sheet a photographer prints. */
export function shotListCsv(
  sections: ShotSection[],
  guests: Record<string, Guest>,
  seating: Seating,
  cast: Cast,
): string {
  const headers = ["Section", "No", "Shot", "People", "Notes"];
  const rows: string[][] = [];
  let number = 0;

  for (const section of sections) {
    for (const shot of section.shots) {
      number += 1;
      const resolved = resolveShot(shot, guests, seating, cast);
      rows.push([section.name, String(number), resolved.label, resolved.people.map((p) => p.name).join(", "), shot.notes]);
    }
  }

  return toCsv(headers, rows);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/ensemble/exports.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/ensemble/exports.ts suite/lib/ensemble/exports.test.ts
git commit -m "feat: export the shot list as CSV"
```

---

## Task 15: `PrintPanel` component (right panel, tab 3)

**Files:**
- Create: `suite/components/ensemble/PrintPanel.tsx`

**Interfaces:**
- Consumes: `Guest`, `Seating`, `Shots` (Task 2); `resolveShot` (Task 6); `renderShotSheet` (Task 13); `shotListCsv` (Task 14); `browserFontSource` (`@/apps/brigade/render/pdf/fontSource`); `download` (`@/lib/data/file` — **`(filename, data, type?)`, not Brigade's `(bytes, filename)`**); `Button`, `Empty`, `Panel`, `Segmented` (`@/components/ui/controls`).
- Produces: `<PrintPanel shots guests seating coupleNames />`. Consumed by Task 16.

- [ ] **Step 1: Implement**

Create `suite/components/ensemble/PrintPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { browserFontSource } from "@/apps/brigade/render/pdf/fontSource";
import { Button, Empty, Panel, Segmented } from "@/components/ui/controls";
import { download } from "@/lib/data/file";
import { shotListCsv } from "@/lib/ensemble/exports";
import { renderShotSheet } from "@/lib/ensemble/render/pdf/shotSheet";
import { resolveShot } from "@/lib/ensemble/resolve";
import type { Guest, Seating, Shots } from "@/lib/model/types";

export function PrintPanel({
  shots,
  guests,
  seating,
  coupleNames,
}: {
  shots: Shots;
  guests: Record<string, Guest>;
  seating: Seating;
  coupleNames: string;
}) {
  const [pageSize, setPageSize] = useState<"A4" | "A5">("A4");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = shots.sections.flatMap((section) =>
    section.shots.flatMap((shot) => {
      const resolved = resolveShot(shot, guests, seating, shots.cast);
      return resolved.problems.map((problem) => ({
        shotLabel: resolved.label,
        text:
          problem.kind === "dangling"
            ? problem.detail
            : problem.kind === "declined"
              ? `${problem.name} has declined`
              : "Nobody is in this shot yet",
      }));
    }),
  );

  const slug = () =>
    (coupleNames || "wedding").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "wedding";

  const makePdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const bytes = await renderShotSheet(shots.sections, guests, seating, shots.cast, {
        fontSource: browserFontSource(),
        pageSize,
        coupleNames,
        generatedOn: `Made with Trousseau, ${new Date().toLocaleDateString()}`,
      });
      download(`${slug()}-group-shots.pdf`, new Blob([bytes as BlobPart], { type: "application/pdf" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PDF could not be made.");
    } finally {
      setBusy(false);
    }
  };

  const makeCsv = () => {
    download(`${slug()}-group-shots.csv`, shotListCsv(shots.sections, guests, seating, shots.cast), "text/csv");
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Panel title="Problems">
        {problems.length === 0 ? (
          <Empty>Nothing wrong that this list can see.</Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {problems.map((problem, index) => (
              <li key={index} className="text-sm text-rose">
                "{problem.shotLabel}" — {problem.text}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Page size">
        <Segmented
          value={pageSize}
          onChange={setPageSize}
          options={[
            { value: "A4", label: "A4" },
            { value: "A5", label: "A5" },
          ]}
        />
      </Panel>

      <div className="flex gap-2">
        <Button tone="primary" disabled={busy} onClick={() => void makePdf()}>
          {busy ? "Making the PDF…" : "Download PDF"}
        </Button>
        <Button tone="quiet" onClick={makeCsv}>
          Download CSV
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add suite/components/ensemble/PrintPanel.tsx
git commit -m "feat: add the print panel with problems, PDF and CSV"
```

---

## Task 16: `EnsembleBoard` assembly and the route page

**Files:**
- Create: `suite/components/ensemble/EnsembleBoard.tsx`
- Create: `suite/app/(app)/(tools)/group-shots/page.tsx`

**Interfaces:**
- Consumes: `useEvent`, `useGuests`, `useSeating`, `useShots`, `useStatus`, `useWriters` (`@/lib/model/useSuite`, Task 4); `propose` (Task 7); `ShotList` (Task 10); `ShotInspector` (Task 11); `CastPanel` (Task 12); `PrintPanel` (Task 15); `Button`, `Empty`, `Segmented` (`@/components/ui/controls`).
- Produces: `<EnsembleBoard />`, mounted at `/group-shots`.

- [ ] **Step 1: Implement the board**

Create `suite/components/ensemble/EnsembleBoard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { Button, Empty, Segmented } from "@/components/ui/controls";
import { useEvent, useGuests, useSeating, useShots, useStatus, useWriters } from "@/lib/model/useSuite";
import { propose } from "@/lib/ensemble/propose";
import { CastPanel } from "./CastPanel";
import { PrintPanel } from "./PrintPanel";
import { ShotInspector } from "./ShotInspector";
import { ShotList } from "./ShotList";

type Tab = "shot" | "cast" | "print";

export function EnsembleBoard() {
  const status = useStatus();
  const event = useEvent();
  const guests = useGuests();
  const seating = useSeating();
  const shots = useShots();
  const { setShots } = useWriters();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("shot");

  if (status !== "ready") return null;

  if (Object.keys(guests).length === 0) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <Empty>Nothing to photograph yet. Add a guest list on the Seating tool first.</Empty>
      </div>
    );
  }

  const selectedShot = shots.sections.flatMap((section) => section.shots).find((shot) => shot.id === selectedId);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className="flex w-96 shrink-0 flex-col border-r border-charcoal/10">
        <div className="flex gap-2 border-b border-charcoal/10 p-3">
          <Button icon={Wand2} onClick={() => setShots({ ...shots, sections: propose(shots.sections, guests, seating, "template") })}>
            Seed the classic list
          </Button>
          <Button icon={Sparkles} onClick={() => setShots({ ...shots, sections: propose(shots.sections, guests, seating, "generate") })}>
            + families and groups
          </Button>
        </div>
        <ShotList
          shots={shots}
          guests={guests}
          seating={seating}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setTab("shot");
          }}
          onChange={setShots}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-charcoal/10 p-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "shot", label: "Shot" },
              { value: "cast", label: "Who's who" },
              { value: "print", label: "Print" },
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "shot" &&
            (selectedShot ? (
              <ShotInspector shot={selectedShot} shots={shots} guests={guests} seating={seating} onChange={setShots} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Empty>Pick a shot on the left, or add one.</Empty>
              </div>
            ))}
          {tab === "cast" && <CastPanel shots={shots} guests={guests} onChange={setShots} />}
          {tab === "print" && <PrintPanel shots={shots} guests={guests} seating={seating} coupleNames={event.coupleNames} />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the route page**

Create `suite/app/(app)/(tools)/group-shots/page.tsx`:

```tsx
import type { Metadata } from "next";
import { EnsembleBoard } from "@/components/ensemble/EnsembleBoard";

export const metadata: Metadata = {
  title: "Group shots",
  description: "The family and group photo list, built from the guest list and the room.",
};

export default function GroupShotsPage() {
  return <EnsembleBoard />;
}
```

- [ ] **Step 3: Verify it typechecks**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`, open the app, and check:

1. A **Group shots** tab appears fifth in the header nav, underlined in the new slate-blue when active.
2. With no guest list loaded: the tool shows "Nothing to photograph yet."
3. Import or add a guest list (via Seating), then open Group shots: "Seed the classic list" produces five sections with shots that resolve to nobody yet.
4. Set a cast role on the "Who's who" tab; the corresponding shots on the left update to show that person's name.
5. Add a section, add a shot, add members of each of the five kinds (guest/family/group/role/text), edit the label and notes, and confirm the left-panel preview updates live.
6. Drag a shot to reorder it within its section, with the mouse.
7. On the Print tab: a shot with a dangling or declined member shows up under Problems; Download PDF and Download CSV both produce a file with the expected content.
8. Refresh the page — the shot list, cast, and section order all survive (confirms the slice is actually persisted).

- [ ] **Step 5: Commit**

```bash
git add suite/components/ensemble/EnsembleBoard.tsx "suite/app/(app)/(tools)/group-shots/page.tsx"
git commit -m "feat: assemble the group shots board and route"
```

---

## Task 17: Landing page integration — `readiness.ts`

**Files:**
- Modify: `suite/lib/model/readiness.ts`
- Modify: `suite/lib/model/readiness.test.ts`

**Interfaces:**
- Consumes: `readShots` (Task 3); `resolveShot` (Task 6).
- Produces: `Readiness["href"]` gains `"/group-shots"`; `readiness()` gains a `"shots-dangling"` row.

- [ ] **Step 1: Write the failing tests**

In `suite/lib/model/readiness.test.ts`, add:

```ts
describe("group shots", () => {
  const shotsWith = (ref: string) => ({
    cast: {},
    sections: [
      {
        id: "s1",
        name: "Family",
        shots: [{ id: "sh1", label: "", members: [{ kind: "guest", ref }], notes: "" }],
      },
    ],
  });

  it("flags a shot that points at a guest who no longer exists", () => {
    expect(ids({ guests: GUESTS, ...TABLES, shots: shotsWith("ghost") })).toContain("shots-dangling");
  });

  it("says nothing when every shot resolves cleanly", () => {
    expect(ids({ guests: GUESTS, ...TABLES, shots: shotsWith("g1") })).not.toContain("shots-dangling");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `c:\Projects\Trousseau\suite`): `npm test -- readiness.test.ts`
Expected: FAIL — no `"shots-dangling"` row exists yet.

- [ ] **Step 3: Implement**

In `suite/lib/model/readiness.ts`:

- Add `readShots` to the `import { guestName, readCrew, readGuests, readSeating, readTimeline } from "./slices";` line.
- Add `import { resolveShot } from "@/lib/ensemble/resolve";`.
- Widen the `Readiness["href"]` union: `href: "/seating" | "/place-cards" | "/timeline" | "/delegation" | "/group-shots";`.
- After the `uncrewed` block and before `return out;`, add:

```ts
  /**
   * A shot pointing at someone or something that has since been deleted.
   * Only the "dangling" kind — a declined guest or an empty shot is already
   * visible inline in the tool itself, and repeating it here is exactly the
   * double-reporting this module exists to avoid.
   */
  const shots = readShots(doc);
  const dangling = shots.sections
    .flatMap((section) => section.shots)
    .flatMap((shot) => resolveShot(shot, guests, seating, shots.cast).problems)
    .filter((problem) => problem.kind === "dangling").length;

  if (dangling > 0) {
    out.push({
      id: "shots-dangling",
      severity: "blocking",
      message:
        dangling === 1
          ? "One group shot points at someone or something that no longer exists."
          : `${dangling} group shots point at someone or something that no longer exists.`,
      href: "/group-shots",
      action: "Fix the shot list",
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- readiness.test.ts`
Expected: PASS. Also run `npm run typecheck` — the `WhatIsLeft.tsx` component reads `Readiness["href"]` generically via `TOOLS.find(...)`, so no further edit should be needed there, but confirm.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/model/readiness.ts suite/lib/model/readiness.test.ts
git commit -m "feat: surface dangling shot references on the landing page"
```

---

## Task 18: Wedding Pack integration

**Files:**
- Modify: `suite/components/shell/WeddingPack.tsx`

**Interfaces:**
- Consumes: `readShots`, `readGuests`, `readSeating` (Task 3, existing); `renderShotSheet` (Task 13).
- Produces: a fourth `PackSection` ("The shots") in the assembled pack.

- [ ] **Step 1: Add the readers to the existing static import**

In `suite/components/shell/WeddingPack.tsx`, change:

```ts
import { readTimeline } from "@/lib/model/slices";
```

to:

```ts
import { readGuests, readSeating, readShots, readTimeline } from "@/lib/model/slices";
```

- [ ] **Step 2: Add the section function**

Add after `jobList()`:

```ts
async function shotSheet(): Promise<Uint8Array | null> {
  const { doc } = useTrousseauStore.getState();
  const shots = readShots(doc);
  const total = shots.sections.reduce((sum, section) => sum + section.shots.length, 0);
  if (total === 0) return null;

  const [{ renderShotSheet }, { browserFontSource }] = await Promise.all([
    import("@/lib/ensemble/render/pdf/shotSheet"),
    import("@/apps/brigade/render/pdf/fontSource"),
  ]);

  return renderShotSheet(shots.sections, readGuests(doc), readSeating(doc), shots.cast, {
    fontSource: browserFontSource(),
    coupleNames: doc.event.coupleNames,
    generatedOn: `Made with Trousseau, ${new Date().toLocaleDateString()}`,
  });
}
```

- [ ] **Step 3: Add it to the pack**

Change:

```ts
    for (const [title, make] of [
      ["The room", floorPlan],
      ["The day", runSheet],
      ["The jobs", jobList],
    ] as const) {
```

to:

```ts
    for (const [title, make] of [
      ["The room", floorPlan],
      ["The day", runSheet],
      ["The jobs", jobList],
      ["The shots", shotSheet],
    ] as const) {
```

- [ ] **Step 4: Update the description copy**

Change the paragraph:

```
        The floor plan, the run sheet and the job list as one document, printed from the wedding
        as it stands right now. Place cards are a separate print — they go on card stock, not in
        a binder.
```

to:

```
        The floor plan, the run sheet, the job list and the group shot list as one document,
        printed from the wedding as it stands right now. Place cards are a separate print — they
        go on card stock, not in a binder.
```

- [ ] **Step 5: Verify it typechecks**

Run (from `c:\Projects\Trousseau\suite`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Verify by hand**

With a guest list, a room, a day and at least one group shot planned, open the landing page and click "Download the pack." Confirm the resulting PDF has four sections and the note lists "The shots" with a page count. Then remove every shot and confirm the pack still builds with three sections and "left out: the shots" in the note.

- [ ] **Step 7: Commit**

```bash
git add suite/components/shell/WeddingPack.tsx
git commit -m "feat: fold the group shot list into the wedding pack"
```

---

## Task 19: Cross-slice validator checks

**Files:**
- Modify: `scripts/validate-wedding.mjs`
- Modify: `scripts/validate-wedding.test.mjs`

**Interfaces:**
- Consumes: nothing new — this script works on plain parsed objects, not the suite's typed model.
- Produces: four new checks inside `check(doc)`, covering `doc.shots`.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/validate-wedding.test.mjs`:

```js
describe("shots slice", () => {
  const base = { event: { date: "2026-06-20" }, day: null, guests: {}, seating: {} };

  it("catches a shot member naming a guest who does not exist", () => {
    const doc = {
      ...base,
      shots: {
        cast: {},
        sections: [{ id: "s1", name: "Family", shots: [{ id: "sh1", label: "x", members: [{ kind: "guest", ref: "ghost" }] }] }],
      },
    };
    expect(check(doc).errors).toEqual([expect.stringContaining("ghost")]);
  });

  it("catches a cast role naming a guest who does not exist", () => {
    const doc = { ...base, shots: { cast: { bride: ["ghost"] }, sections: [] } };
    expect(check(doc).errors).toEqual([expect.stringContaining("bride")]);
  });

  it("warns on a declined guest in a shot, without failing", () => {
    const doc = {
      ...base,
      guests: { g1: { id: "g1", rsvpStatus: "declined" } },
      shots: {
        cast: {},
        sections: [{ id: "s1", name: "Family", shots: [{ id: "sh1", label: "x", members: [{ kind: "guest", ref: "g1" }] }] }],
      },
    };
    const result = check(doc);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining("declined")]);
  });

  it("warns on an empty section and an empty shot", () => {
    const doc = {
      ...base,
      shots: {
        cast: {},
        sections: [
          { id: "s1", name: "Empty section", shots: [] },
          { id: "s2", name: "Has one", shots: [{ id: "sh1", label: "", members: [] }] },
        ],
      },
    };
    const warnings = check(doc).warnings;
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("nobody in it"), expect.stringContaining("nothing in them")]),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `c:\Projects\Trousseau`): `npm test -- validate-wedding.test.mjs`
Expected: FAIL — no shots checks exist yet.

- [ ] **Step 3: Implement**

In `scripts/validate-wedding.mjs`, add before `return { errors, warnings, facts };`:

```js
  // --------------------------------------------------------------- shots slice
  if (isObj(doc.shots)) {
    const guestIds = new Set(Object.keys(isObj(doc.guests) ? doc.guests : {}));
    const familyIds = new Set(Object.keys(doc.seating?.families ?? {}));
    const groupIds = new Set([
      ...Object.keys(doc.seating?.groups ?? {}),
      ...Object.keys(doc.seating?.subgroups ?? {}),
    ]);
    const cast = isObj(doc.shots.cast) ? doc.shots.cast : {};

    for (const [role, ids] of Object.entries(cast)) {
      for (const id of Array.isArray(ids) ? ids : []) {
        if (!guestIds.has(id)) fail(`the cast's ${role} names guest ${id}, who does not exist`);
      }
    }

    let shotCount = 0;
    let emptySections = 0;
    for (const section of Array.isArray(doc.shots.sections) ? doc.shots.sections : []) {
      const shots = Array.isArray(section.shots) ? section.shots : [];
      if (shots.length === 0) emptySections += 1;
      for (const shot of shots) {
        shotCount += 1;
        const members = Array.isArray(shot.members) ? shot.members : [];
        if (members.length === 0) warn(`"${shot.label || "an untitled shot"}" has nobody in it`);
        for (const member of members) {
          if (member.kind === "guest" && !guestIds.has(member.ref)) {
            fail(`"${shot.label || shot.id}" names guest ${member.ref}, who does not exist`);
          }
          if (member.kind === "family" && !familyIds.has(member.ref)) {
            fail(`"${shot.label || shot.id}" names family ${member.ref}, which does not exist`);
          }
          if (member.kind === "group" && !groupIds.has(member.ref)) {
            fail(`"${shot.label || shot.id}" names group ${member.ref}, which does not exist`);
          }
          if (member.kind === "guest" && guestIds.has(member.ref) && doc.guests[member.ref]?.rsvpStatus === "declined") {
            warn(`"${shot.label || shot.id}" includes ${member.ref}, who has declined`);
          }
        }
      }
    }
    if (emptySections > 0) warn(`${emptySections} shot section(s) with nothing in them`);
    if (shotCount > 0) facts.push(`shots: ${shotCount} planned`);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- validate-wedding.test.mjs`
Expected: PASS. Also run the full `npm test` at the root to confirm nothing else regressed.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-wedding.mjs scripts/validate-wedding.test.mjs
git commit -m "feat: validate the shots slice against guests and seating"
```

---

## Task 20: Round-trip regression coverage

**Files:**
- Modify: `suite/lib/model/roundTrip.test.ts`

**Interfaces:**
- Consumes: `addSection`, `addShot`, `patchShot` (Task 5); `readShots` (Task 3).

- [ ] **Step 1: Extend the test**

In `suite/lib/model/roundTrip.test.ts`:

1. Add `readShots` to the `const { publishDay, readCrew, readGuests, readSeating, readTimeline } = await import("./slices");` line.
2. Add a new dynamic import line alongside the existing ones: `const { addSection, addShot, patchShot } = await import("@/lib/ensemble/actions");`
3. In `buildAWedding()`, after the `crew` block (after `store().setSlice("crew", crew);`), add:

```ts
  let shots = addSection(readShots(store().doc), "Bride's family");
  const sectionId = shots.sections[0]!.id;
  shots = addShot(shots, sectionId);
  shots = patchShot(shots, shots.sections[0]!.shots[0]!.id, {
    label: "Bride with her mother",
    members: [{ kind: "guest", ref: "g1" }],
  });
  store().setSlice("shots", shots);
```

4. In the `"an exported backup restores byte for byte, unknown slices included"` test, add after the `readCrew` assertion:

```ts
  expect(readShots(store().doc).sections[0]!.shots[0]!.label).toBe("Bride with her mother");
```

5. In the `"what is stored is what is restored — the whole document, not a summary"` test, extend the slice list:

```ts
  for (const slice of ["event", "guests", "seating", "timeline", "day", "crew", "shots"]) {
```

- [ ] **Step 2: Run the test to verify it fails, then implement, then verify it passes**

Since Tasks 3 and 5 are already done by this point in the plan, this task is a pure extension of existing coverage rather than new behavior — run it once after editing:

Run (from `c:\Projects\Trousseau\suite`): `npm test -- roundTrip.test.ts`
Expected: PASS immediately (the underlying `readShots`/`addSection`/`addShot`/`patchShot` already exist and work; this task only adds assertions that exercise them together for the first time).

- [ ] **Step 3: Commit**

```bash
git add suite/lib/model/roundTrip.test.ts
git commit -m "test: cover the shots slice in the suite-wide round-trip test"
```

---

## Task 21: Docs — root README

**Files:**
- Modify: `README.md` (repo root, `c:\Projects\Trousseau\README.md`)

**Interfaces:** none — copy only.

- [ ] **Step 1: Update the tagline and tool count**

Change the opening line (around line 3):

```
**One wedding, four tools, and no arguments about which copy is right.**
```

to:

```
**One wedding, five tools, and no arguments about which copy is right.**
```

- [ ] **Step 2: Add a row to the tools table**

Find the `## The four tools` heading (around line 59) and its table. Rename the heading to `## The five tools` and add a row after Delegation's:

```
| **Ensemble** (Group shots) | The family photo list, built from who's who | `shots` | the guest list, the room |
```

Match whatever column headers the existing table uses exactly (re-read the table before editing — do not guess the column order).

- [ ] **Step 3: Leave the rest alone, deliberately**

Do **not** touch `suite/README.md` — it specifically documents the four *standalone apps that were ported into the suite* ("This is the four standalone apps ... brought onto one document"). Ensemble was never a standalone app and was never ported; adding it to that document's narrative would misstate its own history. Do **not** edit the root README's mermaid architecture diagram (around line 38) — it is decorative/explanatory, not load-bearing, and a hand-edited diagram this plan cannot render is a worse risk than leaving it one tool behind for now.

- [ ] **Step 4: Verify**

Read the edited sections back and confirm the table's columns still line up (markdown tables are whitespace-sensitive only in that every row needs the same number of `|`-separated cells — check by eye).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: mention the fifth tool"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (name/placement) → Tasks 8, 16. §2 (slice shape, vocabulary) → Task 2. §3 (contract package, sync fix) → Task 1. §4 (reader/writer/resolver) → Tasks 3, 4, 6. §5 (propose) → Task 7. §6 (screen, drag, guest picker) → Tasks 9–12, 16. §7 (PDF, CSV, both integrations, validator, tests) → Tasks 13, 14, 17, 18, 19, plus tests embedded in Tasks 1–14. Corrections 1–4 → Tasks 8, 10, 16 note them explicitly.
- **Placeholder scan:** no "TBD"/"handle it"/"similar to Task N" — every step carries real, complete code or a fully written test.
- **Type consistency check:** `Shots`/`ShotSection`/`Shot`/`ShotMember`/`Cast`/`CastRole` (Task 2) are the same shapes used verbatim through `slices.ts` (3), `useSuite.ts` (4), `actions.ts` (5), `resolve.ts` (6), `propose.ts` (7), every component (9–12, 15–16), `shotSheet.ts` (13), `exports.ts` (14), `readiness.ts` (17) and `WeddingPack.tsx` (18) — no renamed fields or divergent signatures between tasks. `resolveShot`'s return shape (`ResolvedShot` with `label`/`people`/`problems`) is defined once in Task 6 and consumed identically everywhere else. `propose`'s corrected signature (`existing` first, no `cast` param) is used consistently in its own tests (Task 7) and its one caller (Task 16).
