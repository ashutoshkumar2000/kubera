
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../../config/database.js";
import { runReconciliation } from "./reconciliation-run.service.js";

type EventType = "incoming_deposit" | "outgoing_payment";

interface Fixture {
  eventId: string;
  runIds: string[];
  observationIds: string[];
}

async function createFixture(
  eventType: EventType = "incoming_deposit",
  amountMinor = 1_000_000,
): Promise<Fixture> {
  const fixture: Fixture = {
    eventId: `test-${randomUUID()}`,
    runIds: [],
    observationIds: [],
  };

  await pool.query(
    `
      INSERT INTO expected_events (
        id, event_type, description, amount_minor,
        currency, expected_at, status
      )
      VALUES ($1, $2, 'Integration test event', $3, 'USD', $4, 'active')
    `,
    [
      fixture.eventId,
      eventType,
      amountMinor,
      new Date(Date.now() - 60_000),
    ],
  );

  return fixture;
}

async function addObservation(
  fixture: Fixture,
  options: {
    type: EventType;
    status: "confirmed" | "pending" | "failed";
    amountMinor: number;
    currency?: string;
  },
): Promise<void> {
  const observationId = `test-observation-${randomUUID()}`;
  fixture.observationIds.push(observationId);

  await pool.query(
    `
      INSERT INTO observations (
        id, event_id, observation_type, status,
        amount_minor, currency, observed_at, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'synthetic')
    `,
    [
      observationId,
      fixture.eventId,
      options.type,
      options.status,
      options.amountMinor,
      options.currency ?? "USD",
      new Date(),
    ],
  );
}

async function runAndTrack(fixture: Fixture) {
  const result = await runReconciliation({ mode: "live" });

  fixture.runIds.push(result.runId);
  return result;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  // Delete relationships before their referenced records.
  await pool.query(
    `
      DELETE FROM reconciliation_run_findings
      WHERE run_id = ANY($1::uuid[])
         OR finding_id IN (
           SELECT id FROM findings WHERE event_id = $2
         )
    `,
    [fixture.runIds, fixture.eventId],
  );

  await pool.query(
    `
      DELETE FROM reconciliation_run_observations
      WHERE run_id = ANY($1::uuid[])
         OR observation_id = ANY($2::text[])
    `,
    [fixture.runIds, fixture.observationIds],
  );

  await pool.query(
    `
      DELETE FROM reconciliation_run_events
      WHERE run_id = ANY($1::uuid[])
         OR event_id = $2
    `,
    [fixture.runIds, fixture.eventId],
  );

  await pool.query("DELETE FROM findings WHERE event_id = $1", [
    fixture.eventId,
  ]);

  await pool.query(
    `
      DELETE FROM observations
      WHERE event_id = $1 OR id = ANY($2::text[])
    `,
    [fixture.eventId, fixture.observationIds],
  );

  await pool.query(
    "DELETE FROM reconciliation_runs WHERE id = ANY($1::uuid[])",
    [fixture.runIds],
  );

  await pool.query("DELETE FROM expected_events WHERE id = $1", [
    fixture.eventId,
  ]);
}

// Integration tests require a local test database.
after(async () => {
  await pool.end();
});

test("repeated runs update the same persistent finding", async (t) => {
  const fixture = await createFixture();
  t.after(() => cleanupFixture(fixture));

  const first = await runAndTrack(fixture);
  const second = await runAndTrack(fixture);

  assert.ok(
    first.findings.some(
      (finding) => finding.eventId === fixture.eventId,
    ),
  );
  assert.ok(
    second.findings.some(
      (finding) => finding.eventId === fixture.eventId,
    ),
  );

  const result = await pool.query<{
    id: string;
    status: string;
  }>(
    `
      SELECT id, status
      FROM findings
      WHERE event_id = $1
        AND finding_type = 'EXPECTED_EVENT_UNCONFIRMED'
    `,
    [fixture.eventId],
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, "open");

  const history = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM reconciliation_run_findings
      WHERE finding_id = $1
    `,
    [result.rows[0].id],
  );

  assert.equal(Number(history.rows[0].count), 2);
});

test("a confirmed late deposit resolves its old unconfirmed finding", async (t) => {
  const fixture = await createFixture();
  t.after(() => cleanupFixture(fixture));

  await runAndTrack(fixture);

  await addObservation(fixture, {
    type: "incoming_deposit",
    status: "confirmed",
    amountMinor: 1_000_000,
  });

  await runAndTrack(fixture);

  const result = await pool.query<{
    finding_type: string;
    status: string;
  }>(
    `
      SELECT finding_type, status
      FROM findings
      WHERE event_id = $1
    `,
    [fixture.eventId],
  );

  const original = result.rows.find(
    (row) => row.finding_type === "EXPECTED_EVENT_UNCONFIRMED",
  );

  const lateArrival = result.rows.find(
    (row) => row.finding_type === "EVENT_OBSERVED_LATE",
  );

  assert.equal(original?.status, "resolved");
  assert.equal(lateArrival?.status, "resolved");
});

test("a failed supplier payment remains an actionable finding", async (t) => {
  const fixture = await createFixture("outgoing_payment", 700_000);
  t.after(() => cleanupFixture(fixture));

  await addObservation(fixture, {
    type: "outgoing_payment",
    status: "failed",
    amountMinor: 0,
  });

  await runAndTrack(fixture);

  const result = await pool.query<{ status: string }>(
    `
      SELECT status
      FROM findings
      WHERE event_id = $1
        AND finding_type = 'EXPECTED_EVENT_FAILED'
    `,
    [fixture.eventId],
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, "open");
});

test("a confirmed amount mismatch remains open for investigation", async (t) => {
  const fixture = await createFixture();
  t.after(() => cleanupFixture(fixture));

  await addObservation(fixture, {
    type: "incoming_deposit",
    status: "confirmed",
    amountMinor: 900_000, // Expected $10,000; observed $9,000.
  });

  await runAndTrack(fixture);

  const result = await pool.query<{ status: string }>(
    `
      SELECT status
      FROM findings
      WHERE event_id = $1
        AND finding_type = 'AMOUNT_MISMATCH'
    `,
    [fixture.eventId],
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, "open");
});


test("historical runs do not mutate live finding state", async (t) => {
  const fixture = await createFixture();
  t.after(() => cleanupFixture(fixture));

  // First, create an open live finding.
  await runAndTrack(fixture);

  const before = await pool.query<{
    id: string;
    status: string;
    last_detected_at: string;
    last_seen_run_id: string;
    updated_at: string;
  }>(
    `
      SELECT
        id::text,
        status,
        last_detected_at::text,
        last_seen_run_id::text,
        updated_at::text
      FROM findings
      WHERE event_id = $1
        AND finding_type = 'EXPECTED_EVENT_UNCONFIRMED'
    `,
    [fixture.eventId],
  );

  assert.equal(before.rows.length, 1);
  assert.equal(before.rows[0].status, "open");

  // The expected event's deadline is already in the past.
  const historicalAsOf = new Date(Date.now() - 30_000).toISOString();

  const historicalResult = await runReconciliation({
    mode: "historical",
    asOf: historicalAsOf,
  });

  fixture.runIds.push(historicalResult.runId);

  const after = await pool.query(
    `
      SELECT
        id::text,
        status,
        last_detected_at::text,
        last_seen_run_id::text,
        updated_at::text
      FROM findings
      WHERE event_id = $1
        AND finding_type = 'EXPECTED_EVENT_UNCONFIRMED'
    `,
    [fixture.eventId],
  );

  // The persisted live finding must be exactly unchanged.
  assert.deepEqual(after.rows, before.rows);

  // The historical run should have a standalone snapshot.
  const snapshot = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM reconciliation_run_findings
      WHERE run_id = $1
        AND finding_id IS NULL
        AND finding_snapshot->>'eventId' = $2
    `,
    [historicalResult.runId, fixture.eventId],
  );

  assert.equal(Number(snapshot.rows[0].count), 1);
});

