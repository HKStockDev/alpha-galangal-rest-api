-- Find rows across public tables whose updated_at falls in the same *second* as a target instant.
-- Run in Supabase → SQL Editor (or psql).
--
-- IMPORTANT: UI times like "4/10/2026, 9:46:05 AM" are usually *local*. PostgreSQL stores UTC.
-- Set `target_ts` to the correct instant, e.g.:
--   UTC:              timestamptz '2026-04-10 09:46:05+00'
--   US Eastern (EDT): timestamptz '2026-04-10 09:46:05 America/New_York'
--   Asia/Ho_Chi_Minh: timestamptz '2026-04-10 09:46:05 Asia/Ho_Chi_Minh'
--
-- Adjust the single line below, then run the whole script.

DO $$
DECLARE
  -- ▼▼▼ EDIT THIS (one value) ▼▼▼
  target_ts timestamptz := '2026-04-10 09:46:05+00';
  -- ▲▲▲ Use the timezone that matches where that clock time came from ▲▲▲

  r record;
  stmt text;
  n bigint;
  j jsonb;
BEGIN
  RAISE NOTICE 'Searching public.*.updated_at in [%, %)',
    target_ts,
    target_ts + interval '1 second';

  FOR r IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'updated_at'
    ORDER BY table_name
  LOOP
    stmt := format(
      $q$
      SELECT count(*)::bigint
      FROM %I.%I
      WHERE updated_at >= $1
        AND updated_at < ($1 + interval '1 second')
      $q$,
      r.table_schema,
      r.table_name
    );
    EXECUTE stmt USING target_ts INTO n;
    IF n > 0 THEN
      RAISE NOTICE 'HIT %: % row(s)', r.table_name, n;
      stmt := format(
        $q$
        SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
        FROM (
          SELECT * FROM %I.%I
          WHERE updated_at >= $1
            AND updated_at < ($1 + interval '1 second')
          LIMIT 50
        ) s
        $q$,
        r.table_schema,
        r.table_name
      );
      EXECUTE stmt USING target_ts INTO j;
      RAISE NOTICE '%', j::text;
    END IF;
  END LOOP;

  RAISE NOTICE 'Done (updated_at).';
END $$;

-- Optional: structural-growth runs also set ingested_at on entity_factor_values.
-- Uncomment to search the same second on ingested_at:

/*
SELECT *
FROM public.entity_factor_values
WHERE ingested_at >= timestamptz '2026-04-10 09:46:05+00'
  AND ingested_at < timestamptz '2026-04-10 09:46:05+00' + interval '1 second'
LIMIT 100;
*/
