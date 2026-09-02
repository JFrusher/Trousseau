# Trousseau — architecture audit (baseline before the couples-product pivot)

Date: 2026-09-02
Status: reference — this is a point-in-time audit, not a design. See
`docs/PRODUCT-ROADMAP.md` for what came after it.
Scope: root `@jfrusher/trousseau` contract package + `suite/` (Plaque, Cadence,
Brigade, Tableaux).

## Why this exists

Triggered by a real bug: Cadence's printed timeline drifted off the true time
of day, block after block, on the live `trousseau-suite` Vercel deployment.
Fixing it surfaced that `suite/apps/cadence/` is a hand-ported mirror of a
separate standalone `cadence` repo, and that the fix had to be applied twice —
once at the source, once in the port — because nothing keeps the two in sync.
That prompted a full audit of the repo before deciding what to build next, since
the answer changes materially depending on whether this stays a single-wedding
tool or becomes a real product for other couples (it became the latter — see
the roadmap doc).

Five parallel research agents covered the root contract package, the `suite`
Next.js shell, and the three other apps (Plaque, Brigade, Tableaux); Cadence
was audited firsthand during the bug fix itself.

## 1. Core uses & value proposition

Trousseau is a personal wedding-planning suite, built by one developer for one
real wedding, not (at the time of this audit) a generalized product. Four
independent tools each own one facet of the day, sharing one document:

| Tool | Owns | Output |
|---|---|---|
| Tableaux | Guests, seating, dietary, constraints | Seating charts, guest exports |
| Plaque | Place-card/stationery design | Print-ready PDFs, physically calibrated |
| Cadence | Day-of running order | Timeline/run-sheet/call-sheet PDFs |
| Brigade | Crew/job assignment | Job sheets, per-person/per-team call sheets |

`suite/` is a Next.js app (deployed to Vercel as `trousseau-suite`) unifying
all four behind one shared header/nav/undo chrome — a real shared shell, not
four apps bolted side by side (shared `Header`/`ChromeSlot`, a live guest count
in the header sourced from the one Zustand store). An optional
end-to-end-encrypted Supabase sync layer supports multi-device use and a
public guest-facing "find my seat" page (`/seat/[token]`).

The project's actual thesis — *"A tool rewrites only its own slice and copies
every other key byte-for-byte — including keys belonging to tools that do not
exist yet"* — is enforced in code (`mergeSlice` operates on raw untyped data so
a schema bug can never delete another tool's write) and tested
(`preservation.test.ts` uses a slice from an app that doesn't exist yet).

## 2. Architectural & execution assessment

Build health, measured fresh:

| Area | Tests | Typecheck |
|---|---|---|
| Root contract package | 73 passing, 1 suite fails to load | clean |
| `suite` shell | 314 passing | clean |
| Plaque | 633 passing | clean |
| Cadence | 247 passing | clean |
| Brigade | 41 passing | clean |
| Tableaux | 159 passing | clean (no compiler on this app — see below) |
| **Total** | **1,467 passing / 1 suite broken** | — |

Patterns worth preserving into whatever comes next:

- **Plaque's `invariants.test.ts`** — grep-based tests that inspect the source
  itself to enforce architectural rules, a live guardrail against drift.
- **The contract's `looseObject` schema strategy** — every level accepts
  unknown keys so a future app's data survives being round-tripped by the
  others before that app exists.
- **`seat/[token]`'s security model** — decryption key lives only in the URL
  fragment, never sent to the server; 122-bit unguessable token; PBKDF2 at
  600k rounds; the one known limitation (per-instance rate limiting) is
  self-disclosed in a code comment with an upgrade path already stated.
- **Brigade's slice bridge** — reads Cadence's published day directly from the
  shared doc, no re-export/re-import step.

## 3. Shortcomings & technical debt

1. **The Cadence porting model is a live liability.** `suite/apps/cadence/` is
   a manually copy-pasted mirror of the standalone `cadence` repo, kept in
   sync by hand ("Port: ..." commits). Every Cadence bug must be fixed twice.
   This is exactly what caused the live drift bug: two of three necessary
   fixes had been ported, the third silently wasn't, for hours, with no
   signal anything was out of sync.
2. **The same pattern, twice more, already causing damage:**
   - Tableaux's `warnings.js` was hand-ported into `suite/lib/seating/warnings.ts`
     as an "improved" TS copy — the port already fixed a bug (one warning per
     split family member instead of one per family) that the JS original
     still has.
   - Cadence's `DesktopGate` component was copy-pasted into Brigade verbatim:
     on a narrow screen, Brigade tells the user to go open *Cadence*.
3. **A test that would catch real problems isn't running.**
   `scripts/validate-wedding.test.mjs` fails to load (CRLF line-ending issue,
   no `.gitattributes`) — reported as "1 failed suite" in a summary easy to
   misread as all-green. This is the test for the cross-tool validator that
   produced the real seating/dietary/lane warnings seen on live data.
4. **Tableaux sits on an untyped boundary to a typed schema.** The one app
   still in JS/JSX (a real former standalone product, vendored in mostly
   as-is); its document parsing (`planDocSchema`) is `.passthrough()`
   everywhere — checks collection sizes, never field shapes. A renamed field
   in the shared contract silently degrades here instead of failing loudly,
   unlike the three TypeScript apps.
5. **Two README-documented removals that didn't happen:** Tableaux's XLSX
   export ("dropped" per the README) is still wired into its export modal;
   Plaque's CSV parsing ("moved to a dependency-free tokenizer") still imports
   `papaparse`.
6. **Two minor build/ops gaps:** `suite`'s `npm run dev` skips the root
   contract package's build step (only `build` includes it) with no
   documented failure mode for a fresh clone; `.githooks/pre-commit` silently
   skips wedding-data validation if the contract package hasn't been built
   recently, rather than failing.

## 4. Overhangs & cleanup targets (as of this audit)

- Fix `scripts/validate-wedding.test.mjs`'s line endings / add `.gitattributes`.
- Brigade's copy-pasted `DesktopGate` text.
- Tableaux's `exportXlsx.js` / Plaque's `papaparse` dependency — pick one story.
- Unused root dependencies: `@dnd-kit/sortable`, `@dnd-kit/utilities`, `jspdf-autotable`.
- `scratch/PRD.md` — stale pre-DVC, pre-Supabase vision doc; keep only as a "before."
- ~29 tracked `TODO(ux-audit)`/`TODO(family-ux)` comments in Tableaux referencing
  external audit files (`tmp/ux-audit.md`, `tmp/family-ux-followups.md`) never committed.
- Tracked-but-open Tableaux gaps: duplicate CSV headers silently last-write-wins;
  table drag has no collision detection; "apart"/"together" seating constraints
  can silently contradict; a `replace`-strategy guest re-import leaves subgroup
  membership pointing at dead IDs.
- Plaque's image upload has no file-size cap (MIME-type checked only).
- Root `wedding.trousseau.json` (101KB, gitignored) duplicate of `data/wedding.trousseau.json`.

## 5. What happened next

The maintainer's wedding has since happened. The decision coming out of this
audit was to turn Trousseau into a real product for other couples rather than
retire it. See `docs/PRODUCT-ROADMAP.md` for the pivot's scope, decomposition,
and ongoing decisions.
