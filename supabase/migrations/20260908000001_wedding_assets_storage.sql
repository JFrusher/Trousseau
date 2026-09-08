-- Fonts and artwork for the account-based sync system, in Supabase Storage
-- rather than a Postgres table: client uploads/downloads go straight to
-- Storage, so a large embedded font never has to pass through a serverless
-- function's ~4.5MB body-size ceiling. Scoped by is_wedding_member(), the
-- same helper 20260902000001_accounts.sql already established for
-- wedding_documents - see that migration for why it is reused rather than a
-- fresh policy querying wedding_members directly.
--
-- Object paths are "{wedding_id}/{asset_id}" - the policies below read the
-- wedding id as the first path segment via storage.foldername(name).

insert into storage.buckets (id, name, public)
values ('wedding-assets', 'wedding-assets', false)
on conflict (id) do nothing;

drop policy if exists "wedding members can read their wedding-assets" on storage.objects;
create policy "wedding members can read their wedding-assets"
  on storage.objects for select
  using (
    bucket_id = 'wedding-assets'
    and public.is_wedding_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "wedding members can upload their wedding-assets" on storage.objects;
create policy "wedding members can upload their wedding-assets"
  on storage.objects for insert
  with check (
    bucket_id = 'wedding-assets'
    and public.is_wedding_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "wedding members can replace their wedding-assets" on storage.objects;
create policy "wedding members can replace their wedding-assets"
  on storage.objects for update
  using (
    bucket_id = 'wedding-assets'
    and public.is_wedding_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "wedding members can delete their wedding-assets" on storage.objects;
create policy "wedding members can delete their wedding-assets"
  on storage.objects for delete
  using (
    bucket_id = 'wedding-assets'
    and public.is_wedding_member((storage.foldername(name))[1]::uuid)
  );
