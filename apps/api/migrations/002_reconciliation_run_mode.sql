
BEGIN;

ALTER TABLE reconciliation_runs
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'live';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reconciliation_runs_mode_check'
      AND conrelid = 'reconciliation_runs'::regclass
  ) THEN
    ALTER TABLE reconciliation_runs
      ADD CONSTRAINT reconciliation_runs_mode_check
      CHECK (mode IN ('live', 'historical'));
  END IF;
END
$$;

-- Historical findings need snapshots without a live finding record.
-- Give each run-finding relationship its own primary key.
ALTER TABLE reconciliation_run_findings
  ADD COLUMN IF NOT EXISTS id UUID;

UPDATE reconciliation_run_findings
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE reconciliation_run_findings
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE reconciliation_run_findings
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE reconciliation_run_findings
  ADD COLUMN IF NOT EXISTS snapshot_key TEXT;

-- Remove the old composite primary key first.
ALTER TABLE reconciliation_run_findings
  DROP CONSTRAINT IF EXISTS reconciliation_run_findings_pkey;

-- Historical snapshots don't need a live finding_id.
ALTER TABLE reconciliation_run_findings
  ALTER COLUMN finding_id DROP NOT NULL;

-- Each history record now has its own primary key.
ALTER TABLE reconciliation_run_findings
  ADD CONSTRAINT reconciliation_run_findings_pkey PRIMARY KEY (id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reconciliation_run_findings_link_or_snapshot_check'
      AND conrelid = 'reconciliation_run_findings'::regclass
  ) THEN
    ALTER TABLE reconciliation_run_findings
      ADD CONSTRAINT reconciliation_run_findings_link_or_snapshot_check
      CHECK (
        (finding_id IS NOT NULL AND snapshot_key IS NULL)
        OR
        (finding_id IS NULL AND snapshot_key IS NOT NULL)
      );
  END IF;
END
$$;

-- Preserve uniqueness for normal, persisted findings.
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_findings_linked
  ON reconciliation_run_findings (run_id, finding_id)
  WHERE finding_id IS NOT NULL;

-- Prevent duplicate snapshots within a single historical run.
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_findings_snapshot
  ON reconciliation_run_findings (run_id, snapshot_key)
  WHERE finding_id IS NULL;

INSERT INTO schema_migrations (name)
VALUES ('002_reconciliation_run_mode.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
