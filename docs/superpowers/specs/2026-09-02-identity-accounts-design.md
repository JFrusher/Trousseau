# Trousseau — identity & accounts design

Date: 2026-09-02
Status: approved, ready for implementation planning
Scope: subsystem A of `docs/PRODUCT-ROADMAP.md` — couple sign-up, auth, and
shared wedding ownership. Precedes and blocks subsystem B (multi-tenant
storage) and subsystem G (multi-tenant suite mechanics).

## Why

Trousseau is becoming a real product for other couples, not a tool for one
wedding on one laptop. Every other subsystem in the pivot — where a
wedding's data lives, how the suite tells one tenant from another, even
whether Brigade can ever have a vendor-facing portal — assumes "a wedding
belongs to an authenticated account" already exists. This is that
foundation.

See `docs/superpowers/specs/2026-09-02-trousseau-architecture-audit.md` for
the state of the repo this builds on, and `docs/PRODUCT-ROADMAP.md` for the
decisions this design was built from (Supabase Auth, two accounts per
wedding via invite, couple-only roles, email + magic link, no billing).

## Data model

Three new tables, alongside Supabase Auth's own `auth.users`. The wedding's
actual planning data (guests, timeline, etc.) is out of scope here — that's
subsystem B's `weddings`-keyed JSON document; these tables only establish
who owns what.

- **`weddings`** — `id` (uuid, pk), `created_at`. Deliberately no `owner_id`
  column: ownership is membership, not a distinguished role. Two partners
  who both joined are equals; there is no "the real owner" to lose access if
  the other deletes their account (see Deletion, below).
- **`wedding_members`** — `wedding_id` (fk → weddings), `user_id` (fk →
  auth.users), `joined_at`. Composite PK `(wedding_id, user_id)`. A wedding
  is capped at two members, enforced in application code at invite
  acceptance, not a database constraint — this is a product rule ("couple
  only, for now" per the roadmap), not a structural one, and the roadmap
  already flags that this may loosen later (a planner role, e.g.). Encoding
  it as a hard schema constraint would make that future change a migration
  instead of a code change.
- **`invites`** — `id` (uuid, pk), `wedding_id` (fk → weddings),
  `invited_email` (text, lowercased/normalized), `token` (text, unique,
  cryptographically random — same shape as the existing `seat/[token]`
  share tokens: unguessable, no sequential IDs), `created_by` (fk →
  auth.users), `created_at`, `expires_at` (`created_at` + 14 days),
  `accepted_at` (nullable). An invite is single-use: once `accepted_at` is
  set, the token is dead even if clicked again.

RLS: a user can `select` a `weddings` row only via an existing
`wedding_members` row naming them; `wedding_members` rows are readable only
by other members of the same wedding; `invites` are readable by the
`created_by` user (to see pending/expired state) and, by token lookup only
(not by listing), by whoever is completing the invite flow — the token
itself is the credential, matching the existing `seat/[token]` pattern's
"URL fragment as capability" spirit even though this project uses standard
server-side auth rather than E2E encryption.

## Auth & wedding creation

Supabase Auth's magic-link flow is both sign-up and sign-in — there is no
separate registration form. A brand-new email clicking a magic link creates
its `auth.users` row implicitly; a returning email's link just signs them
in. No password ever exists to set, reset, or leak.

The first authenticated action available to a user with no wedding yet is
"create a wedding": this inserts one `weddings` row and one
`wedding_members` row for that user, and nothing else — no onboarding
wizard is specified here (that's a product/UX decision for the
implementation plan, not an architectural one).

No separate email-verification step exists or is needed: successfully
completing the magic-link flow *is* proof the email works. A verification
step on top of that would be redundant friction.

## Invite flow

1. A member of a wedding with fewer than two members enters their partner's
   email. Server validates the wedding isn't already full, creates an
   `invites` row with a fresh token and 14-day expiry, and sends an email to
   `invited_email` containing a link to `/invite/[token]`.
2. Visiting that link with no active session starts the normal magic-link
   flow, pre-filled/locked to `invited_email` — the user cannot substitute a
   different email at this step, since the invite is a promise made to one
   specific address.
3. Once authenticated, the server checks: does the authenticated user's
   email match `invited_email` exactly? If not — e.g. the invited person
   forwarded the email and someone else clicked it, or they're signed in as
   a different existing account — reject with a clear message ("this invite
   was sent to `invited_email`; sign in with that address to accept it"),
   not a silent wrong-account join.
4. If it matches, and the invite is unexpired and unaccepted, and the
   wedding still has fewer than two members: set `accepted_at`, insert the
   `wedding_members` row, redirect into the wedding. Otherwise, show the
   specific reason (expired / already accepted / wedding is full) rather
   than a generic failure.

Resending an invite (e.g. after the original expired) creates a fresh
`invites` row rather than mutating the old one — expired/superseded invites
are kept, not deleted, as a record of what was sent.

## Session

Supabase's standard refresh-token session, via its Next.js SSR cookie
helpers. Sessions are long-lived by design — no custom expiry, no forced
re-authentication — since this is a low-stakes planning tool used casually
over months, and repeated magic-link re-auth is real friction, not a
meaningful security improvement for this threat model. A user stays signed
in on a device until they explicitly sign out.

## Deletion

Deleting an `auth.users` row cascades to remove that user's
`wedding_members` row (and any `invites` they created, or those are kept
for history — implementation detail, not architectural). Two cases:

- **A member remains:** the wedding and its data are completely untouched
  for the remaining partner. Losing your own account must never cost your
  partner their wedding.
- **No members remain:** the wedding itself, and its data document (per
  subsystem B), is deleted along with the last account. There is no orphan
  state where a wedding exists with zero owners.

## Error handling

Every failure mode named above (wrong email, expired invite, already
accepted, wedding full) surfaces its specific reason to the user rather than
a generic "something went wrong" — these are all things a real person needs
to understand and act on (ask for a new invite, sign in with the right
email), not developer-facing edge cases.

## Testing

- RLS policy tests: a user can only read `weddings`/`wedding_members` rows
  for weddings they belong to, from both a member's and a non-member's
  session.
- Invite token tests: expiry enforcement, single-use enforcement, rejection
  when the authenticating email doesn't match `invited_email`, rejection
  when the target wedding already has two members.
- Integration test: full invite-and-accept flow end to end, both for a
  brand-new invited user and for an invited user who already has an
  unrelated account.
- Deletion tests: both cascade cases (partner remains vs. last member),
  confirming the remaining partner's access is untouched in the first case
  and the wedding is fully gone in the second.

## Explicitly deferred (not decided here)

- Which email-sending path (Supabase's built-in vs. a dedicated transactional
  provider) — a deliverability/config choice for the implementation plan.
- Any onboarding UI/wizard beyond "create a wedding exists as an action."
- A role beyond "couple member" (planner, vendor login) — roadmap already
  marks this as explicitly out of scope for now.
