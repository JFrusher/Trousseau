# Trousseau — ecosystem design

Date: 2026-08-20
Status: approved, ready for implementation planning
Scope: Plaque, Tableaux, Cadence, Brigade, plus this contract package and a launcher

## Why

Four wedding tools exist as four unrelated repos. They share a design language,
a great deal of copy-pasted infrastructure, and exactly one real integration:
Cadence exports a `.day.json` that Brigade imports.

The unexploited link is the guest list. Tableaux knows that Priya sits at table
seven; Plaque prints the card that should say so; there is no path between them.
The same is true of suppliers — Cadence holds the phone numbers, Brigade
re-derives its teams from them, Tableaux knows nothing about either.

This document defines the smallest architecture that closes those gaps and stays
open to a fifth app nobody has thought of yet.

## The principle

**One owner per slice. Owners publish resolved output. Nobody recomputes.**

Each app keeps its source document private, exactly as it does today. A
`.cadence.json` holds anchors, gaps and squeeze floors; a `.plaque.json` holds a
millimetre scene graph. What an app *publishes* to the ecosystem is not that
model but the resolved answer derived from it — not "this block floats after
that one", but "this block starts at 14:20".

Consumers therefore never see an owner's internal model, and an owner can
rewrite its internals freely without breaking anyone downstream.

This is not a new idea in this codebase. It is already written down, twice,
independently:

- `cadence/src/core/project/day.ts` — *"Rather than have a second application
  reimplement the one load-bearing function in this codebase, Cadence hands out
  the answer."*
- `Tableaux/server/lib/planSchema.js` — *"The client owns the rich per-entity
  shape; the server enforces types and ceilings"*, implemented as
  `.passthrough()` on every key.

The design below names that pattern and applies it to all four.

## Slices and owners

| Slice | Owner | Consumers | Contents |
| --- | --- | --- | --- |
| `event` | launcher | all four | date, couple names, venue name, curfew, UTC offset |
| `guests` | Tableaux | Plaque | people, families, dietary, contact details |
| `seating` | Tableaux | Plaque | guest id to table label and seat number |
| `day` | Cadence | Brigade | the existing `ResolvedDay`, unchanged |
| `crew` | Brigade | — | jobs, teams, assignments |
| `stationery` | Plaque | — | card spec, sheet spec, print setup |

`event` is the one thing all four need and none uniquely owns. Giving it to the
launcher gives the launcher a job beyond being a page of links, and avoids a
four-way argument about who is authoritative for the couple's names.

Cadence already carries the same facts inside its own document, and its
`ResolvedDay` echoes them into `day.day.*`. That echo stays — it is Cadence's
internal model and its export contract, and breaking it would break Brigade for
no gain. `event` is authoritative; `day.day.*` is a copy. Cadence pulls `event`
like any other consumer, on an explicit action, and the launcher shows the two
as disagreeing when they do rather than silently reconciling them.

`guests` has a wrinkle. Tableaux owns it, but Plaque imports a CSV today and
many people will use Plaque alone. The rule: **Plaque's CSV import seeds
`guests` when the slice is absent or empty; once Tableaux has written it,
Tableaux owns it and Plaque only reads.** Plaque never overwrites a populated
`guests` slice.

## The envelope

```jsonc
{
  "kind": "trousseau",
  "version": 1,
  "event":   { "date": "2026-08-20", "coupleNames": "…", "venueName": "…",
               "curfewMin": 1410, "utcOffsetMin": 60 },
  "guests":  { "<id>": { } },
  "seating": { "<guestId>": { "tableLabel": "7", "seat": 3 } },
  "day":     { "kind": "cadence.day", "version": 1 },
  "crew":    { },
  "stationery": { },
  "sources": { "cadence": { }, "plaque": { } }
}
```

Serialised as `.trousseau.json`.

### Two rules, and they are the whole open-endedness mechanism

1. **An app rewrites only its own slice and copies every other key
   byte-for-byte — including keys it has never heard of.** A fifth app that adds
   a `florals` slice round-trips through all four existing apps untouched, with
   no coordinated release and no version lockstep.
2. **Unknown keys inside a slice an app owns are preserved too.** Same reason,
   one level down: an owner that gains a field in a later version does not lose
   it when an older build writes the slice.

Rule 1 is what makes this an ecosystem rather than a fixed four-way integration.
It must be enforced in the store client, not left to each app's discipline.

### `sources`

Optional. Holds each app's native document verbatim, keyed by app name, so a
single `.trousseau.json` is the whole wedding and can move between machines —
something no current file can do.

`sources` holds JSON documents only, never binary. Uploaded fonts, images and
crests stay in each app's private blob storage and do not travel.

`sources` is not a slice and is not written by `publish`. The ambient store
never carries it: a running ecosystem already has each source document in its
own app's storage, and copying them into the shared store would make every
publish expensive for no benefit.

It is filled only when the launcher exports a `.trousseau.json`. Because the
apps share an origin, the launcher can read each one's own autosave directly —
but it must not hardcode where those live. Each app therefore declares its own
location in its manifest:

```json
"source": { "kind": "localStorage", "key": "cadence.document.v1" }
```

with `kind` one of `localStorage` or `indexedDB` (the latter naming its store
and key). The launcher copies that value in and out opaquely; it never parses a
format it does not own. A fifth app gains portability by adding four lines to
its manifest, and an app that omits `source` is simply not carried in the file.

`sources` is the lowest-value part of this design and the easiest to defer. If
Phase 2 runs long, ship the launcher without it — every app still has its own
native save-file, which is the status quo.

<!-- ponytail: assets do not travel with the file; add a content-addressed
     asset sidecar if moving a job between machines with its uploads intact
     turns out to matter -->

## `@jfrusher/trousseau` — the contract package

A new repo, published to npm. Consumed by all five front-ends as a normal
dependency, so each repo stays independently cloneable and independently
deployable.

Zod is the validation library. Tableaux already depends on it; the other three
gain one small dependency, which is the cost of validating a format that crosses
application boundaries.

### Public surface

```ts
export const trousseauSchema: ZodType<Trousseau>   // passthrough on every slice
export type { Trousseau, Event, Guests, Seating, Day, Crew, Stationery }
export type SliceName = "event" | "guests" | "seating" | "day" | "crew" | "stationery"

/** Validate and bring an unknown document up to the current version. */
export function migrate(doc: unknown): Trousseau

/** Read the whole envelope. Returns an empty valid envelope if nothing is stored. */
export function read(): Promise<Trousseau>

/** Read-modify-write one slice, atomically, preserving every other key. */
export function publish<K extends SliceName>(slice: K, value: Trousseau[K]): Promise<void>

/** Serialise and parse the portable file. */
export function serialise(doc: Trousseau): string
export function parse(text: string): Trousseau
```

There is no `subscribe`. Cross-tab live sync was considered and rejected: a
stray edit in one tab silently rewriting finished work in another is a worse
failure than a stale read.

`migrate` is currently close to identity — there is only version 1 — but the
seam exists from the first release so that adding version 2 is not a
breaking-change event across four repos.

### Storage

A **dedicated** IndexedDB store, not the idb-keyval default:

```ts
const store = createStore("trousseau", "project");   // idb-keyval >= 6
const KEY = "trousseau.project.v1";
```

This is load-bearing, not tidiness. `Plaque/src/state/blobStore.ts:43`
implements "clear all data" as `idbClear()`, which empties the default store
entirely. Putting the shared project there would mean a user clearing Plaque's
data silently destroys the seating plan, the timeline and the crew list as well.

`publish` uses `idb-keyval`'s `update()`, which runs read-modify-write inside a
single transaction, so two apps writing different slices at the same moment
cannot lose each other's work. Because owners write disjoint slices, no merge
policy beyond that is needed.

Each app keeps its existing private autosave untouched. The shared store is
additional, never a replacement.

## Data flow between apps

Owners publish their slice automatically on change, debounced, on the same
trigger as their existing autosave.

Consumers read **only on an explicit user action**. On load an app may read the
envelope to discover whether an offer is worth making, but it never applies
another app's data on its own:

> Tableaux has seating for 94 guests. Use it?

Owners write. Consumers ask. This keeps the ecosystem from ever surprising
someone by rewriting work they considered finished.

## The shared origin

All apps are served from one origin at paths:

```
/           launcher
/seating    Tableaux (local build)
/cards      Plaque
/day        Cadence
/crew       Brigade
```

Same origin is what makes an ambient store possible at all, and it is free: the
existing storage keys are already namespaced (`plaque.autosave`,
`cadence.document.v1`, `brigade.*`), so the four can co-exist on one origin
today with no changes.

Each app sets a Vite `base` matching its path.

**Development.** A Vite proxy in the launcher gives a real single origin on
localhost, so the whole design is exercisable before any hosting decision.

**Production.** Each repo deploys itself to its own Cloudflare Pages project; a
router configuration maps the paths onto those deployments. No submodules, no
meta-repo build, each repo independently deployable.

## The launcher

A small static app. It owns `event`, shows the current project, offers
`.trousseau.json` import and export, and links to the four.

Each app serves a manifest at `<base>/ecosystem.json`:

```json
{
  "name": "Plaque",
  "path": "/cards",
  "blurb": "Place cards and stationery",
  "reads": ["event", "guests", "seating"],
  "writes": ["stationery"],
  "source": { "kind": "indexedDB", "store": "keyval", "key": "plaque.autosave" }
}
```

The launcher fetches all manifests at runtime and renders both the suite and its
data-flow diagram from them, rather than from a hardcoded list. A fifth app
joins by depending on the package, serving a manifest, and being added to the
router — no change to any existing app.

For a portfolio piece this is the payoff: the architecture diagram is generated
from the running system and therefore cannot go stale.

## Tableaux

Tableaux keeps its Supabase SaaS build, its auth, its row-level security and its
share links, deployed as it is today on its own domain.

It gains a second build, `VITE_TROUSSEAU=1`, which is static and local-first:
the same client, with a persistence adapter that writes the shared store instead
of calling the API. This is viable precisely because `planSchema.js` already
treats the server as dumb storage — the rich shape lives client-side already.

The SaaS build gains `.trousseau.json` import and export so the two worlds can
exchange a wedding.

Explicitly not doing: porting Tableaux to TypeScript, upgrading it to React 19,
or unifying its component library with the others. None of that is required by
anything above.

## Build order

| Phase | Work | What it proves |
| --- | --- | --- |
| 0 | Contract repo. Schemas, `migrate`, `serialise`/`parse`, `event` and `day` slices. `ResolvedDay` moves in unchanged. Published to npm. | The package builds and publishes; Cadence's tests stay green against the imported type |
| 1 | Store client. Cadence publishes `day`; Brigade pulls it from the store, keeping its file import. | The mechanism works end to end |
| 2 | Launcher, manifests, Vite proxy origin, `event` slice adopted by all. | It behaves like one suite, locally |
| 3 | Tableaux local build. `guests` and `seating`. Plaque prints table numbers. | The reason to do any of this |
| 4 | Cloudflare Pages per repo, router, real domain. | It is live |

Phase 1 is the honest test, and it is small — both ends already speak this exact
data. If the store client is unpleasant there, the design is wrong and the cost
of finding out is a day.

**One implementation plan per phase.** This document is too broad for a single
plan and deliberately so: each phase touches different repos, ends somewhere
usable, and can be abandoned without stranding the ones before it. Phase 0 is
planned and built first, on its own.

## Testing

- **Contract package.** Round-trip property test for rule 1: an envelope
  carrying an unknown slice and unknown keys within a known slice survives
  `publish` of every other slice, byte-for-byte. This is the one test that must
  never be deleted.
- **Migration.** `migrate` accepts every historical fixture and produces a
  document that validates.
- **Store client.** Concurrent `publish` of two different slices loses neither.
- **Per app.** Existing suites stay green. Each app adds one test that it
  publishes its slice and one that it declines to apply a consumer slice without
  an explicit action.
- **Cadence and Brigade.** The existing `.day.json` fixtures become contract
  fixtures; the file import path keeps its tests.

## Error handling

- A corrupt or unreadable shared store never blocks an app from booting. Same
  posture as `cadence/src/state/persist.ts`: empty state and a notice, never a
  white screen.
- A slice that fails validation is left untouched on disk and reported, not
  deleted or repaired. Losing a guest list to an over-eager validator is the
  worst failure this system can have.
- A browser blocking IndexedDB degrades to no ecosystem: each app works exactly
  as it does today, and the launcher says so.
- A manifest that fails to fetch drops that app from the launcher listing and is
  logged; it does not break the page.

## Non-goals

- No shared UI kit. Brigade and Cadence keep their byte-identical
  `ui/controls.tsx`; 258 duplicated lines cost nothing and coupling them buys
  nothing this document needs.
- No monorepo.
- No sync server, no accounts, and no upload for the three local-first apps. The
  "never leaves your device" promise in their READMEs holds unchanged.
- No cross-tab live sync.
- No TypeScript port of Tableaux.
- No shared build tooling, eslint config or CI template.

## Open risks

- **npm name.** `@jfrusher/trousseau` assumes that npm scope is available and
  claimed. Nothing before the end of Phase 0 depends on it.
- **Cloudflare path routing** across five separate Pages projects is the one
  piece not yet proven. Phase 2's local proxy de-risks everything above it, so a
  routing problem in Phase 4 costs only the hosting approach, not the design.
- **Tableaux's persistence adapter** is assumed to be a clean seam. If the
  client turns out to call the API from many places rather than one, Phase 3
  grows. Worth a spike before committing to Phase 3's estimate.
