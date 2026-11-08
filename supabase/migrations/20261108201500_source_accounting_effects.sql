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

create index if not exists source_effects_owner_updated_idx
  on public.source_effects (user_id, updated_at desc);

alter table public.source_effects enable row level security;

drop policy if exists source_effects_read_permission on public.source_effects;
create policy source_effects_read_permission
  on public.source_effects
  for select
  to authenticated
  using (
    private.can_access_factory_owner(
      user_id,
      case source_type
        when 'doc' then 'invoices'
        when 'po' then 'production'
        when 'vch' then 'invoices'
        when 'je' then 'settings'
        when 'wo' then 'inventory'
      end,
      false
    )
  );

revoke all on table public.source_effects from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.source_effects from authenticated;
grant select on table public.source_effects to authenticated;

create or replace function public.sync_source_effect(
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
  v_current_version integer;
  v_new_version integer;
  v_updated_at timestamptz;
  v_deleted_at timestamptz;
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

  if not private.can_access_factory_owner(v_owner_id, v_permission, true) then
    raise exception 'Not authorized to write this source category' using errcode = '42501';
  end if;

  if coalesce(p_deleted, false) is false then
    if p_payload is null
       or pg_catalog.jsonb_typeof(p_payload) <> 'object'
       or pg_catalog.jsonb_typeof(p_payload -> 'ledger') <> 'array'
       or pg_catalog.jsonb_typeof(p_payload -> 'movements') <> 'array'
       or (pg_catalog.jsonb_array_length(p_payload -> 'ledger') = 0
           and pg_catalog.jsonb_array_length(p_payload -> 'movements') = 0)
       or pg_catalog.octet_length(p_payload::text) > 1048576 then
      raise exception 'Invalid or oversized source effect payload' using errcode = '22023';
    end if;

    if exists (
      select 1
        from pg_catalog.jsonb_array_elements(p_payload -> 'ledger') as x(value)
       where nullif(pg_catalog.btrim(x.value ->> 'accountCode'), '') is null
          or coalesce((x.value ->> 'debit')::numeric, 0) < 0
          or coalesce((x.value ->> 'credit')::numeric, 0) < 0
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
        from pg_catalog.jsonb_array_elements(p_payload -> 'movements') as x(value)
       where nullif(pg_catalog.btrim(x.value ->> 'itemExternalId'), '') is null
          or nullif(pg_catalog.btrim(x.value ->> 'variant'), '') is null
    ) then
      raise exception 'Stock movements require stable item and variant identities' using errcode = '22023';
    end if;
  else
    p_payload := null;
  end if;

  -- Serialize concurrent first-writes as well as updates to the same source key.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_owner_id::text || ':' || p_source_type || ':' || p_source_id, 0
    )
  );

  select se.sync_version
    into v_current_version
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

    insert into public.source_effects (
      user_id, source_type, source_id, sync_version, payload,
      deleted_at, updated_at, updated_by
    ) values (
      v_owner_id, p_source_type, p_source_id, 1, p_payload,
      case when p_deleted then pg_catalog.now() else null end,
      pg_catalog.now(), v_actor_id
    )
    returning source_effects.sync_version, source_effects.updated_at, source_effects.deleted_at
      into v_new_version, v_updated_at, v_deleted_at;
  else
    if p_expected_version <> v_current_version then
      raise exception 'Source effect version conflict: expected %, found %',
        p_expected_version, v_current_version
        using errcode = '40001';
    end if;

    update public.source_effects as se
       set payload = p_payload,
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

  sync_version := v_new_version;
  updated_at := v_updated_at;
  deleted_at := v_deleted_at;
  return next;
end;
$function$;

revoke all on function public.sync_source_effect(text, text, integer, jsonb, boolean) from public, anon;
grant execute on function public.sync_source_effect(text, text, integer, jsonb, boolean) to authenticated;

comment on table public.source_effects is
  'Versioned, source-scoped ledger and inventory effects. Deletions are retained as tombstones.';
comment on function public.sync_source_effect(text, text, integer, jsonb, boolean) is
  'Atomically replaces or tombstones one source effect set using optimistic concurrency and factory permission checks.';
