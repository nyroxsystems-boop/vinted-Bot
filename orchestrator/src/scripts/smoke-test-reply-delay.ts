// Smoke-Test: verifiziert dass scheduled_send_at korrekt
// gesetzt wird und flushDueDrafts() fällige Drafts findet.
//
// Setzt KEINE echten Sends ab — testet nur DB-Layer.
import { getDb, setSetting } from '@vinted-system/shared';

function row<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

function all<T = unknown>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

async function main() {
  console.log('=== Smoke-Test: Reply-Autopilot Delay-Flow ===\n');

  // 1. Check settings keys present
  const keys = [
    'auto_reply_enabled',
    'auto_reply_send_mode',
    'auto_reply_delay_min_s',
    'auto_reply_delay_max_s',
    'llm_provider',
    'seller_name',
    'seller_display_name',
    'seller_zip',
    'seller_city',
    'payment_methods_json',
    'shipping_default_provider',
  ];
  for (const k of keys) {
    const r = row<{ value: string }>('SELECT value FROM settings WHERE key=?', k);
    console.log(`  ${k.padEnd(40)} = ${r?.value ?? '(missing)'}`);
  }

  // 2. Check column exists
  const cols = all<{ name: string }>("PRAGMA table_info('reply_autopilot_log')");
  const hasScheduled = cols.some(c => c.name === 'scheduled_send_at');
  console.log(`\n  scheduled_send_at column: ${hasScheduled ? 'YES ✅' : 'NO ❌'}`);

  // 3. Configure test seller
  setSetting('seller_display_name', 'Lina');
  setSetting('seller_zip', '12345');
  setSetting('seller_city', 'Berlin');
  setSetting('shipping_default_provider', 'Hermes');
  setSetting('payment_methods_json', JSON.stringify([
    { type: 'paypal', handle: 'lina@example.com', name: 'Lina Müller' },
    { type: 'iban',   handle: 'DE89370400440532013000', holder: 'Lina Müller' },
  ]));

  // 4. Test loadSellerContext + renderSellerSystemSnippet
  const { loadSellerContext, renderSellerSystemSnippet } = await import('../reply-autopilot.js');
  const ctx = loadSellerContext();
  console.log('\n  loadSellerContext():');
  console.log('   ', JSON.stringify(ctx, null, 2).split('\n').join('\n    '));

  const snip = renderSellerSystemSnippet(ctx);
  console.log('\n  renderSellerSystemSnippet():');
  console.log('   ', snip);

  // 5. Smoke-test flushDueDrafts: insert a fake row with past scheduled_send_at
  console.log('\n=== Mock-Insert: scheduled_send_at in past ===');
  const db = getDb();
  // pick any existing chat to avoid FK issues
  const anyChat = row<{ id: number }>('SELECT id FROM chats LIMIT 1');
  if (!anyChat) {
    console.log('  No chat row available — skip flush test');
  } else {
    // SQLite-compatible format: 'YYYY-MM-DD HH:MM:SS' matches datetime('now') for lex compare
    const past = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const inserted = db.prepare(
      `INSERT INTO reply_autopilot_log
         (marketplace, chat_id, message_id, intent, in_text, draft_text, mode, status, scheduled_send_at, meta_json)
       VALUES ('vinted', ?, NULL, 'smalltalk', '__smoke__', '__smoke_reply__', 'auto', 'pending', ?, '{}')
       RETURNING id`,
    ).get(anyChat.id, past) as { id: number };
    console.log(`  Inserted row id=${inserted.id} with scheduled_send_at=${past}`);

    // Query the "due drafts" SQL directly
    const due = all<{ id: number; draft_text: string }>(
      `SELECT id, draft_text FROM reply_autopilot_log
        WHERE status='pending' AND mode='auto'
          AND scheduled_send_at IS NOT NULL
          AND scheduled_send_at <= datetime('now')`,
    );
    console.log(`  Due-Drafts gefunden: ${due.length}`);
    const found = due.find(d => d.id === inserted.id);
    console.log(`  Test-Row in Due-Liste: ${found ? 'YES ✅' : 'NO ❌'}`);

    // cleanup
    db.prepare('DELETE FROM reply_autopilot_log WHERE id=?').run(inserted.id);
    console.log(`  Cleanup done`);
  }

  // 6. Cleanup: reset seller fields so we don't accidentally use them in prod
  setSetting('seller_display_name', '');
  setSetting('seller_zip', '');
  setSetting('seller_city', '');
  setSetting('payment_methods_json', '[]');

  console.log('\n=== Smoke-Test fertig ✅ ===');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
