-- Tableaux Suite: end-to-end encrypted sync and guest-facing shares.
--
-- Everything in `slices` and `shares` is ciphertext. This database cannot read
-- a single guest name, and neither can anyone who obtains a dump of it. The
-- keys are derived in the browser from a passphrase that is never transmitted.
--
-- Authorisation is a write-token hash checked in the route handler, not a
-- row-level policy: the rows are unreadable anyway, and "does this writer know
-- the passphrase" is not a question a policy can answer. Access is therefore
-- via the service role only, and the anon key is given no grants at all.

create table if not exists public.weddings (
  id          text primary key,
  -- Public by design. A client must be able to fetch it before it can derive
  -- keys to try, and a salt is not a secret.
  salt        text        not null,
  -- SHA-256 of the write token, which is itself HKDF output. Never the token.
  auth_hash   text        not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.slices (
  wedding_id  text        not null references public.weddings (id) on delete cascade,
  slice       text        not null,
  ciphertext  text        not null,
  iv          text        not null,
  -- Bumped on every accepted write. The client sends what it expects to find,
  -- and a mismatch is the two-laptop conflict rather than a lost edit.
  version     integer     not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (wedding_id, slice)
);

create table if not exists public.shares (
  -- The guest-facing link's path segment. The key that decrypts this row is in
  -- the link's fragment, which browsers never send to a server.
  token       text primary key,
  ciphertext  text        not null,
  iv          text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Row-level security on, with no policies. Nothing reaches these tables except
-- the service role, which bypasses RLS. Leaving RLS off would expose them to
-- the anon key the moment the client library is pointed at this project.
alter table public.weddings enable row level security;
alter table public.slices   enable row level security;
alter table public.shares   enable row level security;

revoke all on public.weddings from anon, authenticated;
revoke all on public.slices   from anon, authenticated;
revoke all on public.shares   from anon, authenticated;

/**
 * Compare-and-set for one slice.
 *
 * The check and the write have to be one statement. Two laptops writing the
 * same slice in the same instant would otherwise both read version 3, both
 * find it matching, and both write version 4 — losing one edit silently, which
 * is the exact failure the version column exists to prevent.
 */
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
  v_current integer;
begin
  select s.version into v_current
    from public.slices s
   where s.wedding_id = p_wedding and s.slice = p_slice
     for update;

  -- Absent is version 0, so a first write expects 0 and needs no special case.
  v_current := coalesce(v_current, 0);

  if v_current <> p_expected then
    return query
      select false,
             coalesce(s.ciphertext, ''),
             coalesce(s.iv, ''),
             v_current,
             coalesce(s.updated_at, to_timestamp(0))
        from public.slices s
       where s.wedding_id = p_wedding and s.slice = p_slice
       union all
       select false, '', '', v_current, to_timestamp(0)
       where not exists (
         select 1 from public.slices s2
          where s2.wedding_id = p_wedding and s2.slice = p_slice
       )
       limit 1;
    return;
  end if;

  insert into public.slices as s (wedding_id, slice, ciphertext, iv, version, updated_at)
       values (p_wedding, p_slice, p_ciphertext, p_iv, v_current + 1, now())
  on conflict (wedding_id, slice) do update
      set ciphertext = excluded.ciphertext,
          iv         = excluded.iv,
          version    = excluded.version,
          updated_at = excluded.updated_at;

  return query
    select true, p_ciphertext, p_iv, v_current + 1, now();
end;
$$;

revoke all on function public.put_slice(text, text, text, text, integer) from anon, authenticated;
