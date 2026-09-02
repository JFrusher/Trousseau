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

**This will always be free and open source.** Freemium was explicitly the
thing this project exists to not be — no paywalled tiers, no upsells on
someone's wedding. This is a load-bearing decision, not a placeholder: it
rules out billing infrastructure as a subsystem entirely, and puts real
weight on hosting-cost sustainability and licensing as open questions
instead (see subsystem F).

## Subsystem map

| # | Subsystem | Depends on | Status |
|---|---|---|---|
| A | Identity & accounts | — | ✅ [spec written](superpowers/specs/2026-09-02-identity-accounts-design.md) |
| B | Multi-tenant data & storage | A | ✅ [spec written](superpowers/specs/2026-09-02-multitenant-storage-design.md) |
| C | Cadence/suite de-duplication | — | ✅ [spec written](superpowers/specs/2026-09-02-cadence-deduplication-design.md), execution blocked on `gh` access |
| D | Tableaux's future | — | 🟢 core decisions made, spec not yet written |
| E | Brigade's expanded scope | (loosely) A, B | 🟡 direction set, needs its own decomposition |
| F | Onboarding, billing & legal at product scale | A | 🟢 core decisions made, spec not yet written |
| G | Multi-tenant suite mechanics | A, B | 🟢 core decisions made, spec not yet written |

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
- **2026-09-02** — Auth: Supabase Auth (already the vendor for the sync/
  sharing backend — no new provider).
- **2026-09-02** — Account model: two accounts per wedding. Whoever signs up
  first creates the wedding and invites their partner. Not a shared login.
- **2026-09-02** — Roles: couple-only for now. Guests stay link-based (no
  login, as today via `/seat/[token]`); vendors/crew stay link/PDF-based via
  Brigade, no logins for either in this phase.
- **2026-09-02** — Sign-in: email + magic link, no passwords, no social login
  for now.
- **2026-09-02** — Encryption: standard server-side encryption at rest +
  Postgres RLS, not true E2E. The current `/seat/[token]` E2E model is being
  left behind for regular account data — it can stay as-is for the guest
  share-link feature specifically if that still makes sense once B is
  designed in full, but it is not the model for a wedding's own data.
- **2026-09-02** — Storage shape: one JSON document per wedding, stored as
  Postgres JSONB, matching the existing zod contract package. Not normalized
  into per-domain relational tables.
- **2026-09-02** — Concurrency: compare-and-set conflict detection (reusing
  the existing pattern from the sync backend) with a "someone else edited
  this, refresh and reapply" notice on conflict. Not real-time collaborative
  editing, not slice-level locking.
- **2026-09-02** — Cadence de-duplication: retire the standalone `cadence`
  repo's role as a place development happens — `suite/apps/cadence` becomes
  the one canonical source. The standalone repo is **archived (via `gh`),
  never fully deleted** — this is a general policy for all the formerly-
  standalone repos (Plaque, Cadence, Brigade, Tableaux each has one), not
  Cadence-specific: history is kept, but nobody develops against it again.
- **2026-09-02** — Tableaux: full rewrite to TypeScript, matching the pattern
  the other three apps already use. Justified by both the audit's
  schema-drift finding and subsystem B's storage rework touching Tableaux's
  data layer regardless — one rewrite instead of a patch now and a rewrite
  later.
- **2026-09-02** — Business model: always free and open source. No
  freemium, no paid tiers — explicitly the reason this project exists.
- **2026-09-02** — Hosting sustainability: hybrid — a maintainer-run hosted
  instance as the default for most users, self-hosting documented and
  genuinely supported as a secondary path (not just theoretically possible).
- **2026-09-02** — License: AGPL (currently MIT at the root — reconciling
  this is an open item under subsystem F).
- **2026-09-02** — Accounts-to-weddings: one active wedding per account for
  v1, no switcher UI. Additive-safe — can extend to multiple weddings per
  account later without redesigning the model.

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

**Decided:** Supabase Auth; two accounts per wedding via partner invite (not
a shared login); couple-only roles for now (guests and vendors/crew stay
link-based, no logins); email + magic-link sign-in, no passwords, no social
login for now.

**Spec written:** [`2026-09-02-identity-accounts-design.md`](superpowers/specs/2026-09-02-identity-accounts-design.md)
— one-click invite via emailed link (locked to the invited email, rejects a
mismatched signer), no separate email verification, long-lived sessions, and
wedding survives account deletion as long as one member remains. Ready for
an implementation plan.

## Subsystem B — Multi-tenant data & storage

**Depends on:** A (an account has to exist before deciding what it owns).

**What exists today:** a working, tested, end-to-end-encrypted Supabase sync
backend (`suite/lib/sync/`) built for the personal-use sharing feature, with
real migrations already written (some not yet applied to a live project per
the audit). This is a real head start, not a from-scratch problem — the open
question is how much of its model (passphrase-derived keys, single-wedding
assumption) needs to change for multi-tenant use.

**Decided:** standard server-side encryption + Postgres RLS (not E2E for
regular wedding data — the existing E2E model may still suit the guest
share-link feature specifically, revisit when this is designed in full); one
JSON document per wedding stored as JSONB, matching the existing zod
contract; compare-and-set conflict detection with a refresh-and-reapply
notice, not real-time collaboration.

**Spec written:** [`2026-09-02-multitenant-storage-design.md`](superpowers/specs/2026-09-02-multitenant-storage-design.md)
— `wedding_documents` + append-only `wedding_document_history` (the DVC
version-history replacement), CAS-gated write path that also runs the
ported `validate-wedding.mjs` as a hard gate (errors block, warnings don't),
local storage demoted to an offline cache with queued-write replay, and the
existing E2E `suite/lib/sync/` backend left untouched, scoped to
`/seat/[token]` only. Ready for an implementation plan.

## Subsystem C — Cadence/suite de-duplication

**Independent of the pivot** — worth fixing regardless of what else gets
decided, and more urgent once there are many tenants instead of one wedding.
`suite/apps/cadence/` is a hand-ported mirror of the standalone `cadence`
repo; the same bug has to be fixed twice, and already wasn't (see the audit).

**Decided:** `suite/apps/cadence` becomes canonical; the standalone `cadence`
repo is archived via `gh` (not deleted) once its content is confirmed fully
absorbed. Same policy applies to the other three apps' standalone repo
histories.

**Spec written:** [`2026-09-02-cadence-deduplication-design.md`](superpowers/specs/2026-09-02-cadence-deduplication-design.md)
— verified via git log comparison that the standalone `cadence` repo has no
unported commits as of now, safe to archive. Execution is blocked on `gh`
CLI access on this machine (or use the GitHub web UI instead — either
works). The other three standalone repos get their own drift check in a
later pass, not this one.

## Subsystem D — Tableaux's future

**Decided:** full rewrite to TypeScript, matching the other three apps'
schema-validated pattern. Not a patch-in-place, not a deferral.

**Still open:** how much of the current JS implementation's logic ports
directly (the CSV parser and warnings engine both look solid per the audit)
vs. gets redesigned; sequencing against subsystem B's storage rework, since
they touch the same data layer. Deferred to the dated spec.

## Subsystem E — Brigade's expanded scope

**Decided:** Brigade keeps building on Cadence's published day, and grows
into four new areas: vendor/contract management (deposits, payment due
dates, contact history), budget tracking (per-vendor cost vs. overall
budget), general task/checklist management (not tied to a Cadence block —
"book florist by March"), and a vendor-facing communication/portal (send job
sheets/timelines directly, track confirmation, not just PDF export).

**Still open:** this is four substantial features, not one — it needs its
own decomposition and sequencing pass (likely its own set of dated specs,
one per area) rather than a single design. Budget tracking and vendor
management look most naturally paired; the communication portal likely
depends on subsystem A/B (vendors need *some* way to receive/view things,
even if not full accounts) and should probably come last. Not yet sequenced.

## Subsystem F — Onboarding, billing & legal at product scale

**Decided:** always free, open source, no freemium — this was explicitly the
point of building it. No billing infrastructure, no paid tiers, ever.
Hosting: a maintainer-run hosted instance is the default experience for most
users, with self-hosting documented and supported as a real (secondary)
path — not just theoretically possible. License: AGPL, specifically so a
paid fork of the hosted service can't undercut the free-forever intent (the
root contract package is currently MIT — needs reconciling, see open
questions).

**Still open:** the MIT-to-AGPL relicensing mechanics for existing code (the
maintainer is sole copyright holder, so straightforward, but needs doing
deliberately rather than assumed); what self-hosting setup actually requires
(env var docs, a setup wizard, a `docker-compose` file?); real
privacy/terms content for a multi-tenant product (the current pages were
written for one wedding); whether donations/sponsorship is worth setting up
now or later. Deferred to the dated spec.

## Subsystem G — Multi-tenant suite mechanics

Wedding switcher, per-tenant route/API isolation, rate limits, admin/support
tooling, account deletion/export (GDPR-style). Depends on A and B.

**Decided:** one active wedding per account for v1 — no wedding-switcher UI
yet. Kept additive-safe: multi-wedding-per-account can be layered on later
without a redesign, since it's a superset of the one-wedding case, not a
different shape.

**Still open:** per-tenant rate limiting shape (the existing `seat/[token]`
limiter is explicitly known to not scale past in-memory/per-instance — does
the same limitation apply here, and does it matter sooner given real
signups?), admin/support tooling (does the maintainer need a way to look at
a couple's wedding for support purposes, and if standard encryption/RLS
means the server *can* read it, what's the access-control/audit story for
that), account deletion/export, and how self-hosting (subsystem F) changes
any of this — a self-hosted instance is inherently single- or
few-tenant, so multi-tenant mechanics may only fully apply to the
maintainer-run hosted instance. Deferred to the dated spec.
