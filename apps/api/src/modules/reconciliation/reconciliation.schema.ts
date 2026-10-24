import { z } from "zod";

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const dateTimeSchema = z.string().datetime({ offset: true });

export const expectedEventSchema = z.object({
    id: z.string().min(1),
    type: z.enum(["incoming_deposit", "outgoing_payment"]),
    amountMinor: z.number().int().positive(),
    currency: currencySchema,
    expectedAt: dateTimeSchema,
});

export const observationSchema = z.object({
    id: z.string().min(1),
    eventId: z.string().min(1),

    type: z.enum(["incoming_deposit", "outgoing_payment"]),
    status: z.enum(["confirmed", "pending", "failed"]),

    amountMinor: z.number().int().nonnegative(),
    currency: currencySchema,
    observedAt: dateTimeSchema,

    source: z.enum(["airwallex", "synthetic", "manual"]),
});

export const reconciliationRequestSchema = z
    .object({
        asOf: dateTimeSchema,
        expectedEvents: z.array(expectedEventSchema).max(100),
        observations: z.array(observationSchema).max(500),
    })
    .superRefine((data, context) => {
        const eventIds = new Set<string>();

        data.expectedEvents.forEach((event, index) => {
            if (eventIds.has(event.id)) {
                context.addIssue({
                    code: "custom",
                    path: ["expectedEvents", index, "id"],
                    message: "Expected event IDs must be unique",
                });
            }

            eventIds.add(event.id);
        });

        const observationIds = new Set<string>();

        data.observations.forEach((observation, index) => {
            if (observationIds.has(observation.id)) {
                context.addIssue({
                    code: "custom",
                    path: ["observations", index, "id"],
                    message: "Observation IDs must be unique",
                });
            }

            observationIds.add(observation.id);

            if (!eventIds.has(observation.eventId)) {
                context.addIssue({
                    code: "custom",
                    path: ["observations", index, "eventId"],
                    message: "Observation references an unknown expected event",
                });
            }
        });
    });

export const reconciliationRunRequestSchema = z
    .object({
        asOf: dateTimeSchema,
    })
    .strict();

export type ExpectedEvent = z.infer<typeof expectedEventSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type ReconciliationRequest = z.infer<
    typeof reconciliationRequestSchema
>;