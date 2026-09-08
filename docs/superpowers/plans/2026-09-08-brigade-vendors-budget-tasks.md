# Vendors, Budget, Tasks and Confirmations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a couple record what each supplier costs, what they have paid,
when the balance falls due and whether that supplier has confirmed; see it
against a budget; and keep a checklist of tasks that are not tied to the day.

**Architecture:** No new entities and no new slice. `Team` gains six optional
contract fields, `Crew` gains a budget, and `Job.blockId` becomes nullable so a
job can exist without a block. Everything else — undo, sync, export,
cross-slice validation, the per-team call sheet — already works and is
inherited.

**Tech Stack:** TypeScript, Next.js (suite), Zustand, existing `components/ui/fields`
primitives. **No new dependencies.**

**Spec:** [docs/superpowers/specs/2026-09-08-brigade-vendors-budget-tasks-design.md](../specs/2026-09-08-brigade-vendors-budget-tasks-design.md)

## Global Constraints

- **No new dependencies, no new slice, no new entity.**
- **Every contract field is optional.** An empty one renders nothing. A wedding
  that never opens Delegation must look exactly as it does today.
- **Amounts are plain numbers, with no currency field.** One wedding, one
  currency; a symbol is a formatting problem, not a data one.
- **No emailing, no reminders, no payment integration.** Ever, per subsystem F.
- **Brigade's existing 41 tests and the suite's readiness tests stay green.**

## Verified before writing this plan

Checked in the repo, not assumed.

- `Team` is `{ id, tag, name, phone, notes }` in **two** places:
  `suite/lib/model/types.ts` (the suite's) and
  `suite/apps/brigade/core/model/types.ts` (Brigade's own). Both need the
  fields. `Job` likewise differs between them — Brigade's has no `status`.
- `apps/brigade/state/sliceBridge.ts` passes crew through wholesale
  (`teams: crew.teams`, `jobs: crew.jobs`) with no per-field mapping, so **it
  needs no change at all** once `readCrew` stops stripping.
- `readCrew` in `suite/lib/model/slices.ts` rebuilds teams, people and jobs
  from fixed field lists. This is the same shape as the `coerceGuests` bug
  fixed on 2026-09-08. It is why Task 1 exists.
- `Board.tsx:43` already computes `orphans` as
  `doc.jobs.filter((job) => !blocks.some((block) => block.id === job.blockId))`.
  A job with `blockId: null` satisfies that predicate **already**, so it
  renders in the existing "Work that has lost its place" section with no change
  — Task 4 only has to tell the two cases apart and add a way to create one.
- `apps/brigade/state/store.ts:112` seeds a new team as
  `{ id, tag: null, name: "New team", phone: "", notes: "", ...seed }`.
- `readiness()` in `suite/lib/model/readiness.ts` returns
  `{ id, severity, message, href, action }` rows and is what `WhatIsLeft`
  renders.

## File Structure

| File | Responsibility |
|---|---|
| `suite/lib/model/slices.ts` | **Modify.** `readCrew` preserves unknown keys, and reads the new fields. |
| `suite/lib/model/types.ts` | **Modify.** The suite's `Team`, `Crew` and `Job`. |
| `suite/lib/model/slices.test.ts` | **Modify.** Round trip and unknown-key tests for crew. |
| `suite/apps/brigade/core/model/types.ts` | **Modify.** Brigade's own `Team` and `Job`. |
| `suite/apps/brigade/state/store.ts` | **Modify.** Seed the new fields on `addTeam`. |
| `suite/apps/brigade/ui/panels/CrewPanel.tsx` | **Modify.** The contract fields and the budget line. |
| `suite/apps/brigade/render/screen/Board.tsx` | **Modify.** Tell a blockless job from an orphaned one. |
| `suite/apps/brigade/ui/panels/JobPanel.tsx` | **Modify.** Let a job be detached from the day. |
| `suite/lib/model/readiness.ts` | **Modify.** Two new rows. |
| `suite/lib/model/readiness.test.ts` | **Modify.** Cover them. |

---

## Task 1: Stop `readCrew` destroying fields, then give it the new ones

**Files:**
- Modify: `suite/lib/model/slices.ts`
- Modify: `suite/lib/model/types.ts`
- Modify: `suite/lib/model/slices.test.ts`

**Interfaces:**
- Produces: `Team` with `cost`, `deposit`, `depositPaidOn`, `balanceDueOn`,
  `email`, `confirmedOn`; `Crew` with `budget`; `Job` with
  `blockId: string | null`. Consumed by every later task.

This comes first because adding six fields to a reader that rebuilds from a
fixed list is exactly the change that would lose them.

- [ ] **Step 1: Write the failing tests**

Append to `suite/lib/model/slices.test.ts` (it already imports `describe`,
`expect`, `it` from vitest — add `readCrew` to the import from `./slices`, and
`import { emptyTrousseau } from "@jfrusher/trousseau";`):

```ts
describe("readCrew", () => {
  const docWith = (crew: unknown) => ({ ...emptyTrousseau(), crew } as never);

  it("reads a team's contract fields", () => {
    const crew = readCrew(
      docWith({
        teams: [
          {
            id: "t1",
            name: "Bloom & Co",
            cost: 1450,
            deposit: 300,
            depositPaidOn: "2026-11-02",
            balanceDueOn: "2027-05-01",
            email: "hello@bloom.example",
            confirmedOn: "2026-11-03",
          },
        ],
      }),
    );

    expect(crew.teams[0]).toMatchObject({
      cost: 1450,
      deposit: 300,
      depositPaidOn: "2026-11-02",
      balanceDueOn: "2027-05-01",
      email: "hello@bloom.example",
      confirmedOn: "2026-11-03",
    });
  });

  it("leaves a team with no contract details alone", () => {
    const crew = readCrew(docWith({ teams: [{ id: "t1", name: "Ushers" }] }));
    expect(crew.teams[0]).toMatchObject({
      cost: null,
      deposit: null,
      depositPaidOn: "",
      confirmedOn: "",
    });
  });

  it("keeps a field belonging to a tool it has never heard of", () => {
    // The same rule as the envelope, one level down. readCrew rebuilt every
    // team from a fixed list, which is how coerceGuests destroyed fullName.
    const crew = readCrew(docWith({ teams: [{ id: "t1", name: "Band", vanRegistration: "AB12 CDE" }] }));
    expect(crew.teams[0]).toMatchObject({ vanRegistration: "AB12 CDE" });
  });

  it("reads the budget, and treats a missing one as unset", () => {
    expect(readCrew(docWith({ budget: 18000 })).budget).toBe(18000);
    expect(readCrew(docWith({})).budget).toBeNull();
  });

  it("accepts a job that is not tied to a block", () => {
    const crew = readCrew(docWith({ jobs: [{ id: "j1", label: "Order confetti", blockId: null }] }));
    expect(crew.jobs[0]!.blockId).toBeNull();
  });

  it("still reads a job that is tied to one", () => {
    const crew = readCrew(docWith({ jobs: [{ id: "j1", label: "Buttonholes", blockId: "b1" }] }));
    expect(crew.jobs[0]!.blockId).toBe("b1");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run from `suite/`: `npx vitest run --project suite lib/model/slices.test.ts`
Expected: FAIL — the contract fields are undefined, `budget` does not exist,
and `blockId` comes back as `""` rather than `null`.

- [ ] **Step 3: Add the fields to the suite's types**

In `suite/lib/model/types.ts`, replace the `Team` interface:

```ts
export interface Team {
  id: string;
  tag: string | null;
  name: string;
  phone: string;
  notes: string;
  /** For sending the call sheet. Teams had a phone and no email. */
  email: string;
  /** Agreed total, in whole units of the couple's own currency. Null if not agreed. */
  cost: number | null;
  /** Deposit, where one was asked for. */
  deposit: number | null;
  /** ISO date the deposit was paid, or "" if it has not been. */
  depositPaidOn: string;
  /** ISO date the balance falls due, or "". */
  balanceDueOn: string;
  /** ISO date this team confirmed their jobs and times, or "". */
  confirmedOn: string;
}
```

In the same file, change `Job.blockId` and add the budget to `Crew`:

```ts
  /** The block of the day this hangs off, or null for a task that is not tied to it. */
  blockId: string | null;
```

```ts
export interface Crew {
  teams: Team[];
  people: Person[];
  jobs: Job[];
  /** What the couple intends to spend in total, or null if they have not said. */
  budget: number | null;
}
```

- [ ] **Step 4: Fix and extend `readCrew`**

In `suite/lib/model/slices.ts`, replace the body of `readCrew`:

```ts
export function readCrew(doc: Trousseau): Crew {
  return cached(doc, "crew", () => {
    const raw: Record<string, unknown> = isRecord(doc.crew) ? doc.crew : {};
    return {
      teams: list(raw["teams"], (t) => {
        if (!isRecord(t) || typeof t["id"] !== "string") return null;
        return {
          // Keep what this model has no opinion about, for the same reason
          // coerceGuests does: rebuilding from the list below is how a field
          // owned by a tool gets silently destroyed on the next read.
          ...t,
          id: t["id"],
          tag: typeof t["tag"] === "string" ? t["tag"] : null,
          name: str(t["name"], "Team"),
          phone: str(t["phone"]),
          notes: str(t["notes"]),
          email: str(t["email"]),
          cost: typeof t["cost"] === "number" ? t["cost"] : null,
          deposit: typeof t["deposit"] === "number" ? t["deposit"] : null,
          depositPaidOn: str(t["depositPaidOn"]),
          balanceDueOn: str(t["balanceDueOn"]),
          confirmedOn: str(t["confirmedOn"]),
        };
      }),
      people: list(raw["people"], (p) => {
        if (!isRecord(p) || typeof p["id"] !== "string") return null;
        return {
          ...p,
          id: p["id"],
          name: str(p["name"], "Someone"),
          teamId: typeof p["teamId"] === "string" ? p["teamId"] : null,
          phone: str(p["phone"]),
          notes: str(p["notes"]),
          // Which guest this person is, when they are one. Narrowing this away
          // would quietly unlink every crew member on the next read.
          guestId: typeof p["guestId"] === "string" ? p["guestId"] : null,
        };
      }),
      jobs: list(raw["jobs"], (j) => {
        if (!isRecord(j) || typeof j["id"] !== "string") return null;
        const status = j["status"];
        return {
          ...j,
          id: j["id"],
          // Null and absent both mean "not tied to the day". An empty string
          // would be a third spelling of the same thing.
          blockId: typeof j["blockId"] === "string" && j["blockId"] !== "" ? j["blockId"] : null,
          label: str(j["label"], "Job"),
          notes: str(j["notes"]),
          teamId: typeof j["teamId"] === "string" ? j["teamId"] : null,
          personIds: list(j["personIds"], (p) => (typeof p === "string" ? p : null)),
          status: status === "doing" || status === "done" ? status : "todo",
        };
      }),
      budget: typeof raw["budget"] === "number" ? raw["budget"] : null,
    };
  });
}
```

- [ ] **Step 5: Run the tests**

Run from `suite/`: `npx vitest run --project suite lib/model`
Expected: PASS, including the six new cases.

- [ ] **Step 6: Type-check**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: errors **only** where `blockId` is now nullable and something still
assumes a string, and where `Crew` is constructed without `budget`. Fix each by
following the new types; do not widen a type back to make an error go away.
Ignore `Cannot find name 'LayoutProps'` — it is generated by Next into
`.next/types` and appears until `npx next build` has run once.

- [ ] **Step 7: Commit**

```bash
git add suite/lib/model
git commit -m "Give teams contract fields, crew a budget, and jobs the right to no block"
```

---

## Task 2: Brigade's own types and store

**Files:**
- Modify: `suite/apps/brigade/core/model/types.ts`
- Modify: `suite/apps/brigade/state/store.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly — Brigade keeps its own types.
- Produces: Brigade's `Team` and `Job` matching the suite's shape, so the
  wholesale pass-through in `sliceBridge.ts` stays type-correct.

- [ ] **Step 1: Match the suite's shape**

In `suite/apps/brigade/core/model/types.ts`, replace `Team`:

```ts
export interface Team {
  id: string;
  tag: string | null;
  name: string;
  phone: string;
  notes: string;
  /** For sending the call sheet. */
  email: string;
  /** Agreed total. Null if nothing has been agreed. */
  cost: number | null;
  deposit: number | null;
  /** ISO dates, or "" for "not yet". */
  depositPaidOn: string;
  balanceDueOn: string;
  confirmedOn: string;
}
```

and change `Job.blockId`:

```ts
  /** The only link back to Cadence, or null for a task that is not part of the day. */
  blockId: string | null;
```

- [ ] **Step 2: Seed a new team with them**

In `suite/apps/brigade/state/store.ts`, the `addTeam` action currently seeds
`{ id, tag: null, name: "New team", phone: "", notes: "", ...seed }`. Extend it:

```ts
        teams: [
          ...doc.teams,
          {
            id,
            tag: null,
            name: "New team",
            phone: "",
            notes: "",
            email: "",
            cost: null,
            deposit: null,
            depositPaidOn: "",
            balanceDueOn: "",
            confirmedOn: "",
            ...seed,
          },
        ],
```

- [ ] **Step 3: Type-check and run Brigade**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json` then
`npx vitest run --project brigade`
Expected: no type errors, and Brigade's tests pass. Fix any place that assumed
`blockId` was a string by handling null, not by casting.

- [ ] **Step 4: Commit**

```bash
git add suite/apps/brigade/core/model/types.ts suite/apps/brigade/state/store.ts
git commit -m "Match Brigade's own team and job types to the shared ones"
```

---

## Task 3: The contract fields and the budget, in Delegation

**Files:**
- Modify: `suite/apps/brigade/ui/panels/CrewPanel.tsx`

**Interfaces:**
- Consumes: `updateTeam` from the store (already there), and
  `TextField` / `Panel` from `@/components/ui/fields` (already imported).
- Produces: nothing importable.

- [ ] **Step 1: Add the fields to the team editor**

`CrewPanel.tsx` already imports `Button, Panel, TextField` and holds
`updateTeam`. Beneath the existing team name field, add a contract block for
the selected team. Every field is optional and shows its own label:

```tsx
<div className={styles.contract}>
  <TextField
    label="Email"
    value={team.email}
    onChange={(email) => updateTeam(team.id, { email })}
  />
  <TextField
    label="Cost"
    type="number"
    value={team.cost === null ? "" : String(team.cost)}
    onChange={(value) => updateTeam(team.id, { cost: value === "" ? null : Number(value) })}
  />
  <TextField
    label="Deposit"
    type="number"
    value={team.deposit === null ? "" : String(team.deposit)}
    onChange={(value) => updateTeam(team.id, { deposit: value === "" ? null : Number(value) })}
  />
  <TextField
    label="Deposit paid"
    type="date"
    value={team.depositPaidOn}
    onChange={(depositPaidOn) => updateTeam(team.id, { depositPaidOn })}
  />
  <TextField
    label="Balance due"
    type="date"
    value={team.balanceDueOn}
    onChange={(balanceDueOn) => updateTeam(team.id, { balanceDueOn })}
  />
  <TextField
    label="Confirmed"
    type="date"
    value={team.confirmedOn}
    onChange={(confirmedOn) => updateTeam(team.id, { confirmedOn })}
  />
</div>
```

If `TextField` does not accept a `type` prop, add one that defaults to
`"text"` and is passed to the underlying `<input>` — `components/ui/fields.tsx`
is shared, so check its signature first and extend it rather than working
around it. Native `type="date"` and `type="number"` are used deliberately: a
date picker and a numeric keypad for free, on every platform, with no
dependency.

- [ ] **Step 2: Add the budget line**

At the top of the crew panel, above the team list:

```tsx
{(() => {
  const committed = teams.reduce((total, t) => total + (t.cost ?? 0), 0);
  if (budget === null && committed === 0) return null;
  return (
    <p className={styles.budget}>
      {committed.toLocaleString()} committed
      {budget === null ? "" : ` of ${budget.toLocaleString()} — ${(budget - committed).toLocaleString()} left`}
    </p>
  );
})()}
```

with a field to set the budget itself beside it, wired to whatever action the
store exposes for the crew document. A wedding with no budget and no costs sees
nothing at all.

- [ ] **Step 3: Check it by hand**

```bash
cd suite && npx next dev --port 3400
```

Open `/delegation`, add a team, and confirm: the contract fields save and
survive a reload; the budget line appears once a cost is entered and disappears
when it is cleared; a team with no contract details looks exactly as it did
before.

- [ ] **Step 4: Commit**

```bash
git add suite/apps/brigade/ui/panels/CrewPanel.tsx suite/components/ui/fields.tsx
git commit -m "Record what a supplier costs, and show it against the budget"
```

---

## Task 4: Tasks that are not part of the day

**Files:**
- Modify: `suite/apps/brigade/render/screen/Board.tsx`
- Modify: `suite/apps/brigade/ui/panels/JobPanel.tsx`

**Interfaces:**
- Consumes: `Job.blockId: string | null` (Task 2).
- Produces: nothing importable.

Most of this already works. `Board.tsx:43` computes `orphans` as jobs whose
`blockId` matches no block, and a `blockId` of `null` already satisfies that.
What is missing is telling the two cases apart and a way to make one.

- [ ] **Step 1: Separate the two kinds**

In `suite/apps/brigade/render/screen/Board.tsx`, replace the single `orphans`
list with two, and render the existing section twice with the right words:

```tsx
  // A job with no block was never on the day; a job whose block has gone is a
  // problem. They look identical to a filter and mean opposite things.
  const tasks = doc.jobs.filter((job) => job.blockId === null && shown(job));
  const orphans = doc.jobs.filter(
    (job) => job.blockId !== null && !blocks.some((block) => block.id === job.blockId) && shown(job),
  );
```

Render `tasks` under the heading `Not tied to the day — N job(s)`, and keep the
existing `Work that has lost its place — N job(s)` heading for `orphans`. Both
use the same `<section className={styles.orphans}>` markup and `JobRow`.

- [ ] **Step 2: Let a job be detached**

In `suite/apps/brigade/ui/panels/JobPanel.tsx`, the block selector currently
maps `job.blockId` straight onto the options. Add a first option that means
"no block", and handle it on the way back out:

```tsx
        value={job.blockId ?? ""}
        options={[
          { value: "", label: "— not tied to the day —" },
          ...(orphan && job.blockId !== null ? [{ value: job.blockId, label: "— block deleted —" }] : []),
          ...blockOptions,
        ]}
        onChange={(blockId) => updateJob(job.id, { blockId: blockId === "" ? null : blockId })}
```

Read the file first: `blockOptions` above is whatever the existing options
array is called there, and the `orphan` guard is the existing one — only its
`job.blockId !== null` condition is new.

- [ ] **Step 3: Confirm the validator still agrees**

Run from `suite/`: `npx vitest run --project suite lib/documents`
Expected: PASS. `crossSliceValidation` reports a job in a lane or block that
does not exist; a `blockId` of `null` must not trip it. If it does, fix the
validator to skip null rather than making the job carry a fake block.

- [ ] **Step 4: Check it by hand**

With the dev server running, add a job, set it to "not tied to the day", and
confirm it moves into its own section, survives a reload, and does not appear
under any block.

- [ ] **Step 5: Commit**

```bash
git add suite/apps/brigade/render/screen/Board.tsx suite/apps/brigade/ui/panels/JobPanel.tsx
git commit -m "Let a job exist without a block, and say so plainly"
```

---

## Task 5: Two rows on the front page

**Files:**
- Modify: `suite/lib/model/readiness.ts`
- Modify: `suite/lib/model/readiness.test.ts`

**Interfaces:**
- Consumes: `readCrew` (Task 1).
- Produces: two `Readiness` rows, rendered by the existing `WhatIsLeft`.

- [ ] **Step 1: Write the failing tests**

Append to `suite/lib/model/readiness.test.ts`, following the shape of the tests
already in it:

```ts
describe("money and confirmations", () => {
  it("says nothing when there is no budget and nothing committed", () => {
    const rows = readinessFor({ crew: { teams: [{ id: "t1", name: "Ushers" }] } });
    expect(rows.some((r) => r.id === "over-budget")).toBe(false);
  });

  it("reports committing more than the budget", () => {
    const rows = readinessFor({
      crew: { budget: 1000, teams: [{ id: "t1", name: "Band", cost: 1400 }] },
    });
    expect(rows.some((r) => r.id === "over-budget")).toBe(true);
  });

  it("stays quiet when the budget still covers it", () => {
    const rows = readinessFor({
      crew: { budget: 2000, teams: [{ id: "t1", name: "Band", cost: 1400 }] },
    });
    expect(rows.some((r) => r.id === "over-budget")).toBe(false);
  });

  it("reports a team with jobs that has not confirmed", () => {
    const rows = readinessFor({
      crew: {
        teams: [{ id: "t1", name: "Band" }],
        jobs: [{ id: "j1", label: "Set up", blockId: "b1", teamId: "t1" }],
      },
    });
    expect(rows.some((r) => r.id === "unconfirmed-teams")).toBe(true);
  });

  it("stays quiet once they have", () => {
    const rows = readinessFor({
      crew: {
        teams: [{ id: "t1", name: "Band", confirmedOn: "2027-01-04" }],
        jobs: [{ id: "j1", label: "Set up", blockId: "b1", teamId: "t1" }],
      },
    });
    expect(rows.some((r) => r.id === "unconfirmed-teams")).toBe(false);
  });
});
```

`readinessFor` above is whatever helper the existing tests in that file use to
build a document and call `readiness` — read the top of the file and use the
same one rather than inventing a second.

- [ ] **Step 2: Run to verify they fail**

Run from `suite/`: `npx vitest run --project suite lib/model/readiness.test.ts`
Expected: FAIL — neither row exists.

- [ ] **Step 3: Add the rows**

In `suite/lib/model/readiness.ts`, inside `readiness()` after the existing crew
work, add:

```ts
  const committed = crew.teams.reduce((total, team) => total + (team.cost ?? 0), 0);
  if (crew.budget !== null && committed > crew.budget) {
    out.push({
      id: "over-budget",
      severity: "advisory",
      message: `Committed ${committed.toLocaleString()} against a budget of ${crew.budget.toLocaleString()}.`,
      href: "/delegation",
      action: "Look at the costs",
    });
  }

  // Only teams with something to do on the day. A venue you are merely paying
  // has nothing to confirm.
  const working = new Set(crew.jobs.map((job) => job.teamId).filter((id): id is string => id !== null));
  const unconfirmed = crew.teams.filter((team) => working.has(team.id) && team.confirmedOn === "");
  if (unconfirmed.length > 0) {
    out.push({
      id: "unconfirmed-teams",
      severity: "advisory",
      message:
        unconfirmed.length === 1
          ? `${unconfirmed[0]!.name} has not confirmed yet.`
          : `${unconfirmed.length} suppliers have not confirmed yet.`,
      href: "/delegation",
      action: "Chase them",
    });
  }
```

- [ ] **Step 4: Run the tests**

Run from `suite/`: `npx vitest run --project suite lib/model`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/model/readiness.ts suite/lib/model/readiness.test.ts
git commit -m "Say on the front page when the money or the suppliers need attention"
```

---

## Task 6: Full regression check

**Files:** none created or modified — verification only.

- [ ] **Step 1: No new dependencies**

Run: `git diff main -- suite/package.json package.json`
Expected: empty.

- [ ] **Step 2: Every project**

Run from `suite/`: `npx vitest run`
Expected: PASS across all five projects.

- [ ] **Step 3: The contract package**

Run from the repo root: `npm test`
Expected: PASS, 7 files / 98 tests. Nothing here touches it; this confirms the
workspace is healthy.

- [ ] **Step 4: Type-check and build**

Run from `suite/`: `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit -p tsconfig.json`
then `npx next build`
Expected: both clean. The `tsbuildinfo` is cleared because it is `incremental`
and hides changes arriving through the `file:..` symlink.

- [ ] **Step 5: A wedding with none of this still looks untouched**

With the dev server running and the example wedding loaded, confirm the front
page shows no new rows, and Delegation looks as it did — every field added here
is optional, and a couple who never opens it should not be able to tell.

- [ ] **Step 6: Nothing to commit**

A gate, not a change.
