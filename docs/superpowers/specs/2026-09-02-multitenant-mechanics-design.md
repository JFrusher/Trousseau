# Trousseau — multi-tenant suite mechanics

Date: 2026-09-02
Status: approved, ready for implementation planning
Scope: subsystem G of `docs/PRODUCT-ROADMAP.md`. Depends on subsystem A
(identity & accounts) and subsystem B (multi-tenant storage) — this is the
layer that makes the hosted suite behave correctly with many tenants
instead of one.

## Why

Subsystems A and B establish who owns a wedding and where its data lives.
This subsystem covers what's left specifically because there are now many
tenants on one running instance: support access to user data, rate
limiting on the real write path, account/data lifecycle beyond what A
already specified, and the reminder that most of this only applies to the
maintainer-run hosted instance at all.

## Decisions

**Account-to-wedding mapping:** one active wedding per account for v1. No
wedding-switcher UI. This is additive-safe — a superset (multiple weddings
per account) can be layered on later without redesigning the model, since
nothing here assumes an account can only ever have one membership row.

**Support access: none, by design.** The maintainer has no built-in path to
view a couple's wedding data. Support works the way it does for most small
open-source projects: the user shares what they need to (a screenshot, an
exported file — see Data export, below) when asking for help. This is
simpler to build, simpler to reason about, and more private by default than
building and maintaining an audited admin-access path — and matches the
project's actual scale (one maintainer, not a support team). Revisit only
if this genuinely becomes a blocker for helping real users.

**Rate limiting: reuse the existing in-memory limiter.** The account/wedding
write path (subsystem B) uses the same per-serverless-instance in-memory
limiter already built for `/seat/[token]`, with the same disclosed ceiling.
This is the project's existing honest-and-simple pattern — upgrade to a
shared Postgres/Redis-backed limiter only if real usage actually approaches
that ceiling, not preemptively.

**Data export: yes, from day one.** A couple can download their full
wedding document as a real file. This reuses the existing `bundle.mjs`
pack/unpack shape almost directly — the wedding document already *is* the
`.trousseau.json` format those scripts work with; exposing "download my
wedding" as an authenticated API route that returns `wedding_documents.document`
for the caller's own wedding (RLS already scopes this correctly) is a small
addition, not new architecture. This doubles as: a backup path, a way to
move from the hosted instance to a self-hosted one, and a concrete answer
to "can I get my data out" that a real product needs regardless of legal
requirements.

**Account deletion/export beyond A's scope:** subsystem A already specifies
the membership cascade (wedding survives if a partner remains, is deleted
if the last member leaves). This subsystem adds nothing further here —
"delete my account" and "export my wedding" are the two real actions a user
needs, and both are now covered.

**Self-hosting interaction:** a self-hosted instance is inherently
single-tenant or few-tenant by nature of who'd run one. Most of this
subsystem — the shared in-memory rate limiter, the "no admin access"
posture — is really about the maintainer-run *hosted* instance
specifically. Someone self-hosting is, by definition, already able to see
their own instance's data directly (it's their database), so the
support-access question doesn't even apply the same way. No special
self-host-specific mechanics are needed beyond what subsystem F's
documentation already covers.

## Testing

- Data export test: an authenticated request returns exactly the caller's
  own wedding's document (RLS-scoped, same pattern as every other
  read/write in subsystem B) and nothing else — including a negative test
  that a user cannot export a wedding they don't belong to.
- Rate limiter tests: existing `/seat/[token]` limiter tests continue to
  cover the shared implementation; no new limiter logic is introduced here.

## Explicitly deferred (not decided here)

- Audited admin access — explicitly rejected for now, revisit only if
  support need genuinely demands it later.
- A shared (non-in-memory) rate limiter — revisit only if real usage
  approaches the disclosed ceiling.
- Multi-wedding-per-account and any wedding-switcher UI — deliberately kept
  additive for a future pass, not designed here.
