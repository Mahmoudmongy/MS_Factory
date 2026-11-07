-- Cover the updated_by foreign key to avoid scans on invoices during user cleanup.
CREATE INDEX IF NOT EXISTS idx_invoices_updated_by
  ON public.invoices (updated_by);
