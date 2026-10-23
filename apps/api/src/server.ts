import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { balancesRouter } from "./modules/balances/balances.routes.js";
import { errorHandler } from "./middleware/error-handler.js";

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

app.use("/api/airwallex/balances", balancesRouter);

// Error handler must come after route registration.
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`KUBERA API listening on port ${env.PORT}`);
});
