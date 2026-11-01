import { randomUUID } from 'node:crypto';

import type { DesktopExecutionGrant } from '@xopcai/gateway-contract';

import type { GatewayConnectionPreview } from '../gateway/connection-manager.js';
import { isConnectionId } from '../gateway/profiles.js';
import { DesktopDeviceAuth } from './device-auth.js';
import { DesktopIdentityStore, type DesktopBinding } from './device-identity.js';
import { desktopAuthTransport } from './device-transport.js';
import { DesktopExecutionCatalog } from './execution-catalog.js';
import { DesktopExecutionHost } from './execution-host.js';
import { DesktopExecutionSession } from './execution-session.js';
import { DesktopExecutionLease, DesktopOperationJournal } from './operation-journal.js';
import type { DesktopExecutionWorker } from './operation-supervisor.js';

type Status = { profileId: string; state: 'authorizing' | 'connecting' | 'online' | 'stop-requested' | 'stopped' | 'stop-unconfirmed' | 'error';
  error?: string; remoteRevocationConfirmed?: boolean; resultUnknown?: boolean };
type Run = { binding: DesktopBinding; epoch: number; transport: 'ssh' | 'direct'; abort: AbortController; close(): void;
  deviceId?: string; proposed?: DesktopExecutionGrant; expectedRevision?: number; host?: DesktopExecutionHost;
  lease?: DesktopExecutionLease; journal?: DesktopOperationJournal; watchdog?: ReturnType<typeof setInterval> };

/** Remote-only coordinator. The executor root must be the fixed per-user state root, never a profile or userData directory. */
export class DesktopExecutionManager {
  private active?: Run;
  private status?: Status;
  private cleanup: Promise<void> = Promise.resolve();
  constructor(private readonly options: {
    manager: GatewayConnectionPreview; store: DesktopIdentityStore; executorRoot: string; catalog: DesktopExecutionCatalog; appVersion: string;
    foreground(): boolean;
    consent(binding: DesktopBinding, grant: DesktopExecutionGrant, signal: AbortSignal): Promise<boolean>;
    confirm: ConstructorParameters<typeof DesktopExecutionSession>[0]['confirm'];
    createWorker(tool: string): DesktopExecutionWorker;
  }) {}
  snapshot(): Status | undefined { return this.status ? { ...this.status } : undefined; }
  origin() {
    const run = this.active, current = this.options.manager.snapshot();
    return run && !run.abort.signal.aborted && current.epoch === run.epoch && current.selectedId === run.binding.profileId ? run.host?.origin() : undefined;
  }
  async readyOrigin() {
    const run = this.active; if (!run || !this.origin()) return;
    const origin = await run.host?.readyOrigin();
    return this.active === run && this.origin()?.endpointId === origin?.endpointId ? origin : undefined;
  }
  stop(): Promise<void> {
    const run = this.active;
    if (!run) return this.cleanup;
    run.abort.abort(); clearInterval(run.watchdog);
    void run.host?.stop().catch(() => {});
    this.status = { profileId: run.binding.profileId, state: 'stop-requested' };
    this.cleanup = this.cleanup.catch(() => {}).then(async () => {
      if (this.active !== run) return;
      let outcome;
      try { outcome = await run.host?.verifyStopped() ?? { state: 'idle' as const }; }
      catch { outcome = { state: 'unknown' as const }; }
      let confirmed = false;
      // Revocation uses a fresh transport: the execution lifetime has already been aborted locally.
      const channel = desktopAuthTransport(run.binding, run.transport), client = new DesktopDeviceAuth(run.binding, this.options.store, channel.request);
      try {
        if (run.deviceId && run.proposed && run.expectedRevision !== undefined) {
          const response = await client.endpointRequest('/api/desktop-host/execution', 'DELETE',
            { grantId: run.proposed.grantId, expectedRevision: run.expectedRevision }, run.deviceId);
          confirmed = response?.active === false && response?.enabled === false;
        }
      } catch { /* Local stop remains authoritative; remote revocation is explicitly unconfirmed. */ }
      finally { channel.close(); run.close(); }
      if (outcome.state === 'unknown') {
        this.status = { profileId: run.binding.profileId, state: 'stop-unconfirmed', remoteRevocationConfirmed: confirmed, resultUnknown: true };
        // Keep the journal and OS lease while an executor could still be running.
        return;
      }
      try { run.journal?.close(); run.lease?.close(); }
      catch { this.status = { profileId: run.binding.profileId, state: 'stop-unconfirmed', remoteRevocationConfirmed: confirmed }; return; }
      this.active = undefined;
      this.status = { profileId: run.binding.profileId, state: 'stopped', remoteRevocationConfirmed: confirmed, ...(outcome.resultUnknown ? { resultUnknown: true } : {}) };
    });
    return this.cleanup;
  }
  async requireStopped(): Promise<void> {
    await this.stop();
    if (this.active) throw new Error('DESKTOP_EXECUTION_STOP_UNCONFIRMED');
  }
  async start(epoch: unknown, id: unknown): Promise<void> {
    if (this.active) throw new Error('DESKTOP_OPERATION_BUSY');
    const snapshot = this.options.manager.snapshot();
    if (!isConnectionId(id) || epoch !== snapshot.epoch || id !== snapshot.selectedId) throw new Error('STALE_CONNECTION_EPOCH');
    if (!this.options.foreground()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    await this.cleanup;
    if (this.active) throw new Error('DESKTOP_OPERATION_BUSY');
    if (epoch !== this.options.manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
    const profile = snapshot.profiles.find(profile => profile.id === id);
    if (!profile?.identity) throw new Error('DESKTOP_PINNED_GATEWAY_REQUIRED');
    const binding = { profileId: id, origin: profile.origin, ...profile.identity }, abort = new AbortController();
    const channel = desktopAuthTransport(binding, profile.transport, abort.signal);
    const run: Run = { binding, epoch: epoch as number, transport: profile.transport, abort, close: channel.close };
    this.active = run; this.status = { profileId: id, state: 'authorizing' };
    const current = () => {
      const snapshot = this.options.manager.snapshot();
      if (this.active !== run || abort.signal.aborted || epoch !== snapshot.epoch || id !== snapshot.selectedId) throw new Error('DESKTOP_OPERATION_CANCELLED');
    };
    try {
      run.lease = new DesktopExecutionLease(this.options.executorRoot); run.journal = new DesktopOperationJournal(run.lease);
      if (run.journal.hasUnknown()) throw new Error('DESKTOP_OPERATION_RECONCILIATION_REQUIRED');
      const client = new DesktopDeviceAuth(binding, this.options.store, channel.request);
      run.deviceId = (await client.readSelf()).deviceId; current();
      const compatibility = await client.endpointRequest('/api/desktop-host/compatibility', 'GET', undefined, run.deviceId); current();
      if (compatibility?.gatewayId !== binding.gatewayId || compatibility.publicKey !== binding.publicKey || compatibility.capabilities?.reliableExecutionVersion !== 1) throw new Error('DESKTOP_EXECUTION_UNSUPPORTED');
      const previous = await client.endpointRequest('/api/desktop-host/execution', 'GET', undefined, run.deviceId); current();
      if (previous?.deviceId !== run.deviceId || !Number.isSafeInteger(previous.revision)) throw new Error('DESKTOP_EXECUTION_DENIED');
      const grant: DesktopExecutionGrant = { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 120000,
        toolRevisions: Object.fromEntries(this.options.catalog.descriptors().map(tool => [tool.name, this.options.catalog.revision(tool.name)!])) };
      if (!await this.options.consent(binding, structuredClone(grant), abort.signal)) throw new Error('DESKTOP_LOCAL_CONSENT_DENIED');
      current(); if (!this.options.foreground()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
      // Record the expected revision before POST, so a lost acknowledgement can still be revoked by exact grant identity.
      run.proposed = grant; run.expectedRevision = previous.revision + 1;
      const authorization = await client.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: previous.revision, grant }, run.deviceId); current();
      if (!authorization?.active || authorization.revision !== run.expectedRevision) throw new Error('DESKTOP_EXECUTION_DENIED');
      this.status = { profileId: id, state: 'connecting' };
      run.host = new DesktopExecutionHost({ binding, auth: client, appVersion: this.options.appVersion, approved: grant,
        authorizationRevision: authorization.revision, catalog: this.options.catalog, journal: run.journal, foreground: this.options.foreground,
        confirm: this.options.confirm, createWorker: this.options.createWorker,
        onState: (state, error) => {
          if (this.active !== run || abort.signal.aborted) return;
          this.status = { profileId: id, state: state === 'stopped' ? 'stop-requested' : state, ...(error ? { error } : {}) };
          if (state === 'stopped' || state === 'error') void this.stop();
        } });
      run.watchdog = setInterval(() => {
        const snapshot = this.options.manager.snapshot();
        if (snapshot.epoch !== epoch || snapshot.selectedId !== id || Date.now() >= grant.expiresAt) void this.stop();
      }, 250);
      await run.host.start(); current();
    } catch (error) {
      if (this.active === run) await this.stop();
      throw error;
    }
  }
}
