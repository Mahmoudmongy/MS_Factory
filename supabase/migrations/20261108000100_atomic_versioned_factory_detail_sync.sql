-- Atomic optimistic-concurrency writes for returns, vouchers and production orders.
-- Prevent stale offline devices from silently overwriting newer cloud records.
ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS sync_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.sync_factory_detail(
  p_table_name text,
  p_external_id text,
  p_expected_version integer,
  p_payload jsonb
)
RETURNS TABLE(sync_version integer, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid := public.current_owner_id();
  v_permission text;
  v_current_version integer;
  v_exists boolean;
  v_raw jsonb;
  v_new_version integer;
  v_updated_at timestamptz;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_table_name NOT IN ('returns', 'vouchers', 'production_orders') THEN
    RAISE EXCEPTION 'Unsupported detail table' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_external_id), '') IS NULL
     OR p_expected_version IS NULL
     OR p_expected_version < 0
     OR p_payload IS NULL
     OR pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid synchronization payload' USING ERRCODE = '22023';
  END IF;

  v_permission := CASE p_table_name
    WHEN 'returns' THEN 'invoices'
    WHEN 'vouchers' THEN 'invoices'
    WHEN 'production_orders' THEN 'production'
  END;
  IF NOT private.can_access_factory_owner(v_owner_id, v_permission, true) THEN
    RAISE EXCEPTION 'Insufficient permission for detail synchronization' USING ERRCODE = '42501';
  END IF;

  v_raw := COALESCE(p_payload -> 'raw', '{}'::jsonb);
  IF pg_catalog.jsonb_typeof(v_raw) <> 'object' THEN
    RAISE EXCEPTION 'Raw record must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_table_name = 'returns' THEN
    IF p_payload ->> 'return_type' NOT IN ('sale_return', 'purchase_return') THEN
      RAISE EXCEPTION 'Invalid return type' USING ERRCODE = '22023';
    END IF;
    SELECT r.sync_version INTO v_current_version
      FROM public.returns AS r
      WHERE r.user_id = v_owner_id AND r.external_id = p_external_id
      FOR UPDATE;
    v_exists := FOUND;
    IF v_exists THEN
      IF v_current_version <> p_expected_version THEN
        RAISE EXCEPTION 'Detail version conflict: current %, submitted %', v_current_version, p_expected_version USING ERRCODE = '40001';
      END IF;
      UPDATE public.returns AS r
         SET return_no = COALESCE(NULLIF(p_payload ->> 'return_no', ''), p_external_id),
             return_type = p_payload ->> 'return_type',
             return_date = COALESCE(NULLIF(p_payload ->> 'return_date', '')::date, r.return_date),
             total = COALESCE(NULLIF(p_payload ->> 'total', '')::numeric, 0),
             note = NULLIF(p_payload ->> 'note', ''),
             raw = v_raw,
             sync_version = r.sync_version + 1
       WHERE r.user_id = v_owner_id AND r.external_id = p_external_id
       RETURNING r.sync_version, r.updated_at INTO v_new_version, v_updated_at;
    ELSE
      IF p_expected_version <> 0 THEN
        RAISE EXCEPTION 'Detail version conflict: record is missing' USING ERRCODE = '40001';
      END IF;
      INSERT INTO public.returns(user_id, external_id, return_no, return_type, return_date, total, note, raw, sync_version)
      VALUES (v_owner_id, p_external_id,
        COALESCE(NULLIF(p_payload ->> 'return_no', ''), p_external_id),
        p_payload ->> 'return_type',
        COALESCE(NULLIF(p_payload ->> 'return_date', '')::date, CURRENT_DATE),
        COALESCE(NULLIF(p_payload ->> 'total', '')::numeric, 0),
        NULLIF(p_payload ->> 'note', ''), v_raw, 1)
      RETURNING returns.sync_version, returns.updated_at INTO v_new_version, v_updated_at;
    END IF;

  ELSIF p_table_name = 'vouchers' THEN
    IF p_payload ->> 'direction' NOT IN ('in', 'out') THEN
      RAISE EXCEPTION 'Invalid voucher direction' USING ERRCODE = '22023';
    END IF;
    SELECT v.sync_version INTO v_current_version
      FROM public.vouchers AS v
      WHERE v.user_id = v_owner_id AND v.external_id = p_external_id
      FOR UPDATE;
    v_exists := FOUND;
    IF v_exists THEN
      IF v_current_version <> p_expected_version THEN
        RAISE EXCEPTION 'Detail version conflict: current %, submitted %', v_current_version, p_expected_version USING ERRCODE = '40001';
      END IF;
      UPDATE public.vouchers AS v
         SET voucher_no = COALESCE(NULLIF(p_payload ->> 'voucher_no', ''), p_external_id),
             direction = p_payload ->> 'direction',
             account = COALESCE(NULLIF(p_payload ->> 'account', ''), 'سند'),
             voucher_date = COALESCE(NULLIF(p_payload ->> 'voucher_date', '')::date, v.voucher_date),
             amount = COALESCE(NULLIF(p_payload ->> 'amount', '')::numeric, 0),
             note = NULLIF(p_payload ->> 'note', ''),
             raw = v_raw,
             sync_version = v.sync_version + 1
       WHERE v.user_id = v_owner_id AND v.external_id = p_external_id
       RETURNING v.sync_version, v.updated_at INTO v_new_version, v_updated_at;
    ELSE
      IF p_expected_version <> 0 THEN
        RAISE EXCEPTION 'Detail version conflict: record is missing' USING ERRCODE = '40001';
      END IF;
      INSERT INTO public.vouchers(user_id, external_id, voucher_no, direction, account, voucher_date, amount, note, raw, sync_version)
      VALUES (v_owner_id, p_external_id,
        COALESCE(NULLIF(p_payload ->> 'voucher_no', ''), p_external_id),
        p_payload ->> 'direction',
        COALESCE(NULLIF(p_payload ->> 'account', ''), 'سند'),
        COALESCE(NULLIF(p_payload ->> 'voucher_date', '')::date, CURRENT_DATE),
        COALESCE(NULLIF(p_payload ->> 'amount', '')::numeric, 0),
        NULLIF(p_payload ->> 'note', ''), v_raw, 1)
      RETURNING vouchers.sync_version, vouchers.updated_at INTO v_new_version, v_updated_at;
    END IF;

  ELSE
    IF p_payload ->> 'status' NOT IN ('new', 'in_progress', 'delivered')
       OR pg_catalog.jsonb_typeof(COALESCE(p_payload -> 'breakdown', '{}'::jsonb)) <> 'object' THEN
      RAISE EXCEPTION 'Invalid production order payload' USING ERRCODE = '22023';
    END IF;
    SELECT o.sync_version INTO v_current_version
      FROM public.production_orders AS o
      WHERE o.user_id = v_owner_id AND o.external_id = p_external_id
      FOR UPDATE;
    v_exists := FOUND;
    IF v_exists THEN
      IF v_current_version <> p_expected_version THEN
        RAISE EXCEPTION 'Detail version conflict: current %, submitted %', v_current_version, p_expected_version USING ERRCODE = '40001';
      END IF;
      UPDATE public.production_orders AS o
         SET order_no = COALESCE(NULLIF(p_payload ->> 'order_no', ''), p_external_id),
             item_name = COALESCE(NULLIF(p_payload ->> 'item_name', ''), 'أمر إنتاج'),
             description = NULLIF(p_payload ->> 'description', ''),
             status = p_payload ->> 'status',
             breakdown = COALESCE(p_payload -> 'breakdown', '{}'::jsonb),
             total_cost = COALESCE(NULLIF(p_payload ->> 'total_cost', '')::numeric, 0),
             order_date = COALESCE(NULLIF(p_payload ->> 'order_date', '')::date, o.order_date),
             raw = v_raw,
             sync_version = o.sync_version + 1
       WHERE o.user_id = v_owner_id AND o.external_id = p_external_id
       RETURNING o.sync_version, o.updated_at INTO v_new_version, v_updated_at;
    ELSE
      IF p_expected_version <> 0 THEN
        RAISE EXCEPTION 'Detail version conflict: record is missing' USING ERRCODE = '40001';
      END IF;
      INSERT INTO public.production_orders(user_id, external_id, order_no, item_name, description, status, breakdown, total_cost, order_date, raw, sync_version)
      VALUES (v_owner_id, p_external_id,
        COALESCE(NULLIF(p_payload ->> 'order_no', ''), p_external_id),
        COALESCE(NULLIF(p_payload ->> 'item_name', ''), 'أمر إنتاج'),
        NULLIF(p_payload ->> 'description', ''),
        p_payload ->> 'status',
        COALESCE(p_payload -> 'breakdown', '{}'::jsonb),
        COALESCE(NULLIF(p_payload ->> 'total_cost', '')::numeric, 0),
        COALESCE(NULLIF(p_payload ->> 'order_date', '')::date, CURRENT_DATE),
        v_raw, 1)
      RETURNING production_orders.sync_version, production_orders.updated_at INTO v_new_version, v_updated_at;
    END IF;
  END IF;

  sync_version := v_new_version;
  updated_at := v_updated_at;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_factory_detail(text, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_factory_detail(text, text, integer, jsonb) TO authenticated;
