import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { compareSemver, fetchNpmTagVersion, resolveNpmChannelTag } from '../update-check.js';

describe('compareSemver', () => {
  it('compares major.minor.patch', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats prerelease as older than release', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-beta.1')).toBe(1);
  });

  it('returns null for invalid', () => {
    expect(compareSemver(null, '1.0.0')).toBe(null);
    expect(compareSemver('v1', '1.0.0')).toBe(null);
  });
});

describe('resolveNpmChannelTag (mocked fetch)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith('/latest')) {
          return {
            ok: true,
            json: async () => ({ version: '2.0.0' }),
          } as Response;
        }
        if (u.endsWith('/beta')) {
          return {
            ok: true,
            json: async () => ({ version: '1.5.0' }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('beta channel picks newer of beta vs latest', async () => {
    const r = await resolveNpmChannelTag({ channel: 'beta', timeoutMs: 1000 });
    expect(r.tag).toBe('latest');
    expect(r.version).toBe('2.0.0');
  });

  it('fetchNpmTagVersion returns version on ok', async () => {
    const r = await fetchNpmTagVersion({ tag: 'latest', timeoutMs: 1000 });
    expect(r.version).toBe('2.0.0');
  });
});
