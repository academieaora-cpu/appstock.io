-- Plateforme CAO/SIG : projets enregistrés en ligne par les utilisateurs.
-- Appliquée le 17/11/2026 au projet Supabase « geometre-topo ».
-- Objets nouveaux et préfixés « geo_ » : rien d'existant n'est modifié.

create table if not exists public.geo_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  storage_path text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.geo_projects is 'Projets de la plateforme CAO/SIG enregistrés en ligne ; le contenu est un fichier compressé dans le bucket geo-projects.';

create index if not exists geo_projects_user_updated_idx on public.geo_projects (user_id, updated_at desc);

alter table public.geo_projects enable row level security;

-- Chaque utilisateur ne voit et ne modifie que ses propres projets.
create policy "geo_projects_select_own" on public.geo_projects
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "geo_projects_insert_own" on public.geo_projects
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "geo_projects_update_own" on public.geo_projects
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "geo_projects_delete_own" on public.geo_projects
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.geo_projects from anon;
grant select, insert, update, delete on public.geo_projects to authenticated;

-- Fichiers des projets : bucket privé, un dossier par utilisateur, 50 Mo par fichier.
insert into storage.buckets (id, name, public, file_size_limit)
values ('geo-projects', 'geo-projects', false, 52428800)
on conflict (id) do nothing;

create policy "geo_projects_files_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'geo-projects' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "geo_projects_files_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'geo-projects' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "geo_projects_files_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'geo-projects' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'geo-projects' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "geo_projects_files_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'geo-projects' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- « Bip » de maintien en vie : une requête anodine, sans donnée, qui prouve que le projet est utilisé.
create or replace function public.geo_ping()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now() $$;

comment on function public.geo_ping() is 'Maintien en vie : appelée périodiquement pour éviter la mise en pause du projet pour inactivité.';

revoke all on function public.geo_ping() from public;
grant execute on function public.geo_ping() to anon, authenticated;
