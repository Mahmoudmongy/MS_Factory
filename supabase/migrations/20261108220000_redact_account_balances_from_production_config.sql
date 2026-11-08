-- Production employees need account identifiers for production workflows,
-- but must never receive opening cash amounts or any other account balance fields.
CREATE OR REPLACE FUNCTION private.sync_production_factory_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_safe_accounts jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', account.value->'id',
        'code', account.value->'code',
        'name', account.value->'name',
        't', account.value->'t',
        'k', account.value->'k',
        'cur', account.value->'cur'
      ))
    ),
    '[]'::jsonb
  )
  INTO v_safe_accounts
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(NEW.state->'accts')='array' THEN NEW.state->'accts' ELSE '[]'::jsonb END
  ) AS account(value)
  WHERE jsonb_typeof(account.value)='object';

  INSERT INTO public.production_factory_config(user_id,accts,codes,curs,warehouses,factory_name,updated_at)
  VALUES(
    NEW.user_id,
    v_safe_accounts,
    COALESCE(NEW.state->'codes','[]'::jsonb),
    COALESCE(NEW.state->'curs','[]'::jsonb),
    COALESCE(NEW.state->'wh','[]'::jsonb),
    COALESCE(NEW.state->>'name',''),
    now()
  )
  ON CONFLICT(user_id) DO UPDATE SET
    accts=EXCLUDED.accts,
    codes=EXCLUDED.codes,
    curs=EXCLUDED.curs,
    warehouses=EXCLUDED.warehouses,
    factory_name=EXCLUDED.factory_name,
    updated_at=now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.sync_production_factory_config() FROM PUBLIC,anon,authenticated;

-- Rebuild existing projections with the strict account-field allowlist.
INSERT INTO public.production_factory_config(user_id,accts,codes,curs,warehouses,factory_name,updated_at)
SELECT
  fs.user_id,
  COALESCE((
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', a.value->'id',
      'code', a.value->'code',
      'name', a.value->'name',
      't', a.value->'t',
      'k', a.value->'k',
      'cur', a.value->'cur'
    )))
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(fs.state->'accts')='array' THEN fs.state->'accts' ELSE '[]'::jsonb END
    ) AS a(value)
    WHERE jsonb_typeof(a.value)='object'
  ),'[]'::jsonb),
  COALESCE(fs.state->'codes','[]'::jsonb),
  COALESCE(fs.state->'curs','[]'::jsonb),
  COALESCE(fs.state->'wh','[]'::jsonb),
  COALESCE(fs.state->>'name',''),
  now()
FROM public.factory_state fs
ON CONFLICT(user_id) DO UPDATE SET
  accts=EXCLUDED.accts,
  codes=EXCLUDED.codes,
  curs=EXCLUDED.curs,
  warehouses=EXCLUDED.warehouses,
  factory_name=EXCLUDED.factory_name,
  updated_at=now();
