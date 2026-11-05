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
    ['browser', { kind: 'browser', principalId: 'browser-id' }],
  ]);
  const runtime = { registry: { get: (id: string) => entries.get(id) }, targets: {
    get: vi.fn(() => undefined as { endpointId: string } | undefined), resolve: vi.fn(() => undefined as { endpointId: string } | undefined),
  } };
  vi.mocked(getBoundEndpointPrincipalId).mockReturnValue('device-id');
  vi.mocked(getDevice).mockReturnValue({ platform: 'desktop', revokedAt: Date.now() } as never);
  return { entries, runtime };
}
it('uses the source desktop when no task target has been selected', () => {
  const f = fixture();
  expect(remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'endpoint', endpointId: 'device' } as never)).toBe('device');
});
it.each(['offline', 'read-only', 'revoked'])('retains %s device routing so a missing execution grant cannot fall back to the server', kind => {
  const f = fixture();
  if (kind === 'offline') f.entries.delete('device');
  else f.entries.set('device', { kind: 'desktop', principalId: 'device-id' });
  expect(remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'endpoint', endpointId: 'device' } as never)).toBe('device');
});
it('retains the selected task target instead of replacing it with the message source', () => {
  const f = fixture(); f.runtime.targets.get.mockReturnValue({ endpointId: 'device' });
  f.runtime.targets.resolve.mockReturnValue({ endpointId: 'device' });
  expect(remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'web' } as never)).toBe('device');
});
it('preserves attached browser routing without querying desktop identity', () => {
  const f = fixture();
  expect(remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'endpoint', endpointId: 'browser' } as never)).toBeUndefined();
  expect(getDevice).not.toHaveBeenCalled();
});
it('does not fall back to the source desktop when the task target is disconnected', () => {
  const f = fixture(); f.runtime.targets.get.mockReturnValue({ endpointId: 'offline-target' });
  expect(() => remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'endpoint', endpointId: 'device' })).toThrow('TARGET_OFFLINE');
});

it('does not use a Gateway Browser when the selected device lacks the capability', () => {
  const f = fixture();
  f.runtime.targets.get.mockReturnValue({ endpointId: 'browser' });
  f.runtime.targets.resolve.mockReturnValue({ endpointId: 'browser' });
  expect(() => remoteBrowserEndpoint(f.runtime as never, 'owner', { type: 'endpoint', endpointId: 'device' })).toThrow('BROWSER_TARGET_UNSUPPORTED');
});
