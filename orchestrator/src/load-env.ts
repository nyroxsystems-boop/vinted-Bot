// MUST be imported FIRST (before any other module that reads process.env at
// top-level). ESM evaluates side-effect imports in source order, so as long
// as this file appears as the first `import` line, dotenv populates process.env
// before any other module's top-level code runs.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ override: true, path: path.resolve(__dirname, '..', '..', '.env') });
