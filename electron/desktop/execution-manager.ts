import { randomUUID } from 'node:crypto';

import type { DesktopExecutionGrant, SignedDesktopExecutionStop } from '@xopcai/gateway-contract';
import type { DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import type { DesktopTerminalHostController } from './terminal-host-controller.js';
import type { DesktopComputerHostController } from './computer-host-controller.js';
import type { DesktopBrowserHostController } from './browser-host-controller.js';
import { REMOTE_BROWSER_CONTROL_TOOL } from '@xopcai/browser-control-contract/remote';
import { REMOTE_COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';

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
import type { DesktopWorkspaceReadApproval } from './workspace-read-session.js';
import type { DesktopExecutionStopOutbox } from './execution-stop-outbox.js';

type Status = { profileId: string; state: 'authorizing' | 'connecting' | 'online' | 'stop-requested' | 'stopped' | 'stop-unconfirmed' | 'error';
  error?: string; remoteRevocationConfirmed?: boolean; stopReceiptConfirmed?: boolean; resultUnknown?: boolean };
type Run = { binding: DesktopBinding; epoch: number; transport: 'ssh' | 'direct'; abort: AbortController; close(): void;
  deviceId?: string; proposed?: DesktopExecutionGrant; expectedRevision?: number; host?: DesktopExecutionHost;
  lease?: DesktopExecutionLease; journal?: DesktopOperationJournal; watchdog?: ReturnType<typeof setInterval>;
  stopResources?: WorkspaceContext['stopResources']; resourceStop?: Promise<{ confirmed: boolean }>; stopProofSupported?: boolean; stopReceipt?: SignedDesktopExecutionStop };
type WorkspaceContext = { catalog: DesktopExecutionCatalog; stopResources(): Promise<{ confirmed: boolean }> } &
  ({ workspaceId: string; kind?: 'container' } | { kind: 'computer' | 'browser'; workspaceId?: never });

/** Remote-only coordinator. The executor root must be the fixed per-user state root, never a profile or userData directory. */
export class DesktopExecutionManager {
  private active?: Run;
  private status?: Status;
  private stoppingRun?: Run;
  private cleanup: Promise<void> = Promise.resolve();
  private deliveringStops = false;
  constructor(private readonly options: {
    manager: GatewayConnectionPreview; store: DesktopIdentityStore; executorRoot: string; catalog: DesktopExecutionCatalog; appVersion: string;
    stopOutbox?: DesktopExecutionStopOutbox;
    foreground(): boolean;
    consent(binding: DesktopBinding, grant: DesktopExecutionGrant, signal: AbortSignal): Promise<boolean>;
    confirm: ConstructorParameters<typeof DesktopExecutionSession>[0]['confirm'];
    confirmRead?(request: DesktopWorkspaceReadApproval, signal: AbortSignal): Promise<boolean>;
    createWorker(tool: string, intent?: DesktopOperationIntent): DesktopExecutionWorker;
    createTerminal?(...input: [...Parameters<ConstructorParameters<typeof DesktopTerminalHostController>[0]['createWorker']>, DesktopExecutionLease]): ReturnType<ConstructorParameters<typeof DesktopTerminalHostController>[0]['createWorker']>;
    confirmTerminalInput?: ConstructorParameters<typeof DesktopTerminalHostController>[0]['confirmInput'];
    createComputer?: ConstructorParameters<typeof DesktopComputerHostController>[0]['createSession'];
    createBrowser?: ConstructorParameters<typeof DesktopBrowserHostController>[0]['createSession'];
  }) {}
  snapshot(): (Status & { workspaceId?: string; container?: true; terminal?: true; computer?: true; browser?: true }) | undefined { return this.status ? { ...this.status,
    ...(this.active?.proposed?.workspaceId ? { workspaceId: this.active.proposed.workspaceId } : {}),
    ...(this.active?.proposed?.toolRevisions['desktop.command.run'] || this.active?.proposed?.toolRevisions['desktop.terminal.open'] ? { container: true } : {}),
    ...(this.active?.proposed?.toolRevisions['desktop.terminal.open'] ? { terminal: true } : {}),
    ...(this.active?.proposed?.toolRevisions[REMOTE_COMPUTER_CONTROL_TOOL] ? { computer: true } : {}),
    ...(this.active?.proposed?.toolRevisions[REMOTE_BROWSER_CONTROL_TOOL] ? { browser: true } : {}) } : undefined; }
  origin() {
    const run = this.active, current = this.options.manager.snapshot();
    return run && !run.abort.signal.aborted && current.epoch === run.epoch && current.selectedId === run.binding.profileId ? run.host?.origin() : undefined;
  }
  async readyOrigin() {
    const run = this.active; if (!run || !this.origin()) return;
    const origin = await run.host?.readyOrigin();
    return this.active === run && this.origin()?.endpointId === origin?.endpointId ? origin : undefined;
  }
  private async verifyResources(run: Run): Promise<boolean> {
    if (!run.stopResources) return true;
    run.resourceStop ??= Promise.resolve().then(run.stopResources).catch(() => ({ confirmed: false })).then(result => {
      if (!result.confirmed) run.resourceStop = undefined;
      return result;
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return (await Promise.race([run.resourceStop, new Promise<{ confirmed: boolean }>(resolve => { timeout = setTimeout(() => resolve({ confirmed: false }), 3000); })])).confirmed;
    } finally { clearTimeout(timeout); }
  }
  stop(): Promise<void> {
    const run = this.active;
    if (!run || this.stoppingRun === run) return this.cleanup;
    this.stoppingRun = run;
    run.abort.abort(); clearInterval(run.watchdog);
    void run.host?.stop().catch(() => {});
    this.status = { profileId: run.binding.profileId, state: 'stop-requested' };
    this.cleanup = this.cleanup.catch(() => {}).then(async () => {
      if (this.active !== run) return;
      let outcome;
      let resourcesStopped = false;
      try {
        [outcome, resourcesStopped] = await Promise.all([run.host?.verifyStopped() ?? Promise.resolve({ state: 'idle' as const }), this.verifyResources(run)]);
      }
      catch { outcome = { state: 'unknown' as const }; }
      let confirmed = false, stopReceiptConfirmed = false;
      // Revocation uses a fresh transport: the execution lifetime has already been aborted locally.
      const channel = desktopAuthTransport(run.binding, run.transport), client = new DesktopDeviceAuth(run.binding, this.options.store, channel.request);
      try {
        if (run.stopProofSupported && this.options.stopOutbox && run.deviceId && run.proposed && run.expectedRevision !== undefined && run.lease
          && outcome.state !== 'unknown' && resourcesStopped) {
          try {
            run.stopReceipt ??= await client.signExecutionStop({ version: 1, stopId: randomUUID(), gatewayId: run.binding.gatewayId, deviceId: run.deviceId,
              grantId: run.proposed.grantId, authorizationRevision: run.expectedRevision, leaseGeneration: run.lease.generation, executionStopped: true });
            await this.options.stopOutbox.save(run.binding, run.stopReceipt);
          }
          catch { this.status = { profileId: run.binding.profileId, state: 'stop-unconfirmed', error: 'DESKTOP_STOP_RECEIPT_STORAGE_FAILED' }; return; }
          try {
            await client.submitExecutionStop(run.stopReceipt, AbortSignal.timeout(5000));
            stopReceiptConfirmed = true; confirmed = true; await this.options.stopOutbox.confirm(run.stopReceipt);
          } catch { /* Durable stop-only receipt can be submitted later; no operation is replayed. */ }
        }
        if (!confirmed && run.deviceId && run.proposed && run.expectedRevision !== undefined) {
          const response = await client.endpointRequest('/api/desktop-host/execution', 'DELETE',
            { grantId: run.proposed.grantId, expectedRevision: run.expectedRevision }, run.deviceId);
          confirmed = response?.active === false && response?.enabled === false;
        }
      } catch { /* Local stop remains authoritative; remote revocation is explicitly unconfirmed. */ }
      finally { channel.close(); run.close(); }
      if (outcome.state === 'unknown' || !resourcesStopped) {
        this.status = { profileId: run.binding.profileId, state: 'stop-unconfirmed', remoteRevocationConfirmed: confirmed, resultUnknown: true };
        // Keep the journal and OS lease while an executor could still be running.
        return;
      }
      try { run.journal?.close(); run.lease?.close(); }
      catch { this.status = { profileId: run.binding.profileId, state: 'stop-unconfirmed', remoteRevocationConfirmed: confirmed }; return; }
      this.active = undefined;
      this.status = { profileId: run.binding.profileId, state: 'stopped', remoteRevocationConfirmed: confirmed,
        ...(run.stopReceipt ? { stopReceiptConfirmed } : {}), ...(outcome.resultUnknown ? { resultUnknown: true } : {}) };
    }).catch(() => {
      this.status = { profileId: run.binding.profileId, state: 'stop-unconfirmed', resultUnknown: true };
    }).finally(() => { if (this.stoppingRun === run) this.stoppingRun = undefined; });
    return this.cleanup;
  }
  async requireStopped(): Promise<void> {
    await this.stop();
    if (this.active) throw new Error('DESKTOP_EXECUTION_STOP_UNCONFIRMED');
  }
  async flushStopReceipts(epoch: unknown, id: unknown): Promise<void> {
    if (!this.options.stopOutbox) return;
    if (this.active || this.deliveringStops) throw new Error('DESKTOP_OPERATION_BUSY');
    this.deliveringStops = true;
    try { await this.deliverStopReceipts(epoch, id); }
    finally { this.deliveringStops = false; }
  }
  private async deliverStopReceipts(epoch: unknown, id: unknown): Promise<void> {
    if (!this.options.stopOutbox) return;
    await this.cleanup;
    if (this.active) throw new Error('DESKTOP_OPERATION_BUSY');
    const snapshot = this.options.manager.snapshot(), profile = snapshot.profiles.find(profile => profile.id === id);
    if (!isConnectionId(id) || epoch !== snapshot.epoch || id !== snapshot.selectedId || !profile?.identity) throw new Error('STALE_CONNECTION_EPOCH');
    const binding = { profileId: id, origin: profile.origin, ...profile.identity };
    const channel = desktopAuthTransport(binding, profile.transport), client = new DesktopDeviceAuth(binding, this.options.store, channel.request);
    try {
      const result = await this.options.stopOutbox.flush(binding, client);
      const current = this.options.manager.snapshot();
      if (epoch !== current.epoch || id !== current.selectedId) throw new Error('STALE_CONNECTION_EPOCH');
      if (this.status?.profileId === id && this.status.state === 'stopped' && this.status.stopReceiptConfirmed !== undefined) {
        this.status.stopReceiptConfirmed = result.pending === 0;
        if (!result.pending) this.status.remoteRevocationConfirmed = true;
      }
    } finally { channel.close(); }
  }
  async start(epoch: unknown, id: unknown, workspace?: WorkspaceContext): Promise<void> {
    if (this.active || this.deliveringStops) throw new Error('DESKTOP_OPERATION_BUSY');
    const snapshot = this.options.manager.snapshot();
    if (!isConnectionId(id) || epoch !== snapshot.epoch || id !== snapshot.selectedId) throw new Error('STALE_CONNECTION_EPOCH');
    if (!this.options.foreground()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
    await this.cleanup;
    if (this.active || this.deliveringStops) throw new Error('DESKTOP_OPERATION_BUSY');
    if (epoch !== this.options.manager.snapshot().epoch) throw new Error('STALE_CONNECTION_EPOCH');
    const profile = snapshot.profiles.find(profile => profile.id === id);
    if (!profile?.identity) throw new Error('DESKTOP_PINNED_GATEWAY_REQUIRED');
    const binding = { profileId: id, origin: profile.origin, ...profile.identity }, abort = new AbortController();
    const channel = desktopAuthTransport(binding, profile.transport, abort.signal);
    const run: Run = { binding, epoch: epoch as number, transport: profile.transport, abort, close: channel.close, ...(workspace ? { stopResources: workspace.stopResources } : {}) };
    this.active = run; this.status = { profileId: id, state: 'authorizing' };
    const current = () => {
      const snapshot = this.options.manager.snapshot();
      if (this.active !== run || abort.signal.aborted || epoch !== snapshot.epoch || id !== snapshot.selectedId) throw new Error('DESKTOP_OPERATION_CANCELLED');
    };
    try {
      run.lease = new DesktopExecutionLease(this.options.executorRoot); run.journal = new DesktopOperationJournal(run.lease);
      if (run.journal.hasUnknown()) throw new Error('DESKTOP_OPERATION_RECONCILIATION_REQUIRED');
      const client = new DesktopDeviceAuth(binding, this.options.store, channel.request);
      if (this.options.stopOutbox) { await this.options.stopOutbox.flush(binding, client); current(); }
      run.deviceId = (await client.readSelf()).deviceId; current();
      const compatibility = await client.endpointRequest('/api/desktop-host/compatibility', 'GET', undefined, run.deviceId); current();
      if (compatibility?.gatewayId !== binding.gatewayId || compatibility.publicKey !== binding.publicKey || compatibility.capabilities?.reliableExecutionVersion !== 1) throw new Error('DESKTOP_EXECUTION_UNSUPPORTED');
      run.stopProofSupported = compatibility.capabilities?.executionStopVersion === 1;
      if (this.options.stopOutbox && (workspace?.kind === 'computer' || workspace?.kind === 'browser') && !run.stopProofSupported) throw new Error('DESKTOP_EXECUTION_STOP_UNSUPPORTED');
      if (workspace && (workspace.kind === 'browser' ? compatibility.capabilities?.remoteBrowserVersion !== 1 : workspace.kind === 'computer' ? compatibility.capabilities?.remoteComputerVersion !== 1
        : workspace.kind === 'container' ? compatibility.capabilities?.containerCommandVersion !== 1 : compatibility.capabilities?.workspaceExecutionVersion !== 1)) throw new Error('DESKTOP_WORKSPACE_UNSUPPORTED');
      if (workspace?.kind === 'computer' && !workspace.catalog.revision(REMOTE_COMPUTER_CONTROL_TOOL)) throw new Error('DESKTOP_COMPUTER_UNSUPPORTED');
      if (workspace?.kind === 'browser' && !workspace.catalog.revision(REMOTE_BROWSER_CONTROL_TOOL)) throw new Error('DESKTOP_BROWSER_UNSUPPORTED');
      if (workspace?.catalog.revision('desktop.terminal.open') && compatibility.capabilities?.containerTerminalVersion !== 1) throw new Error('DESKTOP_TERMINAL_UNSUPPORTED');
      if (compatibility.capabilities?.operationReviewVersion === 1) {
        const pending = await client.endpointRequest('/api/desktop-host/operations', 'GET', undefined, run.deviceId); current();
        if (!Array.isArray(pending?.items) || pending.items.length) throw new Error('DESKTOP_OPERATION_RECONCILIATION_REQUIRED');
      }
      const catalog = new DesktopExecutionCatalog((workspace?.catalog ?? this.options.catalog).descriptors().filter(tool => tool.name !== 'desktop.operation.get_status' || compatibility.capabilities?.operationStatusVersion === 1));
      const previous = await client.endpointRequest('/api/desktop-host/execution', 'GET', undefined, run.deviceId); current();
      if (previous?.deviceId !== run.deviceId || !Number.isSafeInteger(previous.revision)) throw new Error('DESKTOP_EXECUTION_DENIED');
      const grant: DesktopExecutionGrant = { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 120000,
        toolRevisions: Object.fromEntries(catalog.descriptors().map(tool => [tool.name, catalog.revision(tool.name)!])), ...(workspace?.workspaceId ? { workspaceId: workspace.workspaceId } : {}) };
      if (!await this.options.consent(binding, structuredClone(grant), abort.signal)) throw new Error('DESKTOP_LOCAL_CONSENT_DENIED');
      current(); if (!this.options.foreground()) throw new Error('DESKTOP_LOCAL_UI_REQUIRED');
      // Record the expected revision before POST, so a lost acknowledgement can still be revoked by exact grant identity.
      run.proposed = grant; run.expectedRevision = previous.revision + 1;
      const authorization = await client.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: previous.revision, grant }, run.deviceId); current();
      if (!authorization?.active || authorization.revision !== run.expectedRevision) throw new Error('DESKTOP_EXECUTION_DENIED');
      this.status = { profileId: id, state: 'connecting' };
      run.host = new DesktopExecutionHost({ binding, auth: client, appVersion: this.options.appVersion, approved: grant,
        authorizationRevision: authorization.revision, catalog, journal: run.journal, foreground: this.options.foreground,
        confirm: this.options.confirm, confirmRead: this.options.confirmRead, createWorker: this.options.createWorker,
        ...(this.options.createTerminal ? { createTerminal: (intent, binding, emit) => this.options.createTerminal!(intent, binding, emit, run.lease!) } : {}),
        confirmTerminalInput: this.options.confirmTerminalInput,
        createComputer: this.options.createComputer,
        createBrowser: this.options.createBrowser,
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
