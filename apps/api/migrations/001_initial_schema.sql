
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expected_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('incoming_deposit', 'outgoing_payment')
  ),
  description TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  expected_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'cancelled')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expected_events_active_due
  ON expected_events (expected_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES expected_events(id) ON DELETE SET NULL,
  observation_type TEXT NOT NULL CHECK (
    observation_type IN ('incoming_deposit', 'outgoing_payment')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('confirmed', 'pending', 'failed')
  ),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  observed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (
    source IN ('airwallex', 'synthetic', 'manual')
  ),
  source_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_source_record
  ON observations (source, source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_observations_event_time
  ON observations (event_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'completed', 'failed')
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  evaluated_event_count INTEGER NOT NULL DEFAULT 0,
  finding_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_started
  ON reconciliation_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL UNIQUE,
  event_id TEXT REFERENCES expected_events(id) ON DELETE SET NULL,
  finding_type TEXT NOT NULL CHECK (
    finding_type IN (
      'EXPECTED_EVENT_UNCONFIRMED',
      'EXPECTED_EVENT_FAILED',
      'TRANSFER_UNRESOLVED',
      'EVENT_OBSERVED_LATE',
      'AMOUNT_MISMATCH',
      'CURRENCY_MISMATCH',
      'EVENT_TYPE_MISMATCH',
      'RESERVE_RISK'
    )
  ),
  severity TEXT NOT NULL CHECK (
    severity IN ('info', 'warning', 'critical')
  ),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'resolved', 'dismissed')
  ),
  first_detected_at TIMESTAMPTZ NOT NULL,
  last_detected_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  last_seen_run_id UUID REFERENCES reconciliation_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL)
    OR
    (status <> 'resolved' AND resolved_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_findings_status_updated
  ON findings (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_run_events (
  run_id UUID NOT NULL
    REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL
    REFERENCES expected_events(id) ON DELETE RESTRICT,
  PRIMARY KEY (run_id, event_id)
);

CREATE TABLE IF NOT EXISTS reconciliation_run_observations (
  run_id UUID NOT NULL
    REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL
    REFERENCES observations(id) ON DELETE RESTRICT,
  PRIMARY KEY (run_id, observation_id)
);

CREATE TABLE IF NOT EXISTS reconciliation_run_findings (
  run_id UUID NOT NULL
    REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  finding_id UUID NOT NULL
    REFERENCES findings(id) ON DELETE RESTRICT,
  finding_snapshot JSONB NOT NULL,
  PRIMARY KEY (run_id, finding_id)
);

INSERT INTO schema_migrations (name)
VALUES ('001_initial_schema.sql')
ON CONFLICT (name) DO NOTHING;
