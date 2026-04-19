// ──────────────────────────────────────────────────────────────────────────────
// [DEPRECATED] Address-form filling is NOT used in the re-shipping model.
//
// The Temu bot orders to the USER'S default saved address. The user then
// re-ships to the Vinted buyer using the Vinted-generated shipping label.
//
// This file is kept as a stub so old imports don't break during refactoring.
// It intentionally does nothing and returns false — the caller should skip
// the address step entirely.
// ──────────────────────────────────────────────────────────────────────────────

import type { Page } from 'playwright';
import { createLogger } from '@vinted-system/shared';

const log = createLogger('temu-address');

export async function fillShippingAddress(_page: Page, _addr: unknown): Promise<boolean> {
  log.warn('fillShippingAddress called but the re-shipping model does not use it. No-op.');
  return false;
}
