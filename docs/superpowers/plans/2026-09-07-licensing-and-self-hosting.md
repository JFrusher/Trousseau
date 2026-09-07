# Licensing and Self-Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the AGPL over the Trousseau application while leaving the
published `@jfrusher/trousseau` contract package permissive, and write a
self-hosting runbook that actually works on a fresh clone.

**Architecture:** No code changes. The repo root is simultaneously "the whole
project" and "the npm package", and those two now want different licences, so
`LICENSE` becomes a short notice pointing at `LICENSE-MIT` (the contract
package, which is what npm ships) and `LICENSE-AGPL` (the application in
`suite/`). `suite/package.json` gains an AGPL `license` field; the root's stays
MIT. The runbook is one new markdown file under `docs/`.

**Tech Stack:** Markdown and JSON. No dependencies, no code.

**Spec:** [docs/superpowers/specs/2026-09-02-onboarding-billing-legal-design.md](../specs/2026-09-02-onboarding-billing-legal-design.md)

## Global Constraints

- **No billing infrastructure, ever.** Structural, not deferred. Nothing in
  this plan adds a payment path, a tier, or a donation link.
- **No behaviour changes and no code changes.** The only non-documentation edit
  is a `license` field in `suite/package.json`.
- **The privacy/terms rewrite stays deferred**, exactly as the spec says. It is
  a writing task, the existing content is already structured and digest-tested,
  and no strangers' data is at stake yet. Do not touch `suite/lib/legal.ts` —
  changing one word there fails `legal.test.ts` until the date and digest move,
  which is the safeguard working, not an invitation.
- **No Docker.** Documentation, not tooling, per the spec.
- **The runbook must be true on a fresh clone.** Every command in it is run
  before it is written down. A runbook that looks right and fails is worse than
  none.

## Two decisions this plan makes that the spec did not

Both were settled with the maintainer before writing, and both change what the
spec literally says.

1. **The contract package stays MIT; only the application goes AGPL.** The spec
   says to update the `license` field in *every* `package.json`, root included.
   But the root package is `@jfrusher/trousseau`, published to npm, and the
   founding design says a fifth app "joins by depending on the package". AGPL is
   viral for anyone importing it, so AGPL there would mean nobody outside this
   repo can adopt the contract — fighting the ecosystem goal for no gain. The
   roadmap's stated reason for choosing AGPL (stopping a paid fork of the
   *hosted service*) is fully served by AGPL on the application alone.

2. **`LICENSE` becomes a notice, not a licence text.** Verified with
   `npm pack --dry-run`: npm force-includes a root `LICENSE` in the tarball
   **even though `files` is `["dist", "README.md"]`**. So the root licence file
   *is* the published package's licence. Making it AGPL would ship AGPL text
   inside a package whose `package.json` says MIT — self-contradictory, and
   worse than either licence alone. A notice naming both is accurate for the
   npm consumer and puts the AGPL in front of anyone landing at the repo root.

   Known cost, accepted: GitHub's licence auto-detection will read the notice
   and show "Other" rather than an AGPL badge.

## Verified before writing this plan

- `npm pack --dry-run` ships `LICENSE`, `README.md` and `dist/` — 15 files.
  `LICENSE` is included despite not being in `files`.
- The only third-party copyright in the tree is the SIL Open Font Licence for
  Lato, Marcellus and Parisienne (`suite/public/fonts/`,
  `suite/apps/plaque/assets/fonts/`). Those are fonts, separately licensed, and
  are unaffected by relicensing the code. **There is no third-party code**, so
  the spec's "sole copyright holder, mechanical" assumption holds.
- `suite/package.json` has **no** `license` field today.
- The canonical AGPL-3.0 text is 661 lines / 34,523 bytes, sha256
  `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`,
  fetched from `https://www.gnu.org/licenses/agpl-3.0.txt`.
- `suite/.env.example` is **stale**: it documents `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` only. `accountsConfigured()` in `suite/lib/env.ts`
  additionally requires `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, neither of which appears there. A runbook
  built from the current `.env.example` would produce an instance where
  accounts silently never work.
- There are seven migrations in `supabase/migrations/`, and they must be applied
  in filename order.
- `README.md` says "1,233 tests". The real number is 1,588.

## File Structure

| File | Responsibility |
|---|---|
| `LICENSE` | **Rewrite.** A short notice naming both licences and which covers what. Ships inside the npm tarball. |
| `LICENSE-MIT` | **Create.** The existing MIT text, verbatim, covering the contract package. |
| `LICENSE-AGPL` | **Create.** The verbatim GNU AGPL-3.0 text, covering the application. |
| `suite/package.json` | **Modify.** Add `"license": "AGPL-3.0-or-later"`. One line. |
| `README.md` | **Modify.** Rewrite the Licence section; correct the stale test count; link the runbook. |
| `suite/.env.example` | **Modify.** Add the two accounts variables it is missing. |
| `docs/SELF-HOSTING.md` | **Create.** The runbook. |

Root `package.json` is **not** modified — it stays MIT.

---

## Task 1: Split the licence

**Files:**
- Modify: `LICENSE`
- Create: `LICENSE-MIT`
- Create: `LICENSE-AGPL`
- Modify: `suite/package.json`

**Interfaces:** none — no code.

- [ ] **Step 1: Preserve the MIT text under its own name**

```bash
git mv LICENSE LICENSE-MIT
```

`LICENSE-MIT` now holds the existing MIT text unchanged, including the
`Copyright (c) 2026 Jacob Frusher` line. Do not edit it.

- [ ] **Step 2: Fetch the AGPL text**

```bash
curl -sS -o LICENSE-AGPL https://www.gnu.org/licenses/agpl-3.0.txt
```

Then verify it is the real thing and complete, rather than an error page:

```bash
sha256sum LICENSE-AGPL
wc -l LICENSE-AGPL
head -2 LICENSE-AGPL
```

Expected: sha256
`0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`,
661 lines, and a first line reading `GNU AFFERO GENERAL PUBLIC LICENSE`.

**If the hash differs, stop.** Either the fetch failed or gnu.org changed the
file; do not commit a licence you have not verified. Report it rather than
guessing.

- [ ] **Step 3: Write the root notice**

Create `LICENSE`:

```
Trousseau is released under two licences, because this repository holds two
different things.

  The contract package — @jfrusher/trousseau
  ------------------------------------------
  MIT. See LICENSE-MIT.

  This is the published npm package: the schemas and the file format that
  describe a wedding. It is deliberately permissive so that a tool nobody has
  written yet can depend on it, which is the entire point of the format
  existing. If you installed @jfrusher/trousseau from npm, this is the licence
  that applies to you, and you can stop reading here.

  The application — everything in suite/
  --------------------------------------
  GNU Affero General Public License v3.0 or later. See LICENSE-AGPL.

  This is Trousseau itself: the five tools, the shell, the sync and account
  layers. The AGPL is chosen deliberately. Trousseau is free and always will
  be, and the AGPL is what stops someone running a paid, closed fork of the
  hosted service against the intent of everyone who worked on the free one.
  Run it yourself, change it, host it for your friends — but if you host a
  modified version for others, they get the source too.

Fonts bundled under suite/public/fonts/ and suite/apps/plaque/assets/fonts/ are
licensed separately under the SIL Open Font License; see the OFL-*.txt files
beside them.

Copyright (c) 2026 Jacob Frusher
```

- [ ] **Step 4: Give the application its licence field**

In `suite/package.json`, add a `license` field immediately after `"version"`.
It has none today. The result should read:

```json
{
  "name": "suite",
  "version": "0.1.0",
  "license": "AGPL-3.0-or-later",
```

Leave the root `package.json` alone — it stays `"license": "MIT"`, and that is
the whole point of this task.

- [ ] **Step 5: Confirm the npm tarball is still coherent**

Run from the repo root: `npm pack --dry-run`
Expected: the tarball still contains `LICENSE`, `README.md` and `dist/`.
`LICENSE` is now the notice, which correctly tells an npm consumer the package
is MIT and points at `LICENSE-MIT`.

Note that `LICENSE-MIT` and `LICENSE-AGPL` are **not** in the tarball, because
`files` does not list them and npm only force-includes `LICENSE` itself. That
is a real wrinkle: the notice references a file the tarball does not carry.
Fix it by adding both to `files` in the root `package.json`:

```json
  "files": [
    "dist",
    "README.md",
    "LICENSE-MIT",
    "LICENSE-AGPL"
  ],
```

Then re-run `npm pack --dry-run` and confirm both now appear.

- [ ] **Step 6: Confirm nothing else broke**

Run from the repo root: `npm test`
Expected: PASS, 7 files / 98 tests. Nothing here touches code, so this only
confirms the workspace is healthy.

- [ ] **Step 7: Commit**

```bash
git add LICENSE LICENSE-MIT LICENSE-AGPL package.json suite/package.json
git commit -m "Put the AGPL over the application, and leave the contract package MIT"
```

---

## Task 2: Fix the environment example the runbook will point at

**Files:**
- Modify: `suite/.env.example`

**Interfaces:** none.

Done before the runbook, because the runbook tells people to copy this file. It
currently omits the two variables accounts need, so an instance built from it
would run with sign-in silently unavailable and no error explaining why.

- [ ] **Step 1: Add the accounts variables**

In `suite/.env.example`, immediately after the existing
`SUPABASE_SERVICE_ROLE_KEY=` line, add:

```sh

# Accounts and cloud storage. `accountsConfigured()` in lib/env.ts requires all
# three of SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL and
# NEXT_PUBLIC_SUPABASE_ANON_KEY. Set fewer than three and the account routes
# answer 501 and the sign-in page says accounts are not set up on this
# deployment — which is correct behaviour for a deliberately local-only
# instance, and baffling if you meant to enable accounts.
#
# NEXT_PUBLIC_SUPABASE_URL is the same value as SUPABASE_URL, duplicated under
# a NEXT_PUBLIC_ name because the browser bundle can only read variables with
# that prefix.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 2: Check the file against the real schema**

Read `suite/lib/env.ts` and confirm every variable it names appears in
`.env.example`, either set or commented. As of writing that is:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SYNC_IN_MEMORY`, `NEXT_PUBLIC_SENTRY_DSN`,
`CRON_SECRET`, `VERCEL_PROJECT_PRODUCTION_URL`.

`VERCEL_PROJECT_PRODUCTION_URL` is supplied by Vercel and is not something a
self-hoster sets; note that in the runbook rather than adding it here.

- [ ] **Step 3: Commit**

```bash
git add suite/.env.example
git commit -m "Document the account variables the example file was missing"
```

---

## Task 3: Write the self-hosting runbook

**Files:**
- Create: `docs/SELF-HOSTING.md`

**Interfaces:** none.

**Every command in this file must be run before it is written down.** The point
of the runbook is that it works on a fresh clone; a plausible-looking one that
fails is worse than nothing. Several of the steps below exist specifically
because they caught out the person writing this plan.

- [ ] **Step 1: Verify the build sequence from a clean state**

Before writing anything, confirm the order actually required. In a scratch
clone or worktree with no `node_modules`:

```bash
npm install            # repo root
npm run build          # root — builds dist/, which suite depends on
cd suite && npm install
npx next build
```

Confirm that skipping the root `npm run build` fails, and note the error. This
is the trap: `suite/package.json` depends on `"@jfrusher/trousseau": "file:.."`,
which resolves to the root's `dist/`, and `suite`'s own `dev` script does not
build it.

- [ ] **Step 2: Write the runbook**

Create `docs/SELF-HOSTING.md`:

````markdown
# Running your own Trousseau

Trousseau is free software and this is a genuinely supported way to use it, not
a theoretical one. Everything below was run on a fresh clone before it was
written down.

You need this only if you want accounts, sync between devices, or the guest
seat links. **If you just want to plan a wedding on one machine, you do not
need any of this** — clone it, `npm install`, `npm run dev`, and the whole
suite works with no account and no backend, exactly as it does hosted.

## What you are running

Two pieces, licensed differently (see `LICENSE`):

- The **application** in `suite/` — a Next.js app. AGPL-3.0-or-later. If you
  host a modified version for other people, they are entitled to your source.
- The **contract package** at the repo root, published as
  `@jfrusher/trousseau`. MIT. It is the schemas and the file format.

## Requirements

- Node 20 or newer (`"engines": { "node": ">=20" }`).
- A Supabase project, if you want accounts, sync or guest links. Free tier is
  enough for a wedding.
- Nothing else. There is no Docker image, on purpose — the setup is small
  enough that a container would be a second thing to maintain rather than a
  simplification.

## 1. Clone and build

The order matters, and getting it wrong is the most common way to fail:

```sh
git clone <your fork or this repo>
cd Trousseau

npm install          # the contract package's dependencies
npm run build        # builds dist/ — do not skip this

cd suite
npm install
```

**Why `npm run build` first.** `suite/package.json` depends on
`"@jfrusher/trousseau": "file:.."`, which resolves to the root's `dist/`
directory. That directory does not exist in a fresh clone, and `suite`'s `dev`
script does not create it — only `suite`'s `build` script does. Skip the root
build and `npm run dev` fails to resolve the contract package with an error
that does not mention any of this.

## 2. Run it locally, with no backend at all

```sh
cd suite
npm run dev
```

Open http://localhost:3000. Everything works: seating, the timeline, place
cards, delegation, group shots. There is no account, nothing leaves the
browser, and the wedding is stored in IndexedDB.

Stop here if that is all you want.

## 3. Add a backend

Copy the example and fill it in:

```sh
cd suite
cp .env.example .env.local
```

`.env.local` is gitignored. The variables:

| Variable | Needed for | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | sync, accounts | Your project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | sync, accounts | Server-side only. Never expose it to the browser. |
| `NEXT_PUBLIC_SUPABASE_URL` | accounts | The same value as `SUPABASE_URL`. Duplicated because the browser bundle can only read `NEXT_PUBLIC_`-prefixed variables. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | accounts | The anon/publishable key. Safe in the browser; row-level security is what protects the data. |
| `CRON_SECRET` | the retention sweep | At least 16 characters. Unset means the sweep endpoint refuses everything. |
| `NEXT_PUBLIC_SENTRY_DSN` | error reporting | Optional. Unset means no Sentry anywhere. |

Two things that will catch you out:

- **`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both-or-neither.** Half
  of the pair fails the build rather than starting a half-working instance.
- **Accounts need all three of `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY.`** With fewer, sign-in reports "accounts are
  not set up on this deployment" — which is the correct answer for a
  deliberately local-only instance, and confusing if you meant to enable them.

## 4. Apply the migrations

In filename order — later ones depend on earlier ones:

```
supabase/migrations/
  20260830000001_suite_sync.sql
  20260830000002_suite_sync_fixes.sql
  20260901000001_delete_wedding.sql
  20260901000002_retention.sql
  20260901000003_storage_budget.sql
  20260902000001_accounts.sql
  20260903000001_wedding_documents.sql
```

Either paste each into Supabase's SQL editor in that order, or use the Supabase
CLI (`supabase db push`) if you have the project linked.

These create the sync tables, the account and membership tables with their
row-level security policies, and the per-wedding document store. The RLS
policies are what make one couple unable to read another's wedding, so applying
them is not optional.

## 5. Build and start

```sh
cd suite
npm run build     # runs the root build first, then next build
npm start
```

`suite`'s `build` script is `npm --prefix .. run build && next build`, so it
handles the contract package for you — unlike `dev`.

## 6. Check it actually works

Do not trust a clean build. Confirm the instance behaves:

```sh
cd suite
npx vitest run          # every project: expect 1,588 tests passing
npx tsc --noEmit        # expect no errors
```

If `tsc` reports `Cannot find name 'LayoutProps'`, that is not a real error:
`LayoutProps` is generated by Next into `.next/types`, which does not exist
until something has been built. Run `npx next build` once and re-run.

Then, in the browser:

1. Open the app. The five tools load and you can add a guest. *(Local storage
   works.)*
2. Go to `/account` and sign in with a magic link. *(Accounts and email work.)*
3. Add a guest, reload. It is still there. *(Cloud sync works.)*
4. From `/account`, click **Download my wedding**. You get a
   `.trousseau.json` file. *(The document store and export work.)*

If step 2 says accounts are not set up, revisit section 3 — it is almost always
`NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing.

## 7. Deploy it somewhere

The hosted instance runs on Vercel with **Root Directory** set to `suite`, and
that is the least surprising option. Any host that can run a Next.js app works;
set the same environment variables there.

`VERCEL_PROJECT_PRODUCTION_URL` is supplied by Vercel automatically and used to
build absolute URLs for magic links and guest links. On another host you may
need to provide an equivalent — check `originOf()` in `suite/lib/env.ts`.

## Keeping up with changes

Migrations are additive and applied in filename order. When you pull, apply any
migration files you have not already run, then rebuild.

## If you get stuck

There is no support desk and no admin access to your data — by design, nobody
running the hosted instance can read a couple's wedding either. Open an issue
with what you did and what happened. Do not paste your guest list.
````

- [ ] **Step 3: Run every command in the runbook**

Go through the file and actually execute each command block in this worktree:
the build sequence, `npm run build`, `npx vitest run`, `npx tsc --noEmit`,
`npx next build`. Correct the runbook wherever reality disagrees with it —
including the test count, which changes as the suite grows.

- [ ] **Step 4: Commit**

```bash
git add docs/SELF-HOSTING.md
git commit -m "Write a self-hosting runbook that works on a fresh clone"
```

---

## Task 4: Bring the README into line

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Rewrite the Licence section**

Replace the existing section at the end of `README.md`:

```markdown
## Licence

Two licences, because this repository holds two things.

The **application** — everything in `suite/` — is
[AGPL-3.0-or-later](LICENSE-AGPL). Trousseau is free and always will be. The
AGPL is what keeps it that way: run it yourself, change it, host it for
friends, but host a modified version for other people and they get the source
too.

The **contract package**, `@jfrusher/trousseau`, is [MIT](LICENSE-MIT). It is
the schemas and the file format, kept permissive on purpose so a tool nobody
has written yet can depend on it.

Fonts are under the SIL Open Font Licence; see the `OFL-*.txt` files beside
them.

There is no paid tier and never will be. That is the reason this exists.
```

- [ ] **Step 2: Correct the stale test count**

`README.md`'s "Running it" section says `npm test # 1,233 tests`. Run
`npx vitest run` from `suite/` and use the real number.

- [ ] **Step 3: Link the runbook from "Deploying"**

At the end of the `### Deploying` section, add:

```markdown
Running your own instance — environment variables, migrations, and how to check
it works — is in [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Point the README at both licences and the self-hosting runbook"
```

---

## Task 5: Full regression check

**Files:** none created or modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Confirm no code changed**

Run: `git diff --stat main -- suite/lib suite/app suite/components suite/apps src`
Expected: empty. This subsystem changes documentation, two `package.json` files
and one `.env.example`. If a source file appears here, something went wrong.

- [ ] **Step 2: Confirm the legal content was not touched**

Run: `git diff main -- suite/lib/legal.ts`
Expected: empty. The privacy/terms rewrite is deferred, and `legal.test.ts`
would fail if the text moved without its digest.

- [ ] **Step 3: Run every project**

Run from `suite/`: `npx vitest run`
Expected: PASS, no failures. Includes `legal.test.ts`, which proves the policy
digests still match.

- [ ] **Step 4: Run the contract package's tests**

Run from the repo root: `npm test`
Expected: PASS, 7 files / 98 tests.

- [ ] **Step 5: Type-check and build**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json` then `npx next build`
Expected: both clean.

- [ ] **Step 6: Confirm the package still packs correctly**

Run from the repo root: `npm pack --dry-run`
Expected: `LICENSE`, `LICENSE-MIT`, `LICENSE-AGPL`, `README.md` and `dist/`
all present, and the root `package.json` still declares `"license": "MIT"`.

- [ ] **Step 7: Nothing to commit**

A gate, not a change. If everything passed, the branch is ready for review.
