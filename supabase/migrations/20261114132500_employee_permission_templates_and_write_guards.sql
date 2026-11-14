-- Enforce module read/write/delete permissions for employee profiles.
create or replace function private.can_access_factory_owner(
  p_owner_id uuid, p_permission text, p_write boolean
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles as actor
    where actor.id = (select auth.uid())
      and (
        (actor.id = p_owner_id and actor.is_admin is true)
        or (
          actor.created_by = p_owner_id
          and p_permission is not null
          and (actor.permissions ->> p_permission = 'true'
            or (p_write is false and actor.permissions ->> 'reports' = 'true'))
          and (p_write is false or actor.permissions ->> 'edit' = 'true')
        )
      )
  );
$$;
update public.profiles p
set permissions = coalesce(p.permissions,'{}'::jsonb) || '{"edit":true}'::jsonb
where p.created_by is not null
  and not (coalesce(p.permissions,'{}'::jsonb) ? 'edit')
  and exists (
    select 1 from jsonb_each_text(coalesce(p.permissions,'{}'::jsonb)) e
    where e.key in ('invoices','inventory','customers','suppliers','production','reports','settings')
      and e.value = 'true'
  );
create or replace function private.can_delete_factory_record(
  p_owner_id uuid, p_record_type text
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_access_factory_record(p_owner_id,p_record_type,true)
    and exists (
      select 1 from public.profiles actor
      where actor.id = (select auth.uid())
        and (
          (actor.id = p_owner_id and actor.is_admin is true)
          or (actor.created_by = p_owner_id and actor.permissions ->> 'delete' = 'true')
        )
    );
$$;
revoke all on function private.can_delete_factory_record(uuid,text) from public, anon;
grant execute on function private.can_delete_factory_record(uuid,text) to authenticated;
drop policy if exists factory_records_update on public.factory_records;
create policy factory_records_update on public.factory_records
for update to authenticated
using (private.can_access_factory_record(user_id,record_type,true))
with check (
  private.can_access_factory_record(user_id,record_type,true)
  and (deleted_at is null or private.can_delete_factory_record(user_id,record_type))
);
drop policy if exists factory_records_delete on public.factory_records;
create policy factory_records_delete on public.factory_records
for delete to authenticated
using (private.can_delete_factory_record(user_id,record_type));
create or replace function public.update_employee_permissions(
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
revoke all on function public.update_employee_permissions(uuid,jsonb) from public, anon;
grant execute on function public.update_employee_permissions(uuid,jsonb) to authenticated;
