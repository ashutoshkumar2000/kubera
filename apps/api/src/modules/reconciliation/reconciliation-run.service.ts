import {
  createReconciliationRun,
  loadReconciliationInputs,
  markReconciliationRunFailed,
  persistReconciliationResults,
} from "./reconciliation.repository.js";

import { reconcileExpectedEvents } from "./reconciliation.service.js";

export async function runReconciliation(asOf: string) {
  let runId: string | undefined;

  try {
    // 1. Record that reconciliation has started.
    runId = await createReconciliationRun(asOf);

    // 2. Load expected events and observations from PostgreSQL.
    const input = await loadReconciliationInputs(asOf);

    // 3. Run our existing, deterministic rules.
    const findings = reconcileExpectedEvents(input);

    // 4. Persist findings and mark the run completed.
    await persistReconciliationResults(runId, input, findings);

    return {
      runId,
      asOf,
      evaluatedEventCount: input.expectedEvents.length,
      findingCount: findings.length,
      findings,
    };
  } catch (error) {
    // The run was created before processing, so record its failure
    // if any later step fails.
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