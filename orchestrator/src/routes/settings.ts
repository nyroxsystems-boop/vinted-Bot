import { Router } from 'express';
import { getDb, setSetting } from '@vinted-system/shared';
import { eventBus } from '../events.js';

export const settingsRouter = Router();

// Settings whose value must be a positive number (or zero for some).
const NUMERIC_KEYS: ReadonlyArray<string> = [
  'listing_price_default', 'listing_price_floor',
  'temu_max_order_eur', 'temu_max_daily_orders',
  'temu_batch_window_hours',
  'cj_max_order_eur', 'cj_max_daily_orders',
  'vinted_poll_interval_s', 'vinted_daily_publish_cap',
  'kleinanzeigen_poll_interval_s',
  'depop_chat_poll_interval_s', 'depop_sold_poll_interval_s',
  'cj_max_price_eur', 'cj_min_margin_eur', 'cj_target_margin_eur',
  'reply_autopilot_min_delay_s', 'reply_autopilot_max_delay_s',
  'reply_autopilot_lookback_min', 'reply_autopilot_max_discount_pct',
  'cj_tracking_force_push_days',
];

// Settings whose value must be 'true' or 'false' (string-encoded).
const BOOLEAN_KEYS: ReadonlyArray<string> = [
  'paused', 'cj_auto_order', 'cj_auto_tracking_sync', 'cj_auto_discovery',
  'kleinanzeigen_enabled', 'depop_enabled', 'reply_autopilot_active',
  'auto_publisher_enabled',
  'cj_tracking_prefer_eu_carrier', 'cj_auto_match_enabled',
];

// Settings whose value must match a predefined whitelist.
const ENUM_KEYS: Record<string, ReadonlyArray<string>> = {
  fulfillment_provider:   ['cj', 'temu', 'manual'],
  cj_preferred_warehouse: ['CN', 'DE', 'US', 'UK', 'NL'],
  temu_payment_method:    ['paypal', 'bnpl30', 'rechnung', 'karte'],
  reply_autopilot_mode:   ['draft', 'auto'],
  captcha_provider:       ['manual', '2captcha', 'whisper'],
  llm_provider:           ['gemini', 'anthropic', 'openai', 'claude_cli'],
};

// Keys that contain JSON-array values — must be valid JSON or rejected.
const JSON_KEYS: ReadonlyArray<string> = ['auto_crosslist_targets'];

function validateOne(key: string, value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  // Coerce to string up front — the settings table stores strings.
  const str = value === null || value === undefined ? '' : String(value);

  if (NUMERIC_KEYS.includes(key)) {
    const n = Number(str);
    if (!Number.isFinite(n)) return { ok: false, error: `${key} muss eine Zahl sein` };
    if (n < 0) return { ok: false, error: `${key} darf nicht negativ sein` };
    return { ok: true, value: String(n) };
  }
  if (BOOLEAN_KEYS.includes(key)) {
    if (str !== 'true' && str !== 'false') return { ok: false, error: `${key} muss "true" oder "false" sein` };
    return { ok: true, value: str };
  }
  if (ENUM_KEYS[key]) {
    if (!ENUM_KEYS[key]!.includes(str)) {
      return { ok: false, error: `${key} muss einer von ${ENUM_KEYS[key]!.join(', ')} sein` };
    }
    return { ok: true, value: str };
  }
  if (JSON_KEYS.includes(key)) {
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed)) return { ok: false, error: `${key} muss ein JSON-Array sein` };
    } catch {
      return { ok: false, error: `${key} muss valides JSON sein` };
    }
    return { ok: true, value: str };
  }
  // Free-form keys (api keys, labels, etc.) — only reject embedded NULs.
  if (str.includes('\0')) return { ok: false, error: `${key} enthält ungültige Zeichen` };
  return { ok: true, value: str };
}

settingsRouter.get('/', (_req, res) => {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as
    | { key: string; value: string }[];
  const obj: Record<string, string> = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json(obj);
});

function handleWrite(req: Parameters<Parameters<typeof settingsRouter.patch>[1]>[0], res: Parameters<Parameters<typeof settingsRouter.patch>[1]>[1]) {
  const updates = req.body as Record<string, string | number | boolean>;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ ok: false, error: 'body must be an object of {key: value}' });
  }
  // Validate all entries first — fail atomically, don't half-write on error.
  const validated: Record<string, string> = {};
  for (const [k, v] of Object.entries(updates)) {
    const result = validateOne(k, v);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error, key: k });
    validated[k] = result.value;
  }
  for (const [k, str] of Object.entries(validated)) {
    setSetting(k, str);
    eventBus.publish({ type: 'settings.updated', key: k, value: str });
  }
  res.json({ ok: true, count: Object.keys(validated).length });
}

settingsRouter.patch('/', handleWrite);
settingsRouter.put('/', handleWrite);
