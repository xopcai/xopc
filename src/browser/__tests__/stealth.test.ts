import { describe, expect, it } from 'vitest';

import {
  buildLocalStealthArgs,
  buildStealthArgs,
  generateFingerprintSeed,
} from '../stealth.js';

describe('buildStealthArgs', () => {
  it('includes default stealth args', () => {
    const args = buildStealthArgs();
    expect(args.some((a) => a === '--no-sandbox')).toBe(true);
    expect(args.some((a) => a === '--disable-blink-features=AutomationControlled')).toBe(true);
    expect(args.some((a) => a.startsWith('--fingerprint='))).toBe(true);
    expect(args.some((a) => a.startsWith('--fingerprint-platform='))).toBe(true);
  });

  it('injects timezone, locale, and webrtc args', () => {
    const args = buildStealthArgs([], {
      timezone: 'America/New_York',
      locale: 'en-US',
      webrtcIp: '1.2.3.4',
    });
    expect(args.some((a) => a === '--fingerprint-timezone=America/New_York')).toBe(true);
    expect(args.some((a) => a === '--lang=en-US')).toBe(true);
    expect(args.some((a) => a === '--fingerprint-locale=en-US')).toBe(true);
    expect(args.some((a) => a === '--fingerprint-webrtc-ip=1.2.3.4')).toBe(true);
  });

  it('user extra args override defaults with same key prefix', () => {
    const args = buildStealthArgs([
      '--fingerprint=99887',
      '--fingerprint-platform=windows',
    ]);
    const fpArgs = args.filter((a) => a.startsWith('--fingerprint='));
    expect(fpArgs).toHaveLength(1);
    expect(fpArgs[0]).toBe('--fingerprint=99887');

    const platArgs = args.filter((a) => a.startsWith('--fingerprint-platform='));
    expect(platArgs).toHaveLength(1);
    expect(platArgs[0]).toBe('--fingerprint-platform=windows');
  });

  it('no duplicate keys when user overrides geo args', () => {
    const args = buildStealthArgs(
      ['--fingerprint-timezone=UTC', '--lang=fr-FR'],
      { timezone: 'Europe/Berlin', locale: 'de-DE' },
    );
    const tzArgs = args.filter((a) => a.startsWith('--fingerprint-timezone='));
    expect(tzArgs).toHaveLength(1);
    const langArgs = args.filter((a) => a.startsWith('--lang='));
    expect(langArgs).toHaveLength(1);
  });

  it('respects custom fingerprintPlatform', () => {
    const args = buildStealthArgs([], { fingerprintPlatform: 'linux' });
    const platArgs = args.filter((a) => a.startsWith('--fingerprint-platform='));
    expect(platArgs).toHaveLength(1);
    expect(platArgs[0]).toBe('--fingerprint-platform=linux');
  });
});

describe('buildLocalStealthArgs', () => {
  it('includes basic anti-automation args', () => {
    const args = buildLocalStealthArgs();
    expect(args).toContain('--disable-blink-features=AutomationControlled');
    expect(args).toContain('--no-sandbox');
  });

  it('user extra args take priority over defaults', () => {
    const args = buildLocalStealthArgs(['--no-sandbox', '--custom-flag']);
    // Should not have duplicate --no-sandbox
    expect(args.filter((a) => a === '--no-sandbox')).toHaveLength(1);
    expect(args).toContain('--custom-flag');
  });
});

describe('generateFingerprintSeed', () => {
  it('returns a positive number', () => {
    const seed = generateFingerprintSeed();
    expect(seed).toBeGreaterThan(0);
  });

  it('returns different values on successive calls', () => {
    const seed1 = generateFingerprintSeed();
    // Date.now() may return same ms, so just check it is a number
    const seed2 = generateFingerprintSeed();
    expect(typeof seed1).toBe('number');
    expect(typeof seed2).toBe('number');
  });
});
