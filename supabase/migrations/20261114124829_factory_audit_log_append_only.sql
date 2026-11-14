-- Append-only audit trail for the database-first record store.
-- This migration is additive and intentionally does not alter business records.
create table if not exists public.factory_audit_log (
  id bigint generated always as identity primary key,
  factory_user_id uuid not null,
  actor_id uuid,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  record_type text not null,
  record_id text not null,
  old_row jsonb,
  new_row jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  request_id text
);

create index if not exists factory_audit_log_owner_time_idx
  on public.factory_audit_log (factory_user_id, occurred_at desc);
create index if not exists factory_audit_log_record_idx
  on public.factory_audit_log (factory_user_id, record_type, record_id, occurred_at desc);

alter table public.factory_audit_log enable row level security;
revoke all on table public.factory_audit_log from anon, authenticated;
grant select on table public.factory_audit_log to authenticated;

drop policy if exists factory_audit_log_admin_read on public.factory_audit_log;
create policy factory_audit_log_admin_read
  on public.factory_audit_log
  for select to authenticated
  using (
    factory_user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and coalesce(p.is_admin, false) = true
    )
  );

create or replace function public.capture_factory_record_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_row jsonb;
  v_owner uuid;
  v_type text;
  v_id text;
begin
  if TG_OP = 'DELETE' then
    v_row := to_jsonb(OLD);
  else
    v_row := to_jsonb(NEW);
  end if;

  v_owner := (v_row ->> 'user_id')::uuid;
  v_type := v_row ->> 'record_type';
  v_id := v_row ->> 'record_id';

  insert into public.factory_audit_log (
    factory_user_id, actor_id, operation, record_type, record_id,
    old_row, new_row, request_id
  ) values (
    v_owner, auth.uid(), TG_OP, v_type, v_id,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end,
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id'
  );

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

revoke all on function public.capture_factory_record_audit() from public, anon, authenticated;
drop trigger if exists factory_records_audit_capture on public.factory_records;
create trigger factory_records_audit_capture
  after insert or update or delete on public.factory_records
  for each row execute function public.capture_factory_record_audit();

create or replace function public.reject_factory_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'factory_audit_log is append-only';
end;
$$;
revoke all on function public.reject_factory_audit_mutation() from public, anon, authenticated;
drop trigger if exists factory_audit_log_immutable on public.factory_audit_log;
create trigger factory_audit_log_immutable
  before update or delete on public.factory_audit_log
  for each row execute function public.reject_factory_audit_mutation();
