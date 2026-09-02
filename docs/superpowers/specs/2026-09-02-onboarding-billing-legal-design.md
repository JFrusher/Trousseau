# Trousseau — onboarding, billing & legal at product scale

Date: 2026-09-02
Status: approved, ready for implementation planning
Scope: subsystem F of `docs/PRODUCT-ROADMAP.md`. Depends on subsystem A
(accounts must exist) but doesn't block core product work — can trail
behind A/B/C/D shipping.

## Why

Moving from one wedding to real couples changes what "legal" and "billing"
mean here — but the project's founding decision (always free, open source,
no freemium — see `docs/PRODUCT-ROADMAP.md`'s Vision section) removes most
of what this subsystem would normally have to design. There is no pricing
model, no payment processor, no subscription lifecycle to build. What's
left is smaller: licensing, self-hosting as a real path, and legal content
that currently says "written for our wedding."

## Decisions this builds on

- Always free, open source, AGPL (chosen specifically so a paid fork of the
  hosted service can't undercut the free-forever intent).
- Hybrid sustainability: a maintainer-run hosted instance is the default,
  self-hosting is documented and genuinely supported as a secondary path.
- No billing infrastructure, ever — this is not deferred, it's structural.

## Scope of this subsystem

**1. Relicensing MIT → AGPL.** The root `@jfrusher/trousseau` contract
package is currently MIT. The maintainer is sole copyright holder, so this
is mechanical, not legally complex: update `LICENSE`, update the `license`
field in every `package.json` (root and `suite/`), and add a note in the
README about the license change and why (matching this project's habit of
explaining decisions rather than just making them). No CLA or contributor
tracking is needed since there's currently exactly one contributor.

**2. Self-hosting: documentation, not tooling.** No Docker Compose file, no
setup wizard — a thorough markdown runbook covering: cloning the repo,
`npm install`, the full list of required environment variables (Supabase
project URL/keys, any auth config), running the build (`npm run build -w
suite`, noting the root-package-first coupling already documented for the
hosted path), and starting it. This is a smaller lift than a
container-based setup and matches the project's existing documentation
style (the current README already explains *why*, not just *how* — this
runbook continues that). Revisit a Docker-based path later only if the
documentation route proves to be a real barrier for someone who tried it.

**3. Real privacy/terms content.** `suite/app/privacy` and `suite/app/terms`
currently hold real, structured, digest-tested content (per the audit,
unusually rigorous already) — but written for a single wedding's data, not
a multi-tenant product handling strangers' guest lists, dietary information,
and now real account/auth data. This needs a genuine content rewrite (not
an architecture decision) covering: what account data is collected and why,
how self-hosting changes who's actually responsible for a given instance's
data, and standard obligations around a real user's ability to delete their
account and data (ties to subsystem G). This content itself is out of scope
for this spec — it's a writing task, flagged here so it isn't forgotten
before real strangers' data is involved.

**4. Donations/sponsorship: explicitly deferred.** No GitHub
Sponsors/Ko-fi link now. Revisit once there's a real hosted user base and
real hosting cost to offset — setting this up before anyone's using the
product is solving a problem that doesn't exist yet.

## Testing

- The existing `lib/legal.test.ts` digest-test pattern (fails if
  privacy/terms text changes without the `updated` date moving) continues
  to apply to the rewritten content — this is a good existing safeguard,
  not something this subsystem changes.
- No new billing/payment tests, because there is no billing/payment code.

## Explicitly deferred (not decided here)

- Donations/sponsorship setup — revisit once real usage exists.
- A Docker-based self-host path — only if the documentation-only route
  proves insufficient in practice.
- The actual privacy/terms content rewrite — a writing task, not an
  architecture one; tracked here so it happens before real users' data is
  at stake, not designed here.
