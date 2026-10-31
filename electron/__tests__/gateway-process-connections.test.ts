import { describe, expect, it } from 'vitest';

import { LocalGatewayConnectionRegistry, localGatewayOrigin } from '../gateway/local-connection.js';

describe('local Gateway connection boundary', () => {
  it('keeps credentials out of descriptors and snapshots independent of callers', () => {
    const registry = new LocalGatewayConnectionRegistry();
    const credentials = { port: 18790, token: 'private-test-credential' };
    registry.register(credentials);
    credentials.port = 18791;
    credentials.token = 'changed';
    const snapshot = registry.describe();
    expect(snapshot).toEqual({ mode: 'local', profileId: 'local',
      origin: 'http://127.0.0.1:18790', port: 18790, ownership: 'external-local', epoch: 1 });
    expect(JSON.stringify(snapshot)).not.toContain('private-test-credential');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(registry.getCredentials()).toEqual({ port: 18790, token: 'private-test-credential' });
    expect(registry.getCredentials()).not.toBe(registry.getCredentials());
  });

  it('changes epochs on credential, address or management ownership changes only', () => {
    const registry = new LocalGatewayConnectionRegistry();
    expect(registry.describe()).toBeUndefined();
    expect(registry.getCredentials()).toBeUndefined();
    registry.register({ port: 18790, token: 'first' });
    registry.register({ port: 18790, token: 'first' });
    expect(registry.describe()?.epoch).toBe(1);
    registry.register({ port: 18790, token: 'first' }, 'embedded');
    expect(registry.describe()).toMatchObject({ ownership: 'embedded', epoch: 2 });
    registry.register({ port: 18790, token: 'second' }, 'embedded');
    expect(registry.describe()?.epoch).toBe(3);
    registry.register({ port: 18791, token: 'second' });
    expect(registry.describe()).toMatchObject({ ownership: 'external-local', port: 18791, epoch: 4 });
  });

  it.each([0, -1, 65536, 1.5, NaN, Infinity, '18790'])('rejects invalid port %s without replacing the active connection', port => {
    const registry = new LocalGatewayConnectionRegistry();
    registry.register({ port: 18790, token: 'first' });
    expect(() => registry.register({ port: port as number, token: 'second' })).toThrow('port');
    expect(registry.describe()?.epoch).toBe(1);
    expect(registry.getCredentials()?.token).toBe('first');
  });

  it('does not enable remote mode through the legacy adapter', () => {
    const registry = new LocalGatewayConnectionRegistry();
    expect(() => registry.register({ port: 18790, token: 'test', mode: 'remote' as 'local' })).toThrow('not supported');
    expect(registry.describe()).toBeUndefined();
    expect(() => localGatewayOrigin({ port: 18790, mode: 'remote' as 'local' })).toThrow('not supported');
    expect(localGatewayOrigin({ port: 18790 })).toBe('http://127.0.0.1:18790');
  });
});
