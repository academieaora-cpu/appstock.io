-- Les fonctions des comptes ne sont appelables que par un utilisateur connecté ;
-- la fonction du déclencheur ne l'est par personne. Chaque fonction vérifie elle-même
-- l'utilisateur (auth.uid()) et, pour l'administration, le rôle « admin ».
revoke execute on function public.geo_handle_new_user() from public, anon, authenticated;
revoke execute on function public.geo_touch() from public, anon;
revoke execute on function public.geo_is_admin() from public, anon;
revoke execute on function public.geo_claim_admin(text) from public, anon;
revoke execute on function public.geo_admin_overview() from public, anon;
revoke execute on function public.geo_admin_set_role(uuid, text) from public, anon;
grant execute on function public.geo_touch() to authenticated;
grant execute on function public.geo_is_admin() to authenticated;
grant execute on function public.geo_claim_admin(text) to authenticated;
grant execute on function public.geo_admin_overview() to authenticated;
grant execute on function public.geo_admin_set_role(uuid, text) to authenticated;
