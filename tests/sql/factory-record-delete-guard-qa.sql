-- QA-only verification. All fixtures and audit rows are rolled back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  blocked boolean;
begin
  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'partners','qa-partner-guard','{"name":"QA guard fixture"}');
  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'docs','qa-invoice-guard','{"pid":"qa-partner-guard","lines":[]}');

  blocked := false;
  begin
    update public.factory_records set deleted_at=now()
    where user_id=owner_id and record_type='partners' and record_id='qa-partner-guard';
  exception when others then
    if sqlerrm like 'FACTORY_RECORD_DELETE_BLOCKED:%' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'QA FAIL: partner with live invoice reference was soft-deleted'; end if;

  blocked := false;
  begin
    delete from public.factory_records
    where user_id=owner_id and record_type='docs' and record_id='qa-invoice-guard';
  exception when others then
    if sqlerrm like 'FACTORY_RECORD_PHYSICAL_DELETE_BLOCKED:%' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'QA FAIL: physical delete was not blocked'; end if;

  update public.factory_records set deleted_at=now()
  where user_id=owner_id and record_type='docs' and record_id='qa-invoice-guard';
  update public.factory_records set deleted_at=now()
  where user_id=owner_id and record_type='partners' and record_id='qa-partner-guard';
end $$;
rollback;
