BEGIN;

CREATE TABLE IF NOT EXISTS public.data_sync_job_schedules (
  job_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  hourly_interval_hours integer,
  hourly_start_time time,
  market_days_only boolean NOT NULL DEFAULT false,
  daily_time time,
  weekly_day_of_week smallint,
  weekly_time time,
  monthly_day_of_month smallint,
  monthly_time time,
  run_next_market_day_if_closed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT chk_data_sync_job_schedules_frequency
    CHECK (frequency IN ('hourly', 'daily', 'weekly', 'monthly')),
  CONSTRAINT chk_data_sync_job_schedules_hourly_interval
    CHECK (hourly_interval_hours IS NULL OR hourly_interval_hours BETWEEN 1 AND 24),
  CONSTRAINT chk_data_sync_job_schedules_weekly_dow
    CHECK (weekly_day_of_week IS NULL OR weekly_day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_data_sync_job_schedules_monthly_dom
    CHECK (monthly_day_of_month IS NULL OR monthly_day_of_month BETWEEN 1 AND 31)
);

COMMENT ON TABLE public.data_sync_job_schedules IS
  'Admin-configured sync schedule per data_sync job_key (CON-186).';

ALTER TABLE public.data_sync_job_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_sync_job_schedules_platform_admin ON public.data_sync_job_schedules;
CREATE POLICY data_sync_job_schedules_platform_admin
  ON public.data_sync_job_schedules
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Seed defaults (idempotent). Times are America/New_York wall clock.
INSERT INTO public.data_sync_job_schedules (
  job_key, enabled, frequency, timezone,
  hourly_interval_hours, hourly_start_time, market_days_only,
  daily_time, weekly_day_of_week, weekly_time,
  monthly_day_of_month, monthly_time, run_next_market_day_if_closed
) VALUES
  ('fmpPoliticalTrades', true, 'hourly', 'America/New_York', 6, '00:00', false, NULL, NULL, NULL, NULL, NULL, false),
  ('fmpPoliticalFeedMissingSecurities', true, 'hourly', 'America/New_York', 6, '00:55', false, NULL, NULL, NULL, NULL, NULL, false),
  ('congressMembers', true, 'daily', 'America/New_York', NULL, NULL, false, '07:00', NULL, NULL, NULL, NULL, false),
  ('committeeMemberships', true, 'daily', 'America/New_York', NULL, NULL, false, '08:30', NULL, NULL, NULL, NULL, false),
  ('taxonomyStructuralGrowthCagrScores', true, 'daily', 'America/New_York', NULL, NULL, false, '09:00', NULL, NULL, NULL, NULL, false),
  ('taxonomyCycleScores', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 0, '03:15', NULL, NULL, false),
  ('equityExposures', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 0, '02:00', NULL, NULL, false),
  ('politicalScore', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 1, '10:00', NULL, NULL, false),
  ('insiderPrecisionScore', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 1, '10:30', NULL, NULL, false),
  ('netExposureScore', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 1, '11:00', NULL, NULL, false),
  ('hedgeFundQualityScore', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 1, '11:30', NULL, NULL, false),
  ('fundamentalConstrictionScore', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 1, '12:00', NULL, NULL, false),
  ('buffettCommitteeScore', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 0, '04:00', NULL, NULL, false),
  ('burryCommitteeScore', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 0, '04:30', NULL, NULL, false),
  ('jobsFactorsSync', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 1, '13:00', NULL, NULL, false)
ON CONFLICT (job_key) DO NOTHING;

COMMIT;
