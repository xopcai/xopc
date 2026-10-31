import { randomUUID } from 'node:crypto';

import { ConnectionCredentialStore } from './credentials.js';
import { ConnectionProfileStore, parseRemoteProfile, type RemoteProfile } from './profiles.js';

/** S1 has no authenticated/ready state and performs no network or device work. */
export class GatewayConnectionPreview {
  private profiles: RemoteProfile[] = [];
  private selectedId?: string;
  private epoch = 0;
  private storageError = false;
  private queue = Promise.resolve();

  constructor(private readonly store: ConnectionProfileStore, private readonly credentials: ConnectionCredentialStore) {}

  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // A filesystem commit may be in flight. Quarantine until a fresh process reloads disk.
          this.storageError = true;
          reject(new Error('CONNECTION_STORAGE_TIMEOUT_RESTART_REQUIRED'));
        }, 15_000);
      })]);
    } finally { clearTimeout(timer); }
  }

  async initialize(): Promise<void> {
    try {
      await this.bounded((async () => {
        this.profiles = await this.store.load();
        await this.credentials.prune(this.profiles.flatMap(p => p.credentialRef ? [p.credentialRef] : []));
      })());
    }
    catch { this.storageError = true; }
  }

  snapshot() {
    return { stage: 'S1' as const, epoch: this.epoch, mode: 'remote' as const,
      status: this.storageError ? 'storage-error' : this.selectedId ? 'remote-chat-unavailable' : 'unselected',
      reason: this.storageError ? 'PROFILE_STORAGE_UNAVAILABLE' : 'REMOTE_CHAT_NOT_IMPLEMENTED',
      selectedId: this.selectedId, localCapabilities: false as const,
      profiles: this.profiles.map(({ credentialRef, ...profile }) => ({ ...profile, hasCredential: Boolean(credentialRef) })) };
  }

  private mutate<T>(expectedEpoch: unknown, work: () => Promise<T>): Promise<T> {
    if (this.storageError) return Promise.reject(new Error('PROFILE_STORAGE_UNAVAILABLE'));
    const next = this.queue.then(async () => {
      if (expectedEpoch !== this.epoch) throw new Error('STALE_CONNECTION_EPOCH');
      if (this.storageError) throw new Error('PROFILE_STORAGE_UNAVAILABLE');
      await this.credentials.prune(this.profiles.flatMap(p => p.credentialRef ? [p.credentialRef] : []));
      return work();
    });
    this.queue = next.then(() => {}, () => {});
    return this.bounded(next);
  }

  save(expectedEpoch: unknown, input: unknown) {
    return this.mutate(expectedEpoch, async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_PROFILE');
      const value = input as Record<string, unknown>;
      if (Object.keys(value).some(key => !['id', 'name', 'origin', 'transport', 'credential'].includes(key))) throw new Error('INVALID_PROFILE');
      const existing = this.profiles.find(p => p.id === value.id);
      if (value.id !== undefined && !existing) throw new Error('UNKNOWN_PROFILE');
      const profile = parseRemoteProfile({ id: existing?.id ?? randomUUID(), mode: 'remote',
        name: value.name, origin: value.origin, transport: value.transport });
      if (!existing && this.profiles.length >= 20) throw new Error('PROFILE_LIMIT');
      // Changed destinations never inherit credentials, even on the same profile.
      const sameDestination = existing?.origin === profile.origin && existing?.transport === profile.transport;
      let newRef: string | undefined;
      if (value.credential !== undefined && value.credential !== '') newRef = await this.credentials.put(value.credential);
      if (this.storageError) {
        if (newRef) await this.credentials.remove(newRef).catch(() => {});
        throw new Error('PROFILE_STORAGE_UNAVAILABLE');
      }
      const credentialRef = newRef ?? (sameDestination ? existing.credentialRef : undefined);
      const updated = parseRemoteProfile({ ...profile, ...(sameDestination && existing.identity ? { identity: existing.identity } : {}), ...(credentialRef ? { credentialRef } : {}) });
      const profiles = [...this.profiles.filter(p => p.id !== profile.id), updated];
      try { await this.store.save(profiles); }
      catch (error) { if (newRef) await this.credentials.remove(newRef).catch(() => {}); throw error; }
      this.profiles = profiles;
      this.selectedId = undefined;
      this.epoch++;
      if (existing?.credentialRef && existing.credentialRef !== credentialRef) await this.credentials.remove(existing.credentialRef).catch(() => {});
      return this.snapshot();
    });
  }

  beginConnection(expectedEpoch: unknown, id: unknown) {
    return this.mutate(expectedEpoch, async () => {
      if (!this.profiles.some(profile => profile.id === id)) throw new Error('UNKNOWN_PROFILE');
      this.selectedId = String(id); this.epoch++;
      return this.snapshot();
    });
  }

  privateConnection(expectedEpoch: unknown, id: unknown) {
    return this.mutate(expectedEpoch, async () => {
      const profile = this.profiles.find(p => p.id === id);
      if (!profile?.credentialRef) throw new Error('REMOTE_CREDENTIAL_REQUIRED');
      const token = await this.credentials.read(profile.credentialRef);
      if (this.storageError) throw new Error('PROFILE_STORAGE_UNAVAILABLE');
      return { origin: profile.origin, transport: profile.transport, token, identity: profile.identity };
    });
  }

  pinIdentity(expectedEpoch: unknown, id: unknown, identity: { gatewayId: string; publicKey: string }) {
    return this.mutate(expectedEpoch, async () => {
      const existing = this.profiles.find(p => p.id === id);
      if (!existing) throw new Error('UNKNOWN_PROFILE');
      if (existing.identity && (existing.identity.gatewayId !== identity.gatewayId || existing.identity.publicKey !== identity.publicKey)) throw new Error('GATEWAY_IDENTITY_CHANGED');
      if (existing.identity) return this.snapshot();
      const profile = parseRemoteProfile({ ...existing, identity });
      const profiles = this.profiles.map(p => p.id === id ? profile : p);
      await this.store.save(profiles); this.profiles = profiles; this.epoch++;
      return this.snapshot();
    });
  }

  select(expectedEpoch: unknown, id: unknown) {
    return this.mutate(expectedEpoch, async () => {
      const profile = this.profiles.find(p => p.id === id);
      if (!profile) throw new Error('UNKNOWN_PROFILE');
      if (profile.credentialRef) await this.credentials.verify(profile.credentialRef);
      this.selectedId = profile.id;
      this.epoch++;
      return this.snapshot();
    });
  }

  remove(expectedEpoch: unknown, id: unknown) {
    return this.mutate(expectedEpoch, async () => {
      const profile = this.profiles.find(p => p.id === id);
      if (!profile) throw new Error('UNKNOWN_PROFILE');
      const profiles = this.profiles.filter(p => p.id !== id);
      await this.store.save(profiles);
      this.profiles = profiles;
      if (this.selectedId === id) this.selectedId = undefined;
      this.epoch++;
      if (profile.credentialRef) await this.credentials.remove(profile.credentialRef).catch(() => {});
      return this.snapshot();
    });
  }
}
