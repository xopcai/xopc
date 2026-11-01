import { randomUUID } from 'node:crypto';

import { canonicalJson, type DesktopOperationIntent, type EndpointHelloPayload, type EndpointTurnClaim } from '@xopcai/endpoint-tools-protocol';
import { desktopExecutionGrantSchema, type DesktopExecutionGrant } from '@xopcai/gateway-contract';
import { RealtimeClient, RealtimeConnectionError, RealtimeFrameTooLargeError, type RealtimeWebSocket } from '@xopcai/realtime-client';
import { REALTIME_MAX_CLIENT_FRAME_BYTES, REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import WebSocket from 'ws';

import { verifyDesktopGatewayFrame, type DesktopFrameBinding } from '../../src/endpoint-tools/desktop-frame.js';
import type { DesktopDeviceFrameSigner } from '../../src/endpoint-tools/desktop-device-frame.js';
import type { DesktopDeviceAuth } from './device-auth.js';
import type { DesktopBinding } from './device-identity.js';
import { DesktopExecutionCatalog } from './execution-catalog.js';
import { DesktopExecutionSession } from './execution-session.js';
import { DesktopWorkspaceReadSession, type DesktopWorkspaceReadApproval } from './workspace-read-session.js';
import { DesktopOperationJournal } from './operation-journal.js';
import { DesktopOperationSupervisor, type DesktopExecutionWorker } from './operation-supervisor.js';
import { DesktopReliableToolController } from './reliable-tool-controller.js';
import { DesktopTerminalHostController } from './terminal-host-controller.js';
import { createLogger } from '../../src/utils/logger.js';
const log = createLogger('DesktopExecution');

type State = 'connecting' | 'online' | 'stopped' | 'error';
/** One explicitly approved connection. Network loss stops execution and never renews or replays a grant. */
export class DesktopExecutionHost {
  private readonly grant: DesktopExecutionGrant;
  private stopped = false;
  private stopping?: Promise<Awaited<ReturnType<DesktopExecutionSession['close']>>>;
  private realtime?: RealtimeClient;
  private controller?: DesktopReliableToolController;
  private session?: DesktopExecutionSession;
  private signer?: DesktopDeviceFrameSigner;
  private binding?: DesktopFrameBinding;
  private claim?: EndpointTurnClaim;
  private started = false;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(private readonly options: {
    binding: DesktopBinding; auth: DesktopDeviceAuth; appVersion: string;
    approved: DesktopExecutionGrant; authorizationRevision: number; catalog: DesktopExecutionCatalog; journal: DesktopOperationJournal;
    foreground(): boolean;
    confirm: ConstructorParameters<typeof DesktopExecutionSession>[0]['confirm'];
    confirmRead?(request: DesktopWorkspaceReadApproval, signal: AbortSignal): Promise<boolean>;
    createWorker(tool: string, intent?: DesktopOperationIntent): DesktopExecutionWorker;
    createTerminal?: ConstructorParameters<typeof DesktopTerminalHostController>[0]['createWorker'];
    confirmTerminalInput?: ConstructorParameters<typeof DesktopTerminalHostController>[0]['confirmInput'];
    onState(state: State, error?: string): void;
  }) {
    this.grant = desktopExecutionGrantSchema.parse(JSON.parse(JSON.stringify(options.approved)));
    const descriptors = options.catalog.descriptors();
    if (!Number.isSafeInteger(options.authorizationRevision) || options.authorizationRevision < 0
      || descriptors.length !== Object.keys(this.grant.toolRevisions).length
      || descriptors.some(tool => options.catalog.revision(tool.name) !== this.grant.toolRevisions[tool.name as keyof typeof this.grant.toolRevisions])) throw new Error('DESKTOP_EXECUTION_DENIED');
  }
  origin(): EndpointTurnClaim | undefined { return !this.stopped && this.claim ? { ...this.claim } : undefined; }
  async readyOrigin(): Promise<EndpointTurnClaim | undefined> {
    const claim = this.origin();
    if (!claim || !this.options.foreground()) return;
    this.realtime?.sendEndpointMessage({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(),
      type: 'endpoint.availability_changed', payload: { availability: 'foreground' } });
    const signal = AbortSignal.timeout(2000);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!this.origin() || !this.options.foreground()) return;
        const status = await this.options.auth.endpointRequest('/api/desktop-host/status', 'GET', undefined, this.binding?.deviceId, signal);
        if (status?.endpoints?.some((endpoint: any) => endpoint.endpointId === claim.endpointId && endpoint.availability === 'foreground')) return this.origin();
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } catch { return; }
  }
  /** Retry supervision locally; confirming a stop never resolves an unknown operation outcome. */
  async verifyStopped(): Promise<Awaited<ReturnType<DesktopExecutionSession['close']>>> {
    const previous = await this.stop();
    if (previous.state !== 'unknown') return previous;
    const outcome = await (this.controller?.disconnect() ?? this.session?.close()) ?? { state: 'idle' as const };
    if (outcome.state !== 'unknown') this.stopping = Promise.resolve(outcome);
    return outcome;
  }
  async stop(): Promise<Awaited<ReturnType<DesktopExecutionSession['close']>>> {
    if (this.stopping) return this.stopping;
    this.stopped = true; this.claim = undefined; clearTimeout(this.expiry);
    this.stopping = Promise.resolve().then(async () => {
      try { return await this.controller?.disconnect() ?? { state: 'idle' as const }; }
      finally { this.signer?.close(); this.signer = undefined; this.options.onState('stopped'); }
    });
    this.realtime?.disconnect();
    return this.stopping;
  }
  async start(): Promise<void> {
    if (this.started || this.stopped) throw new Error('DESKTOP_EXECUTION_NOT_STARTABLE');
    this.started = true;
    try {
      const identity = await this.options.auth.endpointIdentity();
      if (this.stopped || this.grant.expiresAt <= Date.now()) throw new Error('DESKTOP_EXECUTION_DENIED');
      const current = await this.options.auth.endpointRequest('/api/desktop-host/execution', 'GET', undefined, identity.deviceId);
      if (this.stopped || !current?.active || current.revision !== this.options.authorizationRevision || canonicalJson(current.grant) !== canonicalJson(this.grant)) throw new Error('DESKTOP_EXECUTION_DENIED');
      const clientId = randomUUID(), endpointId = `${identity.deviceId}:${randomUUID()}`, connectionInstanceId = randomUUID();
      const binding = { gatewayId: this.options.binding.gatewayId, deviceId: identity.deviceId, clientId, connectionInstanceId };
      this.binding = binding;
      const active = () => !this.stopped && Date.now() < this.grant.expiresAt;
      let terminal: DesktopTerminalHostController | undefined;
      const terminalEnabled = Boolean(this.grant.toolRevisions['desktop.terminal.open']);
      if (terminalEnabled && (!this.options.createTerminal || !this.options.confirmTerminalInput)) throw new Error('DESKTOP_TERMINAL_UNSUPPORTED');
      const supervisor = new DesktopOperationSupervisor({ journal: this.options.journal,
        authority: tool => ({ gatewayId: binding.gatewayId, deviceId: binding.deviceId, authorizationRevision: this.options.authorizationRevision,
          toolRevision: this.options.catalog.revision(tool) ?? '', expiresAt: this.grant.expiresAt, active: active() && (!['desktop.command.run', 'desktop.terminal.open'].includes(tool) || this.options.foreground()), ...(this.grant.workspaceId ? { workspaceId: this.grant.workspaceId } : {}) }),
        createWorker: (tool, intent) => tool === 'desktop.terminal.open' ? terminal!.workerFor(intent) : this.options.createWorker(tool, intent), validateResult: this.options.catalog.validateResult });
      this.session = new DesktopExecutionSession({ binding: { ...binding, authorizationRevision: this.options.authorizationRevision }, supervisor, confirm: this.options.confirm });
      const hasFileReads = this.options.catalog.descriptors().some(tool => ['desktop.workspace.list', 'desktop.workspace.read'].includes(tool.name));
      if (hasFileReads && !this.options.confirmRead) throw new Error('DESKTOP_EXECUTION_DENIED');
      const reads = hasFileReads && this.grant.workspaceId && this.options.confirmRead ? new DesktopWorkspaceReadSession({
        gatewayId: binding.gatewayId, deviceId: binding.deviceId, workspaceId: this.grant.workspaceId, expiresAt: this.grant.expiresAt,
        catalog: this.options.catalog, foreground: () => active() && this.options.foreground(), confirm: this.options.confirmRead,
        createWorker: this.options.createWorker, onExecutorStopped: () => { void this.stop(); },
      }) : undefined;
      let controller!: DesktopReliableToolController;
      if (terminalEnabled) terminal = new DesktopTerminalHostController({ binding: { ...binding, authorizationRevision: this.options.authorizationRevision }, session: this.session,
        current: () => active() && this.options.foreground(), createWorker: this.options.createTerminal!, confirmInput: this.options.confirmTerminalInput!,
        confirmRootStopped: async intent => { await this.session!.close(); return this.options.journal.inspect(intent)?.executionStopped === true; },
        emit: (invocationId, event) => client.sendEndpointMessage({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), type: 'terminal.event', payload: { invocationId, event } }) });
      controller = new DesktopReliableToolController({ catalog: this.options.catalog, session: this.session,
        ...(terminal ? { terminal } : {}),
        ...(reads ? { reads } : {}),
        availability: () => this.options.foreground() && active() ? 'foreground' : 'background', onTransportFailure: () => { void this.stop(); } });
      this.controller = controller;
      let helloCreated = false;
      const client = new RealtimeClient({ clientId, clientKind: 'desktop', maxReconnectAttempts: 0, createMessageId: randomUUID,
        getWebSocketUrl: () => this.options.binding.origin.replace(/^http/, 'ws') + '/api/realtime/v1/ws',
        createWebSocket: url => this.socket(url),
        issueTicket: async () => {
          if (!active()) throw new RealtimeConnectionError('DESKTOP_EXECUTION_DENIED', false);
          const ticket = await this.options.auth.endpointRequest('/api/realtime/tickets', 'POST', { clientId, clientKind: 'desktop', protocolVersion: REALTIME_PROTOCOL_VERSION }, identity.deviceId);
          if (!['desktop.device-frames.v1', 'desktop.durable-execution.v1'].every(capability => ticket.realtime?.capabilities?.includes(capability))) throw new RealtimeConnectionError('DESKTOP_EXECUTION_UNSUPPORTED', false);
          if (terminalEnabled && !ticket.realtime?.capabilities?.includes('desktop.terminal.v1')) throw new RealtimeConnectionError('DESKTOP_TERMINAL_UNSUPPORTED', false);
          return { ...ticket, connectionProof: await this.options.auth.connectionProof(ticket.ticket) };
        },
        onStateChange: (state, error) => {
          if (this.stopped) return;
          if (state === 'error') { void this.stop(); this.options.onState('error', error); }
          else this.options.onState(state === 'connected' ? 'online' : 'connecting');
        },
      });
      this.realtime = client;
      client.setEndpoint({ createHello: async () => {
        if (helloCreated || !active()) throw new RealtimeConnectionError('DESKTOP_EXECUTION_DENIED', false);
        helloCreated = true;
        await this.options.auth.endpointRequest('/api/endpoint-tools/principals', 'POST', { principalId: identity.deviceId,
          displayName: identity.displayName, publicKey: identity.publicKey, kind: 'desktop', platform: 'desktop' }, identity.deviceId);
        if (!active()) throw new RealtimeConnectionError('DESKTOP_EXECUTION_DENIED', false);
        const unsigned: EndpointHelloPayload = { principalId: identity.deviceId, endpointId, connectionInstanceId, kind: 'desktop', platform: 'desktop',
          displayName: identity.displayName, appVersion: this.options.appVersion, availability: this.options.foreground() ? 'foreground' : 'background',
          nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: this.options.catalog.descriptors(),
          deviceFrames: { version: 1, authorizationRevision: this.options.authorizationRevision },
          execution: { version: 1, grantId: this.grant.grantId, authorizationRevision: this.options.authorizationRevision, expiresAt: this.grant.expiresAt } };
        if (terminalEnabled) unsigned.terminal = { version: 1 };
        const prepared = await this.options.auth.prepareExecutionEndpoint(unsigned, clientId, this.grant);
        if (!active()) { prepared.signer.close(); throw new RealtimeConnectionError('DESKTOP_EXECUTION_DENIED', false); }
        this.signer = prepared.signer; return prepared.hello;
      }, onReady: ready => {
        if (!active() || ready.endpointId !== endpointId) { void this.stop(); return; }
        this.claim = { type: 'endpoint', endpointId, token: ready.turnToken };
        controller.connect(message => client.sendEndpointMessage(message));
      }, onMessage: message => { if (active() && this.claim) void controller.handleMessage(message).catch(error => {
        log.warn({ err: error, phase: 'device_control_frame', frameType: message.type }, 'Device control frame failed; stopping the executor');
        void this.stop();
      }); },
      onDisconnected: () => { if (!this.stopped) void this.stop(); } });
      this.expiry = setTimeout(() => { void this.stop(); }, Math.max(1, this.grant.expiresAt - Date.now()));
      if (!active()) throw new Error('DESKTOP_EXECUTION_DENIED');
      client.connect();
    } catch (error) { await this.stop(); throw error; }
  }
  private socket(url: string): RealtimeWebSocket {
    if (this.stopped || !this.binding || !this.signer) throw new Error('DESKTOP_EXECUTION_DENIED');
    const binding = { ...this.binding }, signer = this.signer;
    let sequence = 0, ready = false;
    const wire = new WebSocket(url, { maxPayload: 768 * 1024, handshakeTimeout: 15000, followRedirects: false });
    const adapter: RealtimeWebSocket = { get readyState() { return wire.readyState; }, onopen: null, onmessage: null, onerror: null, onclose: null,
      close: (code, reason) => wire.close(code, reason), send: data => {
        if (this.stopped) throw new Error('DESKTOP_EXECUTION_DENIED');
        const message = JSON.parse(data), output = message.kind === 'endpoint.message'
          ? JSON.stringify({ ...message, kind: 'desktop.endpoint.message', payload: JSON.parse(signer.sign(message.payload)) }) : data;
        if (Buffer.byteLength(output) > REALTIME_MAX_CLIENT_FRAME_BYTES) throw new RealtimeFrameTooLargeError(Buffer.byteLength(output), REALTIME_MAX_CLIENT_FRAME_BYTES);
        wire.send(output);
      } };
    wire.onopen = event => adapter.onopen?.(event); wire.onerror = event => adapter.onerror?.(event); wire.onclose = event => adapter.onclose?.(event);
    wire.onmessage = event => {
      if (this.stopped) return;
      try {
        const text = String(event.data), message = JSON.parse(text);
        if (message.kind === 'realtime.ready' || message.kind === 'endpoint.message') {
          const verified = verifyDesktopGatewayFrame(text, binding, this.options.binding.publicKey, sequence); sequence = verified.sequence;
          if (message.kind === 'realtime.ready') {
            if (!['desktop.device-frames.v1', 'desktop.durable-execution.v1'].every(capability => message.payload.negotiatedCapabilities?.includes(capability))) throw new Error('DESKTOP_EXECUTION_UNSUPPORTED');
            ready = true;
          } else if (!ready) throw new Error('DESKTOP_GATEWAY_FRAME_INVALID');
        } else if (message.kind !== 'realtime.pong' && message.kind !== 'realtime.error') throw new Error('DESKTOP_GATEWAY_FRAME_INVALID');
        adapter.onmessage?.({ data: text });
      } catch { void this.stop(); this.options.onState('error', 'DESKTOP_GATEWAY_FRAME_INVALID'); wire.close(4401, 'Invalid desktop Gateway frame'); }
    };
    return adapter;
  }
}
