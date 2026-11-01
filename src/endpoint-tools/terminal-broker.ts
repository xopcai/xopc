import { createHash } from 'node:crypto';

import { canonicalJson, desktopTerminalBindingSchema, type DesktopTerminalBinding, type DesktopTerminalEvent, type DesktopTerminalOutput } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import { executeExternalOperation, ExternalEffectNotAppliedError } from '../capabilities/runtime/external-operations.js';
import { getDesktopExecutionGrant } from '../storage/sqlite/desktop-execution-repository.js';
import { getDesktopOperationReceipt } from '../storage/sqlite/desktop-operation-repository.js';
import { EndpointInvocationService, EndpointToolExecutionError } from './invocation-service.js';
import { EndpointRegistry, type EndpointConnectionSnapshot } from './registry.js';

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const controlSchema = z.strictObject({ sessionId: z.uuid(), generation: z.uuid(), action: z.enum(['input', 'read', 'resize', 'close']),
  text: z.string().refine(value => Buffer.byteLength(value) <= 4000).optional(), columns: z.number().int().min(20).max(500).optional(), rows: z.number().int().min(2).max(500).optional() });
type Session = { endpoint: EndpointConnectionSnapshot; key: string; argsHash: string; controller: AbortController;
  binding?: DesktopTerminalBinding; operationId?: string; invocationId?: string; opened: ReturnType<typeof deferred<DesktopTerminalBinding>>;
  root?: Promise<unknown>; closed: boolean; uncertain: boolean; closing: boolean; frames: DesktopTerminalOutput[]; outputSequence: number; inputSequence: number; busy: boolean;
  decoder: TextDecoder;
  pending?: { id: string; sequence?: number; result: ReturnType<typeof deferred<DesktopTerminalEvent>> } };

/** Gateway session router. Root durability outlives the open response; transport ACKs never become execution outcomes. */
export class DesktopTerminalGatewayBroker {
  private readonly sessions = new Map<string, Session>();
  private closed = false;
  constructor(private readonly registry: EndpointRegistry, private readonly invocations: EndpointInvocationService) {}
  private authority(session: Session, allowClosed = false) {
    const endpoint = this.registry.get(session.endpoint.endpointId), original = session.endpoint.executionAuthority;
    const grant = original && getDesktopExecutionGrant(original.deviceId);
    if (this.closed || session.closed && !allowClosed || !endpoint || endpoint.terminalVersion !== 1 || endpoint.connectionId !== session.endpoint.connectionId
      || endpoint.availability !== 'foreground' || !original || !grant?.active || grant.revision !== original.authorizationRevision
      || grant.grant?.grantId !== original.grantId || original.expiresAt <= Date.now()) throw new Error('DESKTOP_TERMINAL_AUTHORITY_INVALID');
    return endpoint;
  }
  private fail(session: Session, reason: string) {
    session.uncertain = true; session.controller.abort();
    session.pending?.result.reject(new Error(reason)); session.pending = undefined;
  }
  async open(input: { endpointId: string; args: Record<string, unknown>; revision: string; key: string; toolCallId: string; signal?: AbortSignal }) {
    input.signal?.throwIfAborted();
    const endpoint = this.registry.get(input.endpointId), tool = this.registry.getTool(input.endpointId, 'desktop.terminal.open');
    if (!endpoint?.executionAuthority || endpoint.terminalVersion !== 1 || tool?.revision !== input.revision) throw new Error('DESKTOP_TERMINAL_NOT_NEGOTIATED');
    const mapKey = digest({ endpointId: input.endpointId, connectionId: endpoint.connectionId, key: input.key });
    let session = this.sessions.get(mapKey);
    if (session) {
      this.authority(session);
      if (session.argsHash !== digest(input.args)) throw new Error('DESKTOP_TERMINAL_INTENT_CONFLICT');
      return { ...await session.opened.promise, operationId: session.operationId, state: 'running', executionStopped: false };
    }
    if (this.sessions.size >= 64) throw new Error('DESKTOP_TERMINAL_SESSION_LIMIT');
    if ([...this.sessions.values()].some(session => session.endpoint.principalId === endpoint.principalId && !session.closed)) throw new Error('DESKTOP_TERMINAL_BUSY');
    session = { endpoint, key: mapKey, argsHash: digest(input.args), controller: new AbortController(), opened: deferred(),
      closed: false, uncertain: false, closing: false, frames: [], outputSequence: 0, inputSequence: 0, busy: false, decoder: new TextDecoder() };
    this.authority(session); this.sessions.set(mapKey, session);
    const current = session, abort = () => { this.fail(current, 'DESKTOP_TERMINAL_OPEN_CANCELLED'); };
    input.signal?.addEventListener('abort', abort, { once: true });
    void current.opened.promise.catch(() => {});
    current.root = executeExternalOperation({ principalId: endpoint.principalId, capabilityId: 'desktop-terminal-root:' + endpoint.endpointId,
      idempotencyKey: input.key, requestDigest: current.argsHash, descriptorDigest: input.revision, surface: 'desktop-terminal', recovery: 'manual', leaseMs: 120000 }, async operationId => {
      current.operationId = operationId;
      try {
        return await this.invocations.invoke({ endpointId: input.endpointId, toolCallId: input.toolCallId, toolName: 'desktop.terminal.open',
          arguments: input.args, descriptorRevision: input.revision, operationId, signal: current.controller.signal,
          onTerminal: (invocationId, event) => { current.invocationId = invocationId; this.event(current, event); } });
      } catch (error) {
        const authority = endpoint.executionAuthority!, receipt = getDesktopOperationReceipt(operationId, authority.deviceId, authority.gatewayId);
        if (current.closing && !current.uncertain && error instanceof EndpointToolExecutionError && error.code === 'TOOL_CANCELLED'
          && receipt?.state === 'stopped' && receipt.executionStopped && receipt.invocationId === current.invocationId) return { closed: true, executionStopped: true, outcome: 'stopped' };
        if (error instanceof EndpointToolExecutionError && (error.confirmedNoEffect || error.code === 'USER_DENIED')) throw new ExternalEffectNotAppliedError(error.message, { cause: error });
        throw error;
      }
    });
    void current.root.then(() => this.finished(current), error => this.finished(current, error));
    try {
      const binding = await current.opened.promise; this.authority(current);
      return { ...binding, operationId: current.operationId, state: 'running', executionStopped: false };
    } finally { input.signal?.removeEventListener('abort', abort); }
  }
  private finished(session: Session, error?: unknown) {
    session.closed = true;
    if (error) session.uncertain = true;
    session.opened.reject(error ?? new Error('DESKTOP_TERMINAL_CLOSED_BEFORE_READY'));
    session.pending?.result.reject(new Error('DESKTOP_TERMINAL_CLOSED')); session.pending = undefined;
  }
  private event(session: Session, event: DesktopTerminalEvent) {
    this.authority(session);
    const binding = desktopTerminalBindingSchema.parse({ sessionId: event.sessionId, generation: event.generation, connectionInstanceId: event.connectionInstanceId });
    if (!session.binding) {
      if (event.event !== 'opened' || event.operationId !== session.operationId || event.sessionId !== session.operationId) throw new Error('DESKTOP_TERMINAL_BINDING_INVALID');
      session.binding = binding; session.opened.resolve(binding); return;
    }
    if (canonicalJson(session.binding) !== canonicalJson(binding)) throw new Error('DESKTOP_TERMINAL_BINDING_INVALID');
    if (event.event === 'output') {
      if (event.sequence !== session.outputSequence + 1 || session.frames.length >= 16 || Buffer.from(event.bytes, 'base64').toString('base64') !== event.bytes) {
        this.fail(session, 'DESKTOP_TERMINAL_OUTPUT_UNKNOWN'); throw new Error('DESKTOP_TERMINAL_OUTPUT_UNKNOWN');
      }
      session.outputSequence = event.sequence; session.frames.push({ ...binding, sequence: event.sequence, bytes: event.bytes }); return;
    }
    if (event.event === 'stream-ended') return;
    const pending = session.pending;
    if (event.event === 'input-ack' && pending?.id === event.inputId && pending.sequence === event.sequence
      || event.event === 'resize-ack' && pending?.id === event.requestId) {
      pending!.result.resolve(event); return;
    }
    this.fail(session, 'DESKTOP_TERMINAL_EVENT_INVALID'); throw new Error('DESKTOP_TERMINAL_EVENT_INVALID');
  }
  async control(input: { endpointId: string; args: Record<string, unknown>; key: string; signal?: AbortSignal }) {
    const args = controlSchema.parse(input.args), session = [...this.sessions.values()].find(session => session.endpoint.endpointId === input.endpointId
      && session.binding?.sessionId === args.sessionId && session.binding.generation === args.generation);
    if (!session?.binding || !session.invocationId) throw new Error('DESKTOP_TERMINAL_UNAVAILABLE');
    this.authority(session, args.action === 'read'); input.signal?.throwIfAborted();
    if (session.busy) throw new Error('DESKTOP_TERMINAL_BUSY');
    const tool = this.registry.getTool(input.endpointId, 'desktop.terminal.control');
    if (!tool) throw new Error('DESKTOP_TERMINAL_NOT_NEGOTIATED');
    session.busy = true;
    try {
      return await executeExternalOperation({ principalId: session.endpoint.principalId, capabilityId: 'desktop-terminal-control:' + args.sessionId,
        idempotencyKey: input.key, requestDigest: digest(args), descriptorDigest: tool.revision, surface: 'desktop-terminal', recovery: 'manual', leaseMs: 60000 }, async requestId => {
        this.authority(session, args.action === 'read'); input.signal?.throwIfAborted();
        if (args.action === 'read') {
          if (args.text !== undefined || args.columns !== undefined || args.rows !== undefined) throw new ExternalEffectNotAppliedError('Invalid terminal read arguments');
          const frames = session.frames.splice(0, 1);
          if (frames.length && !session.closed) this.registry.send(input.endpointId, 'terminal.command', { invocationId: session.invocationId, command: { ...session.binding, action: 'ack', throughSequence: frames.at(-1)!.sequence } });
          const authority = session.endpoint.executionAuthority!;
          const receipt = session.closed && session.operationId ? getDesktopOperationReceipt(session.operationId, authority.deviceId, authority.gatewayId) : undefined;
          return { frames, text: session.decoder.decode(Buffer.concat(frames.map(frame => Buffer.from(frame.bytes, 'base64'))), { stream: !session.closed || session.frames.length > 0 }),
            state: session.closed ? session.uncertain ? 'unknown' : 'closed' : 'running', executionStopped: receipt?.executionStopped === true };
        }
        if (args.action === 'close') {
          session.closing = true;
          this.registry.send(input.endpointId, 'terminal.command', { invocationId: session.invocationId, command: { ...session.binding, action: 'close' } });
          await session.root;
          return { state: 'closed', executionStopped: true };
        }
        const result = deferred<DesktopTerminalEvent>(); void result.promise.catch(() => {});
        if (args.action === 'input') {
          if (typeof args.text !== 'string' || !args.text || args.columns !== undefined || args.rows !== undefined || session.inputSequence >= 1000) throw new ExternalEffectNotAppliedError('Invalid terminal input');
          session.pending = { id: requestId, sequence: ++session.inputSequence, result };
          this.registry.send(input.endpointId, 'terminal.command', { invocationId: session.invocationId,
            command: { ...session.binding, action: 'input', inputId: requestId, sequence: session.inputSequence, bytes: Buffer.from(args.text).toString('base64') } });
        } else {
          if (args.text !== undefined || args.columns === undefined || args.rows === undefined) throw new ExternalEffectNotAppliedError('Invalid terminal resize');
          session.pending = { id: requestId, result };
          this.registry.send(input.endpointId, 'terminal.command', { invocationId: session.invocationId, command: { ...session.binding, action: 'resize', requestId, columns: args.columns, rows: args.rows } });
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => { this.fail(session, 'DESKTOP_TERMINAL_CONTROL_UNKNOWN'); };
        input.signal?.addEventListener('abort', abort, { once: true });
        try {
          const event = await Promise.race([result.promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DESKTOP_TERMINAL_CONTROL_UNKNOWN')), Math.max(1, Math.min(60000, session.endpoint.executionAuthority!.expiresAt - Date.now()))); })]);
          this.authority(session);
          if (event.event === 'input-ack' && event.dispatch === 'unknown') throw new Error('DESKTOP_TERMINAL_CONTROL_UNKNOWN');
          return event;
        } catch (error) { this.fail(session, 'DESKTOP_TERMINAL_CONTROL_UNKNOWN'); throw error; }
        finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); session.pending = undefined; }
      });
    } finally { session.busy = false; }
  }
  close() { this.closed = true; for (const session of this.sessions.values()) if (!session.closed) this.fail(session, 'DESKTOP_TERMINAL_GATEWAY_CLOSED'); }
  async whenStopped() { await Promise.allSettled([...this.sessions.values()].map(session => session.root)); }
}
