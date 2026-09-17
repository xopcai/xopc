import { beforeEach, describe, expect, it, vi } from 'vitest';
const records = vi.hoisted(() => new Map<string, string>());
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({
  XopcSecureStore: class {
    async read(key: string) { return records.get(key); }
    async write(key: string, value: string) { records.set(key, value); }
    async remove(key: string) { records.delete(key); }
  },
}));
import { XopcSecureStore } from '../entry/src/main/ets/service/secureStore.ets';
import { XopcGatewayProfiles, gatewayCredentialKey } from '../entry/src/main/ets/service/gatewayProfiles.ets';
const profile = (id: string) => ({ gatewayId: id, name: id, gatewayPublicKey: `pin-${id}`, deviceId: `device-${id}`,
  routes: [{ id: 'secure', kind: 'custom-https', url: `https://${id}.example.com` }], activeRouteId: 'secure' });
describe('Gateway catalog', () => {
  beforeEach(() => records.clear());
  it('migrates the legacy profile, refresh credential and pending rotation without pairing again', async () => {
    records.set('profile', JSON.stringify(profile('a'))); records.set('refresh', 'secret-a'); records.set('refresh-attempt', 'pending-a');
    const store = new XopcGatewayProfiles(new XopcSecureStore()); await store.restore();
    expect(store.active()?.gatewayId).toBe('a'); expect(store.list()).toHaveLength(1);
    expect(records.get(gatewayCredentialKey('a', 'refresh'))).toBe('secret-a');
    expect(records.get(gatewayCredentialKey('a', 'refresh-attempt'))).toBe('pending-a');
    expect(records.has('profile')).toBe(false);
    records.set(gatewayCredentialKey('a', 'refresh'), 'rotated-a');
    const restarted = new XopcGatewayProfiles(new XopcSecureStore()); await restarted.restore();
    expect(restarted.active()?.gatewayId).toBe('a'); expect(records.get(gatewayCredentialKey('a', 'refresh'))).toBe('rotated-a');
  });
  it('keeps profiles across save, rename, activation and restart', async () => {
    const store = new XopcGatewayProfiles(new XopcSecureStore());
    await store.save(profile('a')); await store.save(profile('b')); await store.rename('a', ' Office '); await store.activate('a');
    const restarted = new XopcGatewayProfiles(new XopcSecureStore()); await restarted.restore();
    expect(restarted.active()?.name).toBe('Office'); expect(restarted.list()).toHaveLength(2);
  });
  it('deduplicates re-pairing and rejects identity changes even after removal', async () => {
    const store = new XopcGatewayProfiles(new XopcSecureStore()); await store.save(profile('a')); await store.save(profile('a'));
    expect(store.list()).toHaveLength(1); await store.remove('a');
    await expect(store.save({ ...profile('a'), gatewayPublicKey: 'attacker' })).rejects.toThrow('GATEWAY_IDENTITY_MISMATCH');
  });
  it('removes only the selected credentials, falls back when active and handles the last profile', async () => {
    const store = new XopcGatewayProfiles(new XopcSecureStore()); await store.save(profile('a')); await store.save(profile('b'));
    records.set(gatewayCredentialKey('a', 'refresh'), 'a'); records.set(gatewayCredentialKey('b', 'refresh'), 'b');
    await store.remove('b'); expect(store.active()?.gatewayId).toBe('a');
    expect(records.get(gatewayCredentialKey('a', 'refresh'))).toBe('a'); expect(records.has(gatewayCredentialKey('b', 'refresh'))).toBe(false);
    await store.remove('a'); expect(store.active()).toBeUndefined(); expect(store.list()).toEqual([]);
  });
});
