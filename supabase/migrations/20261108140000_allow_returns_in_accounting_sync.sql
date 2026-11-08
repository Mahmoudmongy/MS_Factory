-- Return documents (sret/pret) are stored in public.returns, while regular
-- sale/purchase documents are stored in public.invoices. Both use src='doc'
-- in the local ledger/movement model, so both must be valid source references.
CREATE OR REPLACE FUNCTION private.factory_product_exists(
  p_owner uuid,
  p_external_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.user_id = p_owner
      AND product.external_id = p_external_id
  );
$$;

REVOKE ALL ON FUNCTION private.factory_product_exists(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.factory_product_exists(uuid, text) TO authenticated;

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
  v_is_admin boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_source NOT IN ('invoices', 'production', 'settings') THEN RAISE EXCEPTION 'Unsupported accounting source' USING ERRCODE = '22023'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 THEN RAISE EXCEPTION 'Invalid expected version' USING ERRCODE = '22023'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(p_payload->'ledger') <> 'array'
     OR jsonb_typeof(p_payload->'movements') <> 'array'
     OR jsonb_typeof(p_payload->'work_orders') <> 'array'
     OR jsonb_typeof(p_payload->'journal_entries') <> 'array' THEN
    RAISE EXCEPTION 'Invalid accounting payload shape' USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(p_payload) > 5242880 THEN RAISE EXCEPTION 'Accounting payload exceeds 5 MiB' USING ERRCODE = '22023'; END IF;

  v_owner := public.current_owner_id();
  SELECT COALESCE(p.is_admin, false) INTO v_is_admin FROM public.profiles AS p WHERE p.id = auth.uid();
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Factory owner not found' USING ERRCODE = '42501'; END IF;
  IF p_source = 'settings' THEN
    IF NOT v_is_admin OR NOT private.can_access_factory_owner(v_owner, NULL::text, true) THEN
      RAISE EXCEPTION 'Only the factory administrator can sync manual journals and opening balances' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT private.can_access_factory_owner(v_owner, p_source, true) THEN
    RAISE EXCEPTION 'Insufficient permission for accounting source' USING ERRCODE = '42501';
  END IF;

  IF (p_source <> 'production' AND jsonb_array_length(p_payload->'work_orders') > 0)
     OR (p_source <> 'settings' AND jsonb_array_length(p_payload->'journal_entries') > 0) THEN
    RAISE EXCEPTION 'Payload contains records from another source category' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'ledger') AS item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
       OR NULLIF(item.value->>'a', '') IS NULL
       OR NOT private.factory_account_exists(v_owner, item.value->>'a')
       OR COALESCE(NULLIF(item.value->>'dr', '')::numeric, 0) < 0
       OR COALESCE(NULLIF(item.value->>'cr', '')::numeric, 0) < 0
       OR (COALESCE(NULLIF(item.value->>'dr', '')::numeric, 0) > 0 AND COALESCE(NULLIF(item.value->>'cr', '')::numeric, 0) > 0)
       OR (COALESCE(NULLIF(item.value->>'dr', '')::numeric, 0) = 0 AND COALESCE(NULLIF(item.value->>'cr', '')::numeric, 0) = 0)
  ) THEN RAISE EXCEPTION 'Ledger rows contain invalid accounts or amounts' USING ERRCODE = '22023'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'ledger') AS item(value)
    WHERE CASE p_source
      WHEN 'invoices' THEN COALESCE(item.value->>'src', '') NOT IN ('doc', 'vch')
      WHEN 'production' THEN COALESCE(item.value->>'src', '') NOT IN ('po', 'wo')
      WHEN 'settings' THEN CASE WHEN v_is_admin THEN COALESCE(item.value->>'src', '') NOT IN ('', 'je') ELSE COALESCE(item.value->>'src', '') <> 'je' END
    END
  ) THEN RAISE EXCEPTION 'Ledger source does not match the granted module' USING ERRCODE = '42501'; END IF;

  IF p_source <> 'settings' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'ledger') AS item(value)
    WHERE NULLIF(item.value->>'rid', '') IS NULL
  ) THEN RAISE EXCEPTION 'Source ledger rows require a stable source record ID' USING ERRCODE = '22023'; END IF;

  IF EXISTS (
    WITH ledger_rows AS (
      SELECT COALESCE(item.value->>'rid', '__opening__') AS rid,
             COALESCE(item.value->>'src', '') AS source,
             COALESCE(NULLIF(item.value->>'dr', '')::numeric, 0) AS debit,
             COALESCE(NULLIF(item.value->>'cr', '')::numeric, 0) AS credit
      FROM jsonb_array_elements(p_payload->'ledger') AS item(value)
    )
    SELECT 1 FROM ledger_rows GROUP BY rid, source HAVING abs(sum(debit) - sum(credit)) > 0.005
  ) THEN RAISE EXCEPTION 'Ledger rows are not balanced per source transaction' USING ERRCODE = '22023'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload->'movements') AS item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
       OR NULLIF(item.value->>'iid', '') IS NULL
       OR NOT private.factory_product_exists(v_owner, item.value->>'iid')
       OR COALESCE(NULLIF(item.value->>'q', '')::numeric, 0) = 0
       OR CASE p_source
          WHEN 'invoices' THEN COALESCE(item.value->>'src', '') <> 'doc'
          WHEN 'production' THEN COALESCE(item.value->>'src', '') NOT IN ('po', 'wo')
          WHEN 'settings' THEN CASE WHEN v_is_admin THEN COALESCE(item.value->>'src', '') NOT IN ('', 'je') ELSE COALESCE(item.value->>'src', '') <> 'je' END
         END
  ) THEN RAISE EXCEPTION 'Stock movements contain invalid products, quantities or source categories' USING ERRCODE = '22023'; END IF;

  IF p_source = 'invoices' AND (
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payload->'ledger') AS item(value)
      WHERE (item.value->>'src' = 'doc' AND NOT EXISTS (SELECT 1 FROM public.invoices AS inv WHERE inv.user_id = v_owner AND inv.external_id = item.value->>'rid'
           UNION ALL
           SELECT 1 FROM public.returns AS ret WHERE ret.user_id = v_owner AND ret.external_id = item.value->>'rid'))
         OR (item.value->>'src' = 'vch' AND NOT EXISTS (SELECT 1 FROM public.vouchers AS voucher WHERE voucher.user_id = v_owner AND voucher.external_id = item.value->>'rid'))
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payload->'movements') AS item(value)
      WHERE NOT EXISTS (SELECT 1 FROM public.invoices AS inv WHERE inv.user_id = v_owner AND inv.external_id = item.value->>'rid'
           UNION ALL
           SELECT 1 FROM public.returns AS ret WHERE ret.user_id = v_owner AND ret.external_id = item.value->>'rid')
    )
  ) THEN RAISE EXCEPTION 'Invoice accounting entries must reference synchronized invoices or vouchers' USING ERRCODE = '22023'; END IF;

  IF p_source = 'production' AND (
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payload->'ledger') AS item(value)
      WHERE (item.value->>'src' = 'po' AND NOT EXISTS (SELECT 1 FROM public.production_orders AS po WHERE po.user_id = v_owner AND po.external_id = item.value->>'rid'))
         OR (item.value->>'src' = 'wo' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'work_orders') AS work(value) WHERE COALESCE(work.value->>'id', work.value->>'no') = item.value->>'rid'))
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payload->'movements') AS item(value)
      WHERE (item.value->>'src' = 'po' AND NOT EXISTS (SELECT 1 FROM public.production_orders AS po WHERE po.user_id = v_owner AND po.external_id = item.value->>'rid'))
         OR (item.value->>'src' = 'wo' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'work_orders') AS work(value) WHERE COALESCE(work.value->>'id', work.value->>'no') = item.value->>'rid'))
    )
  ) THEN RAISE EXCEPTION 'Production accounting entries must reference synchronized production orders or work orders' USING ERRCODE = '22023'; END IF;

  SELECT s.sync_version INTO v_current_version
  FROM public.factory_accounting_state AS s
  WHERE s.user_id = v_owner AND s.source = p_source
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_version <> 0 THEN RAISE EXCEPTION 'Accounting snapshot version conflict' USING ERRCODE = '40001'; END IF;
    INSERT INTO public.factory_accounting_state(user_id, source, payload, sync_version, updated_at, updated_by)
    VALUES(v_owner, p_source, p_payload, 1, now(), auth.uid())
    RETURNING public.factory_accounting_state.sync_version, public.factory_accounting_state.updated_at
    INTO v_new_version, v_updated_at;
  ELSE
    IF v_current_version <> p_expected_version THEN RAISE EXCEPTION 'Accounting snapshot version conflict' USING ERRCODE = '40001'; END IF;
    UPDATE public.factory_accounting_state AS s
       SET payload = p_payload, sync_version = v_current_version + 1, updated_at = now(), updated_by = auth.uid()
     WHERE s.user_id = v_owner AND s.source = p_source
    RETURNING s.sync_version, s.updated_at INTO v_new_version, v_updated_at;
  END IF;
  RETURN QUERY SELECT v_new_version, v_updated_at;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Accounting snapshot version conflict' USING ERRCODE = '40001';
END;
$$;

REVOKE ALL ON FUNCTION public.sync_factory_accounting(text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_factory_accounting(text, integer, jsonb) TO authenticated;
