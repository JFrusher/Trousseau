-- Accounts: real Supabase Auth users owning a wedding, entirely separate from
-- the E2E-encrypted passphrase-based sharing in 20260830000001_suite_sync.sql.
-- That system's own `weddings` table is untouched and unrelated to this one —
-- this is `account_weddings`, deliberately not `weddings`, because the name
-- was already taken by a different bounded context before this table existed.

create table if not exists public.account_weddings (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- One row per user, ever — not one row per (wedding, user). A user's row IS
-- their one active wedding for v1: `user_id` alone is the primary key, so a
-- second `create_wedding()` call for the same user fails on this constraint
-- rather than needing separate application logic to forbid it.
create table if not exists public.wedding_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  wedding_id uuid not null references public.account_weddings (id) on delete cascade,
  joined_at  timestamptz not null default now()
);

create table if not exists public.invites (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references public.account_weddings (id) on delete cascade,
  invited_email text not null,
  token         text not null unique,
  -- `on delete cascade`, not the default `no action`: `delete_my_account()`
  -- only removes the caller's `wedding_members` row (and the wedding itself if
  -- they were its last member), so a surviving wedding leaves this row's
  -- `wedding_id` cascade unfired — and deleting the auth.users row of whoever
  -- sent the invite (the common case) would fail on this foreign key.
  created_by    uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  accepted_at   timestamptz
);

alter table public.account_weddings enable row level security;
alter table public.wedding_members  enable row level security;
alter table public.invites          enable row level security;

-- Every mutation goes through a function below; direct table access from the
-- client is read-only, and only for what a member is allowed to see.
grant select on public.account_weddings to authenticated;
grant select on public.wedding_members  to authenticated;
grant select on public.invites          to authenticated;
revoke insert, update, delete on public.account_weddings from authenticated;
revoke insert, update, delete on public.wedding_members  from authenticated;
revoke insert, update, delete on public.invites          from authenticated;
revoke all on public.account_weddings from anon;
revoke all on public.wedding_members  from anon;
revoke all on public.invites          from anon;

/**
 * Whether the calling user is a member of the given wedding.
 *
 * Used from RLS policies instead of a plain subquery on `wedding_members`
 * itself: a policy on `wedding_members` whose USING clause queries
 * `wedding_members` again (even under a different alias) makes Postgres
 * re-apply that same policy to plan the subquery, which re-triggers the
 * subquery, forever — "infinite recursion detected in policy for relation
 * wedding_members". A `security definer` function sidesteps this because its
 * body runs with the definer's privileges, which bypass RLS on the table it
 * reads, the same way the mutation functions below do.
 */
create or replace function public.is_wedding_member(p_wedding_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.wedding_members m
     where m.wedding_id = p_wedding_id and m.user_id = auth.uid()
  );
$$;

-- `from public`, not `from anon`: Postgres grants EXECUTE on every new
-- function to the PUBLIC pseudo-role, and revoking from a specific role never
-- removes a grant held through PUBLIC — so `from anon` would be a no-op.
revoke all on function public.is_wedding_member(uuid) from public;
grant execute on function public.is_wedding_member(uuid) to authenticated;

create policy "members can read their own wedding"
  on public.account_weddings for select
  using (public.is_wedding_member(id));

create policy "members can read their wedding's membership"
  on public.wedding_members for select
  using (public.is_wedding_member(wedding_id));

create policy "a user can read invites they created"
  on public.invites for select
  using (created_by = auth.uid());

/**
 * Create a wedding for the calling user and make them its first member, in
 * one statement. Two separate inserts from application code risked an
 * `account_weddings` row with nobody in it if the second failed.
 *
 * Fails with a unique-violation on `wedding_members`'s primary key if the
 * caller already has a wedding — the one-wedding-per-account-for-v1 rule
 * enforced by the schema itself, not re-checked here.
 */
create or replace function public.create_wedding()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wedding_id uuid;
begin
  insert into public.account_weddings default values returning id into v_wedding_id;
  insert into public.wedding_members (user_id, wedding_id) values (auth.uid(), v_wedding_id);
  return v_wedding_id;
end;
$$;

/**
 * Invite a partner. Only an existing member of the wedding may call this,
 * and only while the wedding has room for one more.
 */
create or replace function public.create_invite(p_wedding_id uuid, p_invited_email text)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_count integer;
  v_id uuid;
  v_token text;
  v_expires timestamptz;
begin
  if not exists (
    select 1 from public.wedding_members m
     where m.wedding_id = p_wedding_id and m.user_id = auth.uid()
  ) then
    raise exception 'not a member of that wedding' using errcode = '42501';
  end if;

  select count(*) into v_member_count
    from public.wedding_members m
   where m.wedding_id = p_wedding_id;

  if v_member_count >= 2 then
    raise exception 'wedding already has two members' using errcode = 'P0001';
  end if;

  -- Two random UUIDs, hyphens stripped, rather than pgcrypto's
  -- `gen_random_bytes`: `gen_random_uuid()` is built into core Postgres
  -- (13+, itself backed by the OS CSPRNG) and every other id in this
  -- migration already relies on it, so the token needs no extension the
  -- target project might not have enabled.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + interval '14 days';

  insert into public.invites (wedding_id, invited_email, token, created_by, expires_at)
  values (p_wedding_id, lower(p_invited_email), v_token, auth.uid(), v_expires)
  returning invites.id, invites.token, invites.expires_at into v_id, v_token, v_expires;

  return query select v_id, v_token, v_expires;
end;
$$;

/**
 * Accept an invite as the calling (already-authenticated) user.
 *
 * Every rejection reason is returned, not raised, so the caller can show the
 * specific one — "this invite was sent to X", "that invite has expired",
 * "that invite was already used", "that wedding is full" — rather than a
 * generic failure. `accepted = false` with a `reason` is the normal shape of
 * "no" here, including for a token that doesn't exist at all: the invitee is
 * never `created_by`, so the one SELECT policy on `invites` hides the row from
 * them entirely and the caller cannot look the invite up itself first. This
 * function is the only thing that can see it, so it answers every question
 * about the invite on its own, `invited_email` included.
 */
create or replace function public.accept_invite(p_token text)
returns table (accepted boolean, reason text, wedding_id uuid, invited_email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites%rowtype;
  v_caller_email text;
  v_member_count integer;
begin
  select * into v_invite from public.invites where token = p_token;
  if not found then
    return query select false, 'not-found', null::uuid, null::text;
    return;
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  if v_invite.accepted_at is not null then
    return query select false, 'already-accepted', v_invite.wedding_id, v_invite.invited_email;
    return;
  end if;

  if v_invite.expires_at < now() then
    return query select false, 'expired', v_invite.wedding_id, v_invite.invited_email;
    return;
  end if;

  if lower(v_caller_email) <> v_invite.invited_email then
    return query select false, 'wrong-email', v_invite.wedding_id, v_invite.invited_email;
    return;
  end if;

  -- Lock the wedding row itself before counting its members. Without this,
  -- two concurrent acceptances of two different pending invites to the same
  -- (one-seat-free) wedding can each count one member, each decide there is
  -- room, and both insert — the exact check-then-act shape of the race fixed
  -- for `put_slice` in 20260830000002_suite_sync_fixes.sql. Locking the
  -- parent row serialises them: the second acceptance blocks here until the
  -- first commits its new member row, and then correctly recounts to two.
  perform 1 from public.account_weddings where id = v_invite.wedding_id for update;

  select count(*) into v_member_count
    from public.wedding_members m
   where m.wedding_id = v_invite.wedding_id;

  if v_member_count >= 2 then
    return query select false, 'wedding-full', v_invite.wedding_id, v_invite.invited_email;
    return;
  end if;

  -- `wedding_members.user_id` is the primary key, so a caller who already has
  -- a wedding of their own would otherwise hit a raw unique-violation here.
  -- Answer it the same way as every other "no" above, so the API can say
  -- something the person can act on instead of returning a 500.
  if exists (select 1 from public.wedding_members where user_id = auth.uid()) then
    return query select false, 'already-in-a-wedding', v_invite.wedding_id, v_invite.invited_email;
    return;
  end if;

  insert into public.wedding_members (user_id, wedding_id) values (auth.uid(), v_invite.wedding_id);
  update public.invites set accepted_at = now() where token = p_token;

  return query select true, null::text, v_invite.wedding_id, v_invite.invited_email;
end;
$$;

/**
 * Remove the caller from their wedding, deleting the wedding itself if that
 * was its last member. Does not delete the `auth.users` row — the caller
 * (an API route with the service-role key) does that separately via the
 * Supabase Admin API, which is the supported way to remove a user without
 * leaving Auth-internal state (refresh tokens, identities) inconsistent.
 */
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wedding_id uuid;
  v_remaining integer;
begin
  select wedding_id into v_wedding_id from public.wedding_members where user_id = auth.uid();
  if v_wedding_id is null then
    return;
  end if;

  delete from public.wedding_members where user_id = auth.uid();

  -- Lock the wedding row before recounting, for the same reason as in
  -- accept_invite: two members leaving at the same instant could each delete
  -- their own row, each then count "1 left" under read-committed (seeing the
  -- other's not-yet-committed delete), and neither would clean up the wedding
  -- — an account_weddings row nothing can ever reach again, left behind
  -- forever. Serialising here means the second caller's count reflects the
  -- first caller's already-committed departure.
  perform 1 from public.account_weddings where id = v_wedding_id for update;

  select count(*) into v_remaining from public.wedding_members where wedding_id = v_wedding_id;
  if v_remaining = 0 then
    delete from public.account_weddings where id = v_wedding_id;
  end if;
end;
$$;

-- Revoke the default PUBLIC grant first, for the same reason as
-- `is_wedding_member` above: without it, `anon` can call every one of these
-- through PUBLIC. Nothing here is exploitable by a caller with no
-- `auth.uid()` (each one fails on a not-null or membership check), but a
-- signed-out caller has no business reaching them at all.
revoke all on function public.create_wedding() from public;
revoke all on function public.create_invite(uuid, text) from public;
revoke all on function public.accept_invite(text) from public;
revoke all on function public.delete_my_account() from public;

grant execute on function public.create_wedding() to authenticated;
grant execute on function public.create_invite(uuid, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
