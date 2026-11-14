-- QA-only API/RLS checks; all fixtures and audit rows roll back.
begin;
insert into public.factory_records(user_id,record_type,record_id,payload)
values('92ff1f15-5919-400c-80f3-c77132506df9','items','qa-permission-scope','{"name":"QA RLS fixture"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare v_count integer; v_updated integer;
begin
 select count(*) into v_count from public.factory_records where user_id='92ff1f15-5919-400c-80f3-c77132506df9' and record_type='items' and record_id='qa-permission-scope';
 if v_count<>0 then raise exception 'QA FAIL: unrelated authenticated user can read another factory record'; end if;
 update public.factory_records set deleted_at=now() where user_id='92ff1f15-5919-400c-80f3-c77132506df9' and record_type='items' and record_id='qa-permission-scope';
 get diagnostics v_updated=row_count;
 if v_updated<>0 then raise exception 'QA FAIL: unrelated authenticated user can modify another factory record'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','92ff1f15-5919-400c-80f3-c77132506df9',true);
set local role authenticated;
do $$
declare v_count integer; blocked boolean:=false;
begin
 select count(*) into v_count from public.factory_records where user_id='92ff1f15-5919-400c-80f3-c77132506df9' and record_type='items' and record_id='qa-permission-scope';
 if v_count<>1 then raise exception 'QA FAIL: owner cannot read own record through authenticated RLS'; end if;
 begin
  perform public.update_employee_permissions(gen_random_uuid(),'{"inventory":true,"delete":true,"edit":false}'::jsonb);
 exception when others then
  if sqlerrm like 'EMPLOYEE_DELETE_REQUIRES_EDIT%' then blocked:=true; else raise; end if;
 end;
 if not blocked then raise exception 'QA FAIL: API RPC allowed delete without edit permission'; end if;
end $$;
reset role;
rollback;
