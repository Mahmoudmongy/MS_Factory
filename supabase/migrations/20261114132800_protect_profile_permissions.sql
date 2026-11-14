-- Prevent users from escalating their own profile permissions or owner role.
create or replace function public.reject_profile_security_escalation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is not null and v_actor = old.id then
    if new.permissions is distinct from old.permissions
       or new.is_admin is distinct from old.is_admin
       or new.created_by is distinct from old.created_by then
      raise exception 'PROFILE_SECURITY_FIELDS_OWNER_MANAGED'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.reject_profile_security_escalation() from public, anon, authenticated;
drop trigger if exists profiles_reject_self_escalation on public.profiles;
create trigger profiles_reject_self_escalation
before update on public.profiles
for each row execute function public.reject_profile_security_escalation();
