-- Deleting a wedding, and attaching shares to the wedding they belong to.
--
-- Two problems, one cause. `shares` was keyed by token alone and referenced no
-- wedding, so:
--
--   * Nothing cascaded to it. `slices` and `blobs` both carry a foreign key
--     with `on delete cascade`; a share did not. Deleting a wedding would have
--     left its guest link live, still serving the plan as it was — which is the
--     precise failure the "one live link per wedding" rule was written to
--     prevent, arrived at from the other direction.
--
--   * `delete_share` matched on token only. The route authorises the caller
--     against a wedding, but the token was never checked to belong to it, so a
--     holder of one wedding's passphrase could take down another's link given
--     its token.
--
-- Both are fixed by the column that should have been there from the start.
--
-- DESTRUCTIVE: existing rows cannot be attributed. A share records no wedding,
-- and nothing else in the schema relates the two, so there is no backfill to
-- write — the information was never stored. Rows predating this migration are
-- therefore deleted rather than left null, which would have meant either a
-- nullable column forever or a takedown path that still matched across
-- weddings. Any guest link published before this migration stops working and
-- must be published again; the client mints the same token from what it already
-- holds, so republishing restores the same URL.

alter table public.shares
  add column if not exists wedding_id text
    references public.weddings (id) on delete cascade;

delete from public.shares where wedding_id is null;

alter table public.shares
  alter column wedding_id set not null;

-- Every lookup that is not by primary key is by wedding.
create index if not exists shares_wedding_id_idx on public.shares (wedding_id);

-- No function for the delete itself: `weddings` is the parent of `slices`,
-- `blobs` and now `shares`, all of them `on delete cascade`, so removing the one
-- row removes the wedding entirely. A `security definer` wrapper would add a
-- second thing to keep in step with the foreign keys for no gain.
