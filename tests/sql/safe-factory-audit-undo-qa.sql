-- QA-only verification of admin-only, latest-change-only audit undo.
begin;
insert into public.factory_records(user_id,record_type,record_id,payload) values('92ff1f15-5919-400c-80f3-c77132506df9','items','qa-undo-update','{"name":"before"}');
update public.factory_records set payload='{"name":"after"}' where user_id='92ff1f15-5919-400c-80f3-c77132506df9' and record_type='items' and record_id='qa-undo-update';
insert into public.factory_records(user_id,record_type,record_id,payload) values('92ff1f15-5919-400c-80f3-c77132506df9','items','qa-undo-insert','{"name":"inserted"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','92ff1f15-5919-400c-80f3-c77132506df9',true);
do $$
declare v_first bigint; v_latest bigint; v_insert bigint; v_payload jsonb; v_deleted timestamptz; blocked boolean:=false;
begin
 select min(id),max(id) into v_first,v_latest from public.factory_audit_log where factory_user_id='92ff1f15-5919-400c-80f3-c77132506df9' and record_type='items' and record_id='qa-undo-update';
 begin perform public.undo_factory_record_change(v_first);
 exception when sqlstate '40001' then if sqlerrm like 'UNDO_NOT_LATEST:%' then blocked:=true; else raise; end if; end;
 if not blocked then raise exception 'QA FAIL: stale audit entry was allowed to undo'; end if;
 perform public.undo_factory_record_change(v_latest);
 select payload into v_payload from public.factory_records where user_id='92ff1f15-5919-400c-80f3-c77132506df9' and record_type='items' and record_id='qa-undo-update';
 if v_payload->>'name'<>'before' then raise exception 'QA FAIL: update undo did not restore previous payload'; end if;
 select max(id) into v_insert from public.factory_audit_log where factory_user_id='92ff1f15-5919-400c-80f3-c77132506df9' and record_type='items' and record_id='qa-undo-insert';
 perform public.undo_factory_record_change(v_insert);
 select deleted_at into v_deleted from public.factory_records where user_id='92ff1f15-5919-400c-80f3-c77132506df9' and record_type='items' and record_id='qa-undo-insert';
 if v_deleted is null then raise exception 'QA FAIL: insert undo did not create a tombstone'; end if;
end $$;
reset role;
rollback;
