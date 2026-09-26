import { describe, expect, it, vi } from 'vitest';

import { compareSemver, fetchNpmTagVersion, resolveNpmChannelTag } from '../update-check.js';

describe('fetchNpmTagVersion retries', () => {
  it('retries on 5xx then returns version', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n < 3) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ version: '3.1.0' }) };
    });
    const r = await fetchNpmTagVersion({ tag: 'latest', timeoutMs: 1000, fetchImpl });
    expect(r.version).toBe('3.1.0');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 404', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const r = await fetchNpmTagVersion({ tag: 'nope', timeoutMs: 1000, fetchImpl });
    expect(r.version).toBeNull();
    expect(r.error).toContain('404');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

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

  it('orders prerelease identifiers per semver §11', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0-beta.2')).toBe(-1);
    expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-beta.1')).toBe(-1);
  });

  it('returns null for invalid', () => {
    expect(compareSemver(null, '1.0.0')).toBe(null);
    expect(compareSemver('v1', '1.0.0')).toBe(null);
  });
});

describe('resolveNpmChannelTag (mocked fetch)', () => {
  const fetchImpl = vi.fn(async (url: string) => {
    if (url.endsWith('/latest')) {
      return { ok: true, status: 200, json: async () => ({ version: '2.0.0' }) };
    }
    if (url.endsWith('/beta')) {
      return { ok: true, status: 200, json: async () => ({ version: '1.5.0' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });

  it('beta channel picks newer of beta vs latest', async () => {
    const r = await resolveNpmChannelTag({ channel: 'beta', timeoutMs: 1000, fetchImpl });
    expect(r.tag).toBe('latest');
    expect(r.version).toBe('2.0.0');
  });

  it('fetchNpmTagVersion returns version on ok', async () => {
    const r = await fetchNpmTagVersion({ tag: 'latest', timeoutMs: 1000, fetchImpl });
    expect(r.version).toBe('2.0.0');
  });

  it('preserves the registry error when a stable check fails', async () => {
    const failedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    const r = await resolveNpmChannelTag({
      channel: 'stable',
      timeoutMs: 10,
      fetchImpl: failedFetch,
    });
    expect(r).toMatchObject({ tag: 'latest', version: null, error: 'HTTP 503' });
    expect(failedFetch).toHaveBeenCalledTimes(3);
  });
});
