import { hasCredentials, shopifyFetch } from '../auth/token.js';

async function main() {
  if (!hasCredentials()) {
    console.error('✗ shopify_shop / shopify_access_token not configured');
    process.exit(1);
  }
  const r = await shopifyFetch('/shop.json');
  console.log(r.ok ? '✓' : '✗', 'GET /shop.json →', r.status);
  process.exit(r.ok ? 0 : 1);
}
main();
