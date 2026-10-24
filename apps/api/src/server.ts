import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { balancesRouter } from "./modules/balances/balances.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { reconciliationRouter } from "./modules/reconciliation/reconciliation.routes.js";
import { pool } from "./config/database.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: "http://localhost:4200" }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "kubera-api",
    });
});

app.get("/api/health/db", async (_req, res) => {
    try {
        await pool.query("SELECT 1");

        return res.json({
            status: "ok",
            service: "kubera-database",
        });
    } catch (error) {
        console.error(
            "Database health check failed:",
            error instanceof Error ? error.message : "Unknown error",
        );

        return res.status(503).json({
            error: "Database unavailable",
        });
    }
});

app.use("/api/airwallex/balances", balancesRouter);
app.use("/api/reconciliation", reconciliationRouter);

// Error handler must come after route registration.
app.use(errorHandler);

app.listen(env.PORT, () => {
    console.log(`KUBERA API listening on port ${env.PORT}`);
});
