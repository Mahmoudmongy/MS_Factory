-- Version the complete administrator snapshot so two devices cannot overwrite one another.
ALTER TABLE public.factory_state
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.sync_factory_state(
  p_expected_version integer,
  p_state jsonb
)
RETURNS TABLE(sync_version integer, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_current_version integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_state IS NULL OR pg_catalog.jsonb_typeof(p_state) <> 'object' THEN
    RAISE EXCEPTION 'Factory state must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT fs.sync_version
    INTO v_current_version
    FROM public.factory_state AS fs
   WHERE fs.user_id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_version IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'Factory snapshot version conflict: expected an existing version'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.factory_state(user_id, state, sync_version, updated_at, updated_by)
    VALUES (v_user_id, p_state, 1, pg_catalog.now(), v_user_id)
    RETURNING public.factory_state.sync_version, public.factory_state.updated_at
      INTO sync_version, updated_at;
  ELSE
    IF v_current_version IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'Factory snapshot version conflict: expected %, found %',
        p_expected_version, v_current_version
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.factory_state AS fs
       SET state = p_state,
           sync_version = fs.sync_version + 1,
           updated_at = pg_catalog.now(),
           updated_by = v_user_id
     WHERE fs.user_id = v_user_id
     RETURNING fs.sync_version, fs.updated_at
       INTO sync_version, updated_at;
  END IF;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_factory_state(integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_factory_state(integer, jsonb) TO authenticated;
