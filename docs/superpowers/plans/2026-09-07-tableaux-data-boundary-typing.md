# Tableaux Data-Boundary Typing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Tableaux's two data-boundary files to TypeScript and give
`planDocSchema` real field-shape validation, so a shape or field-name mistake
at the boundary fails loudly instead of coercing to a default — without
changing any behaviour and without a flag day across the app's other 108 JS
files.

**Architecture:** `planSchema.ts` becomes the single definition of what a valid
Tableaux plan looks like: zod schemas with real field shapes, plus the
TypeScript types inferred from them. `sliceBridge.ts` — the file that actually
reads and writes the shared wedding — then consumes those types alongside the
contract package's own `Event` type. Nothing else in Tableaux is touched, and
no runtime validation is added to the load path.

**Tech Stack:** TypeScript (already configured in `suite/tsconfig.json` with
`allowJs` and `strict`), zod 4, Vitest, `@jfrusher/trousseau`.

**Spec:** [docs/superpowers/specs/2026-09-02-tableaux-migration-design.md](../specs/2026-09-02-tableaux-migration-design.md)

## Status

**Complete — all 4 tasks, 2026-09-07.** This is pass one of subsystem D; the
other 108 JS files, including `store/useStore.js`, remain for later passes as
the spec intends.

Verified on the finished branch:

| Check | Result |
|---|---|
| `vitest run` (all five projects) | 163 files / 1,588 tests pass |
| `vitest run --project tableaux` | 176 tests (162 before this plan, plus 14) |
| `npm test` (contract package) | 7 files / 98 tests pass |
| `tsc --noEmit` (with `tsbuildinfo` cleared) | clean |
| `next build` | clean |
| `git diff main -- suite/tsconfig.json` | empty — `checkJs` deliberately not enabled |

**Three things this plan got wrong, found by executing it:**

1. **Baseline test count.** The spec and the audit both say 159 Tableaux tests.
   `main` actually has 162.

2. **`assignedGuestIds` is `(string|null)[]`, not `string[]`.** The first
   hardened schema said `z.array(z.string())` and `persistRoundtrip.test.js`
   failed immediately: the array is seat-indexed and `null` is an empty seat,
   exactly as `normaliseSeats`' own JSDoc says. The schema was wrong about
   reality, not the store, so the schema changed. That fact now has its own
   tests. This is the round-trip gate doing precisely the job it was kept for.

3. **A `.js` specifier does not resolve to a `.ts` file under Turbopack**, only
   under Vitest — see the corrected Verified item 1. All 1,588 tests passed
   while `next build` was broken. **A test-only probe cannot establish a
   build-time fact.**

**And one about the codebase, not this plan:** typing a file does *not* catch a
renamed field on a loose slice. `eventSchema` is a `looseObject`, so its
inferred type carries a catch-all index signature and `doc.event.anything` is
`unknown` — which flows through `a || b || c` without complaint. Proved by
renaming `coupleNames` in the contract, rebuilding, clearing
`tsconfig.tsbuildinfo`, and watching `tsc` stay silent. `sliceBridge.ts` now
asserts against `eventSchema.shape`, which has no index signature. **Every app
reading a loose slice has this same blind spot; only the three fields
`sliceBridge` reads are guarded.**

## Global Constraints

- **No behaviour changes.** This is a typing and validation hardening pass.
  Nothing renders differently, nothing saves differently, no dead code is
  removed. Where existing code does something odd, it gets typed, not fixed.
- **The existing 162 Tableaux tests stay green at every step**, not just at
  the end. This is a regression gate per task, not a final check. (The spec and
  the audit both say 159 — that figure is stale; three tests were added between
  the audit and now. Verified on `main` before this plan ran.)
- **No restructuring.** Tableaux is not being moved toward the other three
  apps' core/render/state/ui layout. Out of scope, per the spec.
- **Unknown keys must still survive.** Objects stay loose, never `.strict()`.
  A future Tableaux build adding a field must not have that field destroyed by
  an older build round-tripping the document — the same rule the envelope
  follows one level up.
- **Only the two boundary files convert.** `store/planSchema.js` and
  `store/sliceBridge.js`. The other 108 `.js`/`.jsx` files stay exactly as they
  are, converted in later passes as time allows.
- **`store/useStore.js` is deferred, deliberately.** The spec names its
  guest/table/room normalization as part of the data boundary, and it is — but
  it is 531 lines and converting it alongside these two would make one branch
  that is hard to review and hard to revert in halves. It is the obvious next
  pass, not part of this one.

## Verified before writing this plan

These were checked by probe in a scratch worktree, not assumed. Do not
re-litigate them mid-execution.

1. **Import specifiers must be made extensionless. Vitest and Turbopack
   disagree.** ⚠️ *This item was wrong when first written and is corrected
   here — see Task 4 Step 6.*

   Tableaux imports with explicit extensions everywhere
   (`from './planSchema.js'`), never extensionless. Vitest resolves `./x.js` to
   `x.ts` transparently, so the whole test suite passes after a rename with no
   importer change — which is what the original probe checked, and why this
   was recorded as "no importer needs editing".

   **`next build` does not.** Turbopack fails with `Module not found: Can't
   resolve '../store/sliceBridge.js'`. A probe that only runs the tests cannot
   see this; only the build step catches it.

   So every specifier pointing at a converted file becomes extensionless. For
   `sliceBridge` that is two production importers —
   `apps/tableaux/hooks/useAutoSave.js` and
   `components/shell/WeddingPack.tsx`'s dynamic `import()`. For consistency the
   test and type-only specifiers are changed too, so the rule is uniform:
   **a converted file is imported without an extension.**

2. **`tsc` picks the file up automatically once renamed.** `suite/tsconfig.json`
   already sets `allowJs: true` and `strict: true`, and its `include` covers
   `**/*.ts`. A renamed file is checked immediately; the remaining `.js` files
   are not checked at all, because `checkJs` is off and `include` does not list
   `**/*.js`.

3. **zod here is 4.5.4, and `z.ZodTypeAny` does not exist in it.** Both
   `(schema: z.ZodType)` and `<T extends z.ZodType>(schema: T)` compile;
   `.passthrough()` still works despite `z.looseObject` being the zod-4 idiom
   the contract package uses. Task 2 uses the generic form.

4. **Renaming `planSchema.js` alone produces exactly five `tsc` errors**, all
   in that file: implicit `any` on `entityMap`'s `max` and `label` parameters
   and on `validatePlanDoc`'s `doc`, and `Property 'status' does not exist on
   type 'Error'` twice. Task 1 fixes precisely these.

## Two corrections to the spec

Both were checked against the codebase before this plan was written.

1. **The spec says to enable `checkJs`. Do not.** `allowJs` is already on.
   Turning on `checkJs` would type-check all 110 existing JS files
   (15,711 lines) at once — the flag day the same spec explicitly rules out in
   the sentence before. Converting a file to `.ts` already opts it into
   checking, because `include` covers `**/*.ts` and `strict` is on. That is
   inherently incremental and needs no config change at all. **This plan
   changes no tsconfig.**

2. **`planDocSchema` has no production callers.** It is imported only by
   `store/persistRoundtrip.test.js` and `store/roomSpaces.test.js`. Hardening
   it therefore does not add a runtime guard — it strengthens the round-trip
   tests, which serialize the live store and validate the result, so a shape
   regression in the store does get caught. That is real but narrower than the
   spec implies, and this plan says so rather than overselling it.

   The compile-time protection lives in Task 3 instead. `sliceBridge` reads
   `doc.event.coupleNames`, `doc.event.venueName` and `doc.event.date` — and
   `Event` is a genuinely typed shape in the contract package. Typing that file
   is what makes a renamed contract field a build failure in Tableaux, which is
   the bug class the audit actually named.

   Note that the contract's `Guests` and `Seating` are `z.record(z.string(),
   z.unknown())` — deliberately opaque, because Tableaux owns those shapes.
   There is nothing to import from the contract for them; that is exactly why
   Task 2 defines them in `planSchema.ts` instead.

## File Structure

| File | Responsibility |
|---|---|
| `suite/apps/tableaux/store/planSchema.js` → `.ts` | **Rename + type, then harden.** The one definition of a valid Tableaux plan: zod schemas with real field shapes, and the types inferred from them. |
| `suite/apps/tableaux/store/planSchema.test.ts` | **Create.** The rejection tests — the concrete regression test for the bug class this migration exists to prevent. |
| `suite/apps/tableaux/store/sliceBridge.js` → `.ts` | **Rename + type.** The real boundary: typed against the contract's `Event` and against Task 2's plan types. |

No tsconfig change. Importers of the two converted files become extensionless — two production files (`apps/tableaux/hooks/useAutoSave.js`, `components/shell/WeddingPack.tsx`) plus the test and type-only specifiers (see Verified, 1).

---

## Task 1: Convert `planSchema` to TypeScript, behaviour identical

**Files:**
- Rename: `suite/apps/tableaux/store/planSchema.js` → `suite/apps/tableaux/store/planSchema.ts`

**Interfaces:**
- Consumes: `zod` (already a dependency).
- Produces: the same public surface it has today — `LIMITS`, `planDocSchema`,
  `MAX_DOC_BYTES`, `validatePlanDoc` — now typed. Task 2 hardens it; Task 3
  consumes the types Task 2 adds.

This task changes no schema and no behaviour. It is the mechanical half, kept
separate so that if Task 2's stricter shapes turn out to be wrong, this
conversion does not have to be unpicked with them.

- [x] **Step 1: Rename the file, preserving history**

```bash
git mv suite/apps/tableaux/store/planSchema.js suite/apps/tableaux/store/planSchema.ts
```

Change every specifier that points at this file to extensionless —
`'./planSchema'` — in `persistRoundtrip.test.js` and `roomSpaces.test.js`.
Vitest would resolve `'./planSchema.js'` to the `.ts` file, but Turbopack will
not, and consistency is cheaper than remembering which resolver sees which file
(see Verified, 1).

- [x] **Step 2: Confirm the five expected type errors, and only those**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: five errors, all in `apps/tableaux/store/planSchema.ts` — implicit
`any` at lines 25 (twice) and 50, and `Property 'status' does not exist on
type 'Error'` twice.

If `Cannot find name 'LayoutProps'` also appears in `app/layout.tsx`, ignore
it: it is generated by Next into the gitignored `.next/types`, so it shows in
any checkout that has never been built. Run `npx next build` once and it goes.

- [x] **Step 3: Type the parameters and the tagged error**

The `status` property is left in place, not removed. Nothing reads it — it is
vestigial from the Express server Tableaux used to have, and `utils/csv.js`
carries the same pattern — but removing it would be a behaviour change, and
this pass makes none.

In `suite/apps/tableaux/store/planSchema.ts`, replace the `entityMap` helper:

```ts
const entityMap = (max: number, label: string) =>
  z
    .record(z.string(), z.object({}).passthrough())
    .refine((m) => Object.keys(m).length <= max, { message: `Too many ${label} (max ${max})` })
```

Add this above `validatePlanDoc`:

```ts
/**
 * An error carrying the HTTP status the old Express server would have sent.
 *
 * Nothing reads `status` any more — there is no server — but it is part of
 * what this function throws today, and this pass changes no behaviour. Typed
 * rather than dropped.
 */
class PlanDocError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'PlanDocError'
    this.status = status
  }
}
```

Then replace `validatePlanDoc` entirely:

```ts
/** Validate an incoming plan document. Throws a 400-tagged error on failure. */
export function validatePlanDoc(doc: unknown) {
  const parsed = planDocSchema.safeParse(doc)
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message || 'Invalid plan document'
    throw new PlanDocError(msg)
  }
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data))
  if (bytes > MAX_DOC_BYTES) {
    throw new PlanDocError('Plan document is too large')
  }
  return parsed.data
}
```

- [x] **Step 4: Type-check**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (ignoring `LayoutProps`, per Step 2).

- [x] **Step 5: Run every Tableaux test**

Run from `suite/`: `npx vitest run --project tableaux`
Expected: PASS, 24 files / 162 tests. The conversion changed no behaviour, so
the count and the results are identical to `main`.

- [x] **Step 6: Commit**

```bash
git add suite/apps/tableaux/store/planSchema.ts
git commit -m "Convert Tableaux's plan schema to TypeScript, behaviour unchanged"
```

---

## Task 2: Give `planDocSchema` real field shapes

**Files:**
- Modify: `suite/apps/tableaux/store/planSchema.ts`
- Create: `suite/apps/tableaux/store/planSchema.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `guestSchema`, `tableSchema`, `roomSchema`, and the inferred types
  `Guest`, `TableEntity`, `Room`, `PlanDoc` — all exported, and all consumed by
  Task 3. `TableEntity` rather than `Table` because `Table` collides with the
  DOM's own `HTMLTableElement`-adjacent naming in reader comprehension, and
  because Tableaux's UI already has a `TableNode` component.

**How strict, and why.** Every object stays **loose** — `.passthrough()`, never
`.strict()` — so a field a future Tableaux build adds survives an older build
round-tripping the document. Within that, identity and structural fields that
the store's own factories always write are **required**, because a required
field is the only thing that actually catches the bug this migration exists to
prevent: a renamed field silently becoming a passthrough key while the real one
defaults. Everything else is optional but typed.

The shapes below are taken from the store's own factories — `addGuest` and
`addTable` in `store/actions.js`, and the initial `room` in `store/useStore.js`
— so a document the live store produces validates by construction. That is what
`persistRoundtrip.test.js` and `roomSpaces.test.js` already assert, and those
two tests are the reason this schema is worth hardening at all.

- [x] **Step 1: Write the failing tests**

Create `suite/apps/tableaux/store/planSchema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { guestSchema, planDocSchema, tableSchema, validatePlanDoc } from './planSchema.js'

/**
 * The concrete regression test for the bug class the whole Tableaux typing
 * migration exists to prevent: a field of the wrong shape, or a renamed field,
 * used to be swallowed by `.passthrough()` and coerced to a default. It now
 * fails loudly.
 */

const guest = {
  id: 'g1',
  firstName: 'Charis',
  lastName: 'Frusher',
  fullName: 'Charis Frusher',
  email: '',
  dietary: '',
  dietaryRaw: '',
  side: null,
  rsvpStatus: 'confirmed',
  plusOneOf: null,
  groupId: null,
  familyId: null,
  assignedTableId: null,
  assignedSeatId: null,
  notes: '',
  tags: [],
}

const table = {
  id: 'tbl1',
  label: 'Table 1',
  designation: null,
  type: 'round',
  capacity: 8,
  x: 100,
  y: 200,
  rotation: 0,
  assignedGuestIds: [],
  seatMode: 'table',
  colour: null,
  perSideSeats: null,
  sizeUnits: { width: 10, height: 10 },
}

describe('guestSchema', () => {
  it('accepts a guest exactly as the store builds one', () => {
    expect(guestSchema.safeParse(guest).success).toBe(true)
  })

  it('keeps a field it has never heard of', () => {
    // Rule 2 of the envelope, one level down: an older build must not destroy
    // a field a newer one added.
    const parsed = guestSchema.parse({ ...guest, favouriteColour: 'sage' })
    expect(parsed).toMatchObject({ favouriteColour: 'sage' })
  })

  it('rejects a guest with no id rather than defaulting one', () => {
    const { id: _dropped, ...noId } = guest
    expect(guestSchema.safeParse(noId).success).toBe(false)
  })

  it('rejects a renamed field instead of silently coercing it', () => {
    // `firstname` is not `firstName`. This is exactly the failure the audit
    // found: the old schema took it as a passthrough key and defaulted the
    // real one.
    const { firstName: _dropped, ...renamed } = guest
    expect(guestSchema.safeParse({ ...renamed, firstname: 'Charis' }).success).toBe(false)
  })

  it('rejects a field of the wrong type', () => {
    expect(guestSchema.safeParse({ ...guest, tags: 'not an array' }).success).toBe(false)
  })
})

describe('tableSchema', () => {
  it('accepts a table exactly as the store builds one', () => {
    expect(tableSchema.safeParse(table).success).toBe(true)
  })

  it('rejects a table whose position is not a number', () => {
    expect(tableSchema.safeParse({ ...table, x: '100' }).success).toBe(false)
  })

  it('rejects a table with no capacity rather than defaulting one', () => {
    const { capacity: _dropped, ...noCapacity } = table
    expect(tableSchema.safeParse(noCapacity).success).toBe(false)
  })
})

describe('planDocSchema', () => {
  it('accepts a whole document built from the store shapes', () => {
    const doc = { guests: { g1: guest }, tables: { tbl1: table } }
    expect(planDocSchema.safeParse(doc).success).toBe(true)
  })

  it('rejects a document whose guest is malformed, naming the guest map', () => {
    const doc = { guests: { g1: { ...guest, tags: 'not an array' } } }
    expect(planDocSchema.safeParse(doc).success).toBe(false)
  })

  it('still carries a slice belonging to nothing it knows about', () => {
    const doc = { guests: {}, somethingNobodyHasWrittenYet: { a: 1 } }
    expect(planDocSchema.parse(doc)).toMatchObject({ somethingNobodyHasWrittenYet: { a: 1 } })
  })

  it('validatePlanDoc throws a 400-tagged error on a malformed guest', () => {
    // The tagged error is vestigial but is still what this throws.
    expect(() => validatePlanDoc({ guests: { g1: { ...guest, tags: 5 } } })).toThrow()
    try {
      validatePlanDoc({ guests: { g1: { ...guest, tags: 5 } } })
    } catch (error) {
      expect((error as { status?: number }).status).toBe(400)
    }
  })
})
```

- [x] **Step 2: Run to verify they fail**

Run from `suite/`: `npx vitest run --project tableaux apps/tableaux/store/planSchema.test.ts`
Expected: FAIL — `guestSchema` and `tableSchema` are not exported yet, so the
import throws before any test runs.

- [x] **Step 3: Add the real shapes**

In `suite/apps/tableaux/store/planSchema.ts`, add above `entityMap`:

```ts
/**
 * The real shapes, taken from the store's own factories (`addGuest` and
 * `addTable` in `actions.js`, and the initial `room` in `useStore.js`) so that
 * a document the live store produces validates by construction.
 *
 * Every object is loose, never strict: a field a later Tableaux build adds has
 * to survive an older build round-tripping the document, which is the
 * envelope's rule-2 one level down.
 *
 * Identity and structural fields are required on purpose. An optional field
 * catches nothing — the bug this schema exists to prevent is a *renamed* field
 * being swallowed as a passthrough key while the real one quietly defaults,
 * and only a required field turns that into a failure.
 */
export const guestSchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    fullName: z.string(),
    email: z.string().optional(),
    dietary: z.string().optional(),
    dietaryRaw: z.string().optional(),
    side: z.string().nullable().optional(),
    rsvpStatus: z.string().optional(),
    plusOneOf: z.string().nullable().optional(),
    groupId: z.string().nullable().optional(),
    familyId: z.string().nullable().optional(),
    assignedTableId: z.string().nullable().optional(),
    assignedSeatId: z.string().nullable().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough()

export const tableSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    type: z.string(),
    capacity: z.number(),
    x: z.number(),
    y: z.number(),
    rotation: z.number().optional(),
    designation: z.string().nullable().optional(),
    assignedGuestIds: z.array(z.string()).optional(),
    seatMode: z.string().optional(),
    colour: z.string().nullable().optional(),
    perSideSeats: z.unknown().optional(),
    sizeUnits: z.unknown().optional(),
  })
  .passthrough()

export const roomSchema = z
  .object({
    widthUnits: z.number().optional(),
    heightUnits: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    backgroundColour: z.string().optional(),
  })
  .passthrough()

export type Guest = z.infer<typeof guestSchema>
export type TableEntity = z.infer<typeof tableSchema>
export type Room = z.infer<typeof roomSchema>
```

Then change `entityMap` to take the per-entity schema, and point the document's
`guests`, `tables` and `room` at the real shapes. Replace the existing
`entityMap` and `planDocSchema` with:

```ts
// Generic rather than a bare `z.ZodType` parameter so the element type survives
// into `PlanDoc`. Note `z.ZodTypeAny` does NOT exist in zod 4 — it was removed,
// and using it is a compile error.
const entityMap = <T extends z.ZodType>(schema: T, max: number, label: string) =>
  z
    .record(z.string(), schema)
    .refine((m) => Object.keys(m).length <= max, { message: `Too many ${label} (max ${max})` })

/** Still loose for the collections nothing has typed yet. */
const looseMap = (max: number, label: string) => entityMap(z.object({}).passthrough(), max, label)

export const planDocSchema = z
  .object({
    meta: z.object({}).passthrough().optional(),
    guests: entityMap(guestSchema, LIMITS.guests, 'guests').optional(),
    groups: looseMap(LIMITS.groups, 'groups').optional(),
    tables: entityMap(tableSchema, LIMITS.tables, 'tables').optional(),
    zones: looseMap(LIMITS.zones, 'zones').optional(),
    room: roomSchema.optional(),
    canvas: z.object({}).passthrough().optional(),
    constraints: z.array(z.object({}).passthrough()).max(LIMITS.constraints).optional(),
    settings: z.object({}).passthrough().optional(),
    snapshots: z.array(z.object({}).passthrough()).max(LIMITS.snapshots).optional(),
  })
  .passthrough()

export type PlanDoc = z.infer<typeof planDocSchema>
```

- [x] **Step 4: Run the new tests**

Run from `suite/`: `npx vitest run --project tableaux apps/tableaux/store/planSchema.test.ts`
Expected: PASS, 12 tests.

- [x] **Step 5: Run every Tableaux test — the real gate**

Run from `suite/`: `npx vitest run --project tableaux`
Expected: PASS, 174 tests (the existing 162 plus this file's 12).

This is the step that matters. `persistRoundtrip.test.js` and
`roomSpaces.test.js` serialize the live store and push the result through
`validatePlanDoc`, so if the shapes above disagree with what the store actually
writes, they fail here. **If they do, the schema is wrong, not the store** —
fix the schema to match reality and do not change the store to suit the schema.
This pass changes no behaviour.

- [x] **Step 6: Type-check**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [x] **Step 7: Commit**

```bash
git add suite/apps/tableaux/store/planSchema.ts suite/apps/tableaux/store/planSchema.test.ts
git commit -m "Give Tableaux's plan schema real field shapes"
```

---

## Task 3: Convert `sliceBridge` to TypeScript

**Files:**
- Rename: `suite/apps/tableaux/store/sliceBridge.js` → `suite/apps/tableaux/store/sliceBridge.ts`

**Interfaces:**
- Consumes: `Guest`, `TableEntity` from `./planSchema.js` (Task 2); `mayWrite`,
  `noteRead` from `@/lib/store/toolGeneration`; `useTrousseauStore` from
  `@/lib/store/useTrousseauStore`.
- Produces: the same three exports it has today — `readDoc`, `isEmpty`,
  `writeDoc` — now typed.

This is the file the whole subsystem is really about. It reads
`doc.event.coupleNames`, `doc.event.venueName` and `doc.event.date` from the
contract package, and `Event` is a genuinely typed shape there — so once this
file is TypeScript, renaming one of those fields in the contract becomes a
build failure in Tableaux instead of a silent empty string.

`isEmpty` is exported but imported by nothing (`hooks/useAutoSave.js` takes only
`readDoc` and `writeDoc`). Leave it exactly where it is: removing it is a change
this pass does not make.

- [x] **Step 1: Rename the file, preserving history**

```bash
git mv suite/apps/tableaux/store/sliceBridge.js suite/apps/tableaux/store/sliceBridge.ts
```

Then make its importers extensionless — `hooks/useAutoSave.js` and the dynamic
`import()` in `components/shell/WeddingPack.tsx`. **Both are production code, so
`next build` fails without this even though every test passes** (see
Verified, 1).

- [x] **Step 2: See what the type-checker says**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: errors in `apps/tableaux/store/sliceBridge.ts` only — implicit `any`
on `isRecord`'s parameter and on `writeDoc`'s `doc`, and index-access errors on
`seating.meta`, `meta.weddingName`, `meta.venue` and `meta.date`, which come
off `Record<string, unknown>` values.

Read the real list before writing Step 3. If an error appears that Step 3 does
not address, stop and report it rather than widening a type to make it go away.

- [x] **Step 3: Type the file**

Replace the whole body below the file's existing doc comment — the comment
block at the top stays exactly as it is, and so does `SEATING_KEYS` and
`UNNAMED`. Add the imports at the top:

```ts
import { mayWrite, noteRead } from '@/lib/store/toolGeneration'
import { useTrousseauStore } from '@/lib/store/useTrousseauStore'
import type { Guest, TableEntity } from './planSchema.js'
```

Add below `UNNAMED`:

```ts
/**
 * The plan as Tableaux's own store holds it.
 *
 * Deliberately not `PlanDoc` from `planSchema.ts`: that is the validated
 * *saved* shape, and this is the live in-memory one, which carries whatever
 * the store happens to hold. The two agree on the parts named here and this
 * type stays open about the rest — the seating half is read and written raw
 * on purpose, as the comment above explains.
 */
export interface TableauxDoc extends Record<string, unknown> {
  guests: Record<string, Guest>
  tables?: Record<string, TableEntity>
  meta?: Record<string, unknown>
}
```

Replace `isRecord`:

```ts
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
```

Replace `readDoc`:

```ts
/** The plan as Tableaux's store wants it, assembled from the shared wedding. */
export function readDoc(): TableauxDoc {
  noteRead('tableaux')
  const { raw, doc } = useTrousseauStore.getState()
  const seating = isRecord(raw.seating) ? raw.seating : {}
  const guests = isRecord(raw.guests) ? (raw.guests as Record<string, Guest>) : {}
  const meta = isRecord(seating.meta) ? seating.meta : {}

  return {
    ...seating,
    guests,
    meta: {
      ...meta,
      // `doc.event` is the contract package's `Event`, so these three field
      // names are checked at build time. That is the whole point of this file
      // being TypeScript: rename one in the contract and Tableaux stops
      // compiling instead of quietly showing an empty venue.
      weddingName: doc.event.coupleNames || meta.weddingName || UNNAMED,
      venue: doc.event.venueName || meta.venue || '',
      date: doc.event.date || meta.date || '',
    },
  }
}
```

Replace `isEmpty`:

```ts
/** True when this wedding has nothing in it yet, so a fresh plan is not overwritten. */
export function isEmpty(): boolean {
  const doc = readDoc()
  return Object.keys(doc.guests).length === 0 && Object.keys(doc.tables ?? {}).length === 0
}
```

Replace `writeDoc`'s signature and its two untyped locals, leaving every
comment and every line of logic in it unchanged:

```ts
export function writeDoc(doc: TableauxDoc): void {
```

and inside it:

```ts
  const seating: Record<string, unknown> = {}
```

and:

```ts
  const meta = isRecord(doc.meta) ? doc.meta : {}
  const named = typeof meta.weddingName === 'string' && meta.weddingName !== UNNAMED
```

`named` gains the `typeof` check because `meta` is a `Record<string, unknown>`
and the value has to be narrowed to a string before it can be assigned to
`coupleNames`. That is the same condition the JavaScript already had —
a non-empty string was truthy there too — made explicit.

- [x] **Step 4: Type-check**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [x] **Step 5: Run every Tableaux test**

Run from `suite/`: `npx vitest run --project tableaux`
Expected: PASS, 174 tests. No behaviour changed, so nothing should move.

- [x] **Step 6: Run the suite project too**

Run from `suite/`: `npx vitest run --project suite`
Expected: PASS. `sliceBridge` touches `useTrousseauStore` and `toolGeneration`,
both of which the suite project covers, so a mistake in the shared-store types
shows up here rather than in Tableaux's own tests.

- [x] **Step 7: Commit**

```bash
git add suite/apps/tableaux/store/sliceBridge.ts
git commit -m "Convert Tableaux's slice bridge to TypeScript"
```

---

## Task 4: Full regression check

**Files:** none created or modified — verification only.

**Interfaces:** none.

- [x] **Step 1: Confirm only the two intended files changed**

Run: `git diff --stat main -- suite/apps/tableaux/`
Expected: exactly three entries — `planSchema.js` → `planSchema.ts`,
`sliceBridge.js` → `sliceBridge.ts`, and the new `planSchema.test.ts`. No other
Tableaux file appears, and in particular no `.jsx` component does.

- [x] **Step 2: Confirm no tsconfig was touched**

Run: `git diff main -- suite/tsconfig.json`
Expected: empty. `checkJs` was deliberately not enabled — see "Two corrections
to the spec".

- [x] **Step 3: Run every project**

Run from `suite/`: `npx vitest run`
Expected: PASS across `suite`, `plaque`, `brigade`, `tableaux` and `cadence`.
Tableaux is 174 (162 + 12); the total is 1,586 (1,574 + 12).

- [x] **Step 4: Run the contract package's tests**

Run from the repo root: `npm test`
Expected: PASS, 98 tests. Unaffected, but it confirms the workspace is healthy.

- [x] **Step 5: Type-check**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. If `LayoutProps` appears, run `npx next build` once first.

- [x] **Step 6: Build**

Run from `suite/`: `npx next build`
Expected: builds clean.

- [x] **Step 7: Nothing to commit**

A gate, not a change. If everything passed, the branch is ready for review. If
anything failed, fix it, re-run that check, then re-run Steps 1-6 in full.
