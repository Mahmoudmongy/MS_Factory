-- Run against an isolated QA database after migration 20261114150000.
begin;
do $$
declare
  v_user uuid;
  v_audit_id bigint;
  v_count integer;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then
    raise exception 'QA fixture requires at least one auth user';
  end if;

  insert into public.factory_records(user_id, record_type, record_id, payload)
  values (v_user, '__audit_test__', gen_random_uuid()::text, '{"test":true}'::jsonb);

  select count(*) into v_count
  from public.factory_audit_log
  where factory_user_id = v_user
    and record_type = '__audit_test__'
    and operation = 'INSERT';
  if v_count <> 1 then
    raise exception 'Expected exactly one INSERT audit row; got %', v_count;
  end if;

  select id into v_audit_id
  from public.factory_audit_log
  where factory_user_id = v_user and record_type = '__audit_test__'
  order by id desc limit 1;

  begin
    update public.factory_audit_log set record_id = 'tampered' where id = v_audit_id;
    raise exception 'Audit immutability check failed: UPDATE unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'Audit immutability check failed: UPDATE unexpectedly succeeded' then
      raise;
    end if;
    if position('append-only' in sqlerrm) = 0 then raise; end if;
  end;
end $$;
rollback;
