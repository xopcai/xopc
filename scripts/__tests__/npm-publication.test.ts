import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { checkNpmPublication, waitForNpmPublication } from '../verify-npm-publication.mjs';

const bytes = Buffer.from('tested package');
const options = { name: '@xopcai/xopc', version: '0.0.439', tag: 'latest', expectedSha256: createHash('sha256').update(bytes).digest('hex') };
function registry({ tarballStatus = 200, contents = bytes, version = options.version } = {}) {
  return vi.fn(async (url: string) => url.endsWith('.tgz')
    ? new Response(contents, { status: tarballStatus })
    : Response.json({ name: options.name, version, dist: { tarball: 'https://registry.npmjs.org/package.tgz', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } }));
}
describe('public npm publication verification', () => {
  it('verifies version, dist tag, integrity and the tested tarball digest', async () => {
    expect(await checkNpmPublication(options, registry())).toMatchObject({ version: options.version, bytes: bytes.length, sha256: options.expectedSha256 });
  });
  it('rejects successful metadata when the tarball is not downloadable', async () => {
    await expect(checkNpmPublication(options, registry({ tarballStatus: 404 }))).rejects.toThrow('HTTP 404');
  });
  it('rejects a corrupt download and an unexpected tested-build digest', async () => {
    await expect(checkNpmPublication(options, registry({ contents: Buffer.from('corrupt') }))).rejects.toThrow('integrity');
    await expect(checkNpmPublication({ ...options, expectedSha256: 'wrong' }, registry())).rejects.toThrow('tested build');
  });
  it('rejects an incorrect version or dist tag', async () => {
    await expect(checkNpmPublication(options, registry({ version: '0.0.438' }))).rejects.toThrow('version');
    const fetch = registry();
    fetch.mockImplementationOnce(async () => Response.json({ name: options.name, version: options.version }));
    fetch.mockImplementationOnce(async () => Response.json({ version: '0.0.438' }));
    await expect(checkNpmPublication(options, fetch)).rejects.toThrow('tag latest');
  });
  it('waits through scanning and enforces a bounded deadline', async () => {
    let now = 0;
    const wait = vi.fn(async (ms: number) => { now += ms; });
    const log = vi.fn();
    const check = vi.fn().mockRejectedValueOnce(new Error('HTTP 404')).mockResolvedValue({ version: options.version });
    expect(await waitForNpmPublication(options, { check, wait, now: () => now, log })).toEqual({ version: options.version });
    expect(wait).toHaveBeenCalledWith(30_000);
    const unavailable = vi.fn().mockRejectedValue(new Error('still unavailable'));
    await expect(waitForNpmPublication({ ...options, timeoutMs: 1 }, { check: unavailable, wait, now: () => now, log })).rejects.toThrow('still unavailable');
    expect(unavailable).toHaveBeenCalledTimes(2);
  });
});
