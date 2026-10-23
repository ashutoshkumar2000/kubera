
import "dotenv/config";
import { z } from "zod";

const accountIdsSchema = z
  .string()
  .transform((value) =>
    value.split(",").map((id) => id.trim()).filter(Boolean),
  )
  .pipe(
    z
      .array(z.string().min(1))
      .min(1, "At least one sandbox account is required")
      .max(10, "At most 10 accounts are supported"),
  )
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Duplicate account IDs are not allowed",
  );

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  AIRWALLEX_BASE_URL: z.literal(
    "https://api.sandbox.airwallex.com",
  ),

  AIRWALLEX_CLIENT_ID: z.string().trim().min(1),
  AIRWALLEX_API_KEY: z.string().trim().min(1),
  AIRWALLEX_ACCOUNT_IDS: accountIdsSchema,
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const invalidVariables = result.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");

  throw new Error(
    `Invalid environment configuration: ${invalidVariables}`,
  );
}

export const env = Object.freeze(result.data);
