-- Soft-delete synchronized business documents with optimistic version checks.
-- Tombstones prevent deleted records from reappearing on the next cloud pull.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_invoice(
  p_external_id text, p_invoice_no text, p_invoice_type text, p_invoice_date date,
  p_total numeric, p_discount numeric, p_note text, p_raw jsonb,
  p_expected_version integer, p_items jsonb
)
RETURNS TABLE(invoice_id uuid, sync_version integer, updated_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid; v_invoice_id uuid; v_version integer; v_updated_at timestamptz;
  v_item jsonb; v_item_name text; v_qty numeric; v_price numeric; v_line_total numeric;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(p.created_by, p.id) INTO v_owner_id FROM public.profiles AS p WHERE p.id = (SELECT auth.uid());
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Factory profile not found' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_external_id), '') IS NULL OR NULLIF(btrim(p_invoice_no), '') IS NULL
     OR p_invoice_type NOT IN ('sale', 'purchase') OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid invoice payload' USING ERRCODE = '22023';
  END IF;
  SELECT i.id, i.sync_version INTO v_invoice_id, v_version
  FROM public.invoices AS i WHERE i.user_id = v_owner_id AND i.external_id = p_external_id FOR UPDATE;
  IF v_invoice_id IS NULL THEN
    IF COALESCE(p_expected_version, 0) <> 0 THEN RAISE EXCEPTION 'Invoice version conflict: expected new invoice' USING ERRCODE = '40001'; END IF;
    INSERT INTO public.invoices (
      user_id, invoice_no, invoice_type, invoice_date, discount, total, note, external_id,
      customer_name, raw, sync_version, updated_at, updated_by
    ) VALUES (
      v_owner_id, p_invoice_no, p_invoice_type, COALESCE(p_invoice_date, CURRENT_DATE),
      COALESCE(p_discount, 0), COALESCE(p_total, 0), p_note, p_external_id,
      NULLIF(p_raw ->> 'customer_name', ''), COALESCE(p_raw, '{}'::jsonb), 1, now(), (SELECT auth.uid())
    )
    RETURNING id, public.invoices.sync_version, public.invoices.updated_at INTO v_invoice_id, v_version, v_updated_at;
  ELSE
    IF p_expected_version IS NULL OR p_expected_version <> v_version THEN
      RAISE EXCEPTION 'Invoice version conflict: current version %, submitted version %', v_version,
        COALESCE(p_expected_version::text, 'null') USING ERRCODE = '40001';
    END IF;
    UPDATE public.invoices AS i
    SET invoice_no = p_invoice_no, invoice_type = p_invoice_type,
        invoice_date = COALESCE(p_invoice_date, i.invoice_date), discount = COALESCE(p_discount, 0),
        total = COALESCE(p_total, 0), note = p_note, raw = COALESCE(p_raw, '{}'::jsonb), is_deleted = false,
        sync_version = i.sync_version + 1, updated_at = now(), updated_by = (SELECT auth.uid())
    WHERE i.id = v_invoice_id RETURNING i.sync_version, i.updated_at INTO v_version, v_updated_at;
    DELETE FROM public.invoice_items WHERE invoice_id = v_invoice_id AND user_id = v_owner_id;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_item_name := COALESCE(NULLIF(v_item ->> 'name', ''), NULLIF(v_item ->> 'product', ''),
      NULLIF(v_item ->> 'item', ''), NULLIF(v_item ->> 'title', ''), 'بند بدون اسم');
    v_qty := COALESCE(NULLIF(v_item ->> 'qty', '')::numeric, NULLIF(v_item ->> 'quantity', '')::numeric, 1);
    v_price := COALESCE(NULLIF(v_item ->> 'price', '')::numeric, NULLIF(v_item ->> 'unit_price', '')::numeric, 0);
    v_line_total := COALESCE(NULLIF(v_item ->> 'total', '')::numeric, NULLIF(v_item ->> 'line_total', '')::numeric, v_qty * v_price);
    INSERT INTO public.invoice_items (
      user_id, invoice_id, item_name, product_name, variant, quantity, unit_price, line_total, qty, price, total, note
    ) VALUES (
      v_owner_id, v_invoice_id, v_item_name, v_item_name,
      COALESCE(NULLIF(v_item ->> 'variant', ''), NULLIF(v_item ->> 'v', ''), '-'),
      v_qty, v_price, v_line_total, v_qty, v_price, v_line_total, NULLIF(v_item ->> 'note', '')
    );
  END LOOP;
  invoice_id := v_invoice_id; sync_version := v_version; updated_at := COALESCE(v_updated_at, now()); RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_invoice(text,text,text,date,numeric,numeric,text,jsonb,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_invoice(text,text,text,date,numeric,numeric,text,jsonb,integer,jsonb) TO authenticated;


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
         SET is_deleted = false,
             return_no = COALESCE(NULLIF(p_payload ->> 'return_no', ''), p_external_id),
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
         SET is_deleted = false,
             voucher_no = COALESCE(NULLIF(p_payload ->> 'voucher_no', ''), p_external_id),
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
         SET is_deleted = false,
             order_no = COALESCE(NULLIF(p_payload ->> 'order_no', ''), p_external_id),
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


CREATE OR REPLACE FUNCTION public.delete_factory_detail(
  p_table_name text,
  p_external_id text,
  p_expected_version integer
)
RETURNS TABLE(sync_version integer, updated_at timestamptz, is_deleted boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_owner uuid := public.current_owner_id();
  v_permission text;
  v_version integer;
  v_deleted boolean;
  v_updated_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
  END IF;
  IF p_table_name NOT IN ('invoices','returns','vouchers','production_orders') THEN
    RAISE EXCEPTION 'Unsupported deletion table' USING ERRCODE='22023';
  END IF;
  IF NULLIF(btrim(p_external_id),'') IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN
    RAISE EXCEPTION 'Invalid deletion request' USING ERRCODE='22023';
  END IF;
  v_permission := CASE WHEN p_table_name='production_orders' THEN 'production' ELSE 'invoices' END;
  IF NOT private.can_access_factory_owner(v_owner,v_permission,true) THEN
    RAISE EXCEPTION 'Insufficient permission for deletion' USING ERRCODE='42501';
  END IF;

  IF p_table_name='invoices' THEN
    SELECT i.sync_version,i.is_deleted,i.updated_at INTO v_version,v_deleted,v_updated_at
      FROM public.invoices i WHERE i.user_id=v_owner AND i.external_id=p_external_id FOR UPDATE;
  ELSIF p_table_name='returns' THEN
    SELECT r.sync_version,r.is_deleted,r.updated_at INTO v_version,v_deleted,v_updated_at
      FROM public.returns r WHERE r.user_id=v_owner AND r.external_id=p_external_id FOR UPDATE;
  ELSIF p_table_name='vouchers' THEN
    SELECT v.sync_version,v.is_deleted,v.updated_at INTO v_version,v_deleted,v_updated_at
      FROM public.vouchers v WHERE v.user_id=v_owner AND v.external_id=p_external_id FOR UPDATE;
  ELSE
    SELECT o.sync_version,o.is_deleted,o.updated_at INTO v_version,v_deleted,v_updated_at
      FROM public.production_orders o WHERE o.user_id=v_owner AND o.external_id=p_external_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    IF p_expected_version=0 THEN
      RETURN QUERY SELECT 0,now(),true;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Delete conflict: remote record no longer exists' USING ERRCODE='40001';
  END IF;
  -- Retrying a successful delete is idempotent even if the response was lost.
  IF v_deleted THEN
    RETURN QUERY SELECT v_version,v_updated_at,true;
    RETURN;
  END IF;
  IF v_version<>p_expected_version THEN
    RAISE EXCEPTION 'Delete version conflict: current %, submitted %',v_version,p_expected_version USING ERRCODE='40001';
  END IF;

  IF p_table_name='invoices' THEN
    UPDATE public.invoices i SET is_deleted=true,sync_version=i.sync_version+1,updated_at=now(),updated_by=auth.uid()
     WHERE i.user_id=v_owner AND i.external_id=p_external_id
     RETURNING i.sync_version,i.updated_at INTO v_version,v_updated_at;
  ELSIF p_table_name='returns' THEN
    UPDATE public.returns r SET is_deleted=true,sync_version=r.sync_version+1,updated_at=now(),updated_by=auth.uid()
     WHERE r.user_id=v_owner AND r.external_id=p_external_id
     RETURNING r.sync_version,r.updated_at INTO v_version,v_updated_at;
  ELSIF p_table_name='vouchers' THEN
    UPDATE public.vouchers v SET is_deleted=true,sync_version=v.sync_version+1,updated_at=now(),updated_by=auth.uid()
     WHERE v.user_id=v_owner AND v.external_id=p_external_id
     RETURNING v.sync_version,v.updated_at INTO v_version,v_updated_at;
  ELSE
    UPDATE public.production_orders o SET is_deleted=true,sync_version=o.sync_version+1,updated_at=now(),updated_by=auth.uid()
     WHERE o.user_id=v_owner AND o.external_id=p_external_id
     RETURNING o.sync_version,o.updated_at INTO v_version,v_updated_at;
  END IF;
  RETURN QUERY SELECT v_version,v_updated_at,true;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_factory_detail(text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_factory_detail(text,text,integer) TO authenticated;
