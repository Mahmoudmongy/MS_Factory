-- Enable database change events for the app's shared factory records.
-- RLS still controls which authenticated users may receive each row.
DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'factory_state',
    'customers',
    'suppliers',
    'invoices',
    'products',
    'returns',
    'vouchers',
    'production_orders'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target_table);
    END IF;
  END LOOP;
END
$$;
