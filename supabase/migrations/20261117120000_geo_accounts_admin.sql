-- Comptes de la plateforme CAO/SIG : profils, dernière activité, administration.
-- Objets nouveaux préfixés « geo_ » ; un déclencheur crée le profil à l'inscription.

create table if not exists public.geo_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (char_length(full_name) <= 120),
  organisation text check (char_length(organisation) <= 160),
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

comment on table public.geo_profiles is 'Profils des utilisateurs de la plateforme CAO/SIG (rôle, dernière activité).';

alter table public.geo_profiles enable row level security;

create policy "geo_profiles_select_own" on public.geo_profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "geo_profiles_update_own" on public.geo_profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

grant select on public.geo_profiles to authenticated;
-- Le rôle n'est pas modifiable par l'utilisateur lui-même.
grant update (full_name, organisation) on public.geo_profiles to authenticated;

create or replace function public.geo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.geo_profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end
$$;

create trigger geo_on_auth_user_created
  after insert on auth.users
  for each row execute function public.geo_handle_new_user();

insert into public.geo_profiles (id, email) select id, email from auth.users on conflict (id) do nothing;

-- Dernière activité (appelée à l'ouverture de la plateforme) ; renvoie le rôle.
create or replace function public.geo_touch()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare r text;
begin
  if auth.uid() is null then return null; end if;
  insert into public.geo_profiles (id, email, last_seen_at)
    select u.id, u.email, now() from auth.users u where u.id = auth.uid()
  on conflict (id) do update set last_seen_at = now(), email = excluded.email
  returning role into r;
  return r;
end
$$;

create or replace function public.geo_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.geo_profiles where id = auth.uid() and role = 'admin')
$$;

-- Codes administrateur à usage unique : seule leur empreinte SHA-256 est stockée.
create table if not exists public.geo_admin_codes (
  code_hash text primary key,
  created_at timestamptz not null default now(),
  used_by uuid,
  used_at timestamptz
);
alter table public.geo_admin_codes enable row level security;

create or replace function public.geo_claim_admin(code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare h text := encode(sha256(convert_to(coalesce(code, ''), 'UTF8')), 'hex');
begin
  if auth.uid() is null then return false; end if;
  update public.geo_admin_codes set used_by = auth.uid(), used_at = now() where code_hash = h and used_at is null;
  if not found then return false; end if;
  insert into public.geo_profiles (id, email, role)
    select u.id, u.email, 'admin' from auth.users u where u.id = auth.uid()
  on conflict (id) do update set role = 'admin';
  return true;
end
$$;

create or replace function public.geo_admin_overview()
returns table (
  id uuid,
  email text,
  full_name text,
  organisation text,
  role text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  last_seen_at timestamptz,
  projects bigint,
  storage_bytes bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.geo_is_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, p.full_name, p.organisation, coalesce(p.role, 'user'), u.created_at, u.last_sign_in_at, p.last_seen_at,
           coalesce(g.n, 0)::bigint, coalesce(g.bytes, 0)::bigint
    from auth.users u
    left join public.geo_profiles p on p.id = u.id
    left join (select gp.user_id, count(*) as n, sum(gp.size_bytes) as bytes from public.geo_projects gp group by gp.user_id) g on g.user_id = u.id
    order by u.created_at desc;
end
$$;

create or replace function public.geo_admin_set_role(target uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.geo_is_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  if new_role not in ('user', 'admin') then raise exception 'Rôle inconnu'; end if;
  if target = auth.uid() and new_role <> 'admin' then raise exception 'Vous ne pouvez pas retirer vos propres droits'; end if;
  insert into public.geo_profiles (id, email, role)
    select u.id, u.email, new_role from auth.users u where u.id = target
  on conflict (id) do update set role = excluded.role;
end
$$;

grant execute on function public.geo_touch() to authenticated;
grant execute on function public.geo_is_admin() to authenticated;
grant execute on function public.geo_claim_admin(text) to authenticated;
grant execute on function public.geo_admin_overview() to authenticated;
grant execute on function public.geo_admin_set_role(uuid, text) to authenticated;
