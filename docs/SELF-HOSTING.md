# Running your own Trousseau

Trousseau is free software and this is a genuinely supported way to use it, not
a theoretical one. Every command below was run on a fresh clone before it was
written down.

You need this only if you want accounts, sync between devices, or the guest
seat links. **If you just want to plan a wedding on one machine, you do not
need any of this** — clone it, install, `npm run dev`, and the whole suite
works with no account and no backend, exactly as it does hosted.

## What you are running

Two pieces, licensed differently (see [`LICENSE`](../LICENSE)):

- The **application** in `suite/` — a Next.js app. AGPL-3.0-or-later. If you
  host a modified version for other people, they are entitled to your source.
- The **contract package** at the repo root, published as
  `@jfrusher/trousseau`. MIT. It is the schemas and the file format.

## Requirements

- Node 20 or newer (`"engines": { "node": ">=20" }`).
- A Supabase project, if you want accounts, sync or guest links. The free tier
  is enough for a wedding.
- Nothing else. There is no Docker image, on purpose — the setup is small
  enough that a container would be a second thing to maintain rather than a
  simplification.

## 1. Clone and build

**The order matters, and getting it wrong is the most common way to fail:**

```sh
git clone <your fork, or this repo>
cd Trousseau

npm install          # the contract package's dependencies
npm run build        # builds dist/ — do not skip this

cd suite
npm install
```

### Why `npm run build` comes first

`suite/package.json` depends on `"@jfrusher/trousseau": "file:.."`, which
resolves to the root's `dist/` directory. A fresh clone has no `dist/`, and
`npm install` does not create one — only `npm run build` does.

Skip it and `suite`'s install still succeeds, which is the trap. The failure
arrives later, and does not mention any of the above:

```
Error: Turbopack build failed with 4 errors:
Error: Module not found: Can't resolve '@jfrusher/trousseau'
```

If you see that, you are in the right place: run `npm run build` in the repo
root and try again.

## 2. Run it locally, with no backend at all

```sh
cd suite
npm run dev
```

Open <http://localhost:3000>. Everything works: seating, the timeline, place
cards, delegation, group shots. There is no account, nothing leaves the
browser, and the wedding lives in IndexedDB.

Stop here if that is all you want.

## 3. Add a backend

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
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | accounts | The anon/publishable key. Safe in the browser — row-level security is what protects the data. |
| `CRON_SECRET` | the retention sweep | At least 16 characters. Unset means the sweep endpoint refuses everything, including your scheduler. |
| `NEXT_PUBLIC_SENTRY_DSN` | error reporting | Optional. Unset means no Sentry, browser or server. |

Two things that will catch you out:

- **`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both-or-neither.** Half
  the pair fails the build rather than starting a half-working instance.
- **Accounts need all three of `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.** With fewer, sign-in reports "accounts are
  not set up on this deployment" — the correct answer for a deliberately
  local-only instance, and thoroughly confusing if you meant to enable them.

`VERCEL_PROJECT_PRODUCTION_URL` also appears in the schema. Vercel supplies it
automatically and it is used to build absolute URLs for magic links and guest
links. On another host you may need an equivalent — see `originOf()` in
`suite/lib/env.ts`.

## 4. Apply the migrations

In filename order. Later ones depend on earlier ones:

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
CLI (`supabase db push`) with the project linked.

These create the sync tables, the account and membership tables with their
row-level security policies, and the per-wedding document store. **The RLS
policies are what make one couple unable to read another's wedding**, so
applying them is not optional.

## 5. Build and start

```sh
cd suite
npm run build     # runs the root build first, then next build
npm start
```

`suite`'s `build` script is `npm --prefix .. run build && next build`, so it
handles the contract package for you — unlike `dev`, which is why section 1
tells you to build the root by hand.

## 6. Check it actually works

A clean build is not proof. Confirm the instance behaves:

```sh
cd suite
npx vitest run          # every project — 1,588 tests at the time of writing
npx tsc --noEmit        # no errors
```

If `tsc` reports `Cannot find name 'LayoutProps'`, that is not a real error.
`LayoutProps` is generated by Next into `.next/types`, which is gitignored and
does not exist until something has been built. Run `npx next build` once and
re-run the check.

Then, in the browser:

1. Open the app. The five tools load and you can add a guest.
   *(Local storage works.)*
2. Go to `/account` and sign in with a magic link.
   *(Accounts and email work.)*
3. Add a guest, then reload. It is still there.
   *(Cloud sync works.)*
4. From `/account`, choose **Download my wedding**. You get a
   `.trousseau.json` file.
   *(The document store and the export path work.)*

If step 2 says accounts are not set up, go back to section 3 — it is almost
always `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing.

## 7. Deploy it somewhere

The hosted instance runs on Vercel with **Root Directory** set to `suite`, and
that is the least surprising option. Any host that can run a Next.js app will
do; set the same environment variables there.

## Keeping up with changes

Migrations are additive and applied in filename order. When you pull, apply any
migration files you have not already run, then rebuild.

## If you get stuck

There is no support desk, and there is no admin access to your data — by
design, nobody running the hosted instance can read a couple's wedding either.
Open an issue with what you did and what happened.

**Do not paste your guest list into an issue.**
