import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../storage/sqlite/browser-session-repository.js', () => ({ isBrowserSessionActive: vi.fn() }));
vi.mock('../../../storage/sqlite/device-access-repository.js', () => ({ getDevice: vi.fn(), isDeviceAccessSessionActive: vi.fn() }));
import { isBrowserSessionActive } from '../../../storage/sqlite/browser-session-repository.js';
import { getDevice, isDeviceAccessSessionActive } from '../../../storage/sqlite/device-access-repository.js';
import { localAppDelegationCaller } from '../local-app-delegation-access.js';
import type { GatewayPrincipal } from '../gateway-principal.js';
import type { ResolvedGatewayAuth } from '../../auth.js';
const context = { principalId: 'owner', scopes: ['workspace.read'] as const, surface: 'http' as const, authorize: () => true };
beforeEach(() => {
  vi.mocked(isBrowserSessionActive).mockReturnValue(true);
  vi.mocked(isDeviceAccessSessionActive).mockReturnValue(true);
  vi.mocked(getDevice).mockReturnValue({ id: 'device', scopes: ['workspace.read'] } as never);
});
describe('Local App delegation caller lifetime', () => {
  it('rechecks a browser session and Gateway credential rotation', () => {
    const auth = { mode: 'token', token: 'initial' } as ResolvedGatewayAuth;
    const principal: GatewayPrincipal = { kind: 'owner', principalId: 'browser:session', browserSessionId: 'session', scopes: ['workspace.read'] };
    const caller = localAppDelegationCaller(context, principal, () => auth);
    expect(() => caller.assertCurrent?.()).not.toThrow();
    vi.mocked(isBrowserSessionActive).mockReturnValue(false);
    expect(() => caller.assertCurrent?.()).toThrow('authorization ended');
    vi.mocked(isBrowserSessionActive).mockReturnValue(true); auth.token = 'rotated';
    expect(() => caller.assertCurrent?.()).toThrow('authorization ended');
  });
  it('rechecks device revocation, sessions and scope narrowing', () => {
    const principal: GatewayPrincipal = { kind: 'device', principalId: 'device', deviceId: 'device', accessSessionId: 'session', scopes: ['workspace.read'] };
    const caller = localAppDelegationCaller(context, principal, () => ({ mode: 'none' }) as ResolvedGatewayAuth);
    expect(() => caller.assertCurrent?.()).not.toThrow();
    vi.mocked(isDeviceAccessSessionActive).mockReturnValue(false);
    expect(() => caller.assertCurrent?.()).toThrow('authorization ended');
    vi.mocked(isDeviceAccessSessionActive).mockReturnValue(true);
    vi.mocked(getDevice).mockReturnValue({ id: 'device', scopes: [] } as never);
    expect(() => caller.assertCurrent?.()).toThrow('authorization ended');
    vi.mocked(getDevice).mockReturnValue(undefined);
    expect(() => caller.assertCurrent?.()).toThrow('authorization ended');
  });
});
