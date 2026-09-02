# Trousseau — Cadence/suite de-duplication

Date: 2026-09-02
Status: verified, ready to execute (blocked on `gh` CLI access — see below)
Scope: subsystem C of `docs/PRODUCT-ROADMAP.md`. Independent of the
couples-product pivot itself — worth doing regardless, and more urgent once
there are many tenants instead of one wedding.

## Why

`suite/apps/cadence/` was a hand-ported mirror of the standalone `cadence`
repo, kept in sync by hand, one fix at a time. This already caused a real
bug: the printed timeline drift fix (see
`docs/superpowers/specs/2026-09-02-trousseau-architecture-audit.md`) had to
land twice, and for a period today the two copies silently disagreed with
no signal anything was wrong. Every future Cadence fix carries the same
risk as long as two copies exist.

## Verification performed

Checked whether the standalone `cadence` repo has any commit not reflected
in `suite/apps/cadence`, per the decided lighter-weight check (git log
comparison, not a full file diff):

- Standalone `cadence`'s full history (`git log --oneline --all`), newest
  first: `c6a2da0`, `a9a8386`, `20b5853`, `9bc9cbe` (merge), `f82c2f8`
  (lockfile-only chore), `9817150` (the vertical-timeline feature), then
  seven earlier commits predating that feature.
- Trousseau's history touching `suite/apps/cadence`: `53e599c` ("Port: stop
  the timeline drifting..."), `73ddfb5` ("Port: stop inflating short
  blocks'..."), `a264fa7` ("Port Cadence's printed-timeline overflow fix"),
  `25d7989` ("Bring Cadence's vertical timeline into the suite"), `eb57812`,
  `7d72891` ("Put the four apps back, then make them one product" — the
  original four-app import).

Every content-bearing standalone commit after the vertical-timeline feature
maps one-to-one to a port commit: `c6a2da0`→`53e599c`, `a9a8386`→`73ddfb5`,
`20b5853`→`a264fa7`. The lockfile-only commit needs no port (Trousseau
manages its own dependencies separately). Everything before the
vertical-timeline feature was captured by the original import (`7d72891`),
with `25d7989` specifically bringing the vertical-timeline feature itself
across afterward.

**Conclusion: the standalone `cadence` repo has no unported work as of this
check. Safe to archive.**

## Action plan

1. Archive the standalone `cadence` repo via `gh repo archive JFrusher/cadence`
   (GitHub's archive feature — read-only, not deleted, exactly the decided
   policy). **Blocked:** `gh` CLI is not installed on this machine (confirmed
   this session — `gh: command not found`). Either install it, or perform
   the equivalent action via the GitHub web UI (repo Settings → Danger Zone
   → Archive this repository) — functionally identical, no CLI required.
2. Add a note to the standalone repo's README (before archiving, since an
   archived repo can still be edited up to the point of archiving, but not
   after) pointing future readers to `suite/apps/cadence` in Trousseau as
   the live location.
3. Update `docs/PRODUCT-ROADMAP.md`'s subsystem C entry once archived.

## Explicitly deferred (not decided here)

- The same check for Plaque, Brigade, and Tableaux's standalone repos — the
  roadmap decision was to check Cadence only in this pass, since it's the
  one with a proven, active drift problem. Each of the other three should
  get the same treatment in its own pass before being archived.
- Whether `gh` gets installed on this machine or the web UI is used instead
  — either satisfies the same policy; this is a tooling choice, not a
  design decision.
