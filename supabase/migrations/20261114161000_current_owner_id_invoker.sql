-- current_owner_id only reads the caller's own profile row; SECURITY INVOKER is sufficient under profiles RLS.
create or replace function public.current_owner_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(p.created_by,p.id)
  from public.profiles p
  where p.id = (select auth.uid());
$function$;
revoke all on function public.current_owner_id() from public, anon;
grant execute on function public.current_owner_id() to authenticated, service_role;
