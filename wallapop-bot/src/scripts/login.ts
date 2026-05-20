import 'dotenv/config';
import path from 'node:path';
import { performInteractiveLogin } from '../login-flow.js';

const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const dataRoot = process.env.WP_DATA_ROOT ?? path.join(process.cwd(), 'data', 'wallapop-accounts');

const result = await performInteractiveLogin({
  accountId,
  storageDir: path.join(dataRoot, String(accountId)),
  waitSec: 600,
});

if (result.ok) console.log(`✅ Logged in (account ${accountId})`);
else { console.error(`❌ Login failed: ${result.error}`); process.exitCode = 1; }
await result.browser.close();
