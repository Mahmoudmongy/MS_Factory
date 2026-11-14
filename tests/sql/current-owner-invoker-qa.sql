-- Run against QA in a transaction. No persistent data is changed.
begin;

do $$
declare
  v_definer boolean;
begin
  select p.prosecdef
    into v_definer
  from pg_proc p
  where p.oid = 'public.current_owner_id()'::regprocedure;

  if v_definer is distinct from false then
    raise exception 'CURRENT_OWNER_MUST_BE_SECURITY_INVOKER';
  end if;

  if not has_function_privilege('authenticated', 'public.current_owner_id()', 'EXECUTE') then
    raise exception 'AUTHENTICATED_OWNER_LOOKUP_EXECUTE_REQUIRED';
  end if;

  if has_function_privilege('anon', 'public.current_owner_id()', 'EXECUTE') then
    raise exception 'ANON_OWNER_LOOKUP_EXECUTE_MUST_BE_REVOKED';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select p.id::text from public.profiles p where p.is_admin is true and p.created_by is null order by p.created_at limit 1),
  true
);
select set_config(
  'request.jwt.claims',
  (select jsonb_build_object('sub', p.id, 'role', 'authenticated')::text
   from public.profiles p where p.is_admin is true and p.created_by is null order by p.created_at limit 1),
  true
);

set local role authenticated;
select public.current_owner_id() as current_owner_id;
reset role;

rollback;
