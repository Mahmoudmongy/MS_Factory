-- Run only in QA. Every fixture is rolled back.
begin;
do $$
declare
  v_admin uuid := '92ff1f15-5919-400c-80f3-c77132506df9';
  v_audit bigint;
  v_row public.factory_records;
  v_failed boolean := false;
begin
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  insert into public.factory_records(user_id,record_type,record_id,payload,version)
  values(v_admin,'docs','qa-undo-fixture-'||txid_current()::text,'{"value":"before"}',1);
  update public.factory_records set payload='{"value":"after"}',version=version+1,updated_at=clock_timestamp()
  where user_id=v_admin and record_type='docs' and record_id='qa-undo-fixture-'||txid_current()::text;
  select max(id) into v_audit from public.factory_audit_log
  where factory_user_id=v_admin and record_type='docs'
    and record_id='qa-undo-fixture-'||txid_current()::text and operation='UPDATE';
  select * into v_row from public.undo_factory_record_change(v_audit);
  if v_row.payload <> '{"value":"before"}'::jsonb or v_row.version <> 3 then
    raise exception 'QA_UNDO_RESTORE_FAILED: %',row_to_json(v_row);
  end if;
  begin
    perform public.undo_factory_record_change(v_audit);
  exception when sqlstate '40001' then v_failed := true;
  end;
  if not v_failed then raise exception 'QA_UNDO_REPLAY_WAS_NOT_BLOCKED'; end if;
  v_failed := false;
  begin
    delete from public.factory_records where user_id=v_admin
      and record_type='docs' and record_id='qa-undo-fixture-'||txid_current()::text;
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'QA_HARD_DELETE_WAS_NOT_BLOCKED'; end if;
  raise notice 'QA_SAFE_UNDO_TESTS_PASSED';
end $$;
rollback;
