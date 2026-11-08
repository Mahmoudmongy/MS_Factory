-- Allow negative on-hand quantity (valid when sales/production consume stock before replenishment)
-- while keeping price validation strict and rejecting malformed raw payloads.
CREATE OR REPLACE FUNCTION public.sync_factory_master_record(
  p_table_name text,
  p_external_id text,
  p_expected_version integer,
  p_payload jsonb
)
RETURNS TABLE(sync_version integer, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner uuid;
  v_actor uuid := auth.uid();
  v_permission text;
  v_version integer;
  v_new_version integer;
  v_updated_at timestamptz;
  v_name text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_table_name NOT IN ('customers','suppliers','products') THEN
    RAISE EXCEPTION 'Unsupported master-data table' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_external_id),'') IS NULL
     OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR pg_column_size(p_payload) > 1048576 THEN
    RAISE EXCEPTION 'Invalid master-data payload' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'raw' AND pg_catalog.jsonb_typeof(p_payload->'raw') <> 'object' THEN
    RAISE EXCEPTION 'Raw master-data record must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_owner := public.current_owner_id();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Factory owner not found' USING ERRCODE = '42501';
  END IF;
  v_permission := CASE p_table_name
    WHEN 'customers' THEN 'customers'
    WHEN 'suppliers' THEN 'suppliers'
    ELSE 'inventory'
  END;
  IF NOT private.can_access_factory_owner(v_owner,v_permission,true) THEN
    RAISE EXCEPTION 'Insufficient permission for master-data synchronization' USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(btrim(p_payload->>'name'),'');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Master-data name is required' USING ERRCODE = '22023';
  END IF;

  IF p_table_name='customers' THEN
    IF COALESCE(p_payload->>'customer_type','retail') NOT IN ('retail','wholesale') THEN
      RAISE EXCEPTION 'Invalid customer type' USING ERRCODE = '22023';
    END IF;
    SELECT c.sync_version INTO v_version
      FROM public.customers c
     WHERE c.user_id=v_owner AND c.external_id=p_external_id
     FOR UPDATE;
    IF NOT FOUND THEN
      IF p_expected_version<>0 THEN RAISE EXCEPTION 'Master record version conflict' USING ERRCODE='40001'; END IF;
      INSERT INTO public.customers(user_id,external_id,name,phone,email,address,governorate,city,customer_type,raw,sync_version,updated_at,updated_by)
      VALUES(v_owner,p_external_id,v_name,NULLIF(p_payload->>'phone',''),NULLIF(p_payload->>'email',''),
        NULLIF(p_payload->>'address',''),NULLIF(p_payload->>'governorate',''),NULLIF(p_payload->>'city',''),
        COALESCE(p_payload->>'customer_type','retail'),COALESCE(p_payload->'raw','{}'::jsonb),1,now(),v_actor)
      RETURNING customers.sync_version,customers.updated_at INTO v_new_version,v_updated_at;
    ELSE
      IF v_version<>p_expected_version THEN RAISE EXCEPTION 'Master record version conflict' USING ERRCODE='40001'; END IF;
      UPDATE public.customers c SET name=v_name,phone=NULLIF(p_payload->>'phone',''),email=NULLIF(p_payload->>'email',''),
        address=NULLIF(p_payload->>'address',''),governorate=NULLIF(p_payload->>'governorate',''),
        city=NULLIF(p_payload->>'city',''),customer_type=COALESCE(p_payload->>'customer_type','retail'),
        raw=COALESCE(p_payload->'raw','{}'::jsonb),sync_version=c.sync_version+1,updated_at=now(),updated_by=v_actor
      WHERE c.user_id=v_owner AND c.external_id=p_external_id
      RETURNING c.sync_version,c.updated_at INTO v_new_version,v_updated_at;
    END IF;

  ELSIF p_table_name='suppliers' THEN
    SELECT s.sync_version INTO v_version
      FROM public.suppliers s
     WHERE s.user_id=v_owner AND s.external_id=p_external_id
     FOR UPDATE;
    IF NOT FOUND THEN
      IF p_expected_version<>0 THEN RAISE EXCEPTION 'Master record version conflict' USING ERRCODE='40001'; END IF;
      INSERT INTO public.suppliers(user_id,external_id,name,phone,email,address,governorate,city,raw,sync_version,updated_at,updated_by)
      VALUES(v_owner,p_external_id,v_name,NULLIF(p_payload->>'phone',''),NULLIF(p_payload->>'email',''),
        NULLIF(p_payload->>'address',''),NULLIF(p_payload->>'governorate',''),NULLIF(p_payload->>'city',''),
        COALESCE(p_payload->'raw','{}'::jsonb),1,now(),v_actor)
      RETURNING suppliers.sync_version,suppliers.updated_at INTO v_new_version,v_updated_at;
    ELSE
      IF v_version<>p_expected_version THEN RAISE EXCEPTION 'Master record version conflict' USING ERRCODE='40001'; END IF;
      UPDATE public.suppliers s SET name=v_name,phone=NULLIF(p_payload->>'phone',''),email=NULLIF(p_payload->>'email',''),
        address=NULLIF(p_payload->>'address',''),governorate=NULLIF(p_payload->>'governorate',''),
        city=NULLIF(p_payload->>'city',''),raw=COALESCE(p_payload->'raw','{}'::jsonb),
        sync_version=s.sync_version+1,updated_at=now(),updated_by=v_actor
      WHERE s.user_id=v_owner AND s.external_id=p_external_id
      RETURNING s.sync_version,s.updated_at INTO v_new_version,v_updated_at;
    END IF;

  ELSE
    IF COALESCE(NULLIF(p_payload->>'buy_price','')::numeric,0)<0
       OR COALESCE(NULLIF(p_payload->>'retail_price','')::numeric,0)<0
       OR COALESCE(NULLIF(p_payload->>'wholesale_price','')::numeric,0)<0 THEN
      RAISE EXCEPTION 'Product quantities and prices cannot be negative' USING ERRCODE='22023';
    END IF;
    SELECT p.sync_version INTO v_version
      FROM public.products p
     WHERE p.user_id=v_owner AND p.external_id=p_external_id
     FOR UPDATE;
    IF NOT FOUND THEN
      IF p_expected_version<>0 THEN RAISE EXCEPTION 'Master record version conflict' USING ERRCODE='40001'; END IF;
      INSERT INTO public.products(user_id,external_id,name,sku,model,unit,warehouse,buy_price,retail_price,wholesale_price,image_url,qty,price,raw,sync_version,updated_at,updated_by)
      VALUES(v_owner,p_external_id,v_name,NULLIF(p_payload->>'sku',''),NULLIF(p_payload->>'model',''),
        COALESCE(NULLIF(p_payload->>'unit',''),'قطعة'),NULLIF(p_payload->>'warehouse',''),
        COALESCE(NULLIF(p_payload->>'buy_price','')::numeric,0),COALESCE(NULLIF(p_payload->>'retail_price','')::numeric,0),
        COALESCE(NULLIF(p_payload->>'wholesale_price','')::numeric,0),NULLIF(p_payload->>'image_url',''),
        COALESCE(NULLIF(p_payload->>'qty','')::numeric,0),COALESCE(NULLIF(p_payload->>'buy_price','')::numeric,0),
        COALESCE(p_payload->'raw','{}'::jsonb),1,now(),v_actor)
      RETURNING products.sync_version,products.updated_at INTO v_new_version,v_updated_at;
    ELSE
      IF v_version<>p_expected_version THEN RAISE EXCEPTION 'Master record version conflict' USING ERRCODE='40001'; END IF;
      UPDATE public.products p SET name=v_name,sku=NULLIF(p_payload->>'sku',''),model=NULLIF(p_payload->>'model',''),
        unit=COALESCE(NULLIF(p_payload->>'unit',''),'قطعة'),warehouse=NULLIF(p_payload->>'warehouse',''),
        buy_price=COALESCE(NULLIF(p_payload->>'buy_price','')::numeric,0),
        retail_price=COALESCE(NULLIF(p_payload->>'retail_price','')::numeric,0),
        wholesale_price=COALESCE(NULLIF(p_payload->>'wholesale_price','')::numeric,0),
        image_url=NULLIF(p_payload->>'image_url',''),qty=COALESCE(NULLIF(p_payload->>'qty','')::numeric,0),
        price=COALESCE(NULLIF(p_payload->>'buy_price','')::numeric,0),raw=COALESCE(p_payload->'raw','{}'::jsonb),
        sync_version=p.sync_version+1,updated_at=now(),updated_by=v_actor
      WHERE p.user_id=v_owner AND p.external_id=p_external_id
      RETURNING p.sync_version,p.updated_at INTO v_new_version,v_updated_at;
    END IF;
  END IF;

  RETURN QUERY SELECT v_new_version,v_updated_at;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Master record version conflict' USING ERRCODE='40001';
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_factory_master_record(text,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_factory_master_record(text,text,integer,jsonb) TO authenticated;
COMMENT ON FUNCTION public.sync_factory_master_record(text,text,integer,jsonb) IS
  'Permission-scoped optimistic compare-and-swap for customer, supplier and product master records. Prevents silent last-write-wins overwrites from offline devices.';
