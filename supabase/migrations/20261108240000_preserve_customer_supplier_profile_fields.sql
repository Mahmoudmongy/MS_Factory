-- Preserve the complete local partner record so customer/supplier flags,
-- wholesale/retail classification, governorate, city and custom fields survive
-- round trips instead of being reconstructed from only name/phone/address.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS raw jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS raw jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.customers
SET raw = jsonb_strip_nulls(jsonb_build_object(
  'id', external_id, 'name', name, 'phone', phone, 'email', email,
  'addr', address, 'gov', governorate, 'city', city,
  'c', 1, 's', 0, 'type', CASE WHEN customer_type='wholesale' THEN 'w' ELSE 'r' END
))
WHERE raw='{}'::jsonb;

UPDATE public.suppliers
SET raw = jsonb_strip_nulls(jsonb_build_object(
  'id', external_id, 'name', name, 'phone', phone, 'email', email,
  'addr', address, 'gov', governorate, 'city', city,
  'c', 0, 's', 1, 'type', 'w'
))
WHERE raw='{}'::jsonb;
