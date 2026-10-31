import type { GatewayConnectionPreview } from '../gateway/connection-manager.js';
import { isConnectionId } from '../gateway/profiles.js';
import { DesktopDeviceAuth } from './device-auth.js';
import { DesktopIdentityStore, type DesktopBinding } from './device-identity.js';
import { desktopAuthTransport } from './device-transport.js';
import { DesktopObservationHost, type DesktopObservationState } from './observation-host.js';
import { desktopOwnerClient } from './owner-client.js';

type Observation = { profileId: string; state: DesktopObservationState; error?: string; capability: 'device-state'; serverRevocationConfirmed?: boolean };
type Run = { binding: DesktopBinding; transport: 'ssh' | 'direct'; epoch: number; controller: AbortController; host?: DesktopObservationHost; deviceId?: string; close(): void };

export class DesktopObservationManager {
  private active?: Run;
  private status?: Observation;
  private cleanup: Promise<void> = Promise.resolve();
  constructor(private readonly options: {
    manager: GatewayConnectionPreview; store: DesktopIdentityStore; appVersion: string;
    visible(): boolean; consent(binding: DesktopBinding, signal: AbortSignal): Promise<boolean>;
    readState(): Promise<{ platform: string; systemVersion: string; locale: string; timezone: string }>;
  }) {}
  snapshot(): Observation | undefined { return this.status ? { ...this.status } : undefined; }
  whenStopped(): Promise<void> { return this.cleanup; }
  origin() {
    const run = this.active;
    if (!run || run.epoch !== this.options.manager.snapshot().epoch || run.binding.profileId !== this.options.manager.snapshot().selectedId) return;
    return run.host?.origin();
  }
  stop(): void {
    const run = this.active; if (!run) return;
    this.active = undefined; run.controller.abort(); run.host?.stop(); run.close();
    this.status = { profileId: run.binding.profileId, state: 'stopped', capability: 'device-state', serverRevocationConfirmed: false };
    this.cleanup = this.cleanup.catch(() => {}).then(async () => {
      let confirmed = false;
      const channel = desktopAuthTransport(run.binding, run.transport), client = new DesktopDeviceAuth(run.binding, this.options.store, channel.request);
      try { if (run.deviceId) { const result = await client.endpointRequest('/api/desktop-host/observation', 'DELETE', undefined, run.deviceId); confirmed = result?.stateEnabled === false; } }
      catch { /* The local Host remains stopped if the server cannot confirm revocation. */ }
      finally { channel.close(); }
      if (!this.active && this.status?.profileId === run.binding.profileId) this.status.serverRevocationConfirmed = confirmed;
    });
  }
  async start(epoch: unknown, id: unknown): Promise<void> {
    if (this.active) throw new Error('DESKTOP_OPERATION_BUSY');
    if (!isConnectionId(id) || epoch !== this.options.manager.snapshot().epoch || id !== this.options.manager.snapshot().selectedId) throw new Error('STALE_CONNECTION_EPOCH');
    if (!this.options.visible()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    await this.cleanup;
    if (this.active) throw new Error('DESKTOP_OPERATION_BUSY');
    if (epoch !== this.options.manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
    const profile = this.options.manager.snapshot().profiles.find(profile => profile.id === id);
    if (!profile?.identity) throw new Error('DESKTOP_PINNED_GATEWAY_REQUIRED');
    const binding: DesktopBinding = { profileId: id, origin: profile.origin, ...profile.identity };
    const controller = new AbortController(), channel = desktopAuthTransport(binding, profile.transport, controller.signal);
    const run: Run = { binding, epoch: epoch as number, transport: profile.transport, controller, close: channel.close }; this.active = run;
    const current = () => { if (this.active !== run || controller.signal.aborted || epoch !== this.options.manager.snapshot().epoch) throw new Error('DESKTOP_OPERATION_CANCELLED'); };
    let owner: ReturnType<typeof desktopOwnerClient> | undefined;
    try {
      const client = new DesktopDeviceAuth(binding, this.options.store, channel.request);
      run.deviceId = (await client.readSelf()).deviceId; current();
      owner = desktopOwnerClient(await this.options.manager.privateConnection(epoch, id), controller.signal);
      const discovery = await owner.request('/api/desktop-host/compatibility'); current();
      if (discovery.payload?.gatewayId !== binding.gatewayId || discovery.payload.publicKey !== binding.publicKey
        || discovery.payload.capabilities?.deviceStateObservation !== true || discovery.payload.capabilities.signedGatewayFrames !== 1) throw new Error('DESKTOP_OBSERVATION_UNSUPPORTED');
      const authorization = await owner.request(`/api/desktop-host/devices/${run.deviceId}/observation`); current();
      if (authorization.payload?.deviceId !== run.deviceId || !Number.isSafeInteger(authorization.payload.revision)) throw new Error('DESKTOP_OBSERVATION_DENIED');
      if (!await this.options.consent(binding, controller.signal)) throw new Error('DESKTOP_LOCAL_CONSENT_DENIED'); current();
      if (!this.options.visible()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
      const grant = await owner.request(`/api/desktop-host/devices/${run.deviceId}/observation`, 'POST', { state: true, expectedRevision: authorization.payload.revision }); current();
      if (grant.payload?.deviceId !== run.deviceId || grant.payload.stateEnabled !== true) throw new Error('DESKTOP_OBSERVATION_DENIED');
      this.status = { profileId: id, state: 'connecting', capability: 'device-state' };
      run.host = new DesktopObservationHost({ binding, auth: client, appVersion: this.options.appVersion, readState: this.options.readState,
        onState: (state, error) => {
          if (this.active !== run || epoch !== this.options.manager.snapshot().epoch) return;
          if (state === 'error') this.stop();
          this.status = { profileId: id, state, ...(error ? { error } : {}), capability: 'device-state' };
        } });
      await run.host.start(); current();
    } catch (error) {
      if (this.active === run) this.stop();
      throw error;
    } finally { owner?.close(); }
  }
}
