import type { ReconciliationRequest, ExpectedEvent, Observation } from "./reconciliation.schema.js";

type FindingType =
    | "EXPECTED_EVENT_UNCONFIRMED"
    | "EXPECTED_EVENT_FAILED"
    | "TRANSFER_UNRESOLVED"
    | "EVENT_OBSERVED_LATE"
    | "AMOUNT_MISMATCH"
    | "CURRENCY_MISMATCH"
    | "EVENT_TYPE_MISMATCH";

type FindingSeverity = "info" | "warning" | "critical";

export interface ReconciliationFinding {
    id: string;
    eventId: string;
    observationId?: string;
    type: FindingType;
    severity: FindingSeverity;
    title: string;
    description: string;
    expectedAmountMinor: number;
    expectedCurrency: string;
    observedAmountMinor?: number;
    observedCurrency?: string;
}

function createFinding(
    event: ExpectedEvent,
    type: FindingType,
    severity: FindingSeverity,
    title: string,
    description: string,
    observation?: Observation,
): ReconciliationFinding {
    return {
        id: `${event.id}:${type}`,
        eventId: event.id,
        type,
        severity,
        title,
        description,
        expectedAmountMinor: event.amountMinor,
        expectedCurrency: event.currency,
        ...(observation
            ? {
                observationId: observation.id,
                observedAmountMinor: observation.amountMinor,
                observedCurrency: observation.currency,
            }
            : {}),
    };
}

export function reconcileExpectedEvents(
    input: ReconciliationRequest,
): ReconciliationFinding[] {
    const asOfTime = Date.parse(input.asOf);

    // Only consider evidence that was available at the requested
    // reconciliation time. This keeps historical runs reproducible.
    const observationsByEventId = new Map<string, Observation[]>();

    for (const observation of input.observations) {
        if (Date.parse(observation.observedAt) > asOfTime) {
            continue;
        }

        const existing = observationsByEventId.get(observation.eventId) ?? [];
        existing.push(observation);
        observationsByEventId.set(observation.eventId, existing);
    }

    const findings: ReconciliationFinding[] = [];

    for (const event of input.expectedEvents) {
        const latestObservation = (
            observationsByEventId.get(event.id) ?? []
        ).sort(
            (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
        )[0];

        const isOverdue = Date.parse(event.expectedAt) <= asOfTime;

        if (!latestObservation) {
            if (isOverdue) {
                findings.push(
                    createFinding(
                        event,
                        "EXPECTED_EVENT_UNCONFIRMED",
                        "warning",
                        "Expected event is overdue",
                        "The expected event is overdue, and no matching observation was supplied. Investigate before relying on it.",
                    ),
                );
            }

            continue;
        }

        if (latestObservation.type !== event.type) {
            findings.push(
                createFinding(
                    event,
                    "EVENT_TYPE_MISMATCH",
                    "warning",
                    "Event type does not match",
                    "The latest observation has a different event type from the expectation. Verify the event mapping.",
                    latestObservation,
                ),
            );

            continue;
        }

        if (latestObservation.status === "failed") {
            findings.push(
                createFinding(
                    event,
                    "EXPECTED_EVENT_FAILED",
                    event.type === "outgoing_payment" ? "critical" : "warning",
                    "Expected event has failed",
                    "The latest observation reports a failure. Verify the failure details before deciding on recovery.",
                    latestObservation,
                ),
            );

            continue;
        }

        if (latestObservation.status === "pending") {
            if (isOverdue) {
                findings.push(
                    createFinding(
                        event,
                        event.type === "outgoing_payment"
                            ? "TRANSFER_UNRESOLVED"
                            : "EXPECTED_EVENT_UNCONFIRMED",
                        "warning",
                        event.type === "outgoing_payment"
                            ? "Transfer is unresolved"
                            : "Expected deposit remains unconfirmed",
                        "The latest observation is pending beyond the expected time. Check the authoritative transaction status before taking action.",
                        latestObservation,
                    ),
                );
            }

            continue;
        }

        // A confirmed observation must match the expected amount and currency.
        if (latestObservation.currency !== event.currency) {
            findings.push(
                createFinding(
                    event,
                    "CURRENCY_MISMATCH",
                    "critical",
                    "Currency mismatch",
                    "The confirmed observation uses a different currency from the expectation. Do not treat the amounts as equivalent.",
                    latestObservation,
                ),
            );

            continue;
        }

        if (latestObservation.amountMinor !== event.amountMinor) {
            findings.push(
                createFinding(
                    event,
                    "AMOUNT_MISMATCH",
                    "warning",
                    "Amount mismatch",
                    "The confirmed amount differs from the expected amount. Investigate the discrepancy.",
                    latestObservation,
                ),
            );

            continue;
        }

        if (Date.parse(latestObservation.observedAt) > Date.parse(event.expectedAt)) {
            findings.push(
                createFinding(
                    event,
                    "EVENT_OBSERVED_LATE",
                    "info",
                    "Event was observed late",
                    "The event was confirmed after its expected time.",
                    latestObservation,
                ),
            );
        }
    }

    return findings;
}