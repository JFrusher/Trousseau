# Trousseau — vendors, budget, tasks and confirmations

Date: 2026-09-08
Status: approved, ready for implementation planning
Scope: subsystem E of `docs/PRODUCT-ROADMAP.md`, all four parts (E1–E4).

## Why this is one spec rather than four

The roadmap decomposed E into four subsystems, each expecting its own design
pass. Reading Brigade's model first changed that: the entities all four need
already exist.

`Team` is `{ id, tag, name, phone, notes }`. A florist, a caterer, a band and a
venue are teams in Brigade today. `Job` is `{ id, blockId, label, notes,
teamId, personIds, status }` — a task, tied to a block of the day.

So none of E1–E4 is a new subsystem. Each is a small change to a model that is
already synced, already undoable, already validated across slices, and already
round-tripped by every other tool.

| | Roadmap framing | What it actually is |
|---|---|---|
| E1 | Vendor/contract management | `Team` gains contract fields |
| E2 | Budget tracking | A total on the crew slice, compared against those fields |
| E3 | General task management | `Job.blockId` becomes nullable |
| E4 | Vendor-facing portal | A confirmation date on `Team` |

Four modest changes rather than four subsystems, and every one inherits the
undo, sync, export and validation that already work.

## Decisions

**A vendor is a team, not a new entity.** One list. The florist has a cost, a
deposit and jobs on the day; the venue has a cost and no jobs; a group of
friends has jobs and no cost. Every contract field is optional and an empty one
does not render.

Rejected: a separate `Vendor` entity with its own slice. It would need its own
types, its own UI, its own round-trip through four other tools, and a
relationship to `Team` — and it would put a question to the user that has no
right answer: *is the photographer a vendor or crew?*

**The budget total lives in the crew slice**, beside the costs it is compared
against. `crew` is Brigade's own and is loose, so this needs no contract
release and no other tool has to know. Putting it in `event` would mean a
change to the contract package's typed schema for a field one tool reads.

**A general task is a job with no block.** `Job.blockId` becomes
`string | null`, matching how `teamId`, `guestId` and `tag` already express
"not attached to anything". Brigade groups jobs by block; jobs with no block
get one more group.

**E4 is a date, not a portal.** Brigade already exports a per-team call sheet
PDF. Sending it is the couple emailing it, which they would do anyway because
a vendor wants it in their inbox. Tracking confirmation is therefore one field
— `confirmedOn` — plus a visible count of who has not replied.

Rejected, for now: a `/seat/[token]`-style share link per team. It is genuinely
nicer for the vendor, and it costs a new share type, a new public route, its
own encryption path and its own retention story — for something a wedding has
about eight of. Revisit if a real vendor asks for one.

**No contact history entity.** `Team.notes` is free text and already exists.
A structured log of calls and emails is a new entity to store, edit, validate
and round-trip, for something a text field does adequately. Revisit if notes
demonstrably fail.

## The fields

Added to `Team`, all optional:

```ts
  /** Agreed total, in whole units of the couple's own currency. */
  cost: number | null;
  /** Deposit, where one was asked for. */
  deposit: number | null;
  /** ISO date the deposit was paid, or "" if it has not been. */
  depositPaidOn: string;
  /** ISO date the balance falls due, or "". */
  balanceDueOn: string;
  /** For sending the call sheet. Teams had a phone and no email. */
  email: string;
  /** ISO date this team confirmed their jobs and times, or "". */
  confirmedOn: string;
```

Added to `Crew`:

```ts
  /** What the couple intends to spend in total, or null if they have not said. */
  budget: number | null;
```

Changed on `Job`:

```ts
  /** The block this hangs off, or null for a task that is not tied to the day. */
  blockId: string | null;
```

**No currency field.** One wedding, one currency, and a symbol the couple
recognises is a formatting concern rather than a data one. Amounts are plain
numbers; the UI shows them without a symbol rather than guessing wrong.

## A prerequisite this uncovered

`readCrew` in `suite/lib/model/slices.ts` rebuilds every team, person and job
from a fixed list of fields — the same shape as the `coerceGuests` bug fixed
on 2026-09-08, which silently destroyed `fullName`, `dietaryRaw` and
`assignedSeatId` on load.

Nothing has been lost through it yet, because nothing writes fields to `crew`
that the suite does not know. Adding six is exactly the change that would.

So `readCrew` spreads the raw object before applying the fields it owns, the
same one-line fix, before any field is added.

## What the couple sees

**In Delegation.** Each team gains a contract section: cost, deposit, when the
deposit was paid, when the balance is due, an email, and whether they have
confirmed. All optional; empty fields stay quiet.

A budget line shows the total agreed against the budget, and what is left. It
appears only once a budget is set — a wedding that has not chosen one is not
shown a number it did not ask for.

Jobs with no block appear under a group of their own, so a checklist item that
is not part of the day has somewhere to live.

**On the front page.** `WhatIsLeft` already reports what spans the tools. It
gains two rows, and only when they are true: money committed above the budget,
and teams with jobs who have not confirmed.

## Testing

- **Round trip.** A team carrying every contract field survives a save and a
  read. This is the test that would have caught the `readCrew` flaw.
- **Unknown keys.** A team with a field the suite has never heard of still has
  it after `readCrew`.
- **The budget sum.** Total committed is the sum of team costs, ignoring teams
  with none, and is not confused by a null budget.
- **Blockless jobs.** A job with `blockId: null` round-trips, is grouped
  separately, and does not appear against any block of the day.
- **Cross-slice.** A job pointing at a block that does not exist is already an
  error in `crossSliceValidation`; `blockId: null` must not become one.
- **Existing suites stay green**, particularly Brigade's 41 and the readiness
  tests.

## Explicitly deferred

- A vendor share link or portal.
- Structured contact history.
- Multiple currencies, tax, or per-line invoicing.
- Payment reminders, or anything that emails on the couple's behalf.
- Splitting vendors from crew in the UI.
