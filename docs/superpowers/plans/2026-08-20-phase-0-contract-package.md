# Trousseau Phase 0 — Contract Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish `@jfrusher/trousseau` — the schemas, types and file
format four wedding apps will share — without touching any of those apps.

**Architecture:** A tiny ESM TypeScript package with one runtime dependency
(zod). It defines an envelope of independently-owned slices, validates them, and
serialises a `.trousseau.json`. Its single most important property is that it
never loses data it does not understand: unknown slices and unknown keys within
slices survive every operation byte-for-byte.

**Tech Stack:** TypeScript 5.9, zod 4, vitest 3, plain `tsc` for the build. No
bundler, no framework, no React.

**Spec:** `docs/superpowers/specs/2026-08-20-trousseau-design.md`

## Global Constraints

- **Phase 0 modifies no existing application.** No file outside
  `c:\Projects\Trousseau` is edited. Fixtures are *copied* in, never moved.
- **Package name:** `@jfrusher/trousseau`. **Version:** `0.1.0` for the first
  publish.
- **Node:** `>=18`. **Module system:** ESM only (`"type": "module"`).
- **Dependencies:** `zod` `^4.4.3` (matching `Tableaux/server/package.json`) is
  the *only* runtime dependency. Adding another requires going back to the spec.
- **Dev dependencies:** `typescript` `^5.9.3`, `vitest` `^3.2.4`. Nothing else.
- **tsconfig must match the consuming apps' strictness**, or its emitted types
  will not compile inside them: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`,
  target `ES2022`, `moduleResolution: "bundler"`.
- **Never use `z.object()`.** In zod 4 it silently strips unknown keys, which is
  the exact data-loss failure this package exists to prevent. Use
  `z.looseObject()` everywhere, without exception. Task 3 adds a test that fails
  if anyone forgets.
- **Validation never repairs and never deletes.** Parsed output is used for
  reading and checking only. Nothing in this package ever writes a parsed
  document back over stored user data.
- **Spelling is British** (`serialise`, not `serialize`), matching all four apps.
- The `day` schema must be **at least as lenient as
  `Brigade/src/core/import/day.ts`**. If Brigade accepts a file today, this
  package must accept it too, or Phase 1b would break a working import.
- **Not in this phase:** `read()` and `publish()`. The spec lists them on the
  package's public surface, but they are the store client and belong to Phase
  1a, alongside the first app that uses them. Phase 0 ships the shapes and the
  file; nothing in it touches a browser, which is why its whole suite runs in
  node.
- **Every zod default is a factory** — `.default(() => [])`, never
  `.default([])`. A literal default is one object shared by every parse in the
  process.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json` | Package metadata, exports map, scripts |
| `tsconfig.json` | Strict, emitting, matches consumer apps |
| `vitest.config.ts` | Node environment, `src/**/*.test.ts` |
| `src/index.ts` | The entire public surface. Re-exports only. |
| `src/event.ts` | `event` slice schema and type |
| `src/day.ts` | `day` slice schema and type — mirrors Cadence's `ResolvedDay` |
| `src/slices.ts` | `guests`, `seating`, `crew`, `stationery` — open-shaped slices |
| `src/envelope.ts` | The envelope schema, `SliceName`, `migrate`, `emptyTrousseau` |
| `src/file.ts` | `serialise` and `parse` for `.trousseau.json` |
| `fixtures/sample-day.day.json` | Copy of Brigade's fixture, for the leniency test |
| `fixtures/minimal.day.json` | A day with every optional field absent |
| `README.md` | Already exists. Task 6 adds usage. |

`src/index.ts` is re-exports only so that the public surface is readable in one
screen and so a later phase adding the store client changes one obvious file.

---

## Task 1: Repository scaffold and the `event` slice

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/event.ts`
- Create: `src/index.ts`
- Test: `src/event.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `eventSchema: ZodType`, `type Event`, and a working
  `npm test` / `npm run build` that every later task relies on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@jfrusher/trousseau",
  "version": "0.1.0",
  "description": "The shared data contract behind Tableaux, Plaque, Cadence and Brigade.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run test && npm run build"
  },
  "dependencies": {
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Emitting, unlike the apps' configs — this package ships its build.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` appears, `package-lock.json` is created, no errors.

- [ ] **Step 5: Write the failing test**

Create `src/event.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eventSchema } from "./event";

describe("eventSchema", () => {
  it("accepts a complete event", () => {
    const parsed = eventSchema.parse({
      date: "2026-06-20",
      coupleNames: "Charis & Jacob",
      venueName: "Vane House",
      curfewMin: 1500,
      utcOffsetMin: 60,
    });
    expect(parsed.coupleNames).toBe("Charis & Jacob");
  });

  it("fills absent fields rather than rejecting a half-built event", () => {
    const parsed = eventSchema.parse({});
    expect(parsed).toEqual({
      date: "",
      coupleNames: "",
      venueName: "",
      curfewMin: null,
      utcOffsetMin: null,
    });
  });

  it("preserves keys it does not know about", () => {
    const parsed = eventSchema.parse({ coupleNames: "A & B", hashtag: "#ab2026" });
    expect(parsed).toMatchObject({ hashtag: "#ab2026" });
  });

  it("rejects a field of the wrong type", () => {
    expect(eventSchema.safeParse({ curfewMin: "late" }).success).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/event.test.ts`
Expected: FAIL — `Failed to resolve import "./event"`.

- [ ] **Step 7: Write the implementation**

Create `src/event.ts`:

```ts
import { z } from "zod";

/**
 * The facts every app needs and none uniquely owns: who, where, when.
 *
 * Owned by the launcher. Cadence carries the same fields inside its own
 * document and echoes them into `day.day.*`; that echo is a copy, and this is
 * authoritative.
 *
 * Every field has a default because an event is half-filled for most of its
 * life. A missing venue is a normal state, not a validation failure — refusing
 * to parse would mean an app could not read the couple's names until someone
 * had chosen a venue.
 */
export const eventSchema = z.looseObject({
  date: z.string().default(""),
  coupleNames: z.string().default(""),
  venueName: z.string().default(""),
  /** Minutes from the day's 00:00, as everywhere in Cadence. */
  curfewMin: z.number().nullable().default(null),
  utcOffsetMin: z.number().nullable().default(null),
});

export type Event = z.infer<typeof eventSchema>;
```

- [ ] **Step 8: Create `src/index.ts`**

```ts
export { eventSchema, type Event } from "./event";
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, 4 tests.

- [ ] **Step 10: Verify the build emits**

Run: `npm run build`
Expected: exit 0, and `dist/index.js`, `dist/index.d.ts`, `dist/event.js`,
`dist/event.d.ts` all exist.

- [ ] **Step 11: Create `.gitignore` additions and commit**

`.gitignore` already contains `node_modules/`, `dist/` and `*.tsbuildinfo`. No
change needed — verify with `cat .gitignore`, then:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/
git commit -m "Add the event slice and the package scaffold

Every field defaults rather than failing: an event is half-filled for most
of its life, and an app should be able to read the couple's names before
anyone has picked a venue."
```

---

## Task 2: The `day` slice

The one slice that already exists in the wild. Cadence writes it
(`cadence/src/core/project/day.ts`), Brigade reads it
(`Brigade/src/core/import/day.ts`), and a `.day.json` fixture is committed in
both repos. This schema must accept everything Brigade accepts today.

**Files:**
- Create: `src/day.ts`
- Create: `fixtures/sample-day.day.json` (copied)
- Create: `fixtures/minimal.day.json`
- Modify: `src/index.ts`
- Test: `src/day.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `daySchema: ZodType`, `type Day`, `type DayBlock`, `type DayTeam`,
  `DAY_KIND = "cadence.day"`, `DAY_VERSION = 1`.

- [ ] **Step 1: Copy Brigade's fixture in**

```bash
mkdir -p fixtures
cp /c/Projects/Brigade/fixtures/sample-day.day.json fixtures/sample-day.day.json
```

This is a copy. Brigade's own fixture is not moved, renamed or edited.

- [ ] **Step 2: Create the minimal fixture**

Create `fixtures/minimal.day.json` — every optional field absent, exercising the
leniency Brigade already has:

```json
{
  "kind": "cadence.day",
  "version": 1,
  "day": {
    "date": "2026-06-20",
    "coupleNames": "A & B",
    "venueName": "Somewhere",
    "curfewMin": 1440,
    "utcOffsetMin": 0
  },
  "blocks": [
    { "id": "b1", "label": "Ceremony", "lane": "Main day", "startMin": 780, "endMin": 810 }
  ]
}
```

Note what is missing and must still parse: `appVersion`, `lanes`, `teams`, and,
inside the block, `location`, `notes`, `tags`, `contentEndMin`, `anchored`,
`moment`.

- [ ] **Step 3: Write the failing test**

Create `src/day.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAY_KIND, DAY_VERSION, daySchema } from "./day";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

describe("daySchema", () => {
  it("accepts the day Cadence exports today", () => {
    const parsed = daySchema.parse(fixture("sample-day.day.json"));
    expect(parsed.kind).toBe(DAY_KIND);
    expect(parsed.version).toBe(DAY_VERSION);
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });

  it("accepts a day with every optional field absent, as Brigade does", () => {
    const parsed = daySchema.parse(fixture("minimal.day.json"));
    expect(parsed.appVersion).toBe("");
    expect(parsed.lanes).toEqual([]);
    expect(parsed.teams).toEqual([]);
    expect(parsed.blocks[0]).toMatchObject({
      location: "",
      notes: "",
      tags: [],
      anchored: false,
      moment: false,
    });
  });

  it("defaults contentEndMin to startMin, as Brigade does", () => {
    const parsed = daySchema.parse(fixture("minimal.day.json"));
    expect(parsed.blocks[0]?.contentEndMin).toBe(780);
  });

  it("accepts a version from the future rather than refusing it", () => {
    const future = { ...(fixture("minimal.day.json") as object), version: 99 };
    expect(daySchema.safeParse(future).success).toBe(true);
  });

  it("preserves unknown keys on the day, a block and a team", () => {
    const parsed = daySchema.parse({
      kind: "cadence.day",
      version: 1,
      day: { date: "", coupleNames: "", venueName: "", curfewMin: 0, utcOffsetMin: 0 },
      blocks: [{ id: "b1", label: "L", lane: "M", startMin: 0, endMin: 1, weather: "fine" }],
      teams: [{ tag: "florist", vanRegistration: "AB12 CDE" }],
      sunsetMin: 1290,
    });
    expect(parsed).toMatchObject({ sunsetMin: 1290 });
    expect(parsed.blocks[0]).toMatchObject({ weather: "fine" });
    expect(parsed.teams[0]).toMatchObject({ vanRegistration: "AB12 CDE" });
  });

  it("rejects a file that is not a Cadence day", () => {
    expect(daySchema.safeParse({ kind: "cadence.project", version: 1 }).success).toBe(false);
  });

  it("rejects a block with no start time", () => {
    const bad = {
      kind: "cadence.day",
      version: 1,
      day: { date: "", coupleNames: "", venueName: "", curfewMin: 0, utcOffsetMin: 0 },
      blocks: [{ id: "b1", label: "L", lane: "M", endMin: 1 }],
    };
    expect(daySchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/day.test.ts`
Expected: FAIL — `Failed to resolve import "./day"`.

- [ ] **Step 5: Write the implementation**

Create `src/day.ts`:

```ts
import { z } from "zod";

/** The `kind` marker Cadence writes, so a reader can refuse the wrong file politely. */
export const DAY_KIND = "cadence.day";
/** The export format's version. Not the project file's schema version. */
export const DAY_VERSION = 1;

/**
 * A block with its clock times already worked out.
 *
 * `id`, `label`, `lane`, `startMin` and `endMin` are required because
 * `Brigade/src/core/import/day.ts` refuses a block without them. Everything
 * else defaults, because Brigade fills those in rather than refusing — and this
 * schema must never reject a file Brigade accepts today.
 */
export const dayBlockSchema = z.looseObject({
  id: z.string(),
  label: z.string(),
  lane: z.string(),
  startMin: z.number(),
  endMin: z.number(),
  location: z.string().default(""),
  notes: z.string().default(""),
  tags: z.array(z.string()).default(() => []),
  contentEndMin: z.number().optional(),
  anchored: z.boolean().default(false),
  moment: z.boolean().default(false),
}).transform((block) => ({
  ...block,
  // Brigade's rule: an absent content end means the block has no buffer.
  contentEndMin: block.contentEndMin ?? block.startMin,
}));

/**
 * A supplier tag with whatever detail was recorded against it.
 *
 * `arrivalMin` is present in Cadence's export and absent from Brigade's reader.
 * It defaults to null so that both round-trip, and so consumers get
 * `number | null` rather than an optional property — the apps compile with
 * `exactOptionalPropertyTypes`, where an optional field is materially harder to
 * assign to.
 */
export const dayTeamSchema = z.looseObject({
  tag: z.string(),
  displayName: z.string().default(""),
  phone: z.string().default(""),
  arrivalMin: z.number().nullable().default(null),
  notes: z.string().default(""),
});

/**
 * The day, resolved.
 *
 * A `.cadence.json` holds anchors, gaps and squeeze floors; knowing when
 * anything actually happens means running Cadence's resolver. Rather than have
 * a second application reimplement that function, Cadence hands out the answer,
 * and this is the shape of the answer.
 *
 * `version` is not constrained to `DAY_VERSION`. A newer file is read as far as
 * this version understands it rather than refused — the same posture Brigade
 * already takes, and the reason its importer carries a `fromFuture` flag rather
 * than an error.
 */
export const daySchema = z.looseObject({
  kind: z.literal(DAY_KIND),
  version: z.number(),
  appVersion: z.string().default(""),
  day: z.looseObject({
    date: z.string(),
    coupleNames: z.string(),
    venueName: z.string(),
    curfewMin: z.number(),
    utcOffsetMin: z.number(),
  }),
  lanes: z.array(z.string()).default(() => []),
  blocks: z.array(dayBlockSchema),
  teams: z.array(dayTeamSchema).default(() => []),
});

export type DayBlock = z.infer<typeof dayBlockSchema>;
export type DayTeam = z.infer<typeof dayTeamSchema>;
export type Day = z.infer<typeof daySchema>;

/** True when the file was written by a Cadence newer than this package. */
export function isFromFuture(day: Day): boolean {
  return day.version > DAY_VERSION;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, 11 tests.

- [ ] **Step 7: Add to the public surface**

Modify `src/index.ts` to read:

```ts
export { eventSchema, type Event } from "./event";
export {
  DAY_KIND,
  DAY_VERSION,
  dayBlockSchema,
  daySchema,
  dayTeamSchema,
  isFromFuture,
  type Day,
  type DayBlock,
  type DayTeam,
} from "./day";
```

- [ ] **Step 8: Verify the build still emits**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add fixtures/ src/day.ts src/day.test.ts src/index.ts
git commit -m "Add the day slice, matching what Cadence already exports

Deliberately at least as lenient as Brigade's importer: every field that
Brigade defaults rather than requires is defaulted here too, so no file
that opens in Brigade today can fail this schema tomorrow."
```

---

## Task 3: The envelope, `migrate`, and the preservation guarantee

The heart of the package. Rules 1 and 2 from the spec become executable here.

**Files:**
- Create: `src/slices.ts`
- Create: `src/envelope.ts`
- Modify: `src/index.ts`
- Test: `src/envelope.test.ts`
- Test: `src/preservation.test.ts`

**Interfaces:**
- Consumes: `eventSchema` from Task 1, `daySchema` from Task 2.
- Produces: `trousseauSchema`, `type Trousseau`, `type SliceName`,
  `SLICE_NAMES: readonly SliceName[]`, `TROUSSEAU_KIND`, `TROUSSEAU_VERSION`,
  `emptyTrousseau(): Trousseau`, `migrate(doc: unknown): Trousseau`,
  `mergeSlice(raw, slice, value)`.

- [ ] **Step 1: Write the open-shaped slices**

Create `src/slices.ts`:

```ts
import { z } from "zod";

/**
 * The slices whose interior shape belongs entirely to their owning app.
 *
 * This package validates that they are objects and nothing more. Tableaux owns
 * what a guest is; Plaque owns what a card looks like. Encoding those shapes
 * here would mean a Tableaux feature could not ship without a release of this
 * package, which is the coupling the whole design exists to avoid.
 *
 * `Tableaux/server/lib/planSchema.js` already takes exactly this position, in
 * its own words: "The client owns the rich per-entity shape; the server
 * enforces types and ceilings."
 */
// Every default is a factory, never a literal. A literal default is one object
// shared by every parse, and a caller who mutates what they were given would
// silently change the default for everyone else in the process.
export const guestsSchema = z.record(z.string(), z.unknown()).default(() => ({}));
export const seatingSchema = z.record(z.string(), z.unknown()).default(() => ({}));
export const crewSchema = z.looseObject({}).default(() => ({}));
export const stationerySchema = z.looseObject({}).default(() => ({}));

export type Guests = z.infer<typeof guestsSchema>;
export type Seating = z.infer<typeof seatingSchema>;
export type Crew = z.infer<typeof crewSchema>;
export type Stationery = z.infer<typeof stationerySchema>;
```

- [ ] **Step 2: Write the failing envelope test**

Create `src/envelope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SLICE_NAMES,
  TROUSSEAU_KIND,
  TROUSSEAU_VERSION,
  emptyTrousseau,
  migrate,
  trousseauSchema,
} from "./envelope";

describe("emptyTrousseau", () => {
  it("is a valid document", () => {
    expect(trousseauSchema.safeParse(emptyTrousseau()).success).toBe(true);
  });

  it("has no day until one is published", () => {
    expect(emptyTrousseau().day).toBeNull();
  });

  it("returns a fresh object each call, so callers cannot share state", () => {
    const a = emptyTrousseau();
    a.event.coupleNames = "A & B";
    expect(emptyTrousseau().event.coupleNames).toBe("");
  });
});

describe("SLICE_NAMES", () => {
  it("lists exactly the six publishable slices", () => {
    expect([...SLICE_NAMES]).toEqual([
      "event",
      "guests",
      "seating",
      "day",
      "crew",
      "stationery",
    ]);
  });

  it("does not include sources, which is not publishable", () => {
    expect(SLICE_NAMES).not.toContain("sources");
  });
});

describe("migrate", () => {
  it("accepts an empty object as a new, empty wedding", () => {
    const doc = migrate({});
    expect(doc.kind).toBe(TROUSSEAU_KIND);
    expect(doc.version).toBe(TROUSSEAU_VERSION);
  });

  it("accepts a document from the future rather than refusing it", () => {
    expect(() => migrate({ kind: TROUSSEAU_KIND, version: 99 })).not.toThrow();
  });

  it("throws on something that is not a trousseau at all", () => {
    expect(() => migrate({ kind: "cadence.day", version: 1 })).toThrow();
  });

  it("throws on a slice of the wrong type rather than discarding it", () => {
    expect(() => migrate({ guests: "everyone" })).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/envelope.test.ts`
Expected: FAIL — `Failed to resolve import "./envelope"`.

- [ ] **Step 4: Write the envelope**

Create `src/envelope.ts`:

```ts
import { z } from "zod";
import { daySchema } from "./day";
import { eventSchema } from "./event";
import { crewSchema, guestsSchema, seatingSchema, stationerySchema } from "./slices";

export const TROUSSEAU_KIND = "trousseau";
export const TROUSSEAU_VERSION = 1;

/**
 * The slices an app may publish. `sources` is deliberately absent: it is not
 * owned by any app, is written only by the launcher on export, and never lives
 * in the ambient store.
 */
export const SLICE_NAMES = [
  "event",
  "guests",
  "seating",
  "day",
  "crew",
  "stationery",
] as const;

export type SliceName = (typeof SLICE_NAMES)[number];

/**
 * The whole wedding.
 *
 * `looseObject` at every level, without exception. In zod 4 a plain
 * `z.object()` silently strips keys it does not know, which for this document
 * means deleting a slice belonging to an app that has not been written yet.
 * That is the single worst thing this package could do.
 */
export const trousseauSchema = z.looseObject({
  kind: z.literal(TROUSSEAU_KIND).default(TROUSSEAU_KIND),
  version: z.number().default(TROUSSEAU_VERSION),
  event: eventSchema.default(() => eventSchema.parse({})),
  guests: guestsSchema,
  seating: seatingSchema,
  /** Null until Cadence has published a day. */
  day: daySchema.nullable().default(null),
  crew: crewSchema,
  stationery: stationerySchema,
  /** Native documents, keyed by app name. Present only in an exported file. */
  sources: z.record(z.string(), z.unknown()).default(() => ({})),
});

export type Trousseau = z.infer<typeof trousseauSchema>;

/** A new, empty wedding. A fresh object every call. */
export function emptyTrousseau(): Trousseau {
  return trousseauSchema.parse({});
}

/**
 * Validate an unknown document and bring it to the current version.
 *
 * There is only version 1, so this is validation plus defaults today. The seam
 * exists from the first release so that adding version 2 is a change to one
 * function rather than a coordinated release across four repositories.
 *
 * Throws rather than returning a result: a caller that cannot read the document
 * must not proceed to write over it. Callers that want to tolerate failure use
 * `trousseauSchema.safeParse` and leave the stored bytes alone.
 */
export function migrate(doc: unknown): Trousseau {
  return trousseauSchema.parse(doc);
}
```

- [ ] **Step 5: Run the envelope tests to verify they pass**

Run: `npx vitest run src/envelope.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Write the failing preservation test**

This is the test the spec says must never be deleted. Create
`src/preservation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SLICE_NAMES, mergeSlice, migrate, trousseauSchema } from "./envelope";

/** A document carrying data from an app that does not exist yet. */
const fromTheFuture = () => ({
  kind: "trousseau",
  version: 1,
  event: { coupleNames: "Charis & Jacob", hashtag: "#cj2026" },
  guests: { "g-1": { name: "Priya" } },
  florals: { arch: "peonies", budget: 1200 },
  stationery: { cardWidthMm: 90, secretPlaqueField: true },
});

describe("rule 1: an app rewrites only its own slice", () => {
  for (const slice of SLICE_NAMES) {
    it(`publishing ${slice} preserves the unknown florals slice`, () => {
      const merged = mergeSlice(fromTheFuture(), slice, {});
      expect(merged["florals"]).toEqual({ arch: "peonies", budget: 1200 });
    });

    it(`publishing ${slice} leaves every other known slice untouched`, () => {
      const before = fromTheFuture();
      const merged = mergeSlice(before, slice, {});
      for (const other of SLICE_NAMES) {
        if (other === slice) continue;
        expect(merged[other]).toEqual((before as Record<string, unknown>)[other]);
      }
    });
  }
});

describe("rule 2: unknown keys inside a known slice survive", () => {
  it("keeps an unknown key on the event through a parse", () => {
    const parsed = migrate(fromTheFuture());
    expect(parsed.event).toMatchObject({ hashtag: "#cj2026" });
  });

  it("keeps an unknown key on the stationery slice through a parse", () => {
    const parsed = migrate(fromTheFuture());
    expect(parsed.stationery).toMatchObject({ secretPlaqueField: true });
  });
});

describe("no schema in this package strips unknown keys", () => {
  it("round-trips a document with an unknown slice byte-for-byte", () => {
    const before = fromTheFuture();
    const after = trousseauSchema.parse(structuredClone(before)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(before)) {
      // Primitives compare whole; objects only need to be a superset, because
      // parsing fills defaults the input did not carry.
      if (value !== null && typeof value === "object") {
        expect(after[key]).toMatchObject(value);
      } else {
        expect(after[key]).toEqual(value);
      }
    }
  });
});

describe("mergeSlice does not mutate its input", () => {
  it("leaves the original document alone", () => {
    const before = fromTheFuture();
    const snapshot = structuredClone(before);
    mergeSlice(before, "crew", { jobs: [] });
    expect(before).toEqual(snapshot);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/preservation.test.ts`
Expected: FAIL — `mergeSlice` is not exported from `./envelope`.

- [ ] **Step 8: Add `mergeSlice` to `src/envelope.ts`**

Append to `src/envelope.ts`:

```ts
/**
 * Set one slice on a raw stored document, copying every other key untouched.
 *
 * Takes and returns *raw* data, not a parsed `Trousseau`, and that is the whole
 * point. Parsing produces only what the schemas describe; if a schema is ever
 * wrong — a plain `z.object()` slipped in, a slice not yet added here — writing
 * the parsed result back would delete real user data. Merging into the raw
 * object means a schema bug can at worst refuse a read. It can never destroy a
 * write.
 *
 * Shallow by design: slices are owned whole, so there is nothing to merge
 * within one.
 */
export function mergeSlice(
  raw: unknown,
  slice: SliceName,
  value: unknown,
): Record<string, unknown> {
  const base =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    ...base,
    kind: TROUSSEAU_KIND,
    version: typeof base["version"] === "number" ? base["version"] : TROUSSEAU_VERSION,
    [slice]: value,
  };
}
```

- [ ] **Step 9: Run the whole suite to verify it passes**

Run: `npx vitest run`
Expected: PASS. The preservation suite alone contributes 16 tests (two per
slice across six slices, plus four).

- [ ] **Step 10: Add a guard against `z.object`**

Create `src/no-strict-object.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A plain object schema strips unknown keys, which in this package means
 * silently deleting a slice belonging to an app nobody has written yet. There
 * is no legitimate use of it here. This test is a tripwire, not a style rule.
 */
describe("source hygiene", () => {
  /** Comments explain the ban and therefore name the thing being banned. */
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("never uses the stripping object schema", () => {
    const dir = new URL("./", import.meta.url);
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) =>
        /\bz\.object\s*\(/.test(withoutComments(readFileSync(new URL(name, dir), "utf8"))),
      );
    expect(offenders).toEqual([]);
  });

  it("catches a real offender", () => {
    expect(withoutComments("const a = z.object({});")).toMatch(/\bz\.object\s*\(/);
  });

  it("ignores one that is only mentioned in a comment", () => {
    expect(withoutComments("// never use z.object() here")).not.toMatch(/\bz\.object\s*\(/);
  });
});
```

- [ ] **Step 11: Run it to verify it passes**

Run: `npx vitest run src/no-strict-object.test.ts`
Expected: PASS, 3 tests.

If the first test fails, a stripping object schema has been written in `src/` —
replace it with `z.looseObject(` rather than weakening the test. The other two
tests exist because the tripwire has to ignore the comments that explain it,
and a comment-stripper that stripped too much would pass while checking nothing.

- [ ] **Step 12: Add to the public surface**

Append to `src/index.ts`:

```ts
export {
  SLICE_NAMES,
  TROUSSEAU_KIND,
  TROUSSEAU_VERSION,
  emptyTrousseau,
  mergeSlice,
  migrate,
  trousseauSchema,
  type SliceName,
  type Trousseau,
} from "./envelope";
export {
  crewSchema,
  guestsSchema,
  seatingSchema,
  stationerySchema,
  type Crew,
  type Guests,
  type Seating,
  type Stationery,
} from "./slices";
```

- [ ] **Step 13: Verify the build and commit**

Run: `npm run build`
Expected: exit 0.

```bash
git add src/
git commit -m "Add the envelope, migrate, and the preservation guarantee

mergeSlice works on raw stored data rather than a parsed document on
purpose: a wrong schema should at worst refuse a read, never destroy a
write. A tripwire test fails the build if anyone writes z.object, which
in zod 4 would silently strip a slice belonging to an app that does not
exist yet."
```

---

## Task 4: The `.trousseau.json` file format

**Files:**
- Create: `src/file.ts`
- Modify: `src/index.ts`
- Test: `src/file.test.ts`

**Interfaces:**
- Consumes: `trousseauSchema`, `migrate`, `emptyTrousseau` from Task 3.
- Produces: `TROUSSEAU_EXTENSION = ".trousseau.json"`, `serialise(doc): string`,
  `parse(text): Trousseau`, `suggestedFilename(doc): string`.

- [ ] **Step 1: Write the failing test**

Create `src/file.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyTrousseau } from "./envelope";
import { TROUSSEAU_EXTENSION, parse, serialise, suggestedFilename } from "./file";

describe("serialise", () => {
  it("ends with a newline, so the file is well-formed on disk", () => {
    expect(serialise(emptyTrousseau()).endsWith("\n")).toBe(true);
  });

  it("is indented, so a diff of two weddings is readable", () => {
    expect(serialise(emptyTrousseau())).toContain('\n  "kind"');
  });
});

describe("parse", () => {
  it("round-trips a document", () => {
    const doc = emptyTrousseau();
    doc.event.coupleNames = "Charis & Jacob";
    expect(parse(serialise(doc)).event.coupleNames).toBe("Charis & Jacob");
  });

  it("keeps a slice it does not know about", () => {
    const text = JSON.stringify({ kind: "trousseau", version: 1, florals: { arch: "peonies" } });
    expect(parse(text)).toMatchObject({ florals: { arch: "peonies" } });
  });

  it("explains itself when handed something that is not JSON", () => {
    expect(() => parse("not json at all")).toThrow(/not valid JSON/);
  });

  it("explains itself when handed a Cadence day", () => {
    const day = JSON.stringify({ kind: "cadence.day", version: 1 });
    expect(() => parse(day)).toThrow(/not a Trousseau file/);
  });
});

describe("suggestedFilename", () => {
  it("uses the couple's names", () => {
    const doc = emptyTrousseau();
    doc.event.coupleNames = "Charis & Jacob";
    expect(suggestedFilename(doc)).toBe(`charis-and-jacob${TROUSSEAU_EXTENSION}`);
  });

  it("falls back when there are no names yet", () => {
    expect(suggestedFilename(emptyTrousseau())).toBe(`wedding${TROUSSEAU_EXTENSION}`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/file.test.ts`
Expected: FAIL — `Failed to resolve import "./file"`.

- [ ] **Step 3: Write the implementation**

Create `src/file.ts`:

```ts
import { TROUSSEAU_KIND, migrate, type Trousseau } from "./envelope";

export const TROUSSEAU_EXTENSION = ".trousseau.json";

/** Indented and newline-terminated: these files end up in git and in email. */
export function serialise(doc: Trousseau): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Read a `.trousseau.json`.
 *
 * Throws with a sentence a person can act on rather than a validation dump.
 * This runs on whatever the user dropped on the window, which is often the
 * wrong file entirely — most usefully, one of the four apps' own save files.
 */
export function parse(text: string): Trousseau {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON. Is it a Trousseau file?");
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("That file is not a Trousseau file.");
  }

  const kind = (raw as Record<string, unknown>)["kind"];
  if (kind !== undefined && kind !== TROUSSEAU_KIND) {
    throw new Error(
      `That is not a Trousseau file — it says it is a "${String(kind)}".`,
    );
  }

  return migrate(raw);
}

/** `charis-and-jacob.trousseau.json`, or a sensible fallback. */
export function suggestedFilename(doc: Trousseau): string {
  const slug = doc.event.coupleNames
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "wedding"}${TROUSSEAU_EXTENSION}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, whole suite.

- [ ] **Step 5: Add to the public surface**

Append to `src/index.ts`:

```ts
export {
  TROUSSEAU_EXTENSION,
  parse,
  serialise,
  suggestedFilename,
} from "./file";
```

- [ ] **Step 6: Verify the build and commit**

Run: `npm run build`
Expected: exit 0.

```bash
git add src/
git commit -m "Add the .trousseau.json file format

parse throws a sentence rather than a validation dump: it runs on
whatever was dropped on the window, and the most likely wrong answer is
one of the four apps' own save files, which it now names."
```

---

## Task 5: Prove the emitted package works inside a consuming app

The apps compile with `exactOptionalPropertyTypes` and
`noUncheckedIndexedAccess`. Types that are fine in this repo can still fail to
compile inside Cadence. Finding that out in Phase 1a, mid-adoption, is exactly
what the spec's safety constraints exist to prevent.

**Files:**
- Create: `verify/tsconfig.json`
- Create: `verify/consumer.ts`
- Modify: `package.json` (add the `verify` script)

**Interfaces:**
- Consumes: the emitted `dist/` from Tasks 1–4.
- Produces: an `npm run verify` gate.

- [ ] **Step 1: Create the consumer's tsconfig**

Create `verify/tsconfig.json`. These flags are copied verbatim from
`cadence/tsconfig.json` — it is the strictest of the four consumers:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": false,
    "noEmit": true,
    "paths": { "@jfrusher/trousseau": ["../dist/index.d.ts"] }
  },
  "include": ["consumer.ts"]
}
```

`skipLibCheck` is deliberately `false` here — the point is to check this
package's emitted types, which `true` would skip.

- [ ] **Step 2: Write the consumer**

Create `verify/consumer.ts`. It exercises every published type the way an app
will, under the app's own compiler settings:

```ts
import {
  emptyTrousseau,
  isFromFuture,
  mergeSlice,
  migrate,
  parse,
  serialise,
  suggestedFilename,
  type Day,
  type Event,
  type SliceName,
  type Trousseau,
} from "@jfrusher/trousseau";

// A slice name is assignable from a literal.
const slice: SliceName = "day";

// The envelope's fields have the types an app expects.
const doc: Trousseau = emptyTrousseau();
const event: Event = doc.event;
const names: string = event.coupleNames;
const curfew: number | null = event.curfewMin;

// `day` is nullable, and narrowing works.
const day: Day | null = doc.day;
if (day !== null) {
  const future: boolean = isFromFuture(day);
  // noUncheckedIndexedAccess: indexing an array yields `| undefined`.
  const first = day.blocks[0];
  const label: string = first?.label ?? "";
  void future;
  void label;
}

// The file functions compose.
const text: string = serialise(doc);
const back: Trousseau = parse(text);
const name: string = suggestedFilename(back);

// mergeSlice takes raw data and a slice name.
const merged: Record<string, unknown> = mergeSlice(back, slice, {});
const remigrated: Trousseau = migrate(merged);

void names;
void curfew;
void name;
void remigrated;
```

- [ ] **Step 3: Add the verify script**

In `package.json`, add to `"scripts"`:

```json
"verify": "npm run build && tsc -p verify/tsconfig.json"
```

and change `prepublishOnly` to:

```json
"prepublishOnly": "npm run test && npm run verify"
```

- [ ] **Step 4: Run it**

Run: `npm run verify`
Expected: exit 0, no output.

If it fails on `exactOptionalPropertyTypes`, the fix is in `src/`, not here:
replace the offending `.optional()` with `.nullable().default(null)`, which
produces a required property of a nullable type. Do not relax `verify/`.

- [ ] **Step 5: Commit**

```bash
git add verify/ package.json
git commit -m "Verify the emitted types compile under the apps' compiler settings

Copied verbatim from cadence/tsconfig.json, the strictest of the four
consumers, with skipLibCheck off. Types that pass in this repo can still
fail inside Cadence, and finding that out mid-adoption is the thing the
phased rollout exists to avoid."
```

---

## Task 6: README, and publish

**Files:**
- Modify: `README.md`
- Test: none — this task's gate is a successful dry-run publish.

**Interfaces:**
- Consumes: everything.
- Produces: `@jfrusher/trousseau@0.1.0` on npm.

- [ ] **Step 1: Add usage to `README.md`**

Append to the existing `README.md`, above the final "Nothing is built yet" line
(which should be deleted):

````markdown
## Install

```sh
npm install @jfrusher/trousseau
```

## Use

```ts
import { emptyTrousseau, mergeSlice, migrate, parse, serialise } from "@jfrusher/trousseau";

// Read a stored document. Never throws away what it does not understand.
const doc = migrate(rawFromStorage);

// Publish your slice. Every other key is copied untouched, including
// slices belonging to apps that do not exist yet.
const next = mergeSlice(rawFromStorage, "day", myResolvedDay);

// The portable file.
const text = serialise(doc);
const back = parse(text);
```

## The rules

1. An app rewrites **only its own slice** and copies every other key
   byte-for-byte, including keys it has never heard of.
2. Unknown keys **inside** a slice an app owns are preserved too.

`mergeSlice` enforces both. It takes raw stored data rather than a parsed
document on purpose: a wrong schema should at worst refuse a read, never destroy
a write.

| Slice | Owner |
| --- | --- |
| `event` | the launcher |
| `guests`, `seating` | Tableaux |
| `day` | Cadence |
| `crew` | Brigade |
| `stationery` | Plaque |

## Design

[The full design](docs/superpowers/specs/2026-08-20-trousseau-design.md), including
why there is no shared UI kit and no monorepo.
````

- [ ] **Step 2: Run the whole gate**

Run: `npm run test && npm run verify`
Expected: all tests pass, exit 0.

- [ ] **Step 3: Check the package contents before publishing**

Run: `npm pack --dry-run`
Expected: the listing contains `dist/` and `README.md` and **nothing else** —
no `src/`, no `fixtures/`, no `verify/`, no test files.

If `dist/` is absent, run `npm run build` first and re-check.

- [ ] **Step 4: Confirm the name is available**

Run: `npm view @jfrusher/trousseau`
Expected: `404 Not Found`, which means the name is free.

If it returns a package, stop and raise it — the spec lists the npm name as an
open risk and the fallback needs a decision, not a guess.

- [ ] **Step 5: Commit before publishing**

```bash
git add README.md
git commit -m "Document the package and its two rules"
```

- [ ] **Step 6: Publish**

Requires `npm login` as a user who owns the `@jfrusher` scope. Scoped packages
are private by default, so public access must be explicit:

```bash
npm publish --access public
```

Expected: `+ @jfrusher/trousseau@0.1.0`.

- [ ] **Step 7: Tag the release**

```bash
git tag -a v0.1.0 -m "Trousseau 0.1.0 — the contract, no adopters yet"
```

- [ ] **Step 8: Confirm a real install works**

From a scratch directory outside this repo:

```bash
mkdir -p /tmp/trousseau-check && cd /tmp/trousseau-check
npm init -y && npm install @jfrusher/trousseau
node --input-type=module -e "import {emptyTrousseau} from '@jfrusher/trousseau'; console.log(emptyTrousseau().kind)"
```

Expected: prints `trousseau`.

---

## Phase 0 done when

- [ ] `npm test` passes.
- [ ] `npm run verify` passes — the emitted types compile under Cadence's
      compiler settings.
- [ ] `@jfrusher/trousseau@0.1.0` installs from npm in a clean directory and
      imports.
- [ ] `git -C /c/Projects/Plaque status`, and the same for Tableaux, cadence and
      Brigade, all report **no changes**. Phase 0 touched no application, and
      this is how that is proved rather than assumed.

Phase 1a begins only after all four are true.
