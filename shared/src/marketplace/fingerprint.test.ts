import { describe, it, expect } from 'vitest';
import { fingerprintFor, stealthInitScript } from './fingerprint.js';

describe('fingerprintFor', () => {
  it('returns a deterministic fingerprint for the same account', () => {
    const a = fingerprintFor(1, 'vinted');
    const b = fingerprintFor(1, 'vinted');
    expect(a).toEqual(b);
  });

  it('returns different fingerprints for different accounts', () => {
    const a = fingerprintFor(1, 'vinted');
    const b = fingerprintFor(2, 'vinted');
    // At least some fields must differ
    const differ =
      a.userAgent !== b.userAgent ||
      a.viewport.width !== b.viewport.width ||
      a.hardwareConcurrency !== b.hardwareConcurrency;
    expect(differ).toBe(true);
  });

  it('returns different fingerprints for different marketplaces (same account)', () => {
    const a = fingerprintFor(1, 'vinted');
    const b = fingerprintFor(1, 'depop');
    expect(a.locale).not.toBe(b.locale);
  });

  it('picks de-DE locale for vinted', () => {
    expect(fingerprintFor(1, 'vinted').locale).toBe('de-DE');
  });

  it('picks en-GB locale for depop', () => {
    expect(fingerprintFor(1, 'depop').locale).toBe('en-GB');
  });

  it('picks en-US locale for mercari', () => {
    expect(fingerprintFor(1, 'mercari').locale).toBe('en-US');
  });

  it('falls back to vinted locale for unknown marketplace', () => {
    expect(fingerprintFor(1, 'banana').locale).toBe('de-DE');
  });

  it('user agent looks like a real Chrome', () => {
    const fp = fingerprintFor(1, 'vinted');
    expect(fp.userAgent).toContain('Chrome/');
    expect(fp.userAgent).toContain('Safari/537.36');
  });

  it('viewport is in realistic desktop range', () => {
    const fp = fingerprintFor(1, 'vinted');
    expect(fp.viewport.width).toBeGreaterThanOrEqual(1280);
    expect(fp.viewport.width).toBeLessThanOrEqual(1920);
    expect(fp.viewport.height).toBeGreaterThanOrEqual(700);
  });
});

describe('stealthInitScript', () => {
  it('returns an executable JS snippet', () => {
    const script = stealthInitScript(fingerprintFor(1, 'vinted'));
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(100);
    expect(script).toContain('webdriver');
  });

  it('masks navigator.webdriver', () => {
    const script = stealthInitScript(fingerprintFor(1, 'vinted'));
    expect(script).toMatch(/webdriver.*undefined/);
  });

  it('spoofs WebGL vendor + renderer', () => {
    const script = stealthInitScript(fingerprintFor(1, 'vinted'));
    expect(script).toContain('WebGLRenderingContext');
    expect(script).toContain('getParameter');
  });

  it('matches the fingerprint hardwareConcurrency', () => {
    const fp = fingerprintFor(1, 'vinted');
    const script = stealthInitScript(fp);
    expect(script).toContain(`get: () => ${fp.hardwareConcurrency}`);
  });
});
