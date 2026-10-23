import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();

app.use(helmet());
app.use(cors({ origin: "http://localhost:4200" }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "kubera-api",
  });
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`KUBERA API listening on port ${port}`);
});