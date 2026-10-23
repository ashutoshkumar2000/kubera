
import { env } from "../../config/env.js";
import {
  airwallexAuthResponseSchema,
  airwallexCurrentBalancesSchema,
  type AirwallexCurrentBalances,
} from "./airwallex.schemas.js";

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const pendingTokenRequests = new Map<string, Promise<string>>();

async function authenticate(accountId: string): Promise<string> {
  const response = await fetch(
    `${env.AIRWALLEX_BASE_URL}/api/v1/authentication/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": env.AIRWALLEX_CLIENT_ID,
        "x-api-key": env.AIRWALLEX_API_KEY,
        "x-login-as": accountId,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Airwallex authentication failed (${response.status})`,
    );
  }

  const rawData: unknown = await response.json();
  const parsed = airwallexAuthResponseSchema.safeParse(rawData);

  if (!parsed.success) {
    throw new Error("Invalid Airwallex authentication response");
  }

  const expiresAt = Date.parse(parsed.data.expires_at);

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("Airwallex returned an expired or invalid token");
  }

  // Refresh one minute before actual expiry.
  const effectiveExpiry = expiresAt - 60_000;

  tokenCache.set(accountId, {
    token: parsed.data.token,
    expiresAt: effectiveExpiry,
  });

  return parsed.data.token;
}

async function getAccessToken(accountId: string): Promise<string> {
  if (!env.AIRWALLEX_ACCOUNT_IDS.includes(accountId)) {
    throw new Error("Account is not configured for KUBERA");
  }

  const cached = tokenCache.get(accountId);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  // Avoid duplicate authentication requests for the same account.
  const existingRequest = pendingTokenRequests.get(accountId);

  if (existingRequest) {
    return existingRequest;
  }

  const request = authenticate(accountId);
  pendingTokenRequests.set(accountId, request);

  try {
    return await request;
  } finally {
    if (pendingTokenRequests.get(accountId) === request) {
      pendingTokenRequests.delete(accountId);
    }
  }
}

export async function getCurrentBalances(
  accountId: string,
): Promise<AirwallexCurrentBalances> {
  const token = await getAccessToken(accountId);

  const response = await fetch(
    `${env.AIRWALLEX_BASE_URL}/api/v1/balances/current`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Airwallex balance request failed (${response.status})`,
    );
  }

  const rawData: unknown = await response.json();
  const parsed = airwallexCurrentBalancesSchema.safeParse(rawData);

  if (!parsed.success) {
    throw new Error("Invalid Airwallex balance response");
  }

  return parsed.data;
}
