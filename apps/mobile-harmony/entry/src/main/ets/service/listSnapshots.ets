import { gatewaySession } from './gatewaySession';

interface XopcListSnapshot<T> {
  data: T;
  requestedAt: number;
}

const SNAPSHOT_AGE: number = 30 * 60 * 1000;
const SNAPSHOT_LIMIT: number = 8;

export function activeListScope(): string {
  const profile = gatewaySession.currentProfile();
  return profile?.gatewayId && profile.deviceId ? JSON.stringify([profile.gatewayId, profile.deviceId]) : '';
}

export class XopcListSnapshots<T> {
  private entries: Map<string, XopcListSnapshot<T>> = new Map<string, XopcListSnapshot<T>>();

  read(scope: string, endpoint: string): T | undefined {
    const key = scope + ':' + endpoint;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.requestedAt > SNAPSHOT_AGE) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.data;
  }

  write(scope: string, endpoint: string, data: T, requestedAt: number): void {
    if (!scope) return;
    const key = scope + ':' + endpoint;
    const old = this.entries.get(key);
    if (old && old.requestedAt > requestedAt) return;
    this.entries.delete(key);
    this.entries.set(key, { data, requestedAt });
    if (this.entries.size > SNAPSHOT_LIMIT) this.entries.delete(Array.from(this.entries.keys())[0]);
  }
}
