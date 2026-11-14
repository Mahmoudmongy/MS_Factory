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

  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'docs','qa-invoice-allocated','{"t":"sale"}');
  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'vch','qa-voucher-allocated','{"alloc":{"qa-invoice-allocated":50}}');
  blocked := false;
  begin
    update public.factory_records set deleted_at=now()
    where user_id=owner_id and record_type='docs' and record_id='qa-invoice-allocated';
  exception when others then
    if sqlerrm like 'FACTORY_RECORD_DELETE_BLOCKED:%' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'QA FAIL: invoice with an allocated voucher was soft-deleted'; end if;

  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'po','qa-production-order','{}');
  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'docs','qa-purchase-for-order','{"t":"pur","dest":"qa-production-order"}');
  blocked := false;
  begin
    update public.factory_records set deleted_at=now()
    where user_id=owner_id and record_type='po' and record_id='qa-production-order';
  exception when others then
    if sqlerrm like 'FACTORY_RECORD_DELETE_BLOCKED:%' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'QA FAIL: production order with linked purchase invoice was soft-deleted'; end if;

  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'items','qa-item','{"name":"QA item"}');
  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'mv','qa-stock-movement','{"iid":"qa-item"}');
  blocked := false;
  begin
    update public.factory_records set deleted_at=now()
    where user_id=owner_id and record_type='items' and record_id='qa-item';
  exception when others then
    if sqlerrm like 'FACTORY_RECORD_DELETE_BLOCKED:%' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'QA FAIL: item with stock movement history was soft-deleted'; end if;

  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'accts','qa-account','{"name":"QA account"}');
  insert into public.factory_records(user_id,record_type,record_id,payload)
  values(owner_id,'L','qa-ledger-line','{"a":"qa-account"}');
  blocked := false;
  begin
    update public.factory_records set deleted_at=now()
    where user_id=owner_id and record_type='accts' and record_id='qa-account';
  exception when others then
    if sqlerrm like 'FACTORY_RECORD_DELETE_BLOCKED:%' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'QA FAIL: account with ledger references was soft-deleted'; end if;

  blocked := false;
  begin
    delete from public.factory_records
    where user_id=owner_id and record_type='docs' and record_id='qa-invoice-guard';
  exception when others then
    if sqlerrm like 'FACTORY_RECORD_PHYSICAL_DELETE_BLOCKED:%'
       or sqlerrm like 'FACTORY_RECORD_HARD_DELETE_DISABLED:%' then blocked := true;
    else raise; end if;
  end;
  if not blocked then raise exception 'QA FAIL: physical delete was not blocked'; end if;
end $$;
rollback;
