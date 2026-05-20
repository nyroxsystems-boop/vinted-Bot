import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateForProduct } from './nano-build-listing-photos.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runRebuild() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage: node nano-rebuild-product.mjs <product-folder-path>");
        process.exit(1);
    }

    const targetFolder = path.resolve(process.cwd(), args[0]);
    const generatedDir = path.join(targetFolder, "generated");
    
    // Clear generated directory first
    try {
        const stats = await fs.stat(generatedDir);
        if (stats.isDirectory()) {
            console.log(`Clearing existing generated/ directory in ${targetFolder}...`);
            const files = await fs.readdir(generatedDir);
            for (const file of files) {
                await fs.unlink(path.join(generatedDir, file));
            }
        }
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error(`[WARN] Could not clear generated/ directory: ${err.message}`);
        }
    }

    // Run generation
    const success = await generateForProduct(targetFolder);
    process.exit(success ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runRebuild().catch(err => {
        console.error("Rebuild script failed:", err);
        process.exit(1);
    });
}
