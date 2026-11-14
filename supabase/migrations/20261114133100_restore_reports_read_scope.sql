-- Keep the report-only read exception while retaining the edit gate for all writes.
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
          and (
            actor.permissions ->> p_permission = 'true'
            or (p_write is false and actor.permissions ->> 'reports' = 'true')
          )
          and (p_write is false or actor.permissions ->> 'edit' = 'true')
        )
      )
  );
$$;
