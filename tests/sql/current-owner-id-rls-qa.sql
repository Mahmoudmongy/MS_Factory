-- QA-only check: invoker function resolves the caller's owner and returns null for unrelated identities.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','92ff1f15-5919-400c-80f3-c77132506df9',true);
do $$
declare v_owner uuid;
begin
  v_owner := public.current_owner_id();
  if v_owner is distinct from '92ff1f15-5919-400c-80f3-c77132506df9'::uuid then
    raise exception 'QA FAIL: owner identity did not resolve through caller RLS';
  end if;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
begin
  if public.current_owner_id() is not null then
    raise exception 'QA FAIL: unrelated identity resolved a factory owner';
  end if;
end $$;
reset role;
rollback;
