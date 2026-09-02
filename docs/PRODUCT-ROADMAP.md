# Trousseau — product roadmap

Status: **living document** — updated as decisions land, not a one-shot spec.
Started: 2026-09-02.

This is the record of turning Trousseau from a tool built for one wedding into
a real product other couples can use. It captures the vision, the
decomposition into independent subsystems, decisions already made, and open
questions per subsystem. Each subsystem gets its own dated design spec in
`docs/superpowers/specs/` once it's actually designed — this document links
out to those rather than duplicating them.

Baseline: `docs/superpowers/specs/2026-09-02-trousseau-architecture-audit.md`
— the architecture audit that preceded this pivot decision.

## Vision

Trousseau was built for one wedding, with the constraints that came from that
being honest: real guest names, four tools that must not overwrite each
other, a date that doesn't move. The wedding has now happened. The decision
is to keep building this — as a real product for other couples, not a
single-use tool being retired.

That changes requirements that were previously answered by "it's just us":
real authentication, real accounts, secure cloud storage instead of a
DVC-backed local file, and a data/legal posture that holds up for strangers'
weddings, not just the maintainer's own.

## Subsystem map

| # | Subsystem | Depends on | Status |
|---|---|---|---|
| A | Identity & accounts | — | 🟡 discovery in progress |
| B | Multi-tenant data & storage | A | ⬜ not started |
| C | Cadence/suite de-duplication | — | ⬜ not started (independent, can happen anytime) |
| D | Tableaux's future | — | ⬜ not started |
| E | Brigade's expanded scope | (loosely) A, B | ⬜ not started |
| F | Onboarding, billing & legal at product scale | A | ⬜ not started |
| G | Multi-tenant suite mechanics | A, B | ⬜ not started |

## Decisions log

Settled answers, in the order they were made. Each entry is a fact to build
against, not a discussion to reopen without a reason.

- **2026-09-02** — Scope: Trousseau becomes a real multi-tenant product for
  couples generally, not a single-wedding tool being wound down.
- **2026-09-02** — Tableaux: its "former standalone SaaS product" scar tissue
  (dead `planId`, references to a server that no longer exists, JS/no-schema
  boundary) is explicitly prunable. Nothing about Tableaux's current shape is
  sacred if it doesn't serve the product going forward.
- **2026-09-02** — Brigade: stays built on top of Cadence's published day (the
  slice-bridge pattern is sound and stays), but is expected to grow tasks
  beyond pure call-sheet generation. (What those tasks are is an open question
  for subsystem E.)
- **2026-09-02** — Data storage: DVC-backed local sync (`scripts/sync.mjs`,
  the OneDrive "remote") was a stopgap for one wedding on two laptops. It is
  explicitly being dropped in favor of real cloud storage for subsystem B —
  not extended or productionized.

## Subsystem A — Identity & accounts

**Why first:** almost every other subsystem assumes "a wedding belongs to an
authenticated account" already exists.

**What exists today to build from:** the `seat/[token]` sharing feature
already has a real, audited security model (unguessable token, key never
reaches the server, PBKDF2-derived encryption) — but it's a passphrase-based
share link, not an account system. Whether that crypto model survives contact
with real user accounts, or gets replaced by something more conventional
(server-side encryption at rest, standard session auth), is one of the first
things to decide.

**Open questions:** see live discussion — not yet settled.

## Subsystem B — Multi-tenant data & storage

**Depends on:** A (an account has to exist before deciding what it owns).

**What exists today:** a working, tested, end-to-end-encrypted Supabase sync
backend (`suite/lib/sync/`) built for the personal-use sharing feature, with
real migrations already written (some not yet applied to a live project per
the audit). This is a real head start, not a from-scratch problem — the open
question is how much of its model (passphrase-derived keys, single-wedding
assumption) needs to change for multi-tenant use.

**Open questions:** not yet discussed.

## Subsystem C — Cadence/suite de-duplication

**Independent of the pivot** — worth fixing regardless of what else gets
decided, and more urgent once there are many tenants instead of one wedding.
`suite/apps/cadence/` is a hand-ported mirror of the standalone `cadence`
repo; the same bug has to be fixed twice, and already wasn't (see the audit).

**Open questions:** not yet discussed — likely resolves to picking one
canonical source (build-time import vs. retiring the standalone repo).

## Subsystem D — Tableaux's future

Decision already made: scar tissue is prunable. Still open: how much of
Tableaux survives as-is vs. gets rebuilt to match the other three apps'
TS/schema-validated pattern.

**Open questions:** not yet discussed.

## Subsystem E — Brigade's expanded scope

Decision already made: Brigade keeps building on Cadence's published day, but
grows beyond pure call-sheet generation.

**Open questions:** what the new tasks actually are — not yet discussed.

## Subsystem F — Onboarding, billing & legal at product scale

Not yet discussed. Depends on A (accounts exist) but doesn't block building
the core product — can trail behind.

## Subsystem G — Multi-tenant suite mechanics

Wedding switcher, per-tenant route/API isolation, rate limits, admin/support
tooling, account deletion/export (GDPR-style). Depends on A and B being
decided first. Not yet discussed.
