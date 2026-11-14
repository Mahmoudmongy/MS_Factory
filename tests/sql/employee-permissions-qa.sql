-- QA-only employee permission matrix. Fixtures are rolled back.
DO $$
DECLARE
  v_owner uuid := '92ff1f15-5919-400c-80f3-c77132506df9';
  v_employee uuid := gen_random_uuid();
  v_record_id text := 'qa-employee-permission-'||txid_current()::text;
  v_count integer;
BEGIN
  BEGIN
    INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES(v_employee,'authenticated','authenticated',v_employee::text||'@qa.invalid','',clock_timestamp(),
      '{"provider":"email","providers":["email"]}','{}',clock_timestamp(),clock_timestamp());
    UPDATE public.profiles SET created_by=v_owner,is_admin=false,
      permissions='{"inventory":true,"edit":false,"delete":false}'::jsonb WHERE id=v_employee;
    PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
    PERFORM set_config('role','authenticated',true);
    INSERT INTO public.factory_records(user_id,record_type,record_id,payload,version)
    VALUES(v_owner,'items',v_record_id,'{"name":"QA permission fixture"}',1);
    PERFORM public.update_employee_permissions(v_employee,'{"inventory":true,"edit":false,"delete":false}'::jsonb);
    PERFORM set_config('request.jwt.claim.sub',v_employee::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_employee,'role','authenticated')::text,true);
    SELECT count(*) INTO v_count FROM public.factory_records WHERE user_id=v_owner AND record_id=v_record_id;
    IF v_count <> 1 THEN RAISE EXCEPTION 'QA_EMPLOYEE_READ_PERMISSION_FAILED'; END IF;
    UPDATE public.factory_records SET payload='{"name":"blocked edit"}' WHERE user_id=v_owner AND record_id=v_record_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 0 THEN RAISE EXCEPTION 'QA_EMPLOYEE_EDIT_WITHOUT_PERMISSION_ALLOWED'; END IF;
    PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
    PERFORM public.update_employee_permissions(v_employee,'{"inventory":true,"edit":true,"delete":false}'::jsonb);
    PERFORM set_config('request.jwt.claim.sub',v_employee::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_employee,'role','authenticated')::text,true);
    UPDATE public.factory_records SET payload='{"name":"allowed edit"}' WHERE user_id=v_owner AND record_id=v_record_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN RAISE EXCEPTION 'QA_EMPLOYEE_EDIT_PERMISSION_FAILED'; END IF;
    BEGIN
      UPDATE public.factory_records SET deleted_at=clock_timestamp() WHERE user_id=v_owner AND record_id=v_record_id;
      RAISE EXCEPTION 'QA_EMPLOYEE_DELETE_WITHOUT_PERMISSION_ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
    PERFORM public.update_employee_permissions(v_employee,'{"inventory":true,"edit":true,"delete":true}'::jsonb);
    PERFORM set_config('request.jwt.claim.sub',v_employee::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_employee,'role','authenticated')::text,true);
    UPDATE public.factory_records SET deleted_at=clock_timestamp() WHERE user_id=v_owner AND record_id=v_record_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN RAISE EXCEPTION 'QA_EMPLOYEE_DELETE_PERMISSION_FAILED'; END IF;
    BEGIN
      PERFORM public.update_employee_permissions(v_employee,'{"inventory":true,"edit":true,"delete":true}'::jsonb);
      RAISE EXCEPTION 'QA_EMPLOYEE_CHANGED_OWN_PERMISSIONS';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE EXCEPTION 'QA_ROLLBACK_EMPLOYEE_PERMISSION_FIXTURE';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'QA_ROLLBACK_EMPLOYEE_PERMISSION_FIXTURE' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'QA_EMPLOYEE_PERMISSION_MATRIX_PASSED';
END $$;
