-- Retention: knowing when a wedding was last touched.
--
-- A public create endpoint accumulates weddings nobody comes back to. Holding
-- strangers' ciphertext for ever with no stated period is a storage-limitation
-- problem, and the schema could not even answer the question — `weddings` had a
-- `created_at` and nothing else, and "last written" meant a max() across
-- `slices` for every row.
--
-- So the wedding row carries its own `updated_at`, and staleness becomes one
-- indexable predicate on one table.
--
-- Touched from inside `put_slice` rather than by a second statement from the
-- application: it is the same transaction as the write it records, so the two
-- cannot disagree, and it costs no extra round trip.
--
-- Only slice writes touch it, which is deliberate. Blobs and shares cannot
-- happen without a wedding that syncs slices — `createShared` writes its slices
-- immediately, and a guest link is published from a document that got there
-- somehow — so slice activity is a faithful signal, and making three call sites
-- responsible for the same column would be three chances to forget.

alter table public.weddings
  add column if not exists updated_at timestamptz not null default now();

-- Existing rows: the only honest starting point is when they were created.
update public.weddings set updated_at = created_at where updated_at < created_at;

create index if not exists weddings_updated_at_idx on public.weddings (updated_at);

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
  -- Unchanged from the previous migration: `insert … select … where` so a first
  -- write is attempted only when the caller expected an absent row, and a
  -- concurrent writer either loses the unique-index race and then updates
  -- nothing, or is serialised behind the row lock. Exactly one of them writes.
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
    -- Only an accepted write counts as activity. A rejected one is a client
    -- that is out of step, and letting it hold a wedding open for another two
    -- years would make the retention period meaningless.
    update public.weddings w set updated_at = now() where w.id = p_wedding;

    return query
      select true, v_written.ciphertext, v_written.iv, v_written.version, v_written.updated_at;
    return;
  end if;

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
