// ──────────────────────────────────────────────────────────────────────────────
// PM2 Ecosystem Config — Auto-restart all services on crash/reboot
// Usage: pm2 start ecosystem.config.cjs
//        pm2 save && pm2 startup
// ──────────────────────────────────────────────────────────────────────────────

const path = require('path');
const ROOT = __dirname;

module.exports = {
  apps: [
    // ── Orchestrator (Port 4700) — Main brain ────────────────────────────
    {
      name: 'orchestrator',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'orchestrator'),
      env: { NODE_ENV: 'production', LOG_LEVEL: 'info' },
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      watch: false,
      max_memory_restart: '512M',
    },

    // ── Vinted Bot (Port 4701) ───────────────────────────────────────────
    {
      name: 'vinted-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'vinted-bot'),
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
    },

    // ── CJ Service (Port 4720) — Fulfillment via CJ Dropshipping API ─────
    {
      name: 'cj-service',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'cj-service'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Kleinanzeigen Bot (Port 4703) ────────────────────────────────────
    {
      name: 'kleinanzeigen-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'kleinanzeigen-bot'),
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
    },

    // ── Mercari Bot (Port 4704) ──────────────────────────────────────────
    {
      name: 'mercari-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'mercari-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Depop Bot (Port 4705) ────────────────────────────────────────────
    {
      name: 'depop-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'depop-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Wallapop Bot (Port 4706) ─────────────────────────────────────────
    {
      name: 'wallapop-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'wallapop-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── eBay DE Bot (Port 4707) ──────────────────────────────────────────
    {
      name: 'ebay-de-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'ebay-bot'),
      env: { EBAY_MARKET: 'de' },
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── eBay UK Bot (Port 4708) ──────────────────────────────────────────
    {
      name: 'ebay-uk-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'ebay-bot'),
      env: { EBAY_MARKET: 'uk' },
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Etsy Bot (Port 4709) ─────────────────────────────────────────────
    {
      name: 'etsy-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'etsy-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Grailed Bot (Port 4710) ──────────────────────────────────────────
    {
      name: 'grailed-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'grailed-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── FB Marketplace Bot (Port 4711) ───────────────────────────────────
    {
      name: 'fb-marketplace-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'fb-marketplace-bot'),
      max_restarts: 3,
      restart_delay: 30000, // FB bans aggressively — slow restart
      watch: false,
    },

    // ── Vestiaire Bot (Port 4712) ────────────────────────────────────────
    {
      name: 'vestiaire-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'vestiaire-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Whatnot Bot (Port 4713) ──────────────────────────────────────────
    {
      name: 'whatnot-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'whatnot-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Poshmark Bot (Port 4719) ─────────────────────────────────────────
    {
      name: 'poshmark-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'poshmark-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Leboncoin Bot (Port 4714) ────────────────────────────────────────
    {
      name: 'leboncoin-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'leboncoin-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Marktplaats Bot (Port 4715) ──────────────────────────────────────
    {
      name: 'marktplaats-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'marktplaats-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Willhaben Bot (Port 4716) ────────────────────────────────────────
    {
      name: 'willhaben-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'willhaben-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Shopify Bot (Port 4717) — API-based ──────────────────────────────
    {
      name: 'shopify-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'shopify-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── WooCommerce Bot (Port 4718) — API-based ──────────────────────────
    {
      name: 'woocommerce-bot',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: path.join(ROOT, 'woocommerce-bot'),
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
    },

    // ── Dashboard (Port 5173) ────────────────────────────────────────────
    {
      name: 'dashboard',
      script: 'npx',
      args: 'vite --host 127.0.0.1',
      cwd: path.join(ROOT, 'dashboard'),
      max_restarts: 5,
      restart_delay: 3000,
      watch: false,
    },
  ],
};
