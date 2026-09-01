-- A ceiling on what one wedding can store.
--
-- Every individual limit was already in place and none of them added up to
-- anything: 64 assets at 8MB plus 16 slices at 4MB is 576MB per wedding, and
-- since anyone may create a wedding and then set its own passphrase, uploading
-- to it needs no permission from us. Rate limiting the create endpoint bounds
-- how many weddings a stranger makes per hour; it does nothing about how large
-- each one gets.
--
-- The sum has to be cheap to ask for. Summing `length(ciphertext)` means the
-- database reading every asset it holds for the wedding on every upload, and
-- asking PostgREST for the same means sending them all to the application. So
-- the length is recorded on the row when it is written, and the check reads a
-- column of integers.

alter table public.blobs
  add column if not exists bytes integer not null default 0;

-- Existing rows: measured once, here, rather than left at zero — a wedding that
-- is already at the ceiling should be refused its next upload, not given a
-- fresh budget.
update public.blobs set bytes = length(ciphertext) where bytes = 0;

create index if not exists blobs_wedding_id_idx on public.blobs (wedding_id);
