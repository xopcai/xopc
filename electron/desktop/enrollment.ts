import { DESKTOP_HOST_MANIFEST } from '@xopcai/gateway-contract';

import type { DesktopBinding } from './device-identity.js';
import { DesktopIdentityStore } from './device-identity.js';
import { DesktopDeviceAuth } from './device-auth.js';
import { desktopAuthTransport } from './device-transport.js';
import { ShellUpstream } from '../shell/upstream.js';
import type { GatewayConnectionPreview } from '../gateway/connection-manager.js';
import { isConnectionId } from '../gateway/profiles.js';

export type DesktopEnrollmentAction = 'enroll' | 'check' | 'disable' | 'reenroll';
type EnrollmentState = 'registered' | 'unregistered' | 'pending' | 'disabled-confirmed' | 'disabled-unconfirmed' | 'cancelled' | 'error';
type EnrollmentStatus = { state: EnrollmentState; deviceId?: string; localCapabilities: false; reliableExecution?: true; operationReview?: true; workspaceExecution?: true; containerCommand?: true; containerTerminal?: true; remoteComputer?: true };

/** Optional device identity operations never start an executor or depend on the chat connection. */
export class DesktopEnrollmentManager {
  private active?: AbortController;
  private statuses = new Map<string, { binding: string; status: EnrollmentStatus }>();
  constructor(private readonly options: {
    manager: GatewayConnectionPreview; store: DesktopIdentityStore; visible(): boolean;
    consent(binding: DesktopBinding, signal: AbortSignal, reenroll: boolean): Promise<boolean>;
  }) {}
  cancel(): void { this.active?.abort(); }
  private bindingKey(binding: DesktopBinding) { return JSON.stringify(binding); }
  private binding(id: string): DesktopBinding {
    const profile = this.options.manager.snapshot().profiles.find(profile => profile.id === id);
    if (!profile?.identity) throw new Error('DESKTOP_PINNED_GATEWAY_REQUIRED');
    return { profileId: id, gatewayId: profile.identity.gatewayId, publicKey: profile.identity.publicKey, origin: profile.origin };
  }
  snapshot(): Record<string, EnrollmentStatus> {
    const profiles = this.options.manager.snapshot().profiles;
    for (const id of this.statuses.keys()) if (!profiles.some(profile => profile.id === id)) this.statuses.delete(id);
    return Object.fromEntries(profiles.flatMap(profile => {
      const item = this.statuses.get(profile.id);
      if (!item || !profile.identity || item.binding !== this.bindingKey(this.binding(profile.id))) return [];
      return [[profile.id, item.status]];
    }));
  }
  async perform(action: DesktopEnrollmentAction, epoch: unknown, id: unknown): Promise<void> {
    if (!isConnectionId(id) || epoch !== this.options.manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
    if (this.active) throw new Error('DESKTOP_OPERATION_BUSY');
    const profile = this.options.manager.snapshot().profiles.find(profile => profile.id === id)!;
    const binding = this.binding(id), controller = new AbortController(); this.active = controller;
    const current = () => {
      if (controller.signal.aborted || epoch !== this.options.manager.snapshot().epoch) throw new Error('DESKTOP_OPERATION_CANCELLED');
    };
    let reliableExecution = false, operationReview = false, workspaceExecution = false, containerCommand = false, containerTerminal = false, remoteComputer = false;
    const set = (state: EnrollmentState, deviceId?: string) => {
      current(); this.statuses.set(id, { binding: this.bindingKey(binding), status: { state, ...(deviceId ? { deviceId } : {}), ...(state === 'registered' && remoteComputer ? { remoteComputer: true as const } : {}), ...(state === 'registered' && containerTerminal ? { containerTerminal: true as const } : {}), ...(state === 'registered' && containerCommand ? { containerCommand: true as const } : {}), ...(state === 'registered' && workspaceExecution ? { workspaceExecution: true as const } : {}), ...(state === 'registered' && operationReview ? { operationReview: true as const } : {}), ...(state === 'registered' && reliableExecution ? { reliableExecution: true as const } : {}), localCapabilities: false } });
    };
    const channel = desktopAuthTransport(binding, profile.transport, controller.signal);
    const client = new DesktopDeviceAuth(binding, this.options.store, channel.request);
    let owner: ShellUpstream | undefined;
    try {
      if (action !== 'disable' && this.options.manager.snapshot().selectedId !== id) throw new Error('DESKTOP_SELECT_GATEWAY_REQUIRED');
      if (action === 'disable') {
        const result = await client.disable(this.options.manager.snapshot().selectedId !== id);
        set(!result.hadIdentity ? 'unregistered' : result.remoteRevocationConfirmed ? 'disabled-confirmed' : 'disabled-unconfirmed'); return;
      }
      if (action === 'check') {
        const result = await client.readSelf();
        const compatibility = await client.endpointRequest('/api/desktop-host/compatibility', 'GET', undefined, result.deviceId); current();
        reliableExecution = compatibility?.gatewayId === binding.gatewayId && compatibility.publicKey === binding.publicKey && compatibility.capabilities?.reliableExecutionVersion === 1;
        operationReview = compatibility?.gatewayId === binding.gatewayId && compatibility.publicKey === binding.publicKey && compatibility.capabilities?.operationReviewVersion === 1;
        workspaceExecution = process.platform === 'darwin' && reliableExecution && compatibility.capabilities?.workspaceExecutionVersion === 1;
        containerCommand = process.platform === 'darwin' && reliableExecution && compatibility.capabilities?.containerCommandVersion === 1;
        containerTerminal = containerCommand && compatibility.capabilities?.containerTerminalVersion === 1;
        remoteComputer = process.platform === 'darwin' && reliableExecution && compatibility.capabilities?.remoteComputerVersion === 1;
        set('registered', result.deviceId); return;
      }
      if (!this.options.visible()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
      const target = await this.options.manager.privateConnection(epoch, id); current();
      owner = new ShellUpstream(target);
      const ownerJson = async (path: string, method = 'GET', body?: unknown) => {
        current(); const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
        await owner!.verifyPinnedIdentity(signal); current();
        return new Promise<any>((resolve, reject) => {
          const req = owner!.request(path, method, { 'content-type': 'application/json' }, signal);
          req.on('error', () => reject(new Error('DESKTOP_AUTH_UNAVAILABLE')));
          req.on('response', res => {
            if (![200, 201].includes(res.statusCode ?? 0)) { res.destroy(); reject(new Error(res.statusCode === 404 ? 'DESKTOP_HOST_UNSUPPORTED' : res.statusCode === 401 || res.statusCode === 403 ? 'DESKTOP_OWNER_AUTH_REQUIRED' : 'DESKTOP_AUTH_UNAVAILABLE')); return; }
            const chunks: Buffer[] = []; let size = 0;
            res.on('data', chunk => { size += chunk.length; if (size > 65536) res.destroy(new Error('DESKTOP_RESPONSE_LIMIT')); else chunks.push(chunk); });
            res.on('error', () => reject(new Error('DESKTOP_AUTH_UNAVAILABLE')));
            res.on('end', () => { try { current(); resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('DESKTOP_AUTH_UNAVAILABLE')); } });
          });
          req.end(body === undefined ? undefined : JSON.stringify(body));
        });
      };
      const compatibility = await ownerJson('/api/desktop-host/compatibility'); current();
      if (compatibility.ok !== true || compatibility.payload?.gatewayId !== binding.gatewayId || compatibility.payload.publicKey !== binding.publicKey
        || compatibility.payload.manifest?.contract !== DESKTOP_HOST_MANIFEST.contract
        || compatibility.payload.manifest.devicePairingVersion !== DESKTOP_HOST_MANIFEST.devicePairingVersion
        || compatibility.payload.manifest.requestProofVersion !== 1
        || compatibility.payload.manifest.credentialOnly !== true) throw new Error('DESKTOP_HOST_UNSUPPORTED');
      if (profile.transport === 'ssh' && compatibility.payload.capabilities?.sshPairing !== true) throw new Error('DESKTOP_HOST_SSH_UNSUPPORTED');
      reliableExecution = compatibility.payload.capabilities?.reliableExecutionVersion === 1;
      operationReview = compatibility.payload.capabilities?.operationReviewVersion === 1;
      workspaceExecution = process.platform === 'darwin' && reliableExecution && compatibility.payload.capabilities?.workspaceExecutionVersion === 1;
      containerCommand = process.platform === 'darwin' && reliableExecution && compatibility.payload.capabilities?.containerCommandVersion === 1;
      containerTerminal = containerCommand && compatibility.payload.capabilities?.containerTerminalVersion === 1;
      remoteComputer = process.platform === 'darwin' && reliableExecution && compatibility.payload.capabilities?.remoteComputerVersion === 1;
      const result = await client.enroll({ displayName: `xopc Desktop (${process.platform})`,
        consent: async () => {
          current(); if (!this.options.visible()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
          const accepted = await this.options.consent(binding, controller.signal, action === 'reenroll'); current(); return accepted;
        },
        setup: async () => {
          current(); const response = await ownerJson('/api/desktop-host/pairing-setups', 'POST', profile.transport === 'ssh' ? { sshOrigin: binding.origin } : {});
          current(); return response.payload?.invitation;
        },
        approve: async (requestId, revision) => { current(); await ownerJson(`/api/device-pairing/requests/${requestId}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); current(); },
        ...(action === 'reenroll' ? { confirmRevoked: async (identity: { deviceId?: string; revocationConfirmed?: boolean; setupId: string }) => {
          current(); if (identity.revocationConfirmed) return true;
          if (!identity.deviceId) {
            const path = `/api/device-pairing/setups/${identity.setupId}`;
            const existing = await ownerJson(path);
            if (existing.request?.status === 'completed') return false;
            await ownerJson(path, 'DELETE');
            const cancelled = await ownerJson(path);
            return cancelled.request == null || ['cancelled', 'expired', 'rejected'].includes(cancelled.request.status);
          }
          const response = await ownerJson('/api/endpoint-tools/devices');
          if (!Array.isArray(response.payload)) return false;
          const existing = response.payload.find((device: any) => device.id === identity.deviceId);
          return !existing || existing.access?.revokedAt != null;
        } } : {}),
      });
      current(); await client.readSelf(); set('registered', result.deviceId);
    } catch (error) {
      if (controller.signal.aborted || epoch !== this.options.manager.snapshot().epoch) throw new Error('DESKTOP_OPERATION_CANCELLED');
      const code = error instanceof Error ? error.message : '';
      if (code === 'DESKTOP_NOT_ENROLLED' || code === 'DESKTOP_ENROLLMENT_PENDING') {
        set(code === 'DESKTOP_NOT_ENROLLED' ? 'unregistered' : 'pending'); throw error;
      }
      const cancelledState = action === 'reenroll' ? this.statuses.get(id)?.status.state === 'disabled-confirmed' ? 'disabled-confirmed' : 'disabled-unconfirmed' : 'cancelled';
      set(code === 'DESKTOP_LOCAL_CONSENT_DENIED' ? cancelledState : code === 'DESKTOP_AUTH_REVOKED' || code === 'DESKTOP_REENROLLMENT_REQUIRED' ? 'disabled-unconfirmed' : 'error');
      throw error;
    } finally { channel.close(); owner?.close(); if (this.active === controller) this.active = undefined; }
  }
}
