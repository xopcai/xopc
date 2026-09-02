import { describe, expect, it, vi } from 'vitest';

import { EndpointBindingService } from '../binding-service.js';
import type { EndpointConnectionSnapshot, EndpointRegistry } from '../registry.js';

const endpoint = {
  endpointId: 'mobile-1',
  principalId: 'principal-1',
  connectionId: 'connection-1',
  displayName: 'Phone',
  kind: 'mobile',
  platform: 'ios',
  appVersion: '1',
  availability: 'foreground',
  lastHeartbeatAt: 1,
  tools: [],
} satisfies EndpointConnectionSnapshot;

function service(online = true) {
  const registry = {
    get: vi.fn((endpointId: string) => online && endpointId === endpoint.endpointId ? endpoint : undefined),
  } as unknown as EndpointRegistry;
  return { bindings: new EndpointBindingService(registry), registry };
}

describe('EndpointBindingService', () => {
  it('binds and resolves one explicit endpoint per session', () => {
    const { bindings } = service();
    expect(bindings.bind(' session-1 ', endpoint.endpointId, 42)).toEqual({
      sessionKey: 'session-1',
      endpointId: endpoint.endpointId,
      boundAt: 42,
    });
    expect(bindings.resolve('session-1')).toBe(endpoint);
    expect(bindings.unbind('session-1')).toBe(true);
    expect(bindings.get('session-1')).toBeUndefined();
  });

  it('refuses to bind an offline endpoint', () => {
    const { bindings } = service(false);
    expect(() => bindings.bind('session-1', endpoint.endpointId)).toThrow('Endpoint is offline');
  });
});
