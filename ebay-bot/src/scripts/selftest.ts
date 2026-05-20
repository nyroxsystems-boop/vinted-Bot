// ──────────────────────────────────────────────────────────────────────────────
// eBay bot selftest.
//
// 1. Checks that OAuth credentials are configured (per marketplace)
// 2. Refreshes the access token (verifies client_id/secret/refresh_token are valid)
// 3. Pings a low-cost authenticated endpoint
//    (/sell/account/v1/payment_policy — read-only, no side-effects)
//
// Exit codes:
//   0  — all checks passed for the requested market
//   1  — at least one check failed
//   2  — credentials missing (so we can't even attempt)
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import {
  ebayApiBase,
  ebayFetch,
  getAccessToken,
  hasCredentials,
  marketplaceId,
  readCredentials,
  type EbayMarket,
} from '../auth/token.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

async function runChecks(market: EbayMarket): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const creds = readCredentials(market);

  out.push({
    name: `${market}/credentials present`,
    ok: !!(creds.clientId && creds.clientSecret && creds.refreshToken),
    detail: !creds.clientId ? 'client_id missing'
      : !creds.clientSecret ? 'client_secret missing'
        : !creds.refreshToken ? 'refresh_token missing'
          : 'ok',
  });

  if (!hasCredentials(market)) {
    return out;
  }

  // token refresh
  try {
    const token = await getAccessToken(market);
    out.push({
      name: `${market}/access_token refresh`,
      ok: !!token && token.length > 10,
      detail: `len=${token.length}`,
    });
  } catch (err) {
    out.push({
      name: `${market}/access_token refresh`,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return out; // can't continue without a token
  }

  // authenticated ping — payment_policy is read-only and present on any seller
  try {
    const mpId = marketplaceId(market);
    const r = await ebayFetch<{ paymentPolicies?: unknown[]; total?: number }>(
      market,
      'GET',
      `/sell/account/v1/payment_policy?marketplace_id=${mpId}`,
    );
    out.push({
      name: `${market}/payment_policy ping`,
      ok: r.ok,
      detail: r.ok
        ? `status=${r.status} policies=${(r.data?.paymentPolicies ?? []).length}`
        : r.error,
    });
  } catch (err) {
    out.push({
      name: `${market}/payment_policy ping`,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return out;
}

async function main(): Promise<void> {
  const requested = (process.env.EBAY_MARKET ?? '').toLowerCase();
  const markets: EbayMarket[] = requested === 'de' || requested === 'uk'
    ? [requested as EbayMarket]
    : (['de', 'uk'] as EbayMarket[]);

  console.log(`\neBay selftest — API base: ${ebayApiBase()}`);
  console.log(`markets: ${markets.join(', ')}\n`);

  let totalPassed = 0;
  let totalChecks = 0;
  let credsMissing = false;

  for (const market of markets) {
    if (!hasCredentials(market)) credsMissing = true;
    const results = await runChecks(market);
    for (const r of results) {
      totalChecks++;
      if (r.ok) totalPassed++;
      const symbol = r.ok ? 'PASS' : 'FAIL';
      console.log(`  [${symbol}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }

  const allPassed = totalPassed === totalChecks && totalChecks > 0;
  console.log(`\n${allPassed ? 'OK' : 'FAIL'} ${totalPassed}/${totalChecks} checks passed`);

  if (allPassed) process.exit(0);
  if (credsMissing && totalPassed === 0) process.exit(2);
  process.exit(1);
}

main().catch((err) => {
  console.error('selftest crashed:', err);
  process.exit(1);
});
