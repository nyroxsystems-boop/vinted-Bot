import { describe, it, expect } from 'vitest';
import {
  fmtEur, fmtEurCompact, fmtNum, fmtPct,
  fmtDate, fmtTime, fmtDateTime, fmtRelative,
} from './format.js';

describe('format helpers', () => {
  describe('fmtEur', () => {
    it('formats integers as de-DE currency', () => {
      expect(fmtEur(29)).toMatch(/29,00\s*€/);
    });
    it('formats decimals with comma separator', () => {
      expect(fmtEur(29.5)).toMatch(/29,50\s*€/);
    });
    it('handles negatives', () => {
      expect(fmtEur(-12.34)).toMatch(/-12,34\s*€/);
    });
    it('returns dash for null/undefined/NaN', () => {
      expect(fmtEur(null)).toBe('—');
      expect(fmtEur(undefined)).toBe('—');
      expect(fmtEur(NaN)).toBe('—');
    });
    it('formats thousands with dot separator (de-DE)', () => {
      expect(fmtEur(12345.67)).toMatch(/12\.345,67\s*€/);
    });
  });

  describe('fmtEurCompact', () => {
    it('uses full format under 1000', () => {
      expect(fmtEurCompact(123.45)).toMatch(/123,45\s*€/);
    });
    it('uses compact notation over 1000', () => {
      const r = fmtEurCompact(2500);
      expect(r).toMatch(/€|EUR/);
      expect(r.length).toBeLessThan(10);
    });
  });

  describe('fmtNum', () => {
    it('formats with de-DE thousands separator', () => {
      expect(fmtNum(1234)).toBe('1.234');
      expect(fmtNum(1234567)).toBe('1.234.567');
    });
    it('returns dash for null', () => {
      expect(fmtNum(null)).toBe('—');
    });
  });

  describe('fmtPct', () => {
    it('formats with one decimal by default', () => {
      expect(fmtPct(42.5)).toBe('42,5 %');
    });
    it('respects digits option', () => {
      expect(fmtPct(42.5, { digits: 0 })).toBe('43 %');
    });
  });

  describe('fmtDate', () => {
    it('formats ISO date', () => {
      expect(fmtDate('2026-05-12')).toMatch(/12\.05\.26/);
    });
    it('returns dash for null', () => {
      expect(fmtDate(null)).toBe('—');
    });
  });

  describe('fmtTime', () => {
    it('formats hours:minutes', () => {
      expect(fmtTime('2026-05-12T14:30:00')).toMatch(/14:30/);
    });
  });

  describe('fmtDateTime', () => {
    it('combines date + time', () => {
      const r = fmtDateTime('2026-05-12T14:30:00');
      expect(r).toMatch(/12\.05\.26/);
      expect(r).toMatch(/14:30/);
    });
  });

  describe('fmtRelative', () => {
    const now = new Date('2026-05-12T12:00:00Z');
    it('"gerade eben" within 30s', () => {
      expect(fmtRelative(new Date(now.getTime() - 10_000), now)).toBe('gerade eben');
    });
    it('minutes', () => {
      expect(fmtRelative(new Date(now.getTime() - 5 * 60_000), now)).toBe('vor 5 min');
    });
    it('hours', () => {
      expect(fmtRelative(new Date(now.getTime() - 4 * 3600_000), now)).toBe('vor 4 h');
    });
    it('"gestern" 24-48h ago', () => {
      expect(fmtRelative(new Date(now.getTime() - 30 * 3600_000), now)).toBe('gestern');
    });
    it('days', () => {
      expect(fmtRelative(new Date(now.getTime() - 4 * 86_400_000), now)).toBe('vor 4 d');
    });
    it('falls back to date for > 7 days', () => {
      const r = fmtRelative(new Date(now.getTime() - 30 * 86_400_000), now);
      expect(r).toMatch(/\d{2}\.\d{2}\.\d{2}/);
    });
    it('returns dash for null', () => {
      expect(fmtRelative(null)).toBe('—');
    });
  });
});
