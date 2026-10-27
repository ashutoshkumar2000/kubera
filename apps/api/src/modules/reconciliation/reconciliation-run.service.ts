import {
    createReconciliationRun,
    loadReconciliationInputs,
    markReconciliationRunFailed,
    persistReconciliationResults,
} from "./reconciliation.repository.js";

import { reconcileExpectedEvents } from "./reconciliation.service.js";
import type { ReconciliationRunRequest } from "./reconciliation.schema.js";

export async function runReconciliation(
    request: ReconciliationRunRequest,
) {
    const mode = request.mode;
    const asOf =
        mode === "live" ? new Date().toISOString() : request.asOf;

    let runId: string | undefined;

    try {
        runId = await createReconciliationRun(asOf, mode);

        const input = await loadReconciliationInputs(asOf);
        const findings = reconcileExpectedEvents(input);

        await persistReconciliationResults(
            runId,
            input,
            findings,
            mode,
        );

        return {
            runId,
            mode,
            asOf,
            evaluatedEventCount: input.expectedEvents.length,
            findingCount: findings.length,
            findings,
        };
    } catch (error) {
        if (runId) {
            try {
                await markReconciliationRunFailed(runId);
            } catch (markError) {
                console.error(
                    "Could not mark reconciliation run as failed:",
                    markError instanceof Error
                        ? markError.message
                        : "Unknown error",
                );
            }
        }

        throw error;
    }
}