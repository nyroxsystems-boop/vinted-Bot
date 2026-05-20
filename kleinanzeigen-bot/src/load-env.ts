import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ override: true, path: path.resolve(__dirname, '..', '..', '.env') });
