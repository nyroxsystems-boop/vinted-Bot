// ──────────────────────────────────────────────────────────────────────────────
// Block-Tracker für Marketplaces.
//
// Wenn ein Bot/API einen Block detectet ("Deine Sitzung wurde blockiert" o.ä.),
// schreiben wir einen Cooldown-Timestamp in die Settings-Tabelle. Vor jeder
// neuen Aktion prüfen wir, ob noch im Cooldown — wenn ja, sofort abbrechen
// statt Browser zu starten und Foto-Upload zu machen.
//
// Default-Cooldown 45min — Vinted's Block hält typischerweise 30-90min.
// ──────────────────────────────────────────────────────────────────────────────

import { getSetting, setSetting } from './db.js';

const DEFAULT_COOLDOWN_MIN = 45;

function key(marketplace: string): string {
  return `${marketplace}_blocked_until`;
}

export interface BlockState {
  blocked: boolean;
  until?: Date;
  reason?: string;
  remainingMs?: number;
}

export function markBlocked(marketplace: string, reason: string, cooldownMinutes = DEFAULT_COOLDOWN_MIN): void {
  const until = new Date(Date.now() + cooldownMinutes * 60 * 1000);
  setSetting(key(marketplace), `${until.toISOString()}|${reason.slice(0, 200)}`);
}

export function clearBlock(marketplace: string): void {
  setSetting(key(marketplace), '');
}

export function getBlockState(marketplace: string): BlockState {
  const raw = getSetting(key(marketplace));
  if (!raw) return { blocked: false };
  const [iso, reason] = raw.split('|');
  if (!iso) return { blocked: false };
  const until = new Date(iso);
  if (Number.isNaN(until.getTime())) return { blocked: false };
  const remainingMs = until.getTime() - Date.now();
  if (remainingMs <= 0) return { blocked: false };
  return { blocked: true, until, reason: reason ?? undefined, remainingMs };
}

/** Wirft Fehler wenn Plattform noch im Cooldown ist. Caller bricht ab. */
export function assertNotBlocked(marketplace: string): void {
  const state = getBlockState(marketplace);
  if (state.blocked && state.until) {
    const minRemaining = Math.ceil((state.remainingMs ?? 0) / 60000);
    throw new Error(
      `${marketplace} blockiert bis ${state.until.toLocaleTimeString('de-DE')} ` +
      `(noch ${minRemaining} min): ${state.reason ?? 'unknown'}`,
    );
  }
}
