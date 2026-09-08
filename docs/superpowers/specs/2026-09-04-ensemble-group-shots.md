# Ensemble: group shots — design

**Status:** Approved. This is the corrected version of the design worked through in brainstorming — corrected against the actual repo state (see "Corrections from the brainstorm" at the end) and with the three open questions resolved.

## 1 · Name and placement

**Ensemble** — codename, `lib/ensemble/`. Nav label **Group shots**, route `/group-shots`, icon `Camera`. Slice name `shots`.

Fifth entry in `suite/lib/tools.ts`, after Delegation. Page at `suite/app/(app)/(tools)/group-shots/page.tsx` — metadata + one component, the same shape as every other tool page.

Ensemble is **suite-native**: unlike the four existing tools (each a standalone app with its own Zustand store, undo history and persistence, embedded via `dynamic(..., { ssr: false })` and bridged into the shared document), Ensemble has no app of its own. It reads and writes the shared `useTrousseauStore` directly, the way the suite's own chrome (`Header`, `WhatIsLeft`, `QuickStats`) already does. It is the first tool built this way — there is no existing suite-native tool to copy the file layout from, only the pattern `useSuite.ts` was clearly built to support.

## 2 · The `shots` slice

```ts
// suite/lib/model/types.ts, beside Crew

export type CastRole =
  | "bride" | "groom"
  | "brides-mother" | "brides-father"
  | "grooms-mother" | "grooms-father"
  | "bridal-party" | "groomsmen";

export const CAST_ROLES: readonly CastRole[] = [
  "bride", "groom",
  "brides-mother", "brides-father",
  "grooms-mother", "grooms-father",
  "bridal-party", "groomsmen",
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

/** Where a person in a shot comes from. Three sources, one union. */
export type ShotMember =
  | { kind: "guest";  ref: string }   // pinned guest id
  | { kind: "family"; ref: string }   // live — seating.families
  | { kind: "group";  ref: string }   // live — seating.groups / subgroups
  | { kind: "role";   ref: CastRole } // live — resolves through cast
  | { kind: "text";   ref: string };  // "the dog", "anyone who wants one"

export interface Shot {
  id: string;
  /** Blank means derive it from the members. Typed once, it sticks. */
  label: string;
  members: ShotMember[];
  notes: string;
}

export interface ShotSection { id: string; name: string; shots: Shot[] }

export interface Shots { cast: Cast; sections: ShotSection[] }
```

Shots nest inside their section rather than living in a record with id arrays alongside — one structure, so an orphaned shot is unrepresentable and reordering is an array splice.

**Vocabulary:** bride/groom, confirmed. Matches the existing `Guest.side` field (`"bride" | "groom" | "both" | ""`) and this wedding.

`"group"` resolves against `seating.groups[ref] ?? seating.subgroups[ref]` — the two records use disjoint id prefixes (`grp_`/`sub_`) so a merged lookup is unambiguous.

## 3 · Contract package

`shots` and `timeline` both become real slice names in `@jfrusher/trousseau` — settling the note in `useTrousseauStore.ts` while touching it.

- `src/slices.ts` — `shotsSchema`, `timelineSchema`: `z.looseObject({}).default(() => ({}))`, exactly like `crewSchema`. The interior stays the suite's.
- `src/envelope.ts` — two names in `SLICE_NAMES`, two fields on `trousseauSchema`.
- `SuiteSlice` in `useTrousseauStore.ts` collapses back to plain `SliceName`.
- **`suite/lib/sync/client.ts:39`** — `const SYNCED: SuiteSlice[] = [...SLICE_NAMES, "timeline"];` becomes `[...SLICE_NAMES]`. This is the one line that gates which local slices push/pull over sync; missing it would mean group shots silently never sync between devices.

## 4 · Reading, writing, resolving

Reader in `suite/lib/model/slices.ts` — `readShots(doc)`, total coercion, through `cached()`, added to `selectors.test.ts`. Hook `useShots()`, writer `setShots(next, { label: "the group shots" })` in `useSuite.ts`. One slice, one owner, no cross-writes.

`lib/ensemble/resolve.ts` — the pure core:

```ts
resolveShot(shot, guests, seating, cast): ResolvedShot
// { people: Array<{ guestId: string | null; name: string; rsvpStatus: RsvpStatus | null }>,
//   label: string,            // typed, or built from the members
//   problems: ShotProblem[] } // dangling ref (incl. an unset role) · declined guest · empty shot
```

Order preserved as authored; duplicates collapsed by guest id, so "Couple + bride's parents + the Hartley family" doesn't print Sue twice. A `role` member whose role has nobody set yet is a `dangling` problem, not silent — a shot missing people it was built to include is worth flagging.

## 5 · Getting the list started

```ts
propose(existing: ShotSection[], guests, seating, mode: "template" | "generate"): ShotSection[]
```

Takes the *current* sections and returns the merged result — not a from-scratch generator — because that is what makes the idempotency rule below actually hold. (The brainstorm's signature took `cast` instead of `existing`; nothing in either mode needs `cast` — there's no reliable way to derive who the bride is from existing data, and an existing wedding's shot list is exactly what a second press must not duplicate. `existing` replaces it.)

- `template` — five classic sections (The couple · Bride's family · Groom's family · Both families · Wedding party), each shot built from `role` members only. Resolves to nobody until the cast is set, which is fine — filling in the cast is the next step, not a prerequisite.
- `generate` — the same, plus one shot per family in the seating slice and one per named group, sided by majority `Guest.side` among their members (a tie or nobody sided falls back to "Both families").

A section is matched and reused by name rather than recreated, and a shot is only added if no shot with that exact label already exists in its section. So pressing either button twice is a no-op the second time, and running `template` then `generate` layers cleanly.

## 6 · The screen

`components/ensemble/EnsembleBoard.tsx`: `flex h-[calc(100vh-3.5rem)]`, list left, inspector right — the same shape Delegation's board uses, built fresh rather than copied (Brigade's board lives in its own app with its own UI kit; there is nothing in `suite/components/` to import from). Everything built from `suite/components/ui/controls.tsx` — `Panel`, `TextField`, `Button`, `IconButton`, `Empty`, `SelectField`, `Segmented` — and the existing palette; no new tokens, no new fonts, except the one below.

- **Left** — sections with a shot count each, collapsible, numbered shots showing the resolved names under the label, a red dot when a shot has a problem. Section order: up/down buttons (rare operation, not worth drag machinery). Shot order within a section: **drag, via `@dnd-kit/core` + `@dnd-kit/sortable`** — already suite dependencies, currently unused anywhere. There is no existing linear-list reorder in the suite to match (Tableaux's canvas drag is free positioning, not list order; Brigade's kanban sets status by click) — dnd-kit was chosen over hand-rolled HTML5 `draggable` for keyboard and touch support that come free with it.
- **Right, tab 1 — Shot.** Label, members (add guest / family / group / role / text), notes.
- **Right, tab 2 — Who's who.** The eight cast roles, each a guest picker; single roles (bride, groom, four parents) hold one, party roles (bridal party, groomsmen) hold many.
- **Right, tab 3 — Print.** Problems listed first, page-size choice (A4/A5), PDF and CSV buttons, `busy` state, errors on screen not in the console.
- **Empty state** — no guests at all: "Nothing to photograph yet," pointing at Seating.

Problems shown inline in `text-rose`: a member whose family was deleted, a guest who has since declined, a role with nobody set. Not blocking — a shot list gets printed before every RSVP is in.

Not built: a count of confirmed guests appearing in no shot at all. At 100 guests it would fire permanently and teach you to ignore the panel.

There is no shared "guest picker" component anywhere in the suite to reuse (nothing suite-native has needed one yet) — a small one is built inside `components/ensemble/` and used by both the shot editor and the cast tab. It stays local; nothing else needs it yet.

## 7 · Outputs

- **PDF** — `lib/ensemble/render/pdf/shotSheet.ts`, A4/A5, one flowing document (section names as headings, shots numbered, names and notes wrapped). Imports Brigade's existing page/table/text/units/font kit (`apps/brigade/render/pdf/*`) rather than making a third near-copy of it — Cadence already carries a second copy of the same kit, so this is genuinely the third, and promoting the shared parts to `lib/pdf/` is the upgrade path if a fourth tool needs it. Marked with a `ponytail:` comment at the import.
- **CSV** — `lib/ensemble/exports.ts` via the existing `toCsv`. Columns: Section, No, Shot, People, Notes.

**Suite-wide integration** (both confirmed in scope):

- **Landing page** — `readiness.ts` gains one row for shots with a *dangling* problem (a member or cast role naming something that no longer exists), `severity: "blocking"`, matching how `jobs-uncrewed` and `cards-from-file` already read. Declined-guest and empty-shot problems are **not** surfaced here — they're already visible inline in the tool itself, and repeating them on the landing page is exactly the double-reporting the module's own docstring warns against.
- **Wedding Pack** — the on-the-day binder (`components/shell/WeddingPack.tsx`) gains the shot sheet as a fourth section, alongside the floor plan, run sheet and job list.

**Validator** — `scripts/validate-wedding.mjs` gains the cross-slice checks (the only place that sees two slices at once):

| | |
| --- | --- |
| error | a shot member names a guest, family, or group that does not exist |
| error | a cast role names a guest who does not exist |
| warning | a shot contains a guest who declined |
| warning | a section with no shots, or a shot with nobody in it |

Not added: "a confirmed guest appears in no shot" — same reasoning as the landing page.

**Tests** — `resolve` (each member kind, dedupe, dangling refs including an unset role, declined), `propose` (both modes, idempotent on a second press, family/group siding), reorder actions, CSV shape, one PDF smoke render, `readShots` in the referential-stability suite, the four validator checks, and one extension to the suite-wide round-trip test. Vitest throughout, matching the rest of the codebase. No component-level tests are added for the React pieces — nothing in this codebase has any (checked directly: `@testing-library/react` is installed and imported by zero files), so UI is verified by hand in the browser instead, consistent with how every other tool's panels are actually tested here.

## Corrections from the brainstorm

Checked against the repo rather than assumed:

1. **No `DelegationBoard` or `CrewPrintPanel` to import.** Those names don't exist under `suite/`. Delegation is the whole standalone Brigade app, embedded — its board and print bar live inside `apps/brigade/`, in Brigade's own UI kit, not the suite's. Ensemble's board is built fresh, in spirit only.
2. **No existing drag-to-reorder anywhere**, native or dnd-kit. The brainstorm's claim that one already existed ("the same pattern the kanban and guest panel already use") doesn't hold up. Resolved by choosing dnd-kit (already a dependency, unused) over hand-rolling HTML5 `draggable`.
3. **A new CSS token block is required**, contrary to "no new tokens." The nav tab's active-state underline reads `var(--accent-bright)` from whichever class `Tool.tokens` names (`Header.tsx:42`) — a fifth tool needs a fifth `.{x}-tokens` block in `lib/design/tokens.css`, checked by `contrast.test.ts`. No new *typeface* or base palette is needed, which is what "no new tokens" was really getting at.
4. **`propose()`'s signature changed** — takes `existing: ShotSection[]` instead of `cast`, for the reasons in §5.
