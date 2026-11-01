import { randomUUID } from 'node:crypto';

import { durableEndpointResultSchema, desktopOperationReceiptSchema, serverEndpointMessageSchema,
  type ClientEndpointMessage, type EndpointAvailability, type EndpointToolErrorCode } from '@xopcai/endpoint-tools-protocol';

import { DesktopExecutionSession } from './execution-session.js';
import { DesktopExecutionCatalog } from './execution-catalog.js';
import type { DesktopWorkspaceReadSession } from './workspace-read-session.js';
import { createLogger } from '../../src/utils/logger.js';

const log = createLogger('DesktopWorkspace');

/** Connection-scoped writes only. Registration, signed transport and native grants remain mandatory outside this adapter. */
export class DesktopReliableToolController {
  private sendMessage?: (message: ClientEndpointMessage) => void;
  private closed = false;
  private active?: string;
  private cancelRequested = false;
  constructor(private readonly options: {
    catalog: DesktopExecutionCatalog;
    session: DesktopExecutionSession;
    reads?: DesktopWorkspaceReadSession;
    availability(): EndpointAvailability;
    onTransportFailure?(): void;
  }) {}
  connect(send: (message: ClientEndpointMessage) => void): void {
    if (this.closed || this.sendMessage) throw new Error('DESKTOP_RELIABLE_CONNECTION_INVALID');
    this.sendMessage = send;
  }
  async disconnect() {
    this.closed = true; this.sendMessage = undefined;
    const read = await this.options.reads?.close();
    const write = await this.options.session.close();
    return read?.state === 'unknown' ? { state: 'unknown' as const } : write;
  }
  async handleMessage(input: unknown): Promise<void> {
    if (this.closed || !this.sendMessage) return;
    const message = serverEndpointMessageSchema.parse(input), { invocationId } = message.payload;
    if (message.type === 'tool.cancel') {
      if (this.active === invocationId) { this.cancelRequested = true; await this.options.reads?.cancel(invocationId).catch(() => {}); await this.options.session.cancel(invocationId).catch(() => {}); }
      // The invocation handler emits its one durable outcome; cancel itself never asserts completion.
      return;
    }
    if (message.payload.toolName === 'desktop.operation.get_status') {
      try {
        const payload = message.payload;
        if (!this.options.catalog.revision(payload.toolName) || payload.descriptorRevision !== this.options.catalog.revision(payload.toolName)
          || payload.execution || payload.uploadGrant || payload.confirmationRequired || !payload.operationQuery
          || payload.operationQuery.operationId !== payload.arguments.operationId || this.options.availability() !== 'foreground'
          || !this.options.catalog.deadlineAllowed(payload.toolName, payload.deadlineAt)) throw new Error('DESKTOP_OPERATION_QUERY_INVALID');
        this.options.catalog.validateArguments(payload.toolName, payload.arguments);
        this.send('tool.received', { invocationId });
        const receipt = this.options.session.inspect(payload.operationQuery);
        this.send('tool.result', { invocationId, content: [{ type: 'json', value: { operationId: payload.operationQuery.operationId,
          status: receipt ? 'recorded' : 'not-found', ...(receipt ? { receipt } : {}) } }] });
      } catch { this.error(invocationId, 'PROTOCOL_ERROR', 'Operation status could not be verified'); }
      return;
    }
    if (message.payload.operationQuery) { this.error(invocationId, 'PROTOCOL_ERROR', 'Operation metadata is only accepted by the status tool'); return; }
    if (this.active) { this.error(invocationId, 'TOOL_BUSY', 'A durable operation is already pending'); return; }
    if (['desktop.workspace.read', 'desktop.workspace.list'].includes(message.payload.toolName)) {
      if (!this.options.reads || message.payload.execution || message.payload.uploadGrant || !message.payload.confirmationRequired) {
        this.error(invocationId, 'PROTOCOL_ERROR', 'Native workspace read authority is required'); return;
      }
      this.active = invocationId;
      try {
        this.send('tool.received', { invocationId });
        const result = await this.options.reads.invoke(message.payload);
        this.send('tool.result', { invocationId, ...result });
      } catch (error) {
        log.warn({ err: error, toolName: message.payload.toolName, phase: 'native_workspace_read' }, 'Native workspace read did not complete');
        const denied = error instanceof Error && error.message === 'WORKSPACE_READ_USER_DENIED';
        this.error(invocationId, denied ? 'USER_DENIED' : 'TOOL_EXECUTION_FAILED', 'Workspace read did not complete under its native approval');
      } finally { if (this.active === invocationId) this.active = undefined; }
      return;
    }
    const revision = this.options.catalog.revision(message.payload.toolName);
    if (!revision) { this.error(invocationId, 'TOOL_NOT_FOUND', 'Durable tool is not registered'); return; }
    if (revision !== message.payload.descriptorRevision) { this.error(invocationId, 'TOOL_REVISION_MISMATCH', 'Durable tool contract changed'); return; }
    if (!message.payload.execution || !message.payload.confirmationRequired) { this.error(invocationId, 'PROTOCOL_ERROR', 'Durable operation intent is required'); return; }
    if (this.options.availability() !== 'foreground') { this.error(invocationId, 'ENDPOINT_NOT_FOREGROUND', 'Desktop is not foreground'); return; }
    if (!this.options.catalog.deadlineAllowed(message.payload.toolName, message.payload.deadlineAt)) { this.error(invocationId, 'TOOL_TIMEOUT', 'Durable deadline exceeds its local contract'); return; }
    if (message.payload.uploadGrant) { this.error(invocationId, 'PROTOCOL_ERROR', 'Durable writes do not accept upload grants'); return; }
    try { this.options.catalog.validateArguments(message.payload.toolName, message.payload.arguments); }
    catch { this.error(invocationId, 'INVALID_ARGUMENTS', 'Durable arguments do not match their local contract'); return; }
    this.active = invocationId;
    this.cancelRequested = false;
    try {
      this.send('tool.received', { invocationId });
      if (this.cancelRequested) { this.error(invocationId, 'TOOL_CANCELLED', 'Operation cancelled before execution'); return; }
      const outcome = await this.options.session.invoke(message.payload, { beforeStart: () => {
        if (this.options.availability() !== 'foreground') throw new Error('DESKTOP_EXECUTION_NOT_FOREGROUND');
      } });
      if (this.closed) return;
      const receipt = desktopOperationReceiptSchema.parse(outcome.receipt);
      if (receipt.state === 'succeeded' && !outcome.repeated) {
        const result = durableEndpointResultSchema.parse(outcome.result);
        this.send('tool.result', { invocationId, ...result, operationReceipt: receipt });
      } else if (receipt.state === 'failed' && !outcome.repeated) {
        const result = durableEndpointResultSchema.parse(outcome.result), first = result.content[0];
        const value = first?.type === 'json' && first.value && typeof first.value === 'object' ? first.value as Record<string, unknown> : undefined;
        const workspaceError = message.payload.toolName.startsWith('desktop.workspace.') && first?.type === 'json'
          && typeof value?.error === 'string' && /^WORKSPACE_[A-Z_]{1,80}$/.test(value.error) ? value.error : undefined;
        this.send('tool.error', { invocationId, code: 'TOOL_EXECUTION_FAILED', message: workspaceError ? `Workspace request failed: ${workspaceError}` : 'Executor reported a completed failure',
          operationReceipt: receipt, operationResult: result });
      } else if (receipt.state === 'stopped') this.send('tool.cancelled', { invocationId, operationReceipt: receipt });
      else this.send('tool.error', { invocationId, code: 'OUTCOME_UNKNOWN',
        message: outcome.repeated ? 'Existing operation receipt requires explicit verification; no action was repeated' : 'Operation outcome requires verification', operationReceipt: receipt });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      this.error(invocationId, code === 'DESKTOP_EXECUTION_USER_DENIED' ? 'USER_DENIED'
        : code === 'DESKTOP_EXECUTION_NOT_FOREGROUND' ? 'ENDPOINT_NOT_FOREGROUND'
        : code === 'DESKTOP_EXECUTION_BUSY' ? 'TOOL_BUSY'
          : code === 'DESKTOP_EXECUTION_STOP_UNCONFIRMED' ? 'EXECUTION_STOP_UNCONFIRMED' : 'OUTCOME_UNKNOWN',
      code === 'DESKTOP_EXECUTION_USER_DENIED' ? 'User denied the operation' : 'Operation outcome or authority requires verification');
    } finally { if (this.active === invocationId) this.active = undefined; }
  }
  private error(invocationId: string, code: EndpointToolErrorCode, message: string): void { this.send('tool.error', { invocationId, code, message }); }
  private send<T extends ClientEndpointMessage['type']>(type: T, payload: Extract<ClientEndpointMessage, { type: T }>['payload']): void {
    if (this.closed) return;
    try { this.sendMessage?.({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), type, payload } as ClientEndpointMessage); }
    catch {
      this.closed = true; this.sendMessage = undefined;
      void this.options.session.close().catch(() => {});
      this.options.onTransportFailure?.();
      throw new Error('DESKTOP_EXECUTION_TRANSPORT_FAILED');
    }
  }
}
