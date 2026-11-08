-- Narrow, RLS-protected production read models replace owner-executed views.
DO $
BEGIN
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='production_catalog' AND c.relkind='v') THEN
  EXECUTE 'DROP VIEW public.production_catalog';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='production_factory_config' AND c.relkind='v') THEN
  EXECUTE 'DROP VIEW public.production_factory_config';
 END IF;
END $;

CREATE TABLE IF NOT EXISTS public.production_catalog (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 external_id text NOT NULL, name text NOT NULL, sku text, model text,
 unit text NOT NULL DEFAULT 'قطعة', warehouse text, image_url text,
 buy_price numeric NOT NULL DEFAULT 0, variant text NOT NULL DEFAULT '-',
 quantity numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,external_id,variant)
);
ALTER TABLE public.production_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_catalog FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_catalog TO authenticated;
DROP POLICY IF EXISTS production_catalog_select ON public.production_catalog;
CREATE POLICY production_catalog_select ON public.production_catalog FOR SELECT TO authenticated
USING(private.can_access_factory_owner(user_id,'production',false));

CREATE TABLE IF NOT EXISTS public.production_factory_config (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 accts jsonb NOT NULL DEFAULT '[]'::jsonb, codes jsonb NOT NULL DEFAULT '[]'::jsonb,
 curs jsonb NOT NULL DEFAULT '[]'::jsonb, warehouses jsonb NOT NULL DEFAULT '[]'::jsonb,
 factory_name text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.production_factory_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_factory_config FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_factory_config TO authenticated;
DROP POLICY IF EXISTS production_factory_config_select ON public.production_factory_config;
CREATE POLICY production_factory_config_select ON public.production_factory_config FOR SELECT TO authenticated
USING(private.can_access_factory_owner(user_id,'production',false));

CREATE OR REPLACE FUNCTION private.sync_production_catalog_from_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM public.production_catalog WHERE user_id=OLD.user_id AND external_id=OLD.external_id;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.user_id<>NEW.user_id OR OLD.external_id<>NEW.external_id) THEN
  DELETE FROM public.production_catalog WHERE user_id=OLD.user_id AND external_id=OLD.external_id;
 END IF;
 IF EXISTS(SELECT 1 FROM public.inventory i WHERE i.product_id=NEW.id) THEN
  INSERT INTO public.production_catalog(user_id,external_id,name,sku,model,unit,warehouse,image_url,buy_price,variant,quantity,updated_at)
  SELECT NEW.user_id,NEW.external_id,NEW.name,NEW.sku,NEW.model,NEW.unit,NEW.warehouse,NEW.image_url,NEW.buy_price,i.variant,i.quantity,now()
  FROM public.inventory i WHERE i.product_id=NEW.id
  ON CONFLICT(user_id,external_id,variant) DO UPDATE SET name=EXCLUDED.name,sku=EXCLUDED.sku,model=EXCLUDED.model,
   unit=EXCLUDED.unit,warehouse=EXCLUDED.warehouse,image_url=EXCLUDED.image_url,buy_price=EXCLUDED.buy_price,
   quantity=EXCLUDED.quantity,updated_at=now();
 ELSE
  INSERT INTO public.production_catalog(user_id,external_id,name,sku,model,unit,warehouse,image_url,buy_price,variant,quantity,updated_at)
  VALUES(NEW.user_id,NEW.external_id,NEW.name,NEW.sku,NEW.model,NEW.unit,NEW.warehouse,NEW.image_url,NEW.buy_price,'-',0,now())
  ON CONFLICT(user_id,external_id,variant) DO UPDATE SET name=EXCLUDED.name,sku=EXCLUDED.sku,model=EXCLUDED.model,
   unit=EXCLUDED.unit,warehouse=EXCLUDED.warehouse,image_url=EXCLUDED.image_url,buy_price=EXCLUDED.buy_price,updated_at=now();
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_production_catalog_from_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE p public.products%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (OLD.product_id<>NEW.product_id OR OLD.variant<>NEW.variant)) THEN
  SELECT * INTO p FROM public.products WHERE id=OLD.product_id;
  IF FOUND THEN
   DELETE FROM public.production_catalog WHERE user_id=OLD.user_id AND external_id=p.external_id AND variant=OLD.variant;
   IF NOT EXISTS(SELECT 1 FROM public.inventory WHERE product_id=OLD.product_id) THEN
    INSERT INTO public.production_catalog(user_id,external_id,name,sku,model,unit,warehouse,image_url,buy_price,variant,quantity,updated_at)
    VALUES(p.user_id,p.external_id,p.name,p.sku,p.model,p.unit,p.warehouse,p.image_url,p.buy_price,'-',0,now())
    ON CONFLICT(user_id,external_id,variant) DO UPDATE SET quantity=0,updated_at=now();
   END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 END IF;
 SELECT * INTO p FROM public.products WHERE id=NEW.product_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 INSERT INTO public.production_catalog(user_id,external_id,name,sku,model,unit,warehouse,image_url,buy_price,variant,quantity,updated_at)
 VALUES(p.user_id,p.external_id,p.name,p.sku,p.model,p.unit,p.warehouse,p.image_url,p.buy_price,NEW.variant,NEW.quantity,NEW.updated_at)
 ON CONFLICT(user_id,external_id,variant) DO UPDATE SET name=EXCLUDED.name,sku=EXCLUDED.sku,model=EXCLUDED.model,
  unit=EXCLUDED.unit,warehouse=EXCLUDED.warehouse,image_url=EXCLUDED.image_url,buy_price=EXCLUDED.buy_price,
  quantity=EXCLUDED.quantity,updated_at=EXCLUDED.updated_at;
 IF NEW.variant<>'-' AND NOT EXISTS(SELECT 1 FROM public.inventory i WHERE i.product_id=NEW.product_id AND i.variant='-') THEN
  DELETE FROM public.production_catalog WHERE user_id=p.user_id AND external_id=p.external_id AND variant='-';
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_production_factory_config()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 INSERT INTO public.production_factory_config(user_id,accts,codes,curs,warehouses,factory_name,updated_at)
 VALUES(NEW.user_id,COALESCE(NEW.state->'accts','[]'::jsonb),COALESCE(NEW.state->'codes','[]'::jsonb),
  COALESCE(NEW.state->'curs','[]'::jsonb),COALESCE(NEW.state->'wh','[]'::jsonb),COALESCE(NEW.state->>'name',''),now())
 ON CONFLICT(user_id) DO UPDATE SET accts=EXCLUDED.accts,codes=EXCLUDED.codes,curs=EXCLUDED.curs,
  warehouses=EXCLUDED.warehouses,factory_name=EXCLUDED.factory_name,updated_at=now();
 RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_production_catalog_from_product() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.sync_production_catalog_from_inventory() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.sync_production_factory_config() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS production_catalog_product_sync ON public.products;
CREATE TRIGGER production_catalog_product_sync AFTER INSERT OR UPDATE OR DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.sync_production_catalog_from_product();
DROP TRIGGER IF EXISTS production_catalog_inventory_sync ON public.inventory;
CREATE TRIGGER production_catalog_inventory_sync AFTER INSERT OR UPDATE OR DELETE ON public.inventory
FOR EACH ROW EXECUTE FUNCTION private.sync_production_catalog_from_inventory();
DROP TRIGGER IF EXISTS production_factory_config_sync ON public.factory_state;
CREATE TRIGGER production_factory_config_sync AFTER INSERT OR UPDATE OF state ON public.factory_state
FOR EACH ROW EXECUTE FUNCTION private.sync_production_factory_config();

-- Existing production data is still in the original factory_state JSON snapshot.
-- Seed normalized inventory only for products that have no inventory rows yet;
-- this preserves any inventory rows already synchronized in newer installations.
INSERT INTO public.inventory(user_id,product_id,variant,quantity,updated_at)
SELECT fs.user_id,p.id,variant_row.key,variant_row.value::numeric,now()
FROM public.factory_state AS fs
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(fs.state->'items','[]'::jsonb)) AS item(value)
JOIN public.products AS p
  ON p.user_id=fs.user_id AND p.external_id=item.value->>'id'
CROSS JOIN LATERAL jsonb_each_text(COALESCE(item.value->'st','{}'::jsonb)) AS variant_row(key,value)
WHERE NOT EXISTS (SELECT 1 FROM public.inventory AS existing WHERE existing.product_id=p.id)
ON CONFLICT (product_id,variant) DO NOTHING;

INSERT INTO public.production_catalog(user_id,external_id,name,sku,model,unit,warehouse,image_url,buy_price,variant,quantity,updated_at)
SELECT p.user_id,p.external_id,p.name,p.sku,p.model,p.unit,p.warehouse,p.image_url,p.buy_price,
 COALESCE(i.variant,'-'),COALESCE(i.quantity,0),COALESCE(i.updated_at,p.created_at)
FROM public.products p LEFT JOIN public.inventory i ON i.product_id=p.id
ON CONFLICT(user_id,external_id,variant) DO UPDATE SET name=EXCLUDED.name,sku=EXCLUDED.sku,model=EXCLUDED.model,
 unit=EXCLUDED.unit,warehouse=EXCLUDED.warehouse,image_url=EXCLUDED.image_url,buy_price=EXCLUDED.buy_price,
 quantity=EXCLUDED.quantity,updated_at=EXCLUDED.updated_at;

INSERT INTO public.production_factory_config(user_id,accts,codes,curs,warehouses,factory_name,updated_at)
SELECT fs.user_id,COALESCE(fs.state->'accts','[]'::jsonb),COALESCE(fs.state->'codes','[]'::jsonb),
 COALESCE(fs.state->'curs','[]'::jsonb),COALESCE(fs.state->'wh','[]'::jsonb),COALESCE(fs.state->>'name',''),now()
FROM public.factory_state fs
ON CONFLICT(user_id) DO UPDATE SET accts=EXCLUDED.accts,codes=EXCLUDED.codes,curs=EXCLUDED.curs,
 warehouses=EXCLUDED.warehouses,factory_name=EXCLUDED.factory_name,updated_at=now();

COMMENT ON TABLE public.production_catalog IS 'Narrow production-only product/variant read model maintained by private triggers.';
COMMENT ON TABLE public.production_factory_config IS 'Narrow production-only factory configuration; excludes full snapshot balances and ledgers.';

NOTIFY pgrst, 'reload schema';
