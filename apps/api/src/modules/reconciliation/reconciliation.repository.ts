
import { pool } from "../../config/database.js";
import {
    reconciliationRequestSchema,
    type ReconciliationRequest,
} from "./reconciliation.schema.js";
import type { ReconciliationFinding } from "./reconciliation.service.js";
import type { Observation } from "./reconciliation.schema.js";

interface ExpectedEventRow {
    id: string;
    event_type: "incoming_deposit" | "outgoing_payment";
    amount_minor: string;
    currency: string;
    expected_at: Date;
}

interface ObservationRow {
    id: string;
    event_id: string;
    observation_type: "incoming_deposit" | "outgoing_payment";
    status: "confirmed" | "pending" | "failed";
    amount_minor: string;
    currency: string;
    observed_at: Date;
    source: "airwallex" | "synthetic" | "manual";
}

function toSafeMinorUnits(value: string): number {
    const amount = Number(value);

    if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error(
            "Stored monetary amount is outside the supported range",
        );
    }

    return amount;
}

export async function loadReconciliationInputs(
    asOf: string,
): Promise<ReconciliationRequest> {
    const eventResult = await pool.query<ExpectedEventRow>(`
    SELECT
      id,
      event_type,
      amount_minor::text AS amount_minor,
      currency,
      expected_at
    FROM expected_events
    WHERE status = 'active'
    ORDER BY expected_at ASC
  `);

    const eventRows = eventResult.rows;
    const eventIds = eventRows.map((event) => event.id);

    let observationRows: ObservationRow[] = [];

    if (eventIds.length > 0) {
        const observationResult = await pool.query<ObservationRow>(
            `
        SELECT
          id,
          event_id,
          observation_type,
          status,
          amount_minor::text AS amount_minor,
          currency,
          observed_at,
          source
        FROM observations
        WHERE event_id = ANY($1::text[])
          AND observed_at <= $2::timestamptz
        ORDER BY observed_at ASC
      `,
            [eventIds, asOf],
        );

        observationRows = observationResult.rows;
    }

    const request = {
        asOf,

        expectedEvents: eventRows.map((row) => ({
            id: row.id,
            type: row.event_type,
            amountMinor: toSafeMinorUnits(row.amount_minor),
            currency: row.currency,
            expectedAt: row.expected_at.toISOString(),
        })),

        observations: observationRows.map((row) => ({
            id: row.id,
            eventId: row.event_id,
            type: row.observation_type,
            status: row.status,
            amountMinor: toSafeMinorUnits(row.amount_minor),
            currency: row.currency,
            observedAt: row.observed_at.toISOString(),
            source: row.source,
        })),
    };

    const parsed = reconciliationRequestSchema.safeParse(request);

    if (!parsed.success) {
        // Don't include database records or sensitive data in this error.
        throw new Error(
            "Stored reconciliation data failed validation",
        );
    }

    return parsed.data;
}


export async function createReconciliationRun(
  asOf: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO reconciliation_runs (as_of, status)
      VALUES ($1, 'running')
      RETURNING id
    `,
    [asOf],
  );

  return result.rows[0].id;
}

export async function markReconciliationRunFailed(
  runId: string,
): Promise<void> {
  await pool.query(
    `
      UPDATE reconciliation_runs
      SET status = 'failed',
          completed_at = NOW(),
          error_code = 'RECONCILIATION_FAILED'
      WHERE id = $1
        AND status = 'running'
    `,
    [runId],
  );
}

function getFindingFingerprint(
  finding: ReconciliationFinding,
): string {
  // The same event and finding type identify the same issue.
  return JSON.stringify([finding.eventId, finding.type]);
}

function getLatestObservations(
  observations: Observation[],
): Map<string, Observation> {
  const latestByEvent = new Map<string, Observation>();

  for (const observation of observations) {
    const previous = latestByEvent.get(observation.eventId);

    if (
      !previous ||
      Date.parse(observation.observedAt) >
        Date.parse(previous.observedAt)
    ) {
      latestByEvent.set(observation.eventId, observation);
    }
  }

  return latestByEvent;
}

export async function persistReconciliationResults(
  runId: string,
  input: ReconciliationRequest,
  findings: ReconciliationFinding[],
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Record which expected events this run evaluated.
    for (const event of input.expectedEvents) {
      await client.query(
        `
          INSERT INTO reconciliation_run_events (run_id, event_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [runId, event.id],
      );
    }

    // Record which observations this run used.
    for (const observation of input.observations) {
      await client.query(
        `
          INSERT INTO reconciliation_run_observations
            (run_id, observation_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [runId, observation.id],
      );
    }

    const fingerprints = findings.map(getFindingFingerprint);

    // Create new findings or update the existing issue.
    for (const finding of findings) {
      const fingerprint = getFindingFingerprint(finding);

      // A late-confirmation finding describes a past event,
      // rather than an issue that still needs action.
      const status =
        finding.type === "EVENT_OBSERVED_LATE"
          ? "resolved"
          : "open";

      const saved = await client.query<{ id: string }>(
        `
          INSERT INTO findings (
            fingerprint,
            event_id,
            finding_type,
            severity,
            title,
            description,
            status,
            first_detected_at,
            last_detected_at,
            resolved_at,
            last_seen_run_id,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            NOW(), NOW(),
            CASE WHEN $7 = 'resolved' THEN NOW() ELSE NULL END,
            $8, NOW(), NOW()
          )
          ON CONFLICT (fingerprint)
          DO UPDATE SET
            event_id = EXCLUDED.event_id,
            finding_type = EXCLUDED.finding_type,
            severity = EXCLUDED.severity,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            first_detected_at = CASE
              WHEN findings.status = 'resolved'
                AND EXCLUDED.status = 'open'
              THEN NOW()
              ELSE findings.first_detected_at
            END,
            last_detected_at = NOW(),
            status = EXCLUDED.status,
            resolved_at = EXCLUDED.resolved_at,
            last_seen_run_id = EXCLUDED.last_seen_run_id,
            updated_at = NOW()
          RETURNING id
        `,
        [
          fingerprint,
          finding.eventId,
          finding.type,
          finding.severity,
          finding.title,
          finding.description,
          status,
          runId,
        ],
      );

      const findingId = saved.rows[0].id;

      await client.query(
        `
          INSERT INTO reconciliation_run_findings (
            run_id,
            finding_id,
            finding_snapshot
          )
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (run_id, finding_id)
          DO UPDATE SET finding_snapshot = EXCLUDED.finding_snapshot
        `,
        [
          runId,
          findingId,
          JSON.stringify({
            ...finding,
            fingerprint,
            status,
          }),
        ],
      );
    }

    // A confirmed or explicitly failed observation can replace an
    // older "unconfirmed" finding with a more accurate result.
    // Pending or missing evidence is not sufficient to resolve it.
    const latestByEvent = getLatestObservations(input.observations);

    const conclusiveEventIds = input.expectedEvents
      .filter((event) => {
        const observation = latestByEvent.get(event.id);

        return (
          observation !== undefined &&
          observation.type === event.type &&
          (observation.status === "confirmed" ||
            observation.status === "failed") &&
          Date.parse(observation.observedAt) <= Date.parse(input.asOf)
        );
      })
      .map((event) => event.id);

    if (conclusiveEventIds.length > 0) {
      const staleResult = await client.query<{
        id: string;
        fingerprint: string;
        event_id: string;
        finding_type: string;
        severity: string;
        title: string;
        description: string;
      }>(
        `
          SELECT
            id,
            fingerprint,
            event_id,
            finding_type,
            severity,
            title,
            description
          FROM findings
          WHERE event_id = ANY($1::text[])
            AND status = 'open'
            AND NOT (fingerprint = ANY($2::text[]))
            AND last_detected_at <= $3::timestamptz
          FOR UPDATE
        `,
        [conclusiveEventIds, fingerprints, input.asOf],
      );

      for (const stale of staleResult.rows) {
        const resolved = await client.query(
          `
            UPDATE findings
            SET status = 'resolved',
                resolved_at = NOW(),
                last_seen_run_id = $2,
                updated_at = NOW()
            WHERE id = $1
              AND status = 'open'
            RETURNING id
          `,
          [stale.id, runId],
        );

        if (resolved.rowCount === 0) {
          continue;
        }

        await client.query(
          `
            INSERT INTO reconciliation_run_findings (
              run_id,
              finding_id,
              finding_snapshot
            )
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (run_id, finding_id)
            DO UPDATE SET finding_snapshot = EXCLUDED.finding_snapshot
          `,
          [
            runId,
            stale.id,
            JSON.stringify({
              id: stale.id,
              fingerprint: stale.fingerprint,
              eventId: stale.event_id,
              type: stale.finding_type,
              severity: stale.severity,
              title: stale.title,
              description: stale.description,
              status: "resolved",
              resolutionReason: "Superseded by a newer conclusive observation",
            }),
          ],
        );
      }
    }

    // Mark the run complete only after its records are saved.
    await client.query(
      `
        UPDATE reconciliation_runs
        SET status = 'completed',
            completed_at = NOW(),
            evaluated_event_count = $2,
            finding_count = $3
        WHERE id = $1
      `,
      [runId, input.expectedEvents.length, findings.length],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

