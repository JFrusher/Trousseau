-- Fixes to the suite's sync schema, and the encrypted asset store.
--
-- The compare-and-set in the first migration had a race. `select … for update`
-- locks nothing when the row does not exist, so two machines writing a slice
-- for the first time both read "absent", both matched an expected version of 0,
-- and both inserted — with `on conflict do update` overwriting unconditionally
-- and *both* being told they had succeeded. One machine's work was lost and it
-- was told otherwise, which is the exact failure the version column exists to
-- prevent.
--
-- The fix is to stop reading before writing at all: the insert itself carries
-- both conditions, and whether a row comes back is the answer.

create table if not exists public.blobs (
  wedding_id  text        not null references public.weddings (id) on delete cascade,
  -- Content-addressed by the client, so the same file uploaded twice is stored
  -- once and the id is stable across machines.
  blob_id     text        not null,
  ciphertext  text        not null,
  iv          text        not null,
  created_at  timestamptz not null default now(),
  primary key (wedding_id, blob_id)
);

alter table public.blobs enable row level security;
revoke all on public.blobs from anon, authenticated;

create or replace function public.put_slice(
  p_wedding    text,
  p_slice      text,
  p_ciphertext text,
  p_iv         text,
  p_expected   integer
)
returns table (accepted boolean, ciphertext text, iv text, version integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_written record;
  v_current record;
begin
  -- `insert … select … where` rather than `values`, so a first write is
  -- attempted only when the caller expected an absent row. A client that thinks
  -- it holds version 5 of a slice this wedding has never had is out of step,
  -- and creating version 1 under it would hide that.
  --
  -- A concurrent writer either loses the unique-index race on insert — and then
  -- updates nothing, because its `where` no longer holds — or is serialised
  -- behind the row lock the update takes. Either way exactly one of them writes.
  insert into public.slices as s (wedding_id, slice, ciphertext, iv, version, updated_at)
       select p_wedding, p_slice, p_ciphertext, p_iv, 1, now()
        where p_expected = 0
  on conflict (wedding_id, slice) do update
      set ciphertext = excluded.ciphertext,
          iv         = excluded.iv,
          version    = s.version + 1,
          updated_at = now()
    where s.version = p_expected
  returning s.ciphertext, s.iv, s.version, s.updated_at
       into v_written;

  if v_written is not null then
    return query
      select true, v_written.ciphertext, v_written.iv, v_written.version, v_written.updated_at;
    return;
  end if;

  -- An expected version above zero on a row that does not exist skips the
  -- insert entirely, so that lands here too.
  select s.ciphertext, s.iv, s.version, s.updated_at
    into v_current
    from public.slices s
   where s.wedding_id = p_wedding and s.slice = p_slice;

  if v_current is not null then
    return query
      select false, v_current.ciphertext, v_current.iv, v_current.version, v_current.updated_at;
  else
    return query select false, ''::text, ''::text, 0, to_timestamp(0);
  end if;
end;
$$;

revoke all on function public.put_slice(text, text, text, text, integer) from anon, authenticated;
