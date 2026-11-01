import { beforeEach, expect, it, vi } from 'vitest';

import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { getBoundEndpointPrincipalId } from '../../storage/sqlite/endpoint-principal-repository.js';
import { remoteBrowserEndpoint } from '../remote/device-target.js';

vi.mock('../../storage/sqlite/device-access-repository.js', () => ({ getDevice: vi.fn() }));
vi.mock('../../storage/sqlite/endpoint-principal-repository.js', () => ({ getBoundEndpointPrincipalId: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
function fixture() {
  const entries = new Map<string, unknown>([
    ['device', { kind: 'desktop', principalId: 'device-id', executionAuthority: {} }],
    ['legacy', { kind: 'browser', principalId: 'legacy-id' }],
  ]);
  const runtime = { registry: { get: (id: string) => entries.get(id) }, bindings: {
    get: vi.fn(() => ({ endpointId: 'legacy' })), resolve: vi.fn(() => ({ endpointId: 'legacy' })),
  } };
  vi.mocked(getBoundEndpointPrincipalId).mockReturnValue('device-id');
  vi.mocked(getDevice).mockReturnValue({ platform: 'desktop', revokedAt: Date.now() } as never);
  return { entries, runtime };
}
it('prefers the fresh explicit device over a historical browser binding', () => {
  const f = fixture();
  expect(remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'endpoint', endpointId: 'device' } as never)).toBe('device');
});
it.each(['offline', 'read-only', 'revoked'])('retains %s device routing so a missing execution grant cannot fall back to the server', kind => {
  const f = fixture();
  if (kind === 'offline') f.entries.delete('device');
  else f.entries.set('device', { kind: 'desktop', principalId: 'device-id' });
  expect(remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'endpoint', endpointId: 'device' } as never)).toBe('device');
});
it('uses the resolved device instance for an existing stable session binding', () => {
  const f = fixture(); f.runtime.bindings.resolve.mockReturnValue({ endpointId: 'device' });
  expect(remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'web' } as never)).toBe('device');
});
it('preserves ordinary and legacy browser routing without querying device identity', () => {
  const f = fixture();
  expect(remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'endpoint', endpointId: 'legacy' } as never)).toBeUndefined();
  expect(getDevice).not.toHaveBeenCalled();
});
