// ──────────────────────────────────────────────────────────────────────────────
// CJ Service — Express server (:4702)
//
// Replaces the Temu Playwright bot with a pure REST API bridge to CJ
// Dropshipping. No browser needed — just HTTP calls.
//
// Endpoints:
//   POST /api/orders/create     — Place a CJ order for a sale
//   GET  /api/orders/:id        — Get order status + tracking
//   GET  /api/orders            — List all CJ orders
//   GET  /api/products/search   — Search CJ catalog
//   GET  /api/products/:pid     — Product detail + variants
//   GET  /api/products/:pid/inventory — Warehouse stock levels
//   GET  /api/logistics         — Shipping options + costs
//   GET  /api/tracking/:orderId — Tracking info for an order
//   POST /api/webhook           — Receive CJ push notifications
//   GET  /health                — Health check
// ──────────────────────────────────────────────────────────────────────────────

import './load-env.js';
import express from 'express';
import { createLogger, getDb } from '@vinted-system/shared';
import { CJClient } from './cj-client.js';

const log = createLogger('cj-service');
const app = express();
app.use(express.json());

const PORT = Number(process.env.CJ_SERVICE_PORT ?? 4702);

// ── CJ Client singleton ────────────────────────────────────────────────────

const CJ_EMAIL = process.env.CJ_EMAIL ?? '';
const CJ_PASSWORD = process.env.CJ_PASSWORD ?? '';

if (!CJ_EMAIL || !CJ_PASSWORD) {
  log.warn('CJ_EMAIL / CJ_PASSWORD not set — API calls will fail. Set them in .env');
}

const cj = new CJClient(CJ_EMAIL, CJ_PASSWORD);

// ── Health check ────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'cj-service', port: PORT });
});

// ── Products ────────────────────────────────────────────────────────────────

app.get('/api/products/search', async (req, res) => {
  try {
    const keyword = String(req.query.keyword ?? req.query.q ?? '');
    if (!keyword) return res.status(400).json({ ok: false, error: 'keyword required' });

    const products = await cj.searchProducts(keyword, {
      pageNum: Number(req.query.page ?? 1),
      pageSize: Number(req.query.limit ?? 20),
      countryCode: req.query.country as string | undefined,
      minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
    });
    res.json({ ok: true, products, count: products.length });
  } catch (err) {
    log.error('Product search failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

app.get('/api/products/:pid', async (req, res) => {
  try {
    const product = await cj.getProductById(req.params.pid);
    res.json({ ok: true, product });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

app.get('/api/products/:pid/inventory', async (req, res) => {
  try {
    const inventory = await cj.getInventory(req.params.pid);
    res.json({ ok: true, inventory });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

// ── Orders ──────────────────────────────────────────────────────────────────

app.post('/api/orders/create', async (req, res) => {
  try {
    const {
      sale_id,
      cj_variant_id,
      customer_name,
      country_code,
      province,
      city,
      address,
      zip,
      phone,
      from_country_code,
      logistic_name,
      remark,
    } = req.body;

    if (!sale_id || !cj_variant_id || !customer_name || !address) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    // Create the order via CJ API
    const result = await cj.createOrder({
      orderNumber: `SALE-${sale_id}`,
      shippingCustomerName: customer_name,
      shippingCountryCode: country_code ?? 'DE',
      shippingProvince: province ?? '',
      shippingCity: city ?? '',
      shippingAddress: address,
      shippingZip: zip ?? '',
      shippingPhone: phone ?? '',
      fromCountryCode: from_country_code ?? 'CN',
      products: [{ vid: cj_variant_id, quantity: 1 }],
      logisticName: logistic_name,
      remark,
    });

    // Persist to DB
    const db = getDb();
    db.prepare(`
      INSERT INTO cj_orders (sale_id, cj_order_id, cj_order_number, status, ordered_at)
      VALUES (?, ?, ?, 'ordered', datetime('now'))
    `).run(sale_id, result.orderId ?? result.cjOrderId, result.orderNumber);

    log.info('CJ order created and saved', { saleId: sale_id, cjOrderId: result.orderId });
    res.json({ ok: true, order: result });
  } catch (err) {
    log.error('Order creation failed', { error: err instanceof Error ? err.message : String(err) });
    // Save failure to DB if sale_id provided
    if (req.body.sale_id) {
      try {
        getDb().prepare(`
          INSERT OR REPLACE INTO cj_orders (sale_id, status, error, updated_at)
          VALUES (?, 'failed', ?, datetime('now'))
        `).run(req.body.sale_id, err instanceof Error ? err.message : String(err));
      } catch { /* non-fatal */ }
    }
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const order = await cj.getOrderById(req.params.orderId);
    res.json({ ok: true, order });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await cj.listOrders({
      pageNum: Number(req.query.page ?? 1),
      pageSize: Number(req.query.limit ?? 50),
      orderStatus: req.query.status as string | undefined,
    });
    res.json({ ok: true, orders, count: orders.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

// ── Tracking ────────────────────────────────────────────────────────────────

app.get('/api/tracking/:orderId', async (req, res) => {
  try {
    const tracking = await cj.getTracking(req.params.orderId);
    if (!tracking) {
      return res.json({ ok: true, tracking: null, message: 'No tracking info yet' });
    }

    // Update DB if tracking number found
    const db = getDb();
    if (tracking.trackingNumber) {
      db.prepare(`
        UPDATE cj_orders
           SET tracking_number = ?,
               logistic_name = ?,
               status = CASE WHEN status = 'ordered' THEN 'shipping' ELSE status END,
               shipped_at = COALESCE(shipped_at, datetime('now')),
               updated_at = datetime('now')
         WHERE cj_order_id = ?
      `).run(tracking.trackingNumber, tracking.logisticName, req.params.orderId);
    }

    res.json({ ok: true, tracking });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

// ── Logistics ───────────────────────────────────────────────────────────────

app.get('/api/logistics', async (req, res) => {
  try {
    const from = String(req.query.from ?? 'CN');
    const to = String(req.query.to ?? 'DE');
    const weight = Number(req.query.weight ?? 200); // grams
    const options = await cj.queryLogistics({
      startCountryCode: from,
      endCountryCode: to,
      productWeight: weight,
    });
    res.json({ ok: true, options, count: options.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
  }
});

// ── Webhook (CJ push notifications) ────────────────────────────────────────

app.post('/api/webhook', (req, res) => {
  const event = req.body;
  log.info('CJ webhook received', { type: event?.type, orderId: event?.orderId });

  try {
    const db = getDb();
    if (event.trackNumber && event.orderId) {
      db.prepare(`
        UPDATE cj_orders
           SET tracking_number = ?,
               logistic_name = ?,
               status = 'shipping',
               shipped_at = COALESCE(shipped_at, datetime('now')),
               updated_at = datetime('now')
         WHERE cj_order_id = ?
      `).run(event.trackNumber, event.logisticName ?? '', event.orderId);

      // Also update the parent sale's tracking_number
      db.prepare(`
        UPDATE sales
           SET tracking_number = ?
         WHERE id = (SELECT sale_id FROM cj_orders WHERE cj_order_id = ?)
      `).run(event.trackNumber, event.orderId);

      log.info('Tracking updated via webhook', { orderId: event.orderId, tracking: event.trackNumber });
    }
    res.json({ ok: true });
  } catch (err) {
    log.error('Webhook processing failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false });
  }
});

// ── Start server ────────────────────────────────────────────────────────────

app.listen(PORT, '127.0.0.1', () => {
  log.info(`CJ Service running on 127.0.0.1:${PORT}`);
});

export { app, cj };
