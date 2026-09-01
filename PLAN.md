# Production hardening plan

Scope: **`suite/` only** — the Next.js application deployed to Vercel. The
contract package, the DVC data pipeline and the four archived standalone repos
are out of scope.

Written 2026-09-01, against `main` at `25d7989`.

---

## The decisions this plan rests on

| Question | Answer |
| --- | --- |
| Scope | `suite/` only |
| Audience | Public, still account-free — anyone may use it, nobody signs up |
| Sync tenancy | **Multi-tenant.** A stranger may create their own wedding |
| Checklist items with no subject | Documented as N/A, not built |
| Hosting | Vercel, default `*.vercel.app`, Supabase sync live |
| Observability | Sentry, client and server, behind an env var |
| Controller | Jacob Frusher · jacob@frusher.co.uk · England & Wales |

The second and third of these are the ones that reshape the work.

**Public and multi-tenant is a bigger change than it sounds.** Today the server
holds one wedding — ours. The moment a stranger can `POST /api/sync/wedding`
and have it stick, this deployment is a data processor for other people's guest
lists. Those lists are ciphertext we cannot read, and that is a strong position,
but encrypted personal data is still personal data under UK GDPR: we hold it,
so we owe a lawful basis, a retention policy, and a deletion route. There is no
deletion route today. That is the single largest gap in this plan and it is why
item 3 moved from "no subject" to "must build".

**Account-free is a strength, not a hole.** No accounts means no session
fixation, no password reset flow to leak, no OAuth callback to confuse, no
cookie to steal. Half of a conventional hardening checklist is not missing here
— it has no subject. This plan records why for each, so a future reader does
not mistake absence for oversight.

---

## Audit: the 20 domains

Legend: **Gap** — real work in this plan. **Partial** — exists, needs
finishing. **Sound** — already correct, no change. **N/A** — no subject in this
architecture, reasoned below.

| # | Domain | Verdict | Finding |
| --- | --- | --- | --- |
| 1 | Legal footers | **Gap** | No `/privacy`, no `/terms`, no footer. Now mandatory: we process third-party data. |
| 2 | Consent management | **N/A** | Zero cookies, zero storage access by any third party. See *Consent* below. |
| 3 | Data privacy tools | **Gap** | Export exists. **No deletion route at all.** `shares` has no FK to `weddings` — deleting a wedding orphans its guest link. |
| 4 | Auth hardening | **N/A** | No accounts. Passphrase → PBKDF2(600k) → HKDF → write token, held in IndexedDB, sent as a Bearer header. |
| 5 | Security protections | **Partial** | CSRF structurally impossible (header token, no cookies) — correct. Constant-time compare, no existence oracle — correct. **No CSP. No runtime validation of request bodies.** |
| 6 | Rate limiting | **Partial** | Present and honest. In-memory, per-instance. Acceptable for one tenant; thin for a public create endpoint. |
| 7 | Resilience | **Gap** | No `error.tsx`, no `global-error.tsx`, no rejection handler. Two `TODO(ux-audit)` boundary gaps in Tableaux. |
| 8 | UX states | **Partial** | Hydration gated by `StoreHydrator` / `WhenDocumentReady`. Double-submit unaudited. |
| 9 | SEO & metadata | **Gap** | Title and description only. No OpenGraph, canonical, `sitemap.ts` or `robots.ts`. `/seat` correctly `noindex`. |
| 10 | Custom error pages | **Gap** | No `not-found.tsx`, no styled 500. |
| 11 | Mobile / a11y | **Partial** | `Announcer` live regions are good. `DesktopGate` walls off every mobile visitor — now a product gap, flagged not fixed. |
| 12 | Theme management | **N/A** | Light-only on purpose. See *Theme* below. |
| 13 | Input validation | **Gap** | **Highest value item here.** `body as { … }` casts on every endpoint. Zod is already a dependency. |
| 14 | Database safety | **Sound** | supabase-js is HTTP/PostgREST — no pool to exhaust. Migrations clean, CAS race already found and fixed. |
| 15 | Asset performance | **Partial** | `next/dynamic` on all four tools — good. Six TTFs served raw; no `next/image`. |
| 16 | Env safeguards | **Gap** | Ad-hoc `process.env[…]`, silent null. Deliberate for local-only mode, but nothing validates a *configured* deploy. |
| 17 | Observability | **Gap** | None. |
| 18 | Analytics | **N/A** | None wanted. See *Analytics* below. |
| 19 | Transactional email | **N/A** | No accounts, no resets, no address to send to. |
| 20 | Response headers | **Gap** | No `next.config` headers, no middleware, no `vercel.json`. Vercel supplies HSTS; nothing else. |

### The N/A items, reasoned

**2 — Consent management.** PECR consent is owed for *storage access* on the
user's device by non-essential parties. The app stores the wedding in IndexedDB,
which is strictly necessary to the service the user asked for. Sentry's browser
SDK will be configured with no session replay and no cookies, so it accesses no
storage; error reporting then rests on legitimate interest, disclosed in the
Privacy Policy. A consent banner would ask permission for something that is not
happening, which is worse than no banner: it trains people that the dialog is
noise. **Revisit the moment anything sets a cookie or adds a marketing tag.**

**4 — Auth hardening.** Expiry, refresh and multi-tab session sync all presume a
server-issued credential with a lifetime. The write token is a deterministic
function of a passphrase the user retypes; it has no lifetime to expire and no
issuer to refresh it. Protected routes have no subject either — every route is
public and every document is local. *One caveat carried forward:* the token sits
in IndexedDB indefinitely, so an unlocked shared device stays unlocked. Recorded
as a known limitation in the Privacy Policy rather than papered over.

**12 — Theme management.** The four tools render print previews. A dark page
behind a white A4 sheet makes the sheet read as artwork rather than paper, which
is the one thing these tools must get right. Light-only is a product decision,
not an omission. Flicker-free is trivially satisfied: there is nothing to flick
between.

**18 — Analytics.** Declined. Nothing to wire consent into, and the privacy
claim on the front page is load-bearing.

**19 — Transactional email.** No accounts to verify, no passwords to reset, and
no email address is ever collected. Guest email addresses in a wedding are
deliberately stripped from the share snapshot and never leave the device.

---

## Progress — all eleven steps done

| Step | State | Notes |
| --- | --- | --- |
| 0 — Refused IndexedDB reported, not thrown past | **Done** | Not in the plan. Found in the baseline run: a live bug that also failed the suite. |
| 1 — Env schema, fail-fast at build | **Done** | `CREATE_GATE_SECRET` dropped; open creation was chosen. |
| 2 — Runtime validation on every API body | **Done** | Path segments too. |
| 3 — Security response headers | **Done, changed** | The nonce does not work in Next 16. See below. |
| 4 — Error pages and boundaries | **Done** | |
| 5 — Cascading deletion | **Done** | Also found cross-wedding share takedown. Migration is destructive. |
| 6 — Retention | **Done** | Backfill bug found by the migration tests and fixed. |
| 7 — Create endpoint hardening | **Done, rescoped** | See below. |
| 8 — Legal pages and footer | **Done** | Effective date held to the text by a digest test. |
| 9 — SEO and metadata | **Done** | `/seat` excluded three ways. |
| 10 — Observability | **Done** | Sentry, with fragment scrubbing as the load-bearing part. |
| 11 — UX and accessibility pass | **Done** | Focus ring was entirely absent. |
| Reported 500 on save | **Fixed** | Schema drift, plus a route with no error handling at all. |

### Step 3 did not go to plan

The plan called for a per-request nonce from middleware plus `strict-dynamic`.
That was built, then removed. Next 16 emits fourteen inline bootstrap scripts
and stamps a nonce onto none of them — checked against a production server
twice, once prerendered and once with the whole tree forced dynamic. The policy
would have blocked every script in the document.

What shipped is the static policy. `script-src` keeps `'unsafe-inline'`, and
`connect-src 'self'` is the directive doing the real work: the threat here is a
guest list leaving for another origin, not a defaced page.

### Step 7 was rescoped, and the rescope mattered

Planned as moving the rate-limit counter into Postgres. Measuring the exposure
first found something larger: every individual limit was in place and none of
them added up to anything. Sixty-four assets at 8MB plus sixteen slices at 4MB
is 576MB per wedding, and anyone may create a wedding and choose its own
passphrase. Rate limiting creation bounds how many weddings a stranger makes
per hour and says nothing about how large each one gets.

A 64MB per-wedding budget shipped instead. The Postgres-backed limiter is
deliberately **not** done: retention now removes abandoned weddings, validation
refuses malformed creates before the database sees them, and the per-wedding
ceiling bounds the cost of each one. What remains is a stranger burning create
quota from rotating addresses, which Vercel's own edge protection is better
placed to absorb than an application-level counter.

### The SQL is now tested

There was no way to verify migrations — no Docker, no psql, no credentials.
PGlite is Postgres compiled to WebAssembly, so the migrations now run in the
ordinary test suite: clean installs, the destructive share upgrade, the
retention backfill, grants and row-level security.

It immediately found a bug in the retention migration. `add column … default
now()` stamps every existing row with the moment the migration runs, so a
backfill guarded on `where updated_at < created_at` never matched — dead code
that looked right, which would have handed every abandoned wedding a fresh two
years.

### What the reported 500 turned out to be

Two faults, and the schema was only one. The code writes columns the applied
migrations do not have, so every write failed; and the route had no error
handling whatsoever, so a Postgres error reached the client as a bare 500 with
nothing in it. Both fixed, the second being the one that would have bitten again
for a different reason later.

## Roadmap

Eleven commits, ordered so each is independently revertable and nothing depends
on a later one. Every step names its own verification.

Baseline before starting — record the output, this is what "intact" means:

```sh
npm run typecheck -w suite
npm run test      -w suite
npm run build     -w suite
```

---

### 1 — Env schema validation, fail-fast at build

*Item 16.*

`lib/env.ts`: a Zod schema over `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SYNC_IN_MEMORY`, `SENTRY_DSN`, `CREATE_GATE_SECRET`. The rule is
**all-or-nothing, not all-required**: an unconfigured deploy is legitimate and
must stay so, but a *half*-configured one — a URL with no key — is a
misconfiguration that currently degrades to a silent 501, and must fail the
build instead. Import it from `next.config.ts` so it runs at build time.

Replace the ad-hoc reads in `supabaseStore.ts` and the route handler.

**Verify:** `npm run build -w suite` with a full env, with an empty env, and with
only `SUPABASE_URL` set. Third must fail with a named error. Add
`lib/env.test.ts` asserting the three cases against the schema directly.

### 2 — Runtime validation on every API body

*Item 13. Highest value in this plan.*

`lib/sync/schemas.ts`: Zod schemas for each endpoint's input — create, push,
blob, share. Enforce at the boundary what the constants in `handlers.ts` already
document: `MAX_SLICES_PER_PUSH`, base64 shape on ciphertext and IV, id and token
character sets. Parse in `route.ts`; a failure is a 400 with the issue path, not
a cast into a handler.

Today `body as { id: string; salt: string; authHash: string }` will hand
`undefined` to the store on a malformed body and surface as a 500. That is an
attacker-controlled path to a stack trace.

**Verify:** extend `lib/sync/handlers.test.ts` with malformed-body cases per
endpoint — missing field, wrong type, oversized array, non-base64 ciphertext.
Each asserts 400 and that the store was never touched.

### 3 — Security response headers

*Item 20.*

`next.config.ts` `headers()`: CSP, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, `Permissions-Policy` denying camera, microphone and
geolocation. HSTS explicitly rather than relying on Vercel's default.

CSP can be strict: `connect-src 'self'` suffices, because the browser never
talks to Supabase — only the route handler does. `script-src` needs a nonce or
`'strict-dynamic'` for Next's inline bootstrap; `style-src` needs
`'unsafe-inline'` for Tailwind v4 and the CSS Modules, which is the one
concession and worth noting in the file. If Sentry's browser SDK is enabled its
ingest origin joins `connect-src`, sourced from the same env schema as step 1.

**Verify:** `curl -sI` the deployed preview and assert each header. Add
`lib/headers.test.ts` importing the config and asserting the header list, so a
future edit cannot quietly drop one.

### 4 — Error pages and boundaries

*Items 7 and 10.*

`app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`, styled with the
existing tokens. A `window.onunhandledrejection` handler in `StoreHydrator`.
Close the two `TODO(ux-audit)` gaps in `apps/tableaux/components/layout/AppShell.jsx`
by wrapping Toolbar and RightSidebar.

The `error.tsx` copy matters more than usual: the document lives in the user's
browser, so "your work is still on this device, reload" is true and reassuring,
where a generic "something went wrong" reads as data loss.

**Verify:** a test route that throws renders the boundary, not a blank page.
Navigate to `/nonsense` and get the styled 404. Existing Tableaux tests still
pass.

### 5 — Cascading deletion, and fixing the orphaned shares

*Item 3. The compliance-critical one.*

Migration `20260901000001_delete_wedding.sql`:

- Add `wedding_id` to `shares`, backfilled, with
  `references weddings (id) on delete cascade`. **This is a live bug, not
  merely a gap**: a deleted wedding leaves its guest link serving the old plan
  for ever, because nothing cascades to it.
- `delete_wedding(p_wedding text)`, `security definer`, deleting the wedding row
  and letting the FKs take slices, blobs and shares.

`DELETE /api/sync/wedding/:id` in the route, behind `guarded()` — only a holder
of the passphrase may delete. Wire a destructive, typed-confirmation control
into `components/shell/DataManager.tsx` beside the existing export.

**Verify:** `handlers.test.ts` — delete removes wedding, slices, blobs *and*
shares; a wrong token gets 403 and deletes nothing; the share token 404s
afterwards. Apply the migration to a scratch Supabase project and confirm the
backfill leaves no null `wedding_id`.

### 6 — Retention for abandoned weddings

*Item 3, continued. Multi-tenancy makes this mandatory.*

A public create endpoint accumulates weddings that nobody comes back to. Holding
strangers' ciphertext for ever with no stated period fails storage limitation.

A Supabase scheduled function deleting weddings with no slice written in 24
months, via `delete_wedding`. Twenty-four months is chosen to comfortably clear
an engagement plus the wedding plus a year; state it in the Privacy Policy and
make it match the code exactly.

**Verify:** run the function against seeded rows with backdated `updated_at` —
stale wedding gone with all children, recent one untouched.

### 7 — Gating and hardening the create endpoint

*Item 6, revisited for multi-tenancy.*

`POST /api/sync/wedding` is the only unauthenticated write. At 5/hour/IP,
in-memory, per-instance, a public deployment is a free ciphertext store for
anyone who rotates an address.

Move the rate-limit counter into Postgres — a `rate_limits (key, count,
reset_at)` table and one upsert function — so the window is global rather than
per-instance. `rateLimit.ts` already names this as its upgrade path. Keep the
in-memory limiter as the fallback when unconfigured.

**Verify:** `handlers.test.ts` against the memory store for window rollover and
exhaustion. Hit a preview deploy 6 times in an hour and get a 429 on the sixth.

### 8 — Legal pages and footer

*Item 1.*

`app/(app)/privacy/page.tsx`, `app/(app)/terms/page.tsx`, and a footer in
`app/(app)/layout.tsx`. Effective date derived from the file's own last-modified
commit date at build time, not hand-typed — a stale date on a policy is worse
than none.

The Privacy Policy must state plainly, because all of it is true and unusually
favourable: the wedding lives in the browser; the server stores ciphertext under
a key derived from a passphrase it never receives; guest email addresses, phone
numbers, dietary requirements and notes are stripped from a share snapshot and
never transmitted; retention is 24 months from last write; deletion is
self-service and immediate. It must also state the two uncomfortable truths:
the write token persists in IndexedDB until the browser data is cleared, and
Sentry receives error diagnostics.

**Verify:** both routes render, footer links from every `(app)` page, dates
match `git log` for those files. Re-read against the retention constant in
step 6 — the number in the prose and the number in the code must agree.

### 9 — SEO and metadata

*Item 9.*

`app/sitemap.ts` and `app/robots.ts`, both driven by
`VERCEL_PROJECT_PRODUCTION_URL` so no hostname is hardcoded. `metadataBase` plus
OpenGraph and Twitter cards in the root layout; canonical URLs per route. An OG
image via `next/og`.

`robots.ts` must `disallow: /seat/` and `/api/`. `/seat` already sets `noindex`
per-page; belt and braces, because a guest link in a search index is the one
genuinely damaging leak available here.

**Verify:** fetch `/sitemap.xml` and `/robots.txt` on a preview; confirm `/seat`
is excluded from both and still carries `noindex`.

### 10 — Observability

*Item 17.*

`@sentry/nextjs`, client and server, enabled only when `SENTRY_DSN` is present
so local and unconfigured deploys stay silent.

Configuration is not optional here — a default Sentry install would defeat the
product's central claim:

- `sendDefaultPii: false`
- No session replay
- `beforeSend` scrubbing URL fragments — a guest link's decryption key lives in
  the fragment, and shipping it to Sentry would hand a third party the ability
  to decrypt a plan
- No breadcrumbs from the store: the document is the guest list

Add the ingest origin to CSP `connect-src` from step 3.

**Verify:** a deliberate throw reaches Sentry on a preview with the DSN set, and
reaches nothing with it unset. Assert `beforeSend` strips a fragment with a unit
test — this is the one that protects the encryption model.

### 11 — UX states and accessibility pass

*Items 8, 11, 15.*

Double-submit guards on the destructive and long-running controls: delete,
publish share, export pack. Focus-visible rings audited against the gold token.
Touch targets on the non-gated surfaces — the front page, `/seat`, the legal
pages — brought to 44px. Check for horizontal overflow at 320px on those same
surfaces. `font-display: swap` and `preload` on the six TTFs.

`DesktopGate` is deliberately excluded. It walls off every mobile visitor from
all four tools, which is a real product gap now that the app is public — but
making four canvas-and-PDF editors work on a phone is a project, not a step in a
hardening plan. **Flagged, not fixed.** The surfaces a mobile visitor can
actually reach are in scope, and `/seat` matters most: a guest looking up their
table is on a phone, at a venue, on bad signal.

**Verify:** keyboard-only pass through the front page, `/seat` and both legal
pages. 320px viewport with no horizontal scroll. Lighthouse accessibility on
`/seat` — the one page whose users did not choose this software.

---

## Verification gate

Every commit ends with all three green, plus its own named check:

```sh
npm run typecheck -w suite
npm run test      -w suite
npm run build     -w suite
```

Steps 5, 6 and 7 also need a scratch Supabase project — migrations get applied
and rolled back there before they go near the one holding a real wedding.

## Still open

- **Migrations are not applied.** There are no Supabase credentials on this
  machine, so this could not be done here. Apply all three, in filename order,
  **before** deploying — the code writes columns they add, and a deploy that
  lands first fails every write.
- **`20260901000001` is destructive.** It deletes share rows it cannot
  attribute. Any guest link published before it must be published again; the
  client mints the same token, so the URL is unchanged.

## Carried forward, deliberately not done

- **`DesktopGate` blocks all mobile use of the four tools.** The largest product
  gap the audit found. Out of scope here.
- **Write token persists in IndexedDB with no expiry.** Inherent to a
  passphrase-derived credential. Disclosed in the Privacy Policy.
- **Rate limiting remains per-instance for read and write paths.** Only the
  create endpoint moves to Postgres in step 7; the others stay in memory, where
  the existing comment's reasoning still holds.
- **No mechanism to delete a wedding whose passphrase is lost.** Deletion
  requires the write token. This is a direct consequence of the server being
  unable to read anything, and the correct trade — but it means a GDPR erasure
  request from someone who has lost their passphrase cannot be honoured
  individually. Retention in step 6 is the backstop, and the Privacy Policy must
  say so.
