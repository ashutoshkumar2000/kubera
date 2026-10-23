
import { z } from "zod";

export const airwallexAuthResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/,
    "Expected an ISO timestamp with timezone",
  ),
});

export type AirwallexAuthResponse = z.infer<
  typeof airwallexAuthResponseSchema
>;


export const airwallexCurrentBalancesSchema = z.array(
  z.object({
    account_type: z.enum(["cash", "yield", "credit"]),
    currency: z.string().regex(/^[A-Z]{3}$/),

    available_amount: z.number().finite(),

    // Some fields depend on the account type.
    pending_amount: z.number().finite().optional(),
    prepayment_amount: z.number().finite().optional(),
    reserved_amount: z.number().finite().optional(),
    total_amount: z.number().finite().optional(),
  }),
);

export type AirwallexCurrentBalances = z.infer<
  typeof airwallexCurrentBalancesSchema
>;
