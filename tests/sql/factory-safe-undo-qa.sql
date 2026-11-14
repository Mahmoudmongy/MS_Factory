-- QA-only safe undo and hard-delete regression. Every fixture is rolled back.
DO $$
DECLARE
  v_admin uuid := '92ff1f15-5919-400c-80f3-c77132506df9';
  v_record_id text := 'qa-undo-fixture-'||txid_current()::text;
  v_audit bigint;
  v_row public.factory_records;
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN
    INSERT INTO public.factory_records(user_id,record_type,record_id,payload,version)
    VALUES(v_admin,'docs',v_record_id,'{"value":"before"}',1);
    UPDATE public.factory_records SET payload='{"value":"after"}',version=version+1,updated_at=clock_timestamp()
    WHERE user_id=v_admin AND record_type='docs' AND record_id=v_record_id;
    SELECT max(id) INTO v_audit FROM public.factory_audit_log
    WHERE factory_user_id=v_admin AND record_type='docs'
      AND record_id=v_record_id AND operation='UPDATE';
    SELECT * INTO v_row FROM public.undo_factory_record_change(v_audit);
    IF v_row.payload <> '{"value":"before"}'::jsonb OR v_row.version <> 3 THEN
      RAISE EXCEPTION 'QA_UNDO_RESTORE_FAILED: %',row_to_json(v_row);
    END IF;
    BEGIN
      PERFORM public.undo_factory_record_change(v_audit);
      RAISE EXCEPTION 'QA_UNDO_REPLAY_WAS_NOT_BLOCKED';
    EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
    END;
    BEGIN
      DELETE FROM public.factory_records WHERE user_id=v_admin
        AND record_type='docs' AND record_id=v_record_id;
      RAISE EXCEPTION 'QA_HARD_DELETE_WAS_NOT_BLOCKED';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'QA_ROLLBACK_UNDO_FIXTURE';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'QA_ROLLBACK_UNDO_FIXTURE' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'QA_SAFE_UNDO_TESTS_PASSED';
END $$;
