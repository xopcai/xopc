import { XopcProfile } from '../model/gateway';
import { validateRoutes } from '../common/protocol';
import { XopcSecureStore } from './secureStore';

interface XopcGatewayCatalog { profiles: XopcProfile[]; activeGatewayId: string; }

export function gatewayCredentialKey(gatewayId: string, kind: string): string {
  return 'gateway:' + encodeURIComponent(gatewayId) + ':' + kind;
}

export class XopcGatewayProfiles {
  private store: XopcSecureStore;
  private catalog: XopcGatewayCatalog = { profiles: [], activeGatewayId: '' };
  constructor(store: XopcSecureStore) { this.store = store; }

  list(): XopcProfile[] { return this.catalog.profiles.slice(); }
  active(): XopcProfile | undefined {
    return this.catalog.profiles.find((profile: XopcProfile): boolean => profile.gatewayId === this.catalog.activeGatewayId);
  }

  async restore(): Promise<void> {
    const saved = await this.store.read('gateway-catalog');
    if (saved) {
      const catalog = JSON.parse(saved) as XopcGatewayCatalog;
      if (!Array.isArray(catalog.profiles) || typeof catalog.activeGatewayId !== 'string') throw new Error('INVALID_PROFILE');
      const ids: string[] = [];
      for (const profile of catalog.profiles) {
        this.validate(profile);
        if (ids.includes(profile.gatewayId)) throw new Error('INVALID_PROFILE');
        ids.push(profile.gatewayId);
      }
      if (catalog.activeGatewayId && !ids.includes(catalog.activeGatewayId)) throw new Error('INVALID_PROFILE');
      this.catalog = catalog;
      return;
    }
    const legacy = await this.store.read('profile');
    if (!legacy) return;
    const profile = JSON.parse(legacy) as XopcProfile;
    this.validate(profile);
    // Commit the catalog last. A crash before this point can safely repeat migration.
    for (const kind of ['refresh', 'refresh-attempt']) {
      const credential = await this.store.read(kind);
      if (credential) await this.store.write(gatewayCredentialKey(profile.gatewayId, kind), credential);
    }
    await this.save(profile);
    await this.store.remove('profile');
    await this.store.remove('refresh');
    await this.store.remove('refresh-attempt');
  }

  private validate(profile: XopcProfile): void {
    if (!profile || typeof profile.gatewayId !== 'string' || !profile.gatewayId || !profile.deviceId
      || !profile.gatewayPublicKey || typeof profile.name !== 'string') throw new Error('INVALID_PROFILE');
    profile.routes = validateRoutes(profile.routes);
    if (!profile.routes.some((route): boolean => route.id === profile.activeRouteId)) throw new Error('INVALID_PROFILE');
  }

  private async commit(next: XopcGatewayCatalog): Promise<void> {
    await this.store.write('gateway-catalog', JSON.stringify(next));
    this.catalog = next;
  }

  async save(profile: XopcProfile): Promise<void> {
    this.validate(profile);
    const pinKey = gatewayCredentialKey(profile.gatewayId, 'identity');
    const pin = await this.store.read(pinKey);
    const previous = this.catalog.profiles.find((item: XopcProfile): boolean => item.gatewayId === profile.gatewayId);
    if ((pin && pin !== profile.gatewayPublicKey) || (previous && previous.gatewayPublicKey !== profile.gatewayPublicKey)) {
      throw new Error('GATEWAY_IDENTITY_MISMATCH');
    }
    await this.store.write(pinKey, profile.gatewayPublicKey);
    await this.commit({ profiles: [profile, ...this.catalog.profiles.filter((item: XopcProfile): boolean => item.gatewayId !== profile.gatewayId)],
      activeGatewayId: profile.gatewayId });
  }

  async activate(gatewayId: string): Promise<void> {
    if (!this.catalog.profiles.some((item: XopcProfile): boolean => item.gatewayId === gatewayId)) throw new Error('NOT_PAIRED');
    await this.commit({ profiles: this.catalog.profiles, activeGatewayId: gatewayId });
  }

  async rename(gatewayId: string, name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) throw new Error('INVALID_GATEWAY_NAME');
    const profiles = this.catalog.profiles.map((item: XopcProfile): XopcProfile => {
      const copy = JSON.parse(JSON.stringify(item)) as XopcProfile;
      if (copy.gatewayId === gatewayId) copy.name = trimmed;
      return copy;
    });
    await this.commit({ profiles, activeGatewayId: this.catalog.activeGatewayId });
  }

  async remove(gatewayId: string): Promise<void> {
    const profiles = this.catalog.profiles.filter((item: XopcProfile): boolean => item.gatewayId !== gatewayId);
    await this.commit({ profiles, activeGatewayId: this.catalog.activeGatewayId === gatewayId ? (profiles[0]?.gatewayId ?? '') : this.catalog.activeGatewayId });
    // Keep the identity pin, including after a local removal.
    for (const kind of ['refresh', 'refresh-attempt']) {
      try { await this.store.remove(gatewayCredentialKey(gatewayId, kind)); }
      catch (_) { /* The committed catalog already prevents use of an orphaned encrypted credential. */ }
    }
  }
}
