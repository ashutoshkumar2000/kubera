
import { Pool } from "pg";
import { env } from "./env.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (error) => {
  console.error(
    "Unexpected PostgreSQL pool error:",
    error.message,
  );
});
