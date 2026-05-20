import { describe, it, expect } from 'vitest';
import { cloudflareLaunchArgs } from './cloudflare.js';

describe('cloudflareLaunchArgs', () => {
  it('returns a non-empty flag array', () => {
    const args = cloudflareLaunchArgs();
    expect(Array.isArray(args)).toBe(true);
    expect(args.length).toBeGreaterThan(5);
  });

  it('strips the AutomationControlled banner', () => {
    const args = cloudflareLaunchArgs();
    expect(args).toContain('--disable-blink-features=AutomationControlled');
  });

  it('disables features that betray automation', () => {
    const args = cloudflareLaunchArgs();
    const joined = args.join(' ');
    expect(joined).toMatch(/IsolateOrigins|BackForwardCache/);
  });

  it('sets a desktop-sized window', () => {
    const args = cloudflareLaunchArgs();
    expect(args.some((a) => /--window-size=\d{4,},\d{3,}/.test(a))).toBe(true);
  });

  it('removes first-run banners', () => {
    const args = cloudflareLaunchArgs();
    expect(args).toContain('--no-first-run');
    expect(args).toContain('--no-default-browser-check');
  });
});
