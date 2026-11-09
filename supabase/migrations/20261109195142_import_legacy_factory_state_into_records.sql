-- One-time server-to-server migration from the legacy admin snapshot.
-- Browser/device localStorage is intentionally never read or imported.
-- Existing factory_records data is left untouched; only empty factory owners are migrated.
DO $migration$
DECLARE
  snapshot_row record;
  array_row record;
  item jsonb;
  item_index bigint;
  record_key text;
  payload_value jsonb;
  meta_value jsonb;
BEGIN
  FOR snapshot_row IN
    SELECT user_id, state
    FROM public.factory_state
    WHERE state IS NOT NULL AND jsonb_typeof(state) = 'object'
    ORDER BY updated_at
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.factory_records
      WHERE user_id = snapshot_row.user_id
    ) THEN
      CONTINUE;
    END IF;

    FOR array_row IN
      SELECT key, value
      FROM jsonb_each(snapshot_row.state)
      WHERE jsonb_typeof(value) = 'array'
    LOOP
      FOR item, item_index IN
        SELECT value, ordinality
        FROM jsonb_array_elements(array_row.value) WITH ORDINALITY
      LOOP
        record_key := NULL;
        IF jsonb_typeof(item) = 'object' THEN
          record_key := COALESCE(
            NULLIF(item->>'_cloudRecordId', ''),
            NULLIF(item->>'id', ''),
            NULLIF(item->>'no', ''),
            NULLIF(item->>'code', ''),
            NULLIF(item->>'sku', ''),
            NULLIF(item->>'external_id', '')
          );
          payload_value := item - ARRAY[
            '_cloudRecordId','_cloudUpdatedAt','_cloudConflict','_cloudVersion'
          ];
        ELSE
          payload_value := item;
        END IF;
        record_key := COALESCE(record_key, 'legacy-index-' || (item_index - 1)::text);

        INSERT INTO public.factory_records (
          user_id, record_type, record_id, payload, version,
          deleted_at, updated_at, updated_by
        ) VALUES (
          snapshot_row.user_id, array_row.key, record_key, payload_value, 1,
          NULL, now(), snapshot_row.user_id
        )
        ON CONFLICT (user_id, record_type, record_id) DO NOTHING;
      END LOOP;
    END LOOP;

    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
      INTO meta_value
    FROM jsonb_each(snapshot_row.state)
    WHERE jsonb_typeof(value) <> 'array'
      AND key NOT IN ('pend', 'undefined');

    INSERT INTO public.factory_records (
      user_id, record_type, record_id, payload, version,
      deleted_at, updated_at, updated_by
    ) VALUES (
      snapshot_row.user_id, '__meta', 'main', meta_value, 1,
      NULL, now(), snapshot_row.user_id
    )
    ON CONFLICT (user_id, record_type, record_id) DO NOTHING;
  END LOOP;
END
$migration$;
