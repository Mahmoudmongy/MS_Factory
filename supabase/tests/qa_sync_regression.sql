-- QA-ONLY integration regression suite for MS Factory cloud synchronization.
-- Requires the isolated QA profiles:
--   admin: 66666666-6666-4666-8666-666666666666
--   production-only: 77777777-7777-4777-8777-777777777777
--   invoice-only: 88888888-8888-4888-8888-888888888888
-- Run only after all migrations are applied to the disposable QA project.
-- Every fixture is rolled back. Do not run against production.
BEGIN;

INSERT INTO public.factory_state(user_id,state,sync_version)
VALUES ('66666666-6666-4666-8666-666666666666',
'{"accts":[{"id":"qa-cash","name":"QA Cash","cash":987654,"balance":987654},{"id":"qa-wip","name":"QA WIP"}],"items":[],"wh":[],"codes":[],"curs":[],"name":"QA Factory"}'::jsonb,1)
ON CONFLICT(user_id) DO UPDATE SET state=EXCLUDED.state;
INSERT INTO public.products(user_id,external_id,name,sku,unit,buy_price,retail_price,wholesale_price,qty,raw)
VALUES('66666666-6666-4666-8666-666666666666','qa-sync-item','QA Fabric','QA-FAB','متر',10,20,18,0,'{"id":"qa-sync-item","name":"QA Fabric"}'::jsonb)
ON CONFLICT(user_id,external_id) DO NOTHING;

-- Production-only employee: order + ledger + stock movement.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
SELECT set_config('request.jwt.claims','{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',true);
SELECT * FROM public.sync_factory_detail('production_orders','qa-po-cas',0,
 '{"order_no":"QA-PO","item_name":"QA Fabric Order","status":"in_progress","breakdown":{},"total_cost":50,"raw":{"qa":true}}'::jsonb);
SELECT * FROM public.sync_factory_accounting('production',0,
 '{"ledger":[{"a":"qa-cash","src":"po","rid":"qa-po-cas","dr":50,"cr":0},{"a":"qa-wip","src":"po","rid":"qa-po-cas","dr":0,"cr":50}],
 "movements":[{"iid":"qa-sync-item","v":"-","q":-5,"src":"po","rid":"qa-po-cas","d":"2026-11-09"}],
 "work_orders":[],"journal_entries":[]}'::jsonb);
DO $$
DECLARE q numeric;
BEGIN
 SELECT i.quantity INTO q FROM public.inventory i JOIN public.products p ON p.id=i.product_id WHERE p.external_id='qa-sync-item' AND i.variant='-';
 IF q<>-5 THEN RAISE EXCEPTION 'Production stock issue expected -5, got %',q; END IF;
 IF EXISTS(SELECT 1 FROM public.factory_state) THEN RAISE EXCEPTION 'Production employee can read full factory snapshot'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.production_catalog WHERE external_id='qa-sync-item' AND buy_price=10) THEN RAISE EXCEPTION 'Production catalog row missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.production_factory_config WHERE accts::text LIKE '%987654%') THEN RAISE EXCEPTION 'Cash/balance leaked into production configuration'; END IF;
 IF EXISTS(SELECT 1 FROM public.products WHERE external_id='qa-sync-item') THEN RAISE EXCEPTION 'Production employee can read canonical products'; END IF;
END $$;
-- Identical retry must be idempotent; editing -5 to -7 applies only delta -2.
SELECT * FROM public.sync_factory_accounting('production',1,
 '{"ledger":[{"a":"qa-cash","src":"po","rid":"qa-po-cas","dr":50,"cr":0},{"a":"qa-wip","src":"po","rid":"qa-po-cas","dr":0,"cr":50}],
 "movements":[{"iid":"qa-sync-item","v":"-","q":-5,"src":"po","rid":"qa-po-cas","d":"2026-11-09"}],
 "work_orders":[],"journal_entries":[]}'::jsonb);
DO $$ DECLARE q numeric; BEGIN
 SELECT i.quantity INTO q FROM public.inventory i JOIN public.products p ON p.id=i.product_id WHERE p.external_id='qa-sync-item' AND i.variant='-';
 IF q<>-5 THEN RAISE EXCEPTION 'Production retry duplicated movement: %',q; END IF;
END $$;
SELECT * FROM public.sync_factory_accounting('production',2,
 '{"ledger":[{"a":"qa-cash","src":"po","rid":"qa-po-cas","dr":70,"cr":0},{"a":"qa-wip","src":"po","rid":"qa-po-cas","dr":0,"cr":70}],
 "movements":[{"iid":"qa-sync-item","v":"-","q":-7,"src":"po","rid":"qa-po-cas","d":"2026-11-09"}],
 "work_orders":[],"journal_entries":[]}'::jsonb);
DO $$
DECLARE q numeric;
BEGIN
 SELECT i.quantity INTO q FROM public.inventory i JOIN public.products p ON p.id=i.product_id WHERE p.external_id='qa-sync-item' AND i.variant='-';
 IF q<>-7 THEN RAISE EXCEPTION 'Production movement delta expected -7, got %',q; END IF;
 BEGIN
  PERFORM * FROM public.sync_factory_accounting('production',2,
   '{"ledger":[{"a":"qa-cash","src":"po","rid":"qa-po-cas","dr":90,"cr":0},{"a":"qa-wip","src":"po","rid":"qa-po-cas","dr":0,"cr":90}],
    "movements":[{"iid":"qa-sync-item","v":"-","q":-9,"src":"po","rid":"qa-po-cas","d":"2026-11-09"}],
    "work_orders":[],"journal_entries":[]}'::jsonb);
  RAISE EXCEPTION 'Stale production writer accepted';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
 END;
 SELECT i.quantity INTO q FROM public.inventory i JOIN public.products p ON p.id=i.product_id WHERE p.external_id='qa-sync-item' AND i.variant='-';
 IF q<>-7 THEN RAISE EXCEPTION 'Stale production writer changed inventory'; END IF;
 BEGIN
  PERFORM * FROM public.sync_factory_accounting('invoices',0,'{"ledger":[],"movements":[],"work_orders":[],"journal_entries":[]}'::jsonb);
  RAISE EXCEPTION 'Production user wrote invoice accounting';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM * FROM public.sync_factory_accounting('settings',0,'{"ledger":[],"movements":[],"work_orders":[],"journal_entries":[]}'::jsonb);
  RAISE EXCEPTION 'Production user wrote settings accounting';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM * FROM public.sync_factory_master_record('products','qa-sync-item',1,'{"name":"Nope","raw":{}}'::jsonb);
  RAISE EXCEPTION 'Production user wrote product master';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
-- Versioned soft-delete: stale deletes conflict, successful retries are idempotent, and a later save restores the row.
SELECT * FROM public.sync_factory_detail('production_orders','qa-delete-po',0,
 '{"order_no":"QA-DELETE-PO","item_name":"QA Delete Order","status":"new","breakdown":{},"raw":{"qa":true}}'::jsonb);
SELECT * FROM public.sync_factory_detail('production_orders','qa-delete-po',1,
 '{"order_no":"QA-DELETE-PO","item_name":"QA Delete Order Updated","status":"in_progress","breakdown":{},"raw":{"qa":true,"edit":true}}'::jsonb);
DO $$
BEGIN
 BEGIN
  PERFORM * FROM public.delete_factory_detail('production_orders','qa-delete-po',1);
  RAISE EXCEPTION 'Stale production delete accepted';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
END $$;
SELECT * FROM public.delete_factory_detail('production_orders','qa-delete-po',2);
SELECT * FROM public.delete_factory_detail('production_orders','qa-delete-po',2);
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.production_orders WHERE external_id='qa-delete-po' AND is_deleted=true AND sync_version=3;
 IF n<>1 THEN RAISE EXCEPTION 'Production tombstone or idempotent retry failed'; END IF;
 SELECT count(*) INTO n FROM public.production_orders WHERE external_id='qa-delete-po' AND is_deleted=false;
 IF n<>0 THEN RAISE EXCEPTION 'Deleted production row still appears in active pull filter'; END IF;
END $$;
SELECT * FROM public.sync_factory_detail('production_orders','qa-delete-po',3,
 '{"order_no":"QA-DELETE-PO","item_name":"QA Delete Order Restored","status":"new","breakdown":{},"raw":{"qa":true,"restored":true}}'::jsonb);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.production_orders WHERE external_id='qa-delete-po' AND is_deleted=false AND sync_version=4) THEN
  RAISE EXCEPTION 'Production re-save did not clear tombstone';
 END IF;
 BEGIN
  PERFORM * FROM public.delete_factory_detail('invoices','qa-invoice-cas',0);
  RAISE EXCEPTION 'Production employee deleted invoice';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;

-- Invoice-only employee: invoice, receipt voucher, return and linked ledger.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
SELECT set_config('request.jwt.claims','{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}',true);
DO $$
DECLARE r record; inv uuid;
BEGIN
 SELECT * INTO r FROM public.sync_invoice('qa-invoice-cas','QA-INV','sale',CURRENT_DATE,40,0,'QA',
  '{"customer_name":"QA Customer"}'::jsonb,0,
  '[{"name":"QA Fabric","qty":2,"price":20,"total":40}]'::jsonb);
 inv:=r.invoice_id;
 SELECT * INTO r FROM public.sync_invoice('qa-invoice-cas','QA-INV','sale',CURRENT_DATE,60,0,'QA edit',
  '{"customer_name":"QA Customer","edit":true}'::jsonb,1,
  '[{"name":"QA Fabric","qty":3,"price":20,"total":60}]'::jsonb);
 IF r.sync_version<>2 THEN RAISE EXCEPTION 'Invoice update version incorrect'; END IF;
 IF (SELECT count(*) FROM public.invoice_items WHERE invoice_id=inv)<>1 THEN RAISE EXCEPTION 'Invoice child replacement failed'; END IF;
END $$;
SELECT * FROM public.sync_factory_detail('vouchers','qa-voucher-cas',0,
 '{"voucher_no":"QA-VCH","direction":"in","account":"qa-cash","amount":20,"raw":{"qa":true}}'::jsonb);
SELECT * FROM public.sync_factory_detail('returns','qa-return-cas',0,
 '{"return_no":"QA-RET","return_type":"sale_return","total":20,"raw":{"qa":true}}'::jsonb);
SELECT * FROM public.sync_factory_accounting('invoices',0,
 '{"ledger":[
  {"a":"qa-cash","src":"doc","rid":"qa-invoice-cas","dr":60,"cr":0},{"a":"qa-wip","src":"doc","rid":"qa-invoice-cas","dr":0,"cr":60},
  {"a":"qa-cash","src":"vch","rid":"qa-voucher-cas","dr":20,"cr":0},{"a":"qa-wip","src":"vch","rid":"qa-voucher-cas","dr":0,"cr":20},
  {"a":"qa-cash","src":"doc","rid":"qa-return-cas","dr":20,"cr":0},{"a":"qa-wip","src":"doc","rid":"qa-return-cas","dr":0,"cr":20}],
 "movements":[{"iid":"qa-sync-item","v":"-","q":-3,"src":"doc","rid":"qa-invoice-cas","d":"2026-11-09"}],
 "work_orders":[],"journal_entries":[]}'::jsonb);
DO $$
DECLARE q numeric;
BEGIN
 SELECT i.quantity INTO q FROM public.inventory i JOIN public.products p ON p.id=i.product_id WHERE p.external_id='qa-sync-item' AND i.variant='-';
 IF q<>-10 THEN RAISE EXCEPTION 'Invoice stock delta expected -10 total, got %',q; END IF;
 BEGIN
  PERFORM * FROM public.sync_factory_accounting('production',0,'{"ledger":[],"movements":[],"work_orders":[],"journal_entries":[]}'::jsonb);
  RAISE EXCEPTION 'Invoice-only user wrote production accounting';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM * FROM public.sync_factory_accounting('settings',0,'{"ledger":[],"movements":[],"work_orders":[],"journal_entries":[]}'::jsonb);
  RAISE EXCEPTION 'Invoice-only user wrote settings accounting';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.production_catalog) THEN RAISE EXCEPTION 'Invoice-only user read production catalog'; END IF;
END $$;
-- Invoice, return and voucher tombstones are versioned; retries do not increment twice and a later save restores them.
SELECT * FROM public.delete_factory_detail('invoices','qa-invoice-cas',2);
SELECT * FROM public.delete_factory_detail('invoices','qa-invoice-cas',2);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.invoices WHERE external_id='qa-invoice-cas' AND is_deleted=true AND sync_version=3) THEN
  RAISE EXCEPTION 'Invoice tombstone/idempotent retry failed';
 END IF;
END $$;
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM public.sync_invoice('qa-invoice-cas','QA-INV','sale',CURRENT_DATE,60,0,'QA restored',
  '{"customer_name":"QA Customer","restored":true}'::jsonb,3,
  '[{"name":"QA Fabric","qty":3,"price":20,"total":60}]'::jsonb);
 IF r.sync_version<>4 THEN RAISE EXCEPTION 'Invoice restore version incorrect'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.invoices WHERE external_id='qa-invoice-cas' AND is_deleted=false) THEN
  RAISE EXCEPTION 'Invoice upsert did not clear tombstone';
 END IF;
END $$;
SELECT * FROM public.delete_factory_detail('returns','qa-return-cas',1);
SELECT * FROM public.sync_factory_detail('returns','qa-return-cas',2,
 '{"return_no":"QA-RET","return_type":"sale_return","total":20,"raw":{"qa":true,"restored":true}}'::jsonb);
SELECT * FROM public.delete_factory_detail('vouchers','qa-voucher-cas',1);
SELECT * FROM public.sync_factory_detail('vouchers','qa-voucher-cas',2,
 '{"voucher_no":"QA-VCH","direction":"in","account":"qa-cash","amount":20,"raw":{"qa":true,"restored":true}}'::jsonb);
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.returns WHERE external_id='qa-return-cas' AND is_deleted=false AND sync_version=3) THEN RAISE EXCEPTION 'Return restore failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vouchers WHERE external_id='qa-voucher-cas' AND is_deleted=false AND sync_version=3) THEN RAISE EXCEPTION 'Voucher restore failed'; END IF;
 BEGIN
  PERFORM * FROM public.delete_factory_detail('production_orders','qa-delete-po',4);
  RAISE EXCEPTION 'Invoice-only user deleted production order';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;

-- Administrator: scoped master-data CAS, manual journal/stock baseline and stale-write protection.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
SELECT set_config('request.jwt.claims','{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}',true);
DO $$
DECLARE r record; q numeric;
BEGIN
 SELECT * INTO r FROM public.sync_factory_master_record('customers','qa-customer-cas',0,
  '{"name":"عميل QA","phone":"01000000000","governorate":"البحيرة","city":"دمنهور","customer_type":"wholesale","raw":{"custom":"kept"}}'::jsonb);
 IF r.sync_version<>1 THEN RAISE EXCEPTION 'Customer insert failed'; END IF;
 SELECT * INTO r FROM public.sync_factory_master_record('customers','qa-customer-cas',1,
  '{"name":"عميل QA معدل","phone":"01000000001","governorate":"البحيرة","city":"دمنهور","customer_type":"retail","raw":{"custom":"updated"}}'::jsonb);
 IF r.sync_version<>2 THEN RAISE EXCEPTION 'Customer update failed'; END IF;
 BEGIN
  PERFORM * FROM public.sync_factory_master_record('customers','qa-customer-cas',1,'{"name":"stale","customer_type":"retail","raw":{}}'::jsonb);
  RAISE EXCEPTION 'Stale customer writer accepted';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;

 SELECT * INTO r FROM public.sync_factory_master_record('suppliers','qa-supplier-cas',0,
  '{"name":"مورد QA","phone":"01200000000","city":"دمنهور","raw":{"custom":"kept"}}'::jsonb);
 IF r.sync_version<>1 THEN RAISE EXCEPTION 'Supplier insert failed'; END IF;
 SELECT * INTO r FROM public.sync_factory_master_record('suppliers','qa-supplier-cas',1,
  '{"name":"مورد QA معدل","phone":"01200000001","city":"دمنهور","raw":{"custom":"updated"}}'::jsonb);
 IF r.sync_version<>2 THEN RAISE EXCEPTION 'Supplier update failed'; END IF;
 BEGIN
  PERFORM * FROM public.sync_factory_master_record('suppliers','qa-supplier-cas',1,'{"name":"stale","raw":{}}'::jsonb);
  RAISE EXCEPTION 'Stale supplier writer accepted';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;

 SELECT * INTO r FROM public.sync_factory_master_record('products','qa-product-cas',0,
  '{"name":"صنف QA","sku":"QA-1","unit":"متر","buy_price":12,"retail_price":25,"wholesale_price":20,"qty":10,"raw":{"custom":"kept"}}'::jsonb);
 IF r.sync_version<>1 THEN RAISE EXCEPTION 'Product insert failed'; END IF;
 SELECT * INTO r FROM public.sync_factory_master_record('products','qa-product-cas',1,
  '{"name":"صنف QA معدل","sku":"QA-1","unit":"متر","buy_price":13,"retail_price":26,"wholesale_price":21,"qty":12,"raw":{"custom":"updated"}}'::jsonb);
 IF r.sync_version<>2 THEN RAISE EXCEPTION 'Product update failed'; END IF;
 BEGIN
  PERFORM * FROM public.sync_factory_master_record('products','qa-product-cas',1,'{"name":"stale","buy_price":1,"retail_price":1,"wholesale_price":1,"qty":1,"raw":{}}'::jsonb);
  RAISE EXCEPTION 'Stale product writer accepted';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;

 SELECT * INTO r FROM public.sync_factory_master_record('products','qa-negative-product',0,
  '{"name":"صنف برصيد سالب","buy_price":10,"retail_price":20,"wholesale_price":15,"qty":-4,"raw":{"custom":"allowed"}}'::jsonb);
 IF r.sync_version<>1 THEN RAISE EXCEPTION 'Negative stock product insert failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE external_id='qa-negative-product' AND qty=-4) THEN
  RAISE EXCEPTION 'Negative stock balance was not preserved';
 END IF;
 BEGIN
  PERFORM * FROM public.sync_factory_master_record('products','qa-invalid-raw',0,
   '{"name":"صنف غير صالح","raw":[]}'::jsonb);
  RAISE EXCEPTION 'Array raw payload accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM * FROM public.sync_factory_master_record('products','qa-negative-price',0,
   '{"name":"سعر سالب","buy_price":-1,"raw":{}}'::jsonb);
  RAISE EXCEPTION 'Negative product price accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 SELECT * INTO r FROM public.sync_factory_accounting('settings',0,
  '{"ledger":[],"movements":[{"iid":"qa-sync-item","v":"-","q":10,"src":"je","rid":"qa-opening","d":"2026-11-09"}],"work_orders":[],"journal_entries":[{"id":"qa-opening"}]}'::jsonb);
 SELECT i.quantity INTO q FROM public.inventory i JOIN public.products p ON p.id=i.product_id WHERE p.external_id='qa-sync-item' AND i.variant='-';
 IF q<>0 THEN RAISE EXCEPTION 'Admin opening stock expected zero after production and sale, got %',q; END IF;
 IF EXISTS(SELECT 1 FROM public.production_catalog WHERE external_id='qa-sync-item' AND quantity<>0) THEN RAISE EXCEPTION 'Production catalog not refreshed after admin stock movement'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
