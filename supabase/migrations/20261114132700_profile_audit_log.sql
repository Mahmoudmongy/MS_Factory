-- Include employee/profile changes in the same owner-scoped append-only audit timeline.
create or replace function public.capture_profile_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_row jsonb;
  v_owner uuid;
  v_profile_id uuid;
begin
  if tg_op='DELETE' then v_row:=to_jsonb(old); else v_row:=to_jsonb(new); end if;
  v_profile_id:=(v_row->>'id')::uuid;
  v_owner:=coalesce(nullif(v_row->>'created_by','')::uuid,v_profile_id);
  insert into public.factory_audit_log(
    factory_user_id,actor_id,operation,record_type,record_id,
    old_row,new_row,request_id
  ) values (
    v_owner,(select auth.uid()),tg_op,'profile',v_profile_id::text,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    nullif(current_setting('request.headers',true),'')::jsonb->>'x-request-id'
  );
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.capture_profile_audit() from public,anon,authenticated;
drop trigger if exists profiles_audit_capture on public.profiles;
create trigger profiles_audit_capture
after insert or update or delete on public.profiles
for each row execute function public.capture_profile_audit();
