-- QA-only check for profile/employee audit capture. The fixture update is rolled back.
DO $$
DECLARE
  v_owner uuid := '92ff1f15-5919-400c-80f3-c77132506df9';
  v_count integer;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
    PERFORM set_config('role','authenticated',true);
    UPDATE public.profiles SET full_name=coalesce(full_name,'') WHERE id=v_owner;
    SELECT count(*) INTO v_count FROM public.factory_audit_log
      WHERE factory_user_id=v_owner AND record_type='profile'
        AND record_id=v_owner::text AND actor_id=v_owner AND operation='UPDATE';
    IF v_count<1 THEN RAISE EXCEPTION 'QA_PROFILE_AUDIT_CAPTURE_FAILED'; END IF;
    RAISE EXCEPTION 'QA_ROLLBACK_PROFILE_AUDIT_FIXTURE';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'QA_ROLLBACK_PROFILE_AUDIT_FIXTURE' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'QA_PROFILE_AUDIT_CAPTURE_PASSED';
END $$;
