import { hasCredentials, wooFetch } from '../auth/credentials.js';

async function main() {
  if (!hasCredentials()) {
    console.error('✗ woocommerce credentials not configured');
    process.exit(1);
  }
  const r = await wooFetch('/system_status');
  console.log(r.ok ? '✓' : '✗', 'GET /system_status →', r.status);
  process.exit(r.ok ? 0 : 1);
}
main();
