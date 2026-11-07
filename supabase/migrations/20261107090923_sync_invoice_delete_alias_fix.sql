-- Fix ambiguous invoice_id reference in the atomic child-row replacement.
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
        total = COALESCE(p_total, 0), note = p_note, raw = COALESCE(p_raw, '{}'::jsonb),
        sync_version = i.sync_version + 1, updated_at = now(), updated_by = (SELECT auth.uid())
    WHERE i.id = v_invoice_id RETURNING i.sync_version, i.updated_at INTO v_version, v_updated_at;
    DELETE FROM public.invoice_items AS ii WHERE ii.invoice_id = v_invoice_id AND ii.user_id = v_owner_id;
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
