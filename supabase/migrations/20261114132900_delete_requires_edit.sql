-- A delete permission is meaningful only when the employee also has edit rights.
create or replace function private.update_employee_permissions(
  p_employee_id uuid, p_permissions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_allowed text[] := array['invoices','inventory','customers','suppliers','production','reports','settings','edit','delete'];
begin
  if v_actor is null then
    raise exception 'EMPLOYEE_PERMISSION_AUTH_REQUIRED' using errcode='42501';
  end if;
  if jsonb_typeof(p_permissions) is distinct from 'object' then
    raise exception 'EMPLOYEE_PERMISSION_PAYLOAD_INVALID' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_permissions) as keys(key) where not (keys.key = any(v_allowed)))
     or exists (select 1 from jsonb_each(p_permissions) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'EMPLOYEE_PERMISSION_KEYS_INVALID' using errcode='22023';
  end if;
  if p_permissions ->> 'delete' = 'true' and p_permissions ->> 'edit' is distinct from 'true' then
    raise exception 'EMPLOYEE_DELETE_REQUIRES_EDIT' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.profiles owner_profile
    where owner_profile.id=v_actor and owner_profile.is_admin is true and owner_profile.created_by is null
  ) then
    raise exception 'EMPLOYEE_PERMISSION_OWNER_ONLY' using errcode='42501';
  end if;
  select created_by into v_owner from public.profiles where id=p_employee_id for update;
  if not found or v_owner is distinct from v_actor then
    raise exception 'EMPLOYEE_PERMISSION_TARGET_NOT_OWNED' using errcode='42501';
  end if;
  update public.profiles set permissions=p_permissions where id=p_employee_id;
  return p_permissions;
end;
$$;
