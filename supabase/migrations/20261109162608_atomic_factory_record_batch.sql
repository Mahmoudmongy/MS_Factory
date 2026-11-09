create or replace function public.apply_factory_record_batch(p_records jsonb)
returns setof public.factory_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v jsonb;
  v_expected bigint;
  v_row public.factory_records;
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array' using errcode = '22023';
  end if;

  for v in select value from jsonb_array_elements(p_records)
  loop
    v_expected := coalesce((v->>'expected_version')::bigint, 0);
    insert into public.factory_records (
      user_id, record_type, record_id, payload, version,
      deleted_at, updated_at, updated_by
    ) values (
      (v->>'user_id')::uuid, v->>'record_type', v->>'record_id',
      coalesce(v->'payload', '{}'::jsonb), v_expected + 1,
      nullif(v->>'deleted_at', '')::timestamptz, now(), auth.uid()
    )
    on conflict (user_id, record_type, record_id)
    do update set
      payload = excluded.payload,
      version = public.factory_records.version + 1,
      deleted_at = excluded.deleted_at,
      updated_at = now(),
      updated_by = auth.uid()
    where public.factory_records.version = v_expected
    returning * into v_row;

    if not found then
      raise exception 'FACTORY_RECORD_CONFLICT: %/%', v->>'record_type', v->>'record_id'
        using errcode = '40001';
    end if;
    return next v_row;
  end loop;
end;
$$;
revoke all on function public.apply_factory_record_batch(jsonb) from public;
grant execute on function public.apply_factory_record_batch(jsonb) to authenticated;
