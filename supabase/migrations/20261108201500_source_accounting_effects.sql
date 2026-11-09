-- Draft migration: source-scoped accounting and inventory effects.
-- This migration is intentionally NOT applied to the production Supabase project.
-- Client writes must go through sync_source_effect(); direct table writes are revoked.

create table if not exists public.source_effects (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('doc', 'po', 'vch', 'je', 'wo')),
  source_id text not null check (length(btrim(source_id)) between 1 and 200),
  sync_version integer not null default 1 check (sync_version > 0),
  payload jsonb,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (user_id, source_type, source_id),
  check (
    (deleted_at is null and payload is not null)
    or
    (deleted_at is not null and payload is null)
  )
);

-- SKU is the human-facing item code; reject cross-device collisions instead of
-- silently creating two different items with the same operational code.
create unique index if not exists products_owner_sku_unique_idx
  on public.products (user_id, sku)
  where nullif(btrim(sku), '') is not null;

create index if not exists source_effects_owner_updated_idx
  on public.source_effects (user_id, updated_at desc);

alter table public.source_effects enable row level security;

-- No direct SELECT/INSERT/UPDATE/DELETE: the read RPC redacts ledger and
-- movement sections independently according to the caller's role.
drop policy if exists source_effects_read_permission on public.source_effects;
revoke all on table public.source_effects from public, anon, authenticated;

create or replace function private.sync_source_effect(
  p_source_type text,
  p_source_id text,
  p_expected_version integer,
  p_payload jsonb,
  p_deleted boolean default false
)
returns table(sync_version integer, updated_at timestamptz, deleted_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_owner_id uuid;
  v_permission text;
  v_can_write_ledger boolean;
  v_can_write_movements boolean;
  v_write_ledger boolean := false;
  v_write_movements boolean := false;
  v_current_version integer;
  v_new_version integer;
  v_updated_at timestamptz;
  v_deleted_at timestamptz;
  v_existing_payload jsonb;
  v_merged_payload jsonb;
  v_debits numeric := 0;
  v_credits numeric := 0;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select coalesce(p.created_by, p.id)
    into v_owner_id
    from public.profiles as p
   where p.id = v_actor_id;

  if v_owner_id is null then
    raise exception 'Factory profile not found' using errcode = '42501';
  end if;

  v_permission := case p_source_type
    when 'doc' then 'invoices'
    when 'po' then 'production'
    when 'vch' then 'invoices'
    when 'je' then 'settings'
    when 'wo' then 'inventory'
    else null
  end;

  if v_permission is null
     or nullif(btrim(p_source_id), '') is null
     or length(p_source_id) > 200
     or p_expected_version is null
     or p_expected_version < 0 then
    raise exception 'Invalid source effect identity or version' using errcode = '22023';
  end if;

  v_can_write_ledger := private.can_access_factory_owner(v_owner_id, v_permission, true);
  v_can_write_movements := private.can_access_factory_owner(v_owner_id, 'inventory', true);

  if coalesce(p_deleted, false) then
    -- A tombstone removes both sections, so it requires permission for both.
    if not v_can_write_ledger or not v_can_write_movements then
      raise exception 'Deleting a complete source effect requires ledger and inventory write permissions'
        using errcode = '42501';
    end if;
    p_payload := null;
  else
    if p_payload is null
       or pg_catalog.jsonb_typeof(p_payload) <> 'object'
       or p_payload ->> 'sourceType' is distinct from p_source_type
       or p_payload ->> 'sourceId' is distinct from p_source_id
       or pg_catalog.octet_length(p_payload::text) > 1048576 then
      raise exception 'Invalid or oversized source effect payload' using errcode = '22023';
    end if;

    v_write_ledger := coalesce(p_payload -> 'ledgerIncluded' = 'true'::jsonb, false);
    v_write_movements := coalesce(p_payload -> 'movementsIncluded' = 'true'::jsonb, false);

    if not v_write_ledger and not v_write_movements then
      raise exception 'At least one authorized source-effect section must be included'
        using errcode = '42501';
    end if;
    if v_write_ledger and not v_can_write_ledger then
      raise exception 'Not authorized to write this source ledger section' using errcode = '42501';
    end if;
    if v_write_movements and not v_can_write_movements then
      raise exception 'Not authorized to write this source inventory section' using errcode = '42501';
    end if;

    if v_write_ledger then
      if pg_catalog.jsonb_typeof(p_payload -> 'ledger') is distinct from 'array' then
        raise exception 'Included ledger section must be an array' using errcode = '22023';
      end if;
      if exists (
        select 1
          from pg_catalog.jsonb_array_elements(p_payload -> 'ledger') as x(value)
         where nullif(pg_catalog.btrim(x.value ->> 'accountCode'), '') is null
            or pg_catalog.jsonb_typeof(x.value -> 'debit') is distinct from 'number'
            or pg_catalog.jsonb_typeof(x.value -> 'credit') is distinct from 'number'
            or (x.value ->> 'debit')::numeric < 0
            or (x.value ->> 'credit')::numeric < 0
      ) then
        raise exception 'Ledger rows require an account code and non-negative amounts' using errcode = '22023';
      end if;

      select coalesce(sum(coalesce((x.value ->> 'debit')::numeric, 0)), 0),
             coalesce(sum(coalesce((x.value ->> 'credit')::numeric, 0)), 0)
        into v_debits, v_credits
        from pg_catalog.jsonb_array_elements(p_payload -> 'ledger') as x(value);

      if pg_catalog.abs(v_debits - v_credits) > 0.005 then
        raise exception 'Source ledger effect is not balanced' using errcode = '22023';
      end if;

      if exists (
        select 1
          from pg_catalog.jsonb_array_elements(p_payload -> 'ledger') as x(value)
         where nullif(x.value ->> 'partnerExternalId', '') is not null
           and not exists (
             select 1 from public.customers as c
              where c.user_id = v_owner_id and c.external_id = x.value ->> 'partnerExternalId'
             union all
             select 1 from public.suppliers as s
              where s.user_id = v_owner_id and s.external_id = x.value ->> 'partnerExternalId'
           )
      ) then
        raise exception 'Ledger effect references a partner not registered for this factory'
          using errcode = '22023';
      end if;
    end if;

    if v_write_movements then
      if pg_catalog.jsonb_typeof(p_payload -> 'movements') is distinct from 'array' then
        raise exception 'Included inventory section must be an array' using errcode = '22023';
      end if;
      if exists (
        select 1
          from pg_catalog.jsonb_array_elements(p_payload -> 'movements') as x(value)
         where nullif(pg_catalog.btrim(x.value ->> 'itemExternalId'), '') is null
            or nullif(pg_catalog.btrim(x.value ->> 'variant'), '') is null
            or pg_catalog.jsonb_typeof(x.value -> 'quantity') is distinct from 'number'
            or pg_catalog.jsonb_typeof(x.value -> 'value') is distinct from 'number'
            or not exists (
              select 1 from public.products as pr
               where pr.user_id = v_owner_id
                 and pr.external_id = x.value ->> 'itemExternalId'
            )
      ) then
        raise exception 'Stock movements contain invalid values or an item not registered for this factory'
          using errcode = '22023';
      end if;

      if exists (
        select 1
          from pg_catalog.jsonb_array_elements(p_payload -> 'movements') as x(value)
         where nullif(x.value ->> 'partnerExternalId', '') is not null
           and not exists (
             select 1 from public.customers as c
              where c.user_id = v_owner_id and c.external_id = x.value ->> 'partnerExternalId'
             union all
             select 1 from public.suppliers as s
              where s.user_id = v_owner_id and s.external_id = x.value ->> 'partnerExternalId'
           )
      ) then
        raise exception 'Stock movement references a partner not registered for this factory'
          using errcode = '22023';
      end if;
    end if;
  end if;

  -- Serialize source writes against the one-time factory baseline publication.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text || ':factory-opening-baseline', 0)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_owner_id::text || ':' || p_source_type || ':' || p_source_id, 0
    )
  );

  select se.sync_version, se.payload
    into v_current_version, v_existing_payload
    from public.source_effects as se
   where se.user_id = v_owner_id
     and se.source_type = p_source_type
     and se.source_id = p_source_id
   for update;

  if not found then
    if p_expected_version <> 0 then
      raise exception 'Source effect version conflict: expected a new source'
        using errcode = '40001';
    end if;
    if not coalesce(p_deleted, false) then
      v_merged_payload := pg_catalog.jsonb_build_object(
        'sourceType', p_source_type,
        'sourceId', p_source_id,
        'ledger', case when v_write_ledger then p_payload -> 'ledger' else '[]'::jsonb end,
        'movements', case when v_write_movements then p_payload -> 'movements' else '[]'::jsonb end
      );
    end if;

    insert into public.source_effects as se (
      user_id, source_type, source_id, sync_version, payload,
      deleted_at, updated_at, updated_by
    ) values (
      v_owner_id, p_source_type, p_source_id, 1, v_merged_payload,
      case when p_deleted then pg_catalog.now() else null end,
      pg_catalog.now(), v_actor_id
    )
    returning se.sync_version, se.updated_at, se.deleted_at
      into v_new_version, v_updated_at, v_deleted_at;
  else
    if p_expected_version <> v_current_version then
      raise exception 'Source effect version conflict: expected %, found %',
        p_expected_version, v_current_version
        using errcode = '40001';
    end if;

    if not coalesce(p_deleted, false) then
      v_merged_payload := pg_catalog.jsonb_build_object(
        'sourceType', p_source_type,
        'sourceId', p_source_id,
        'ledger', case when v_write_ledger then p_payload -> 'ledger'
                       else coalesce(v_existing_payload -> 'ledger', '[]'::jsonb) end,
        'movements', case when v_write_movements then p_payload -> 'movements'
                          else coalesce(v_existing_payload -> 'movements', '[]'::jsonb) end
      );
    end if;

    update public.source_effects as se
       set payload = v_merged_payload,
           deleted_at = case when p_deleted then pg_catalog.now() else null end,
           sync_version = se.sync_version + 1,
           updated_at = pg_catalog.now(),
           updated_by = v_actor_id
     where se.user_id = v_owner_id
       and se.source_type = p_source_type
       and se.source_id = p_source_id
     returning se.sync_version, se.updated_at, se.deleted_at
       into v_new_version, v_updated_at, v_deleted_at;
  end if;

  if not coalesce(p_deleted, false)
     and pg_catalog.jsonb_array_length(v_merged_payload -> 'ledger') = 0
     and pg_catalog.jsonb_array_length(v_merged_payload -> 'movements') = 0 then
    raise exception 'A source effect cannot be empty; use a tombstone to delete it'
      using errcode = '22023';
  end if;

  sync_version := v_new_version;
  updated_at := v_updated_at;
  deleted_at := v_deleted_at;
  return next;
end;
$function$;

revoke all on function private.sync_source_effect(text, text, integer, jsonb, boolean) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.sync_source_effect(text, text, integer, jsonb, boolean) to authenticated;

-- PostgREST-facing wrapper is SECURITY INVOKER; privileged logic stays in the
-- unexposed private schema and performs its own auth.uid()/permission checks.
create or replace function public.sync_source_effect(
  p_source_type text,
  p_source_id text,
  p_expected_version integer,
  p_payload jsonb,
  p_deleted boolean default false
)
returns table(sync_version integer, updated_at timestamptz, deleted_at timestamptz)
language sql
security invoker
set search_path = ''
as $wrapper$
  select * from private.sync_source_effect($1, $2, $3, $4, $5);
$wrapper$;

revoke all on function public.sync_source_effect(text, text, integer, jsonb, boolean) from public, anon;
grant execute on function public.sync_source_effect(text, text, integer, jsonb, boolean) to authenticated;

create or replace function private.can_access_factory_owner_strict(
  p_owner_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.profiles actor
     where actor.id = (select auth.uid())
       and (
         (actor.id = p_owner_id and actor.is_admin is true)
         or (actor.created_by = p_owner_id
             and p_permission is not null
             and actor.permissions ->> p_permission = 'true')
       )
  );
$function$;

revoke all on function private.can_access_factory_owner_strict(uuid, text) from public, anon;

create or replace function private.get_source_effects()
returns table(
  source_type text,
  source_id text,
  sync_version integer,
  updated_at timestamptz,
  deleted_at timestamptz,
  payload jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_owner_id uuid;
  v_can_read_all_movements boolean;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select coalesce(p.created_by, p.id)
    into v_owner_id
    from public.profiles as p
   where p.id = v_actor_id;

  if v_owner_id is null then
    raise exception 'Factory profile not found' using errcode = '42501';
  end if;

  -- Inventory permission allows stock-only access to all source categories without exposing ledger rows.
  v_can_read_all_movements :=
    private.can_access_factory_owner_strict(v_owner_id, 'inventory');

  return query
  select
    se.source_type,
    se.source_id,
    se.sync_version,
    se.updated_at,
    se.deleted_at,
    case
      when se.deleted_at is not null then null::jsonb
      else pg_catalog.jsonb_build_object(
        'sourceType', se.source_type,
        'sourceId', se.source_id,
        'ledgerIncluded', ledger_access.allowed,
        'movementsIncluded', v_can_read_all_movements,
        'ledger', case when ledger_access.allowed then se.payload -> 'ledger' else '[]'::jsonb end,
        'movements', case when v_can_read_all_movements
                          then se.payload -> 'movements' else '[]'::jsonb end
      )
    end as payload
  from public.source_effects as se
  cross join lateral (
    select private.can_access_factory_owner_strict(
      v_owner_id,
      case se.source_type
        when 'doc' then 'invoices'
        when 'po' then 'production'
        when 'vch' then 'invoices'
        when 'je' then 'settings'
        when 'wo' then 'inventory'
      end
    ) as allowed
  ) as ledger_access
  where se.user_id = v_owner_id
    and (ledger_access.allowed or v_can_read_all_movements)
  order by se.source_type, se.source_id;
end;
$function$;

revoke all on function private.get_source_effects() from public, anon;
grant execute on function private.get_source_effects() to authenticated;

create or replace function public.get_source_effects()
returns table(
  source_type text,
  source_id text,
  sync_version integer,
  updated_at timestamptz,
  deleted_at timestamptz,
  payload jsonb
)
language sql
security invoker
set search_path = ''
as $wrapper$
  select * from private.get_source_effects();
$wrapper$;

revoke all on function public.get_source_effects() from public, anon;
grant execute on function public.get_source_effects() to authenticated;

comment on table public.source_effects is
  'Versioned, source-scoped ledger and inventory effects. Deletions are retained as tombstones.';
comment on function public.sync_source_effect(text, text, integer, jsonb, boolean) is
  'Atomically replaces or tombstones one source effect set using optimistic concurrency and factory permission checks.';
