import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateForProduct } from './nano-build-listing-photos.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SYSTEM_DIR = path.resolve(__dirname, '..');
const VINTED_ROOT = path.resolve(SYSTEM_DIR, '../Vinted');

const SKIP_CATEGORIES = new Set(["Handbags", "Links"]);

async function getProductsForCategories(categories) {
    const products = [];
    
    let targetCats = categories;
    if (categories.includes('all')) {
        const items = await fs.readdir(VINTED_ROOT, { withFileTypes: true });
        targetCats = items
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .filter(name => !SKIP_CATEGORIES.has(name) && !name.startsWith('_') && !name.startsWith('.'));
    }

    for (const cat of targetCats) {
        if (SKIP_CATEGORIES.has(cat)) continue;
        
        const catDir = path.join(VINTED_ROOT, cat);
        try {
            const numDirs = await fs.readdir(catDir, { withFileTypes: true });
            for (const numDir of numDirs) {
                if (!numDir.isDirectory() || !/^\d+$/.test(numDir.name)) continue;
                
                const cjDirs = await fs.readdir(path.join(catDir, numDir.name), { withFileTypes: true });
                for (const cjDir of cjDirs) {
                    if (cjDir.isDirectory() && cjDir.name.startsWith("CJ")) {
                        products.push(path.join(catDir, numDir.name, cjDir.name));
                    }
                }
            }
        } catch (err) {
            console.warn(`[WARN] Could not read category directory ${catDir}: ${err.message}`);
        }
    }
    
    return products;
}

async function runBatch() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage: node nano-batch-listings.mjs <category-name> [<category-name>...] | all [--concurrency=N]");
        process.exit(1);
    }
    
    let concurrency = 2; // Default concurrency
    const categories = [];
    
    for (const arg of args) {
        if (arg.startsWith('--concurrency=')) {
            concurrency = parseInt(arg.split('=')[1], 10) || concurrency;
        } else {
            categories.push(arg);
        }
    }
    
    console.log(`Starting batch job. Categories: ${categories.join(', ')} | Concurrency: ${concurrency}`);
    
    const products = await getProductsForCategories(categories);
    console.log(`Found ${products.length} products to process.\n`);
    
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    const failedProducts = [];
    
    const startTime = Date.now();
    
    // Chunk processing
    for (let i = 0; i < products.length; i += concurrency) {
        const chunk = products.slice(i, i + concurrency);
        const promises = chunk.map(async (productDir) => {
            // generateForProduct now handles per-variant done-checking internally,
            // so we don't pre-check here. It will skip variants that are already done.
            try {
                const success = await generateForProduct(productDir);
                if (success) successCount++;
                else { failCount++; failedProducts.push(productDir); }
            } catch (err) {
                console.error(`[FAIL] ${path.basename(productDir)}: ${err.message}`);
                failCount++;
                failedProducts.push(productDir);
            }
        });
        
        await Promise.all(promises);
    }
    
    const durationMins = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    
    console.log(`\n=== BATCH REPORT ===`);
    console.log(`Total Found:    ${products.length}`);
    console.log(`Successfully generated: ${successCount}`);
    console.log(`Skipped (already done): ${skipCount}`);
    console.log(`Failed:         ${failCount}`);
    console.log(`Duration:       ${durationMins} minutes`);
    console.log(`Est. Cost:      ~$${((successCount * 5) * 0.003).toFixed(2)} - $${((successCount * 5) * 0.01).toFixed(2)} (depending on model tier)`);
    
    if (failedProducts.length > 0) {
        console.log(`\nFailed Products:`);
        failedProducts.forEach(fp => console.log(` - ${fp}`));
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runBatch().catch(err => {
        console.error("Batch script failed:", err);
        process.exit(1);
    });
}
