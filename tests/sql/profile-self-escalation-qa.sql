-- QA-only profile self-escalation test; employee fixtures are rolled back.
DO $$
DECLARE
  v_owner uuid := '92ff1f15-5919-400c-80f3-c77132506df9';
  v_employee uuid := gen_random_uuid();
  v_failed boolean := false;
BEGIN
  BEGIN
    INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES(v_employee,'authenticated','authenticated',v_employee::text||'@qa.invalid','',clock_timestamp(),
      '{"provider":"email","providers":["email"]}','{}',clock_timestamp(),clock_timestamp());
    UPDATE public.profiles SET created_by=v_owner,is_admin=false,
      permissions='{"inventory":true,"edit":true,"delete":false}'::jsonb WHERE id=v_employee;
    PERFORM set_config('request.jwt.claim.sub',v_employee::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_employee,'role','authenticated')::text,true);
    PERFORM set_config('role','authenticated',true);
    BEGIN
      UPDATE public.profiles SET permissions='{"inventory":true,"settings":true,"edit":true,"delete":true}'::jsonb
      WHERE id=v_employee;
      RAISE EXCEPTION 'QA_PROFILE_SELF_PERMISSION_ESCALATION_ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_failed:=true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'QA_PROFILE_SELF_PERMISSION_ESCALATION_NOT_BLOCKED'; END IF;
    v_failed:=false;
    BEGIN
      UPDATE public.profiles SET is_admin=true WHERE id=v_employee;
      RAISE EXCEPTION 'QA_PROFILE_SELF_ADMIN_ESCALATION_ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_failed:=true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'QA_PROFILE_SELF_ADMIN_ESCALATION_NOT_BLOCKED'; END IF;
    RAISE EXCEPTION 'QA_ROLLBACK_PROFILE_ESCALATION_FIXTURE';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'QA_ROLLBACK_PROFILE_ESCALATION_FIXTURE' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'QA_PROFILE_SELF_ESCALATION_BLOCKED';
END $$;
