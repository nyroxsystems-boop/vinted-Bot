import 'dotenv/config';
import { depopAdapter } from '../index.js';
const accountId = Number(process.env.ACCOUNT_ID ?? 1);
const r = await depopAdapter.login(accountId);
if (r.ok) console.log(`✅ Logged in (account ${accountId})`);
else { console.error(`❌ ${r.error}`); process.exitCode = 1; }
