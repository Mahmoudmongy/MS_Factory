-- Preserve complete return, voucher and production-order records in dedicated tables.
-- External IDs map the browser's stable numeric/string IDs to durable cloud rows.
ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS raw jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS raw jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS raw jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS returns_user_external_id_uidx
  ON public.returns (user_id, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS vouchers_user_external_id_uidx
  ON public.vouchers (user_id, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS production_orders_user_external_id_uidx
  ON public.production_orders (user_id, external_id);

CREATE INDEX IF NOT EXISTS returns_user_updated_idx ON public.returns(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS vouchers_user_updated_idx ON public.vouchers(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS production_orders_user_updated_idx ON public.production_orders(user_id, updated_at DESC);
