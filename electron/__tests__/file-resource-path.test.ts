import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerGatewayConnection } from '../gateway-process.js';
import { resolveFileResourceHostPath } from '../ipc/file-resource-path.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveFileResourceHostPath', () => {
  it('resolves one opaque file id through the registered local gateway', async () => {
    registerGatewayConnection({ port: 18790, token: 'desktop-token' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ absolutePath: '/tmp/report.xlsx' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveFileResourceHostPath('space.report-id')).resolves.toEqual({
      ok: true,
      path: '/tmp/report.xlsx',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18790/api/files/space.report-id/host-path',
      expect.objectContaining({ headers: { Authorization: 'Bearer desktop-token' } }),
    );
  });

  it('rejects invalid ids and non-absolute gateway paths', async () => {
    await expect(resolveFileResourceHostPath('')).resolves.toMatchObject({ ok: false, code: 'INVALID_FILE' });
    registerGatewayConnection({ port: 18790, token: 'desktop-token' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ absolutePath: 'relative/report.xlsx' }))));
    await expect(resolveFileResourceHostPath('space.report-id')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
