
import { Router } from "express";
import { fetchBalancesForAccounts } from "./balances.service.js";
import { AppError } from "../../middleware/app-error.js";

export const balancesRouter = Router();

balancesRouter.get("/", async (_req, res, next) => {
  try {
    const result = await fetchBalancesForAccounts();
    return res.json(result);
  } catch {
    return next(
      new AppError(502, "Could not retrieve sandbox balances"),
    );
  }
});
