# Trousseau — Tableaux incremental TypeScript migration

Date: 2026-09-02
Status: approved, ready for implementation planning
Scope: subsystem D of `docs/PRODUCT-ROADMAP.md`. Revised same day from an
earlier "full rewrite" decision — see the decisions log in
`docs/PRODUCT-ROADMAP.md` for why.

## Why

The audit found Tableaux's real risk isn't its logic — the CSV parser and
warnings engine are solid — it's that `planDocSchema` is `.passthrough()`
everywhere, so a field renamed in the shared zod contract silently coerces
to a default in Tableaux instead of failing to compile, unlike the other
three apps. A full rewrite was the first answer, then reconsidered: it risks
re-implementing (and potentially regressing) audit-validated behavior for a
problem that's really just about the data boundary, not the whole app.

## Approach

**Type in place, don't rebuild.** Same files, same logic, same behavior.
Concretely:

1. Enable `allowJs`/`checkJs` in Tableaux's TypeScript config so `.js`/`.jsx`
   and `.ts`/`.tsx` coexist during the transition — no flag day where
   everything has to convert at once.
2. Convert files to `.ts`/`.tsx` one at a time, starting with the ones that
   matter most for the risk this is solving: the data boundary first
   (`store/planSchema.js`, the guest/table/room normalization in
   `useStore.js`), then the CSV/warnings modules the audit already
   validated as solid logic, then the rest of the app as time allows. UI
   components are the lowest priority — they're not where schema drift
   bites.
3. **Real validation, not just types:** replace `planDocSchema`'s
   `.passthrough()` everywhere with actual field-shape validation against
   the real guest/table/room shapes, using zod — consistent with the rest
   of the ecosystem's contract package, so a shape mismatch fails loudly
   (a thrown, catchable validation error) instead of silently defaulting.
4. No behavior changes bundled into this work. This is a typing/validation
   hardening pass, not a feature or UX change — matching the "one thing per
   step" discipline already established for this ecosystem (see
   `docs/superpowers/specs/2026-08-20-trousseau-design.md`'s safety
   constraints).

## Sequencing against subsystem B

Proceeds independently, in parallel with subsystem B's storage rework —
this migration doesn't touch how Tableaux persists data, only how it
validates and types what it already reads and writes. When B ships,
Tableaux's storage integration gets updated the same way the other three
apps' will, as its own separate follow-on step. Neither blocks the other.

## Testing

- The existing 159 tests must stay green throughout — this is a strict
  regression gate at every conversion step, not just at the end.
- `tsc --noEmit` (or the equivalent scoped check) becomes a new gate,
  growing stricter as more files convert from `allowJs`-tolerated `.js` to
  checked `.ts`.
- New tests specifically for the hardened validation boundary: a
  malformed/renamed-field document is rejected with a clear error rather
  than silently coerced — this is the concrete regression test for the bug
  class this whole migration exists to prevent.

## Explicitly deferred (not decided here)

- Restructuring Tableaux to match the other three apps'
  core/render/state/ui separation — that was part of the original "redesign
  the rest" full-rewrite plan and is out of scope now. This migration is
  about typing and validating the existing shape, not re-architecting it.
- A timeline/deadline for full conversion — file-by-file, as time allows, no
  forced completion date.
