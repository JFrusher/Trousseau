# Trousseau — from here to hosted

A runbook. Follow it top to bottom; each stage ends with something you can check
before moving on.

Roughly 40 minutes, most of it waiting for Vercel.

**Where things stand right now:** the suite is written, tested and building, on
branch `suite` in `JFrusher/Trousseau`, uncommitted. No Supabase project exists.
Nothing is deployed.

---

## 0. What you need

| | |
|---|---|
| Node | **20 or newer** (`node -v`) — the sync handlers use `crypto.subtle`, which is stable from 19 |
| Python + DVC | Only on machines that **commit** to this repo — see §2 |
| A GitHub account | The repo is already at `JFrusher/Trousseau` |
| A Vercel account | Free tier is enough |
| A Supabase account | Free tier is enough. **Only needed for sharing** — see §3 |

**You can stop after §2 and have a working app.** Everything except publishing a
guest link and syncing between two machines works with no backend at all. §3
onwards is what makes those two work.

---

## 1. Check it builds here first

```sh
cd C:/Projects/Trousseau
npm install                # installs the workspace: root package + suite
npm test                   # 87 — the data contract
npm test  -w suite         # 703 — the application
npm run build -w suite     # compiles the contract, then Next
```

**Checkpoint.** All three pass, and the build prints nine routes ending in
`/seat/[token]` and `/api/sync/[...route]`.

If `npm test -w suite` cannot find `tsc` or the contract package, run
`npm install` from the **repo root**, not from `suite/`. The root is the npm
workspace; installing from inside the workspace member is what usually goes
wrong here.

---

## 2. Commit and push the branch

### The hooks will stop you first

This repo sets `core.hooksPath = .githooks`, and both `pre-commit` and
`pre-push` end in `python -m dvc git-hook …`. Without DVC installed, **every
commit fails**, and the error will not obviously say why.

```sh
python -m dvc --version      # expect 3.x
```

If that fails: `pip install dvc`. Do not reach for `--no-verify` — the same
hooks are what stop an inconsistent wedding file being committed, and you want
them working.

### Commit

```sh
git add suite supabase package.json package-lock.json scripts
git commit -m "Bring the four apps onto one document, and host it"
git push -u origin suite
```

That `add` list is everything the deploy needs. It deliberately leaves out
`scratch/`, which is untracked working notes — **including this file**. If you
want the runbook in the repo, move it somewhere tracked:

```sh
git mv scratch/docs/SETUP.md docs/SETUP.md    # or: cp, if you want both
git add docs/SETUP.md
```

### Which branch, and when

**Vercel deploys the default branch to production**, and builds every *other*
branch as a preview. That gives you a choice about ordering, and the safer one
is not the obvious one:

- **Import to Vercel while the work is still on a branch.** It builds a preview.
  You get to prove the Root Directory setting and the environment variables
  against a real Linux build before `main` claims any of it works.
- **Then** fast-forward `main`, which deploys to production.

If you would rather just merge first, nothing is lost — there is nothing live to
break, and a failed build is a red tick rather than an outage.

```sh
git checkout main
git merge --ff-only suite    # refuses rather than making a merge commit if
git push origin main         # the branches have diverged
```

**Checkpoint.** `git log main --oneline -1` shows your commit, and GitHub agrees.

---

## 3. Supabase

Skip this whole section if you do not want sharing yet. The app runs without it;
the two sharing features return a clear "not set up on this deployment" message
rather than breaking.

### 3.1 Create the project

1. supabase.com → **New project**
2. Name it `trousseau`. Region: whichever is nearest you.
3. Set a database password and put it in your password manager. You will not
   need it for this app, but you will need it if you ever open the database
   directly.
4. Wait for it to finish provisioning (~2 minutes).

### 3.2 Apply the two migrations, in order

**Order matters.** The second replaces a function the first defines.

Simplest route — the dashboard:

1. **SQL Editor** → **New query**
2. Paste the whole of `supabase/migrations/20260830000001_suite_sync.sql`, run it
3. New query. Paste `supabase/migrations/20260830000002_suite_sync_fixes.sql`, run it

Or, if you have the CLI and would rather it be repeatable:

```sh
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Checkpoint.** **Table Editor** shows four tables — `weddings`, `slices`,
`shares`, `blobs` — each marked *RLS enabled*. That marking matters: the tables
have RLS on with **no policies**, so nothing reaches them except the service
role. If any of them says RLS is disabled, the first migration did not finish.

### 3.3 Take the two keys

**Settings → API**:

- **Project URL** → this is `SUPABASE_URL`
- **service_role** secret → this is `SUPABASE_SERVICE_ROLE_KEY`

> The service role key bypasses row-level security entirely. It must only ever
> live in Vercel's server-side environment. **Never** give it a `NEXT_PUBLIC_`
> prefix, and never paste it into client code — that would hand every visitor
> the ability to read and delete every row.
>
> What it protects is smaller than it sounds: every row is ciphertext this key
> cannot decrypt. Someone holding it could delete weddings, not read them.

---

## 4. Vercel

### 4.1 Import

1. vercel.com → **Add New** → **Project** → import `JFrusher/Trousseau`
2. **Root Directory: `suite`** ← the one setting that matters most

   Click **Edit** beside Root Directory and choose `suite`. Vercel cannot be
   told this from a config file, so it has to be done here. Get it wrong and the
   build fails with "no Next.js version detected", because the repo root is the
   contract package, not the app.
3. Framework preset should auto-detect **Next.js**. Leave Build and Install
   commands on their defaults — `suite`'s own `build` script already compiles
   the contract package first.
4. **Node.js Version** (Settings → General): **20.x or later**.

### 4.2 Environment variables

Settings → **Environment Variables**. Add both, for **Production, Preview and
Development**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL from §3.3 |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role secret from §3.3 |

**Do not set `SYNC_IN_MEMORY`.** It exists for local development only. On a
serverless platform it would accept a wedding into one instance's memory and
lose it on the next request — which is worse than refusing, because it looks
like it worked.

### 4.3 Deploy

First build takes 2–4 minutes. What you get depends on which branch the work is
on: a **preview** while it is still on a branch, **production** once it is on
`main`. Both exercise the same build, so a preview that works is real evidence.

The checkpoints below apply to whichever URL you were given.

**Checkpoint — this is the one that catches a bad env setup:**

```sh
curl https://<your-app>.vercel.app/api/sync/wedding/nothing/salt
```

| Response | Meaning |
|---|---|
| `{"salt":null}` | Correct. The backend is wired up. |
| `{"error":"Sharing is not set up on this deployment…"}` (501) | The env vars did not reach the running build. Check they are set for **Production**, then **redeploy** — Vercel does not apply new variables to an existing deployment. |
| 404 or an HTML error page | Root Directory is not `suite`. |

Two more worth running:

```sh
curl -i https://<your-app>.vercel.app/api/sync/wedding/x/slices        # expect 403
curl -i https://<your-app>.vercel.app/api/sync/share/nothing            # expect 404
```

---

## 5. Lock it down (recommended)

You said the URL will be public but only the two of you will use it. Two things
worth doing:

**Deployment Protection** (Settings → Deployment Protection). Set it to protect
**preview deployments only**, and leave production open.

> Protection is all-or-nothing per deployment — there is no way to exempt a
> single path. So protecting *production* would break guest links: a guest
> opening `/seat/…` would be asked to log in to Vercel. Protecting *previews*
> costs you nothing and has a useful side effect: it makes it much harder to
> hand out a link that points at a preview URL by mistake.
>
> If you would rather lock production down completely and do without guest
> links, that is a legitimate choice — the app works fine, you just hand people
> their table another way.

**A custom domain** (Settings → Domains) if you would rather hand out
`seats.example.com` than a `vercel.app` URL. Do this **before** publishing any
guest link — see the warning in §6.

Without protection, what stands between a stranger and your data:

- The wedding id is 128 random bits and cannot be enumerated — a missing wedding
  and a wrong passphrase return byte-identical responses
- Every row is ciphertext; the server has no key
- Rate limits: 5 wedding creations per hour per IP, 20 failed unlock attempts
  per 15 minutes, 4 MB per slice, 8 MB per file, 64 files per wedding

The rate limiter is in-memory and therefore **per serverless instance**. It
slows a determined attacker rather than stopping one. If that ever matters, move
the counter into Postgres.

---

## 6. First run

1. Open the production URL. Empty wedding, no signup.
2. **Data** in the header → set names, date, venue.
3. Upload a guest CSV, or add guests by hand in **Seating**.
4. **Data → Sharing → Start sharing.** Choose a passphrase of four or more
   random words.

   > Write the passphrase down somewhere that is not this app. It is never
   > transmitted and never stored — it is stretched into the key that decrypts
   > your wedding. **Lose it and the server copy is unrecoverable.** Your local
   > copy is fine; the shared one is gone.

5. Note the **wedding id** it gives you. That plus the passphrase is what the
   second machine needs.

### The second machine

Open the same URL → **Data → Sharing** → paste the wedding id and passphrase →
**Open it**.

If that device already has a wedding on it, it will stop and ask before
replacing. Export a backup first if you want to keep what is there.

### The guest link

**Data → Sharing → Publish a link.**

> ⚠️ **Publish from the production domain, not a preview deployment.** The link
> is built from whatever origin you are on, so one minted on
> `trousseau-abc123.vercel.app` will point at that preview forever — and preview
> URLs are not permanent. If you add a custom domain later, republish.

The link carries its decryption key after the `#`, which browsers never send to
a server. It contains names and table numbers only — no email addresses, no
phone numbers, no dietary requirements, no notes, and nobody who declined.

There is only ever **one live link**. *Update the link* replaces what it shows,
so a link already given out stays correct. *Take it down* deletes it.

---

## 7. After setup

**Back up.** The Data manager's **Export backup** writes the whole wedding —
guests, seating, the day, the crew, the stationery — to one `.trousseau.json`.
That file is the only copy that survives clearing your browser. Do it after any
big session, and keep it somewhere that is not the laptop.

**Sync habit.** Press **Sync now** when you sit down and when you get up. A
slice you have edited is never overwritten by a pull; if both machines changed
the same thing you are asked which to keep. Nothing is lost silently either way.

**Archive the four repos.** Nothing in the suite reads from Tableaux, Plaque,
cadence or Brigade any more — their code was copied in, with their tests. On
each: Settings → scroll down → **Archive this repository**.

**The DVC pipeline still works** and is now belt-and-braces: `npm run sync` at
the repo root still packs, validates and pushes the wedding to your OneDrive
remote. The cross-slice validator was updated to read the suite's own slices, so
it checks the real data rather than passing vacuously.

---

## Troubleshooting

**"no Next.js version detected"** — Root Directory is not `suite`.

**Build fails on `tsc`** — the contract package failed to compile. Reproduce
locally with `npm run build` at the repo root.

**API returns 501 in production** — env vars missing, or set after the last
build. Set them, then redeploy.

**API returns 500** — check Vercel's function logs. If it mentions Supabase,
the migrations probably did not run; confirm all four tables exist.

**"That wedding could not be opened with that passphrase"** — the same message
covers a wrong passphrase *and* an unknown wedding id, deliberately, so the API
cannot be used to discover which weddings exist. Check both.

**Sync says "already in step" when you expect changes** — that is correct when
nothing changed since the last exchange. Make an edit and sync again.

**A guest link shows "This link is missing the part after the #"** — the link
was copied without its fragment. Some chat apps truncate at the `#`. Send it as
a plain link rather than pasted text, or use the copy button.

**Everything vanished after a browser update** — storage is per browser, per
device. Restore from a backup export.

---

## What is not set up by this

- **Restyling the printed pieces** is read-only in the Timeline's Print panel.
- **XLSX export** was dropped in favour of CSV.
- **Cadence's presentation mode** and drag-to-what-if ghosting are not ported.
- **Rate limiting is per-instance**, as above.

None of these block anything; they are listed so nobody goes looking.
