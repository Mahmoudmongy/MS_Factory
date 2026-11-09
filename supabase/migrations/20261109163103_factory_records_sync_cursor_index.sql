create index if not exists factory_records_owner_updated_at_idx
  on public.factory_records(user_id, updated_at desc);
