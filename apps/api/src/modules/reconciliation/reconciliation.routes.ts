import { Router } from "express";
import { AppError } from "../../middleware/app-error.js";
import { reconciliationRunRequestSchema } from "./reconciliation.schema.js";
import { runReconciliation } from "./reconciliation-run.service.js";

export const reconciliationRouter = Router();

reconciliationRouter.post("/run", async (req, res, next) => {
  const parsed = reconciliationRunRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return next(new AppError(400, "Invalid reconciliation request"));
  }

  try {
    const result = await runReconciliation(parsed.data);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});