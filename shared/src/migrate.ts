import 'dotenv/config';
import { runMigrations, closeDb } from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('migrate');

try {
  runMigrations();
  log.info('Migrations applied successfully');
} catch (err) {
  log.error('Migration failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
} finally {
  closeDb();
}
