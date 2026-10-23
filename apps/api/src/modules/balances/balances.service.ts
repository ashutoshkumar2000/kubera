
import { env } from "../../config/env.js";
import { getCurrentBalances } from "../../integrations/airwallex/airwallex.client.js";

export async function fetchBalancesForAccounts() {
  const accounts = await Promise.all(
    env.AIRWALLEX_ACCOUNT_IDS.map(async (accountId) => ({
      accountId,
      balances: await getCurrentBalances(accountId),
    })),
  );

  return { accounts };
}
