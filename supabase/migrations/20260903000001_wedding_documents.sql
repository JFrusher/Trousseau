-- A wedding's own account-owned data: one JSONB document per wedding, plus an
-- append-only snapshot history. Entirely separate from the E2E-encrypted
-- passphrase-based sharing in 20260830000001_suite_sync.sql (that system's
-- `weddings`/`slices` tables are untouched and unrelated) and built on top of
-- 20260902000001_accounts.sql's `account_weddings`/`wedding_members`, not the
-- sync system's own `weddings` table of the same-sounding name.

create table if not exists public.wedding_documents (
  wedding_id uuid primary key references public.account_weddings (id) on delete cascade,
  document   jsonb not null default '{}'::jsonb,
  -- Starts at 0, meaning "no document has ever been saved for this wedding
  -- yet" — save_wedding_document()'s insert branch below only fires when the
  -- caller's expected version is 0, so a wedding's first save creates this
  -- row rather than requiring it to be pre-created at wedding-creation time.
  version    integer not null default 0,
  updated_at timestamptz not null default now(),
  -- `on delete set null`, not the default `no action`: the person who last
  -- saved a wedding's document is very often not the only member, and their
  -- account being deleted later must not block their own deletion nor erase
  -- their partner's wedding. See 20260902000001_accounts.sql's `invites` table
  -- comment for the identical reasoning (and the bug that shipped without it).
  updated_by uuid references auth.users (id) on delete set null
);

-- Append-only: every accepted write to wedding_documents inserts exactly one
-- row here, in the same transaction, as a full snapshot (not a diff) — the
-- DVC version-history replacement. Nothing in this migration updates or
-- deletes a row here once inserted.
create table if not exists public.wedding_document_history (
  id         uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.account_weddings (id) on delete cascade,
  document   jsonb not null,
  saved_at   timestamptz not null default now(),
  -- Same `set null` reasoning as wedding_documents.updated_by above — a
  -- history row must survive its author's later account deletion.
  saved_by   uuid references auth.users (id) on delete set null
);

alter table public.wedding_documents         enable row level security;
alter table public.wedding_document_history  enable row level security;

-- Every mutation goes through save_wedding_document() below; direct table
-- access from the client is read-only, and only for a wedding's own members —
-- the same shape 20260902000001_accounts.sql already established.
grant select on public.wedding_documents        to authenticated;
grant select on public.wedding_document_history to authenticated;
revoke insert, update, delete on public.wedding_documents        from authenticated;
revoke insert, update, delete on public.wedding_document_history from authenticated;
revoke all on public.wedding_documents        from anon;
revoke all on public.wedding_document_history from anon;

-- Reuses is_wedding_member(), not a fresh subquery against wedding_members —
-- a policy here that queried wedding_members directly would be fine on its
-- own (this table does not recurse into itself), but there is no reason to
-- duplicate the membership check's own bugs-not-yet-found when a tested,
-- already-shipped helper says the same thing.
drop policy if exists "members can read their wedding's document" on public.wedding_documents;
create policy "members can read their wedding's document"
  on public.wedding_documents for select
  using (public.is_wedding_member(wedding_id));

drop policy if exists "members can read their wedding's document history" on public.wedding_document_history;
create policy "members can read their wedding's document history"
  on public.wedding_document_history for select
  using (public.is_wedding_member(wedding_id));

/**
 * Compare-and-set write: accept the incoming document only if the caller's
 * expected version still matches what is stored, and record a full snapshot
 * in wedding_document_history in the same transaction as any accepted write.
 *
 * Does NOT mirror put_slice's single `insert ... select ... where
 * p_expected = 0 on conflict ... do update` shape from
 * 20260830000002_suite_sync_fixes.sql — that shape has a real, confirmed bug
 * (see the comment inside the function body below) where the UPDATE branch
 * silently never runs for any non-zero expected version. This instead tries
 * an unconditional `update ... where wedding_id = ... and version =
 * p_expected_version` first (the common case, since a document row exists
 * for every wedding after its first save), and only attempts an `insert ...
 * on conflict (wedding_id) do nothing` when that update matched nothing and
 * the caller expected version 0 — i.e. the first-ever-save case. Each
 * statement is still race-free on its own under concurrent writers (the
 * UPDATE's row lock, and the INSERT's own conflict handling), without a
 * separate `for update` step — unlike accept_invite/delete_my_account in
 * 20260902000001_accounts.sql, which lock a *different* row (the wedding)
 * before counting members in a *different* table, there is only one row
 * involved here.
 *
 * Cross-slice validation (the ported validate-wedding.mjs logic) does not
 * live here — it runs in TypeScript, in
 * suite/lib/documents/handlers.ts (Task 4), before this function is ever
 * called, because that logic is pure and depends only on the *incoming*
 * document, never on concurrent database state. Rewriting it in plpgsql
 * would duplicate real business logic in a second language for no
 * correctness benefit.
 */
create or replace function public.save_wedding_document(
  p_wedding_id       uuid,
  p_document         jsonb,
  p_expected_version integer
)
returns table (accepted boolean, version integer, document jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_written record;
  v_current record;
begin
  if not public.is_wedding_member(p_wedding_id) then
    raise exception 'not a member of that wedding' using errcode = '42501';
  end if;

  -- Try the update first — the common case, since a document row exists for
  -- every wedding after its first save. This is NOT put_slice's single
  -- `insert ... select ... where p_expected = 0 on conflict ... do update`
  -- shape, on purpose: that shape has a real, confirmed bug — when the
  -- SELECT's `where` filters out its only candidate row (which it does for
  -- every non-zero expected version), Postgres has zero proposed rows to
  -- insert, so ON CONFLICT never fires at all, and the UPDATE branch —
  -- including every ordinary second-or-later write with the correct
  -- expected version — silently never runs. Splitting into an explicit
  -- UPDATE-then-INSERT avoids that: the UPDATE is unconditional over the
  -- wedding_id/version match (no row-generation step to suppress), and the
  -- INSERT is a plain, unconditionally-proposed row so
  -- `on conflict (wedding_id) do nothing` can always detect a genuine
  -- concurrent first-write race, the same race put_slice's own comment
  -- describes handling.
  update public.wedding_documents d
     set document   = p_document,
         version    = d.version + 1,
         updated_at = now(),
         updated_by = auth.uid()
   where d.wedding_id = p_wedding_id
     and d.version = p_expected_version
  returning d.document, d.version, d.updated_at
       into v_written;

  if v_written is null and p_expected_version = 0 then
    -- No row was updated. If the caller expected "nothing saved yet",
    -- attempt to create it — `on conflict do nothing` rather than `do
    -- update` because a version mismatch on an existing row is already a
    -- rejection, not something to retry as an update here.
    insert into public.wedding_documents as d (wedding_id, document, version, updated_at, updated_by)
    values (p_wedding_id, p_document, 1, now(), auth.uid())
    on conflict (wedding_id) do nothing
    returning d.document, d.version, d.updated_at
         into v_written;
  end if;

  if v_written is not null then
    insert into public.wedding_document_history (wedding_id, document, saved_at, saved_by)
    values (p_wedding_id, v_written.document, v_written.updated_at, auth.uid());

    return query select true, v_written.version, v_written.document, v_written.updated_at;
    return;
  end if;

  -- Rejected: either a real version mismatch on an existing row, or
  -- p_expected_version was above 0 on a wedding with no document row yet.
  -- Either way, return the true current state so the caller can show it —
  -- never a generic failure.
  select d.document, d.version, d.updated_at
    into v_current
    from public.wedding_documents d
   where d.wedding_id = p_wedding_id;

  if v_current is not null then
    return query select false, v_current.version, v_current.document, v_current.updated_at;
  else
    return query select false, 0, null::jsonb, null::timestamptz;
  end if;
end;
$$;

revoke all on function public.save_wedding_document(uuid, jsonb, integer) from public;
grant execute on function public.save_wedding_document(uuid, jsonb, integer) to authenticated;
