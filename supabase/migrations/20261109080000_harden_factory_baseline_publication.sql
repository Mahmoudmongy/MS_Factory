-- QA rollout hardening for the immutable opening baseline publisher.
-- The initial draft migration is retained for history; this replaces its publisher
-- with a version that locks and validates completeness against factory_state.
create or replace function private.publish_factory_baseline(
  p_expected_version integer,
  p_inventory_section jsonb,
  p_accounting_section jsonb
)
returns table(baseline_version integer, inventory_fingerprint text,
              accounting_fingerprint text, published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_owner_id uuid;
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_inventory_fp text;
  v_accounting_fp text;
  v_published_at timestamptz;
  v_snapshot jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select coalesce(p.created_by, p.id)
    into v_owner_id
    from public.profiles p
   where p.id = v_actor_id;

  if v_owner_id is null
     or v_actor_id <> v_owner_id
     or not private.can_access_factory_owner(v_owner_id, 'settings', true) then
    raise exception 'Only the factory owner/admin can publish the opening baseline'
      using errcode = '42501';
  end if;

  if p_expected_version is distinct from 0
     or p_inventory_section is null
     or p_accounting_section is null
     or pg_catalog.jsonb_typeof(p_inventory_section) <> 'object'
     or pg_catalog.jsonb_typeof(p_accounting_section) <> 'object'
     or pg_catalog.jsonb_typeof(p_inventory_section -> 'stock') <> 'object'
     or pg_catalog.jsonb_typeof(p_inventory_section #> '{stock,items}') <> 'array'
     or nullif(p_inventory_section #>> '{stock,fingerprint}', '') is null
     or pg_catalog.jsonb_typeof(p_inventory_section -> 'openingMovements') <> 'array'
     or pg_catalog.jsonb_typeof(p_accounting_section -> 'accounts') <> 'array'
     or pg_catalog.jsonb_typeof(p_accounting_section -> 'partners') <> 'array'
     or pg_catalog.jsonb_typeof(p_accounting_section -> 'openingLedger') <> 'array'
     or p_inventory_section ->> 'baselineVersion' is distinct from '1'
     or p_accounting_section ->> 'baselineVersion' is distinct from '1'
     or pg_catalog.octet_length(p_inventory_section::text) > 2097152
     or pg_catalog.octet_length(p_accounting_section::text) > 2097152 then
    raise exception 'Invalid baseline sections or expected version'
      using errcode = '22023';
  end if;

  -- The snapshot is the source of truth for baseline completeness. Lock it while
  -- validating and publishing so a concurrent admin snapshot write cannot race.
  select fs.state into v_snapshot
    from public.factory_state as fs
   where fs.user_id = v_owner_id
   for share;

  if v_snapshot is null
     or pg_catalog.jsonb_typeof(v_snapshot -> 'items') is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_snapshot -> 'accts') is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_snapshot -> 'partners') is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_snapshot -> 'L') is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_snapshot -> 'mv') is distinct from 'array' then
    raise exception 'Factory snapshot is missing required baseline source arrays'
      using errcode = '23514';
  end if;

  if pg_catalog.jsonb_array_length(p_inventory_section #> '{stock,items}')
       <> pg_catalog.jsonb_array_length(v_snapshot -> 'items')
     or pg_catalog.jsonb_array_length(p_accounting_section -> 'accounts')
       <> pg_catalog.jsonb_array_length(v_snapshot -> 'accts')
     or pg_catalog.jsonb_array_length(p_accounting_section -> 'partners')
       <> pg_catalog.jsonb_array_length(v_snapshot -> 'partners')
     or pg_catalog.jsonb_array_length(p_accounting_section -> 'openingLedger')
       <> pg_catalog.jsonb_array_length(v_snapshot -> 'L')
     or pg_catalog.jsonb_array_length(p_inventory_section -> 'openingMovements')
       <> pg_catalog.jsonb_array_length(v_snapshot -> 'mv') then
    raise exception 'Baseline is incomplete compared with the factory opening snapshot'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_snapshot -> 'items') as s(value)
     where not exists (
       select 1 from pg_catalog.jsonb_array_elements(p_inventory_section #> '{stock,items}') as b(value)
        where b.value ->> 'itemExternalId' =
          coalesce(nullif(s.value ->> 'cloudId', ''), s.value ->> 'id')
     )
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(v_snapshot -> 'accts') as s(value)
     where not exists (
       select 1 from pg_catalog.jsonb_array_elements(p_accounting_section -> 'accounts') as b(value)
        where b.value ->> 'code' = s.value ->> 'code'
     )
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(v_snapshot -> 'partners') as s(value)
     where not exists (
       select 1 from pg_catalog.jsonb_array_elements(p_accounting_section -> 'partners') as b(value)
        where b.value ->> 'externalId' =
          coalesce(nullif(s.value ->> 'cloudId', ''), s.value ->> 'id')
     )
  ) then
    raise exception 'Baseline omits or changes a factory master-record identity'
      using errcode = '23514';
  end if;

  -- Share the factory lock with source-effect writes so baseline publication cannot race a transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text || ':factory-opening-baseline', 0)
  );

  -- Baseline is a one-time bootstrap. Transactional effects must be backfilled first.
  if exists (select 1 from public.source_effects se where se.user_id = v_owner_id) then
    raise exception 'Source effects exist; backfill them before baseline publication'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_inventory_section #> '{stock,items}') x(value)
     where pg_catalog.jsonb_typeof(x.value -> 'variants') is distinct from 'array'
        or pg_catalog.jsonb_typeof(x.value -> 'value') is distinct from 'number'
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(x.value -> 'variants') = 'array' then x.value -> 'variants' else '[]'::jsonb end) v(value)
           where nullif(pg_catalog.btrim(v.value ->> 'variant'), '') is null
              or pg_catalog.jsonb_typeof(v.value -> 'quantity') is distinct from 'number'
        )
  ) then
    raise exception 'Stock baseline contains invalid values or variants'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_inventory_section #> '{stock,items}') x(value)
     group by x.value ->> 'itemExternalId'
    having count(*) > 1
  ) then
    raise exception 'Duplicate item identities in stock baseline'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_inventory_section #> '{stock,items}') x(value)
     where nullif(pg_catalog.btrim(x.value ->> 'itemExternalId'), '') is null
        or not exists (
          select 1 from public.products pr
           where pr.user_id = v_owner_id
             and pr.external_id = x.value ->> 'itemExternalId'
        )
  ) then
    raise exception 'Inventory baseline contains an item not synced to this factory'
      using errcode = '23503';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_inventory_section -> 'openingMovements') x(value)
     where nullif(pg_catalog.btrim(x.value ->> 'itemExternalId'), '') is null
        or nullif(pg_catalog.btrim(x.value ->> 'variant'), '') is null
        or pg_catalog.jsonb_typeof(x.value -> 'quantity') is distinct from 'number'
        or pg_catalog.jsonb_typeof(x.value -> 'value') is distinct from 'number'
        or not exists (
          select 1 from public.products pr
           where pr.user_id = v_owner_id
             and pr.external_id = x.value ->> 'itemExternalId'
        )
  ) then
    raise exception 'Opening movement references an item not synced to this factory'
      using errcode = '23503';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_accounting_section -> 'partners') x(value)
     where nullif(pg_catalog.btrim(x.value ->> 'name'), '') is null
  ) then
    raise exception 'Every baseline partner must have a name'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_accounting_section -> 'partners') x(value)
     group by x.value ->> 'externalId'
    having count(*) > 1
  ) then
    raise exception 'Duplicate partner identities in baseline'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_accounting_section -> 'partners') x(value)
     where nullif(pg_catalog.btrim(x.value ->> 'externalId'), '') is null
        or (
          not exists (select 1 from public.customers c
                       where c.user_id = v_owner_id and c.external_id = x.value ->> 'externalId')
          and not exists (select 1 from public.suppliers s
                           where s.user_id = v_owner_id and s.external_id = x.value ->> 'externalId')
        )
  ) then
    raise exception 'Accounting baseline contains a partner not synced to this factory'
      using errcode = '23503';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_accounting_section -> 'accounts') x(value)
     where nullif(pg_catalog.btrim(x.value ->> 'code'), '') is null
  ) then
    raise exception 'Every baseline account must have a stable code'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from (
        select x.value ->> 'code' as code
          from pg_catalog.jsonb_array_elements(p_accounting_section -> 'accounts') x(value)
         group by x.value ->> 'code'
        having count(*) > 1
      ) d
  ) then
    raise exception 'Duplicate account codes in baseline'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_accounting_section -> 'openingLedger') x(value)
     where nullif(x.value ->> 'partnerExternalId', '') is not null
       and not exists (
         select 1 from pg_catalog.jsonb_array_elements(p_accounting_section -> 'partners') p(value)
          where p.value ->> 'externalId' = x.value ->> 'partnerExternalId'
       )
  ) then
    raise exception 'Opening ledger references a partner not included in the baseline'
      using errcode = '23503';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_accounting_section -> 'openingLedger') x(value)
     where nullif(pg_catalog.btrim(x.value ->> 'accountCode'), '') is null
        or pg_catalog.jsonb_typeof(x.value -> 'debit') is distinct from 'number'
        or pg_catalog.jsonb_typeof(x.value -> 'credit') is distinct from 'number'
        or (x.value ->> 'debit')::numeric < 0
        or (x.value ->> 'credit')::numeric < 0
        or not exists (
          select 1 from pg_catalog.jsonb_array_elements(p_accounting_section -> 'accounts') a(value)
           where a.value ->> 'code' = x.value ->> 'accountCode'
        )
  ) then
    raise exception 'Opening ledger has invalid amounts or an unknown account code'
      using errcode = '22023';
  end if;

  select coalesce(sum((x.value ->> 'debit')::numeric), 0),
         coalesce(sum((x.value ->> 'credit')::numeric), 0)
    into v_debits, v_credits
    from pg_catalog.jsonb_array_elements(p_accounting_section -> 'openingLedger') x(value);

  if pg_catalog.abs(v_debits - v_credits) > 0.005 then
    raise exception 'Opening ledger is not balanced'
      using errcode = '23514';
  end if;

  v_inventory_fp := pg_catalog.md5(p_inventory_section::text);
  v_accounting_fp := pg_catalog.md5(p_accounting_section::text);

  -- The factory lock above serializes concurrent first-publication attempts.

  if exists (select 1 from public.factory_sync_baselines b where b.user_id = v_owner_id) then
    raise exception 'Opening baseline is already published and immutable'
      using errcode = '23505';
  end if;

  insert into public.factory_sync_baselines as b (
    user_id, baseline_version, inventory_section, accounting_section,
    inventory_fingerprint, accounting_fingerprint, published_by
  ) values (
    v_owner_id, 1, p_inventory_section, p_accounting_section,
    v_inventory_fp, v_accounting_fp, v_actor_id
  )
  returning b.published_at into v_published_at;

  baseline_version := 1;
  inventory_fingerprint := v_inventory_fp;
  accounting_fingerprint := v_accounting_fp;
  published_at := v_published_at;
  return next;
end;
$function$;

