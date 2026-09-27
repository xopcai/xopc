import { describe, expect, it, vi } from 'vitest';

import { checkNpmRelease, resolveNpmTag } from '../npm-release-preflight.mjs';

describe('npm release preflight', () => {
  it.each([
    ['1.2.3', 'latest'], ['1.2.3-beta.1', 'beta'], ['1.2.3-alpha.2', 'dev'],
    ['1.2.3-dev.1', 'dev'], ['1.2.3-rc.1', 'rc'],
  ])('maps package version %s to %s even on a manual branch run', (version, tag) => {
    expect(resolveNpmTag(version)).toBe(tag);
  });

  it.each(['1.2.3-latest.1', '1.2', '1.2.3\ninjected=true', '01.2.3'])('rejects %s', (version) => {
    expect(() => resolveNpmTag(version)).toThrow();
  });

  const pkg = { name: '@xopcai/xopc', version: '1.2.3' };
  const context = { eventName: 'push', refName: 'v1.2.3' };

  it('rejects a tag mismatch before accessing the registry', async () => {
    const fetchImpl = vi.fn();
    await expect(checkNpmRelease(pkg, { ...context, refName: 'v1.2.4', fetchImpl })).rejects.toThrow('does not match');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('only treats HTTP 404 as an unpublished version', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    await expect(checkNpmRelease(pkg, { ...context, fetchImpl })).resolves.toEqual({ version: '1.2.3', tag: 'latest', exists: false });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://registry.npmjs.org/%40xopcai%2Fxopc/1.2.3');
  });

  it.each([401, 403, 429, 500, 503])('fails closed on HTTP %s', async (status) => {
    await expect(checkNpmRelease(pkg, {
      ...context, fetchImpl: vi.fn().mockResolvedValue(new Response('', { status })),
    })).rejects.toThrow(`HTTP ${status}`);
  });

  it('propagates network failures', async () => {
    await expect(checkNpmRelease(pkg, {
      ...context, fetchImpl: vi.fn().mockRejectedValue(new Error('network unavailable')),
    })).rejects.toThrow('network unavailable');
  });

  it('verifies metadata before skipping an existing version', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json(pkg))
      .mockResolvedValueOnce(Response.json({ ...pkg, version: '1.2.4' }));
    await expect(checkNpmRelease(pkg, { ...context, fetchImpl })).resolves.toMatchObject({ exists: true });
    await expect(checkNpmRelease(pkg, { ...context, fetchImpl })).rejects.toThrow('unexpected');
  });
});
