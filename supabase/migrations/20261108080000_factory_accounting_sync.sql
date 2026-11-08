CREATE TABLE IF NOT EXISTS public.factory_accounting_state (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('invoices', 'production', 'settings')),
  payload jsonb NOT NULL DEFAULT '{"ledger":[],"movements":[],"work_orders":[],"journal_entries":[]}'::jsonb,
  sync_version integer NOT NULL DEFAULT 1 CHECK (sync_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, source),
  CHECK (jsonb_typeof(payload) = 'object')
);

ALTER TABLE public.factory_accounting_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.factory_accounting_state FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.factory_accounting_state TO authenticated;

DROP POLICY IF EXISTS factory_accounting_state_select ON public.factory_accounting_state;
CREATE POLICY factory_accounting_state_select
ON public.factory_accounting_state
FOR SELECT TO authenticated
USING (
  private.can_access_factory_owner(
    user_id,
    CASE source
      WHEN 'invoices' THEN 'invoices'
      WHEN 'production' THEN 'production'
      WHEN 'settings' THEN 'settings'
    END,
    false
  )
);

DROP POLICY IF EXISTS factory_accounting_state_insert ON public.factory_accounting_state;
CREATE POLICY factory_accounting_state_insert
ON public.factory_accounting_state
FOR INSERT TO authenticated
WITH CHECK (
  private.can_access_factory_owner(
    user_id,
    CASE source
      WHEN 'invoices' THEN 'invoices'
      WHEN 'production' THEN 'production'
      WHEN 'settings' THEN 'settings'
    END,
    true
  )
);

DROP POLICY IF EXISTS factory_accounting_state_update ON public.factory_accounting_state;
CREATE POLICY factory_accounting_state_update
ON public.factory_accounting_state
FOR UPDATE TO authenticated
USING (
  private.can_access_factory_owner(
    user_id,
    CASE source
      WHEN 'invoices' THEN 'invoices'
      WHEN 'production' THEN 'production'
      WHEN 'settings' THEN 'settings'
    END,
    true
  )
)
WITH CHECK (
  private.can_access_factory_owner(
    user_id,
    CASE source
      WHEN 'invoices' THEN 'invoices'
      WHEN 'production' THEN 'production'
      WHEN 'settings' THEN 'settings'
    END,
    true
  )
);

CREATE OR REPLACE FUNCTION public.sync_factory_accounting(
  p_source text,
  p_expected_version integer,
  p_payload jsonb
)
RETURNS TABLE(sync_version integer, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_current_version integer;
  v_new_version integer;
  v_updated_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_source NOT IN ('invoices', 'production', 'settings') THEN
    RAISE EXCEPTION 'Unsupported accounting source' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'Invalid expected version' USING ERRCODE = '22023';
  END IF;

  IF p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(p_payload->'ledger') <> 'array'
     OR jsonb_typeof(p_payload->'movements') <> 'array'
     OR jsonb_typeof(p_payload->'work_orders') <> 'array'
     OR jsonb_typeof(p_payload->'journal_entries') <> 'array' THEN
    RAISE EXCEPTION 'Invalid accounting payload shape' USING ERRCODE = '22023';
  END IF;

  IF pg_column_size(p_payload) > 5242880 THEN
    RAISE EXCEPTION 'Accounting payload exceeds 5 MiB' USING ERRCODE = '22023';
  END IF;

  v_owner := public.current_owner_id();
  IF v_owner IS NULL
     OR NOT private.can_access_factory_owner(v_owner, p_source, true) THEN
    RAISE EXCEPTION 'Insufficient permission for accounting source' USING ERRCODE = '42501';
  END IF;

  SELECT s.sync_version
    INTO v_current_version
    FROM public.factory_accounting_state AS s
   WHERE s.user_id = v_owner
     AND s.source = p_source
   FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_version <> 0 THEN
      RAISE EXCEPTION 'Accounting snapshot version conflict' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.factory_accounting_state
      (user_id, source, payload, sync_version, updated_at, updated_by)
    VALUES
      (v_owner, p_source, p_payload, 1, now(), auth.uid())
    RETURNING public.factory_accounting_state.sync_version,
              public.factory_accounting_state.updated_at
         INTO v_new_version, v_updated_at;
  ELSE
    IF v_current_version <> p_expected_version THEN
      RAISE EXCEPTION 'Accounting snapshot version conflict' USING ERRCODE = '40001';
    END IF;

    UPDATE public.factory_accounting_state AS s
       SET payload = p_payload,
           sync_version = v_current_version + 1,
           updated_at = now(),
           updated_by = auth.uid()
     WHERE s.user_id = v_owner
       AND s.source = p_source
    RETURNING s.sync_version, s.updated_at
         INTO v_new_version, v_updated_at;
  END IF;

  RETURN QUERY SELECT v_new_version, v_updated_at;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Accounting snapshot version conflict' USING ERRCODE = '40001';
END;
$$;

REVOKE ALL ON FUNCTION public.sync_factory_accounting(text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_factory_accounting(text, integer, jsonb) TO authenticated;
