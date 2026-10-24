
import test from "node:test";
import assert from "node:assert/strict";

import {
    reconciliationRequestSchema,
    type ExpectedEvent,
    type Observation,
    type ReconciliationRequest,
} from "./reconciliation.schema.js";

import { reconcileExpectedEvents } from "./reconciliation.service.js";

const AS_OF = "2026-10-24T12:00:00+05:30";

const depositEvent: ExpectedEvent = {
    id: "deposit-001",
    type: "incoming_deposit",
    amountMinor: 1_000_000, // $10,000 USD
    currency: "USD",
    expectedAt: "2026-10-24T11:00:00+05:30",
};

const supplierPaymentEvent: ExpectedEvent = {
    id: "supplier-payment-001",
    type: "outgoing_payment",
    amountMinor: 700_000, // $7,000 USD
    currency: "USD",
    expectedAt: "2026-10-24T11:00:00+05:30",
};

function makeRequest(
    overrides: Partial<ReconciliationRequest> = {},
): ReconciliationRequest {
    return {
        asOf: AS_OF,
        expectedEvents: [depositEvent],
        observations: [],
        ...overrides,
    };
}

function makeObservation(
    overrides: Partial<Observation> = {},
): Observation {
    return {
        id: "observation-001",
        eventId: depositEvent.id,
        type: "incoming_deposit",
        status: "confirmed",
        amountMinor: 1_000_000,
        currency: "USD",
        observedAt: "2026-10-24T10:50:00+05:30",
        source: "synthetic",
        ...overrides,
    };
}

test("flags an overdue deposit when no observation exists", () => {
    const findings = reconcileExpectedEvents(makeRequest());

    assert.equal(findings.length, 1);
    assert.equal(findings[0].type, "EXPECTED_EVENT_UNCONFIRMED");
    assert.equal(findings[0].severity, "warning");
    assert.equal(findings[0].eventId, depositEvent.id);
});

test("returns no finding for a matching deposit confirmed on time", () => {
    const request = makeRequest({
        observations: [makeObservation()],
    });

    const findings = reconcileExpectedEvents(request);

    assert.deepEqual(findings, []);
});

test("flags a failed supplier payment as critical", () => {
    const failedPayment = makeObservation({
        id: "observation-payment-001",
        eventId: supplierPaymentEvent.id,
        type: "outgoing_payment",
        status: "failed",
        amountMinor: 0,
        observedAt: "2026-10-24T11:30:00+05:30",
    });

    const findings = reconcileExpectedEvents(
        makeRequest({
            expectedEvents: [supplierPaymentEvent],
            observations: [failedPayment],
        }),
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0].type, "EXPECTED_EVENT_FAILED");
    assert.equal(findings[0].severity, "critical");
});

test("flags a confirmed amount that differs from the expectation", () => {
    const request = makeRequest({
        observations: [
            makeObservation({
                amountMinor: 900_000, // $9,000 instead of $10,000
            }),
        ],
    });

    const findings = reconcileExpectedEvents(request);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].type, "AMOUNT_MISMATCH");
});

test("ignores observations recorded after the requested as-of time", () => {
    const request = makeRequest({
        observations: [
            makeObservation({
                observedAt: "2026-10-24T12:30:00+05:30",
            }),
        ],
    });

    const findings = reconcileExpectedEvents(request);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].type, "EXPECTED_EVENT_UNCONFIRMED");
});

test("rejects observations that reference an unknown event", () => {
    const result = reconciliationRequestSchema.safeParse(
        makeRequest({
            observations: [
                makeObservation({
                    eventId: "unknown-event",
                }),
            ],
        }),
    );

    assert.equal(result.success, false);
});

test("rejects duplicate expected event IDs", () => {
    const result = reconciliationRequestSchema.safeParse(
        makeRequest({
            expectedEvents: [depositEvent, depositEvent],
        }),
    );

    assert.equal(result.success, false);
});

test("flags an event confirmed after its expected time", () => {
    const request = makeRequest({
        observations: [
            makeObservation({
                observedAt: "2026-10-24T11:30:00+05:30",
            }),
        ],
    });

    const findings = reconcileExpectedEvents(request);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].type, "EVENT_OBSERVED_LATE");
});
