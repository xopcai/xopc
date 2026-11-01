import { randomUUID } from 'node:crypto';

import { durableEndpointResultSchema, desktopOperationReceiptSchema, serverEndpointMessageSchema,
  type ClientEndpointMessage, type EndpointAvailability, type EndpointToolErrorCode } from '@xopcai/endpoint-tools-protocol';

import { DesktopExecutionSession } from './execution-session.js';
import { DesktopExecutionCatalog } from './execution-catalog.js';

/** Connection-scoped writes only. Registration, signed transport and native grants remain mandatory outside this adapter. */
export class DesktopReliableToolController {
  private sendMessage?: (message: ClientEndpointMessage) => void;
  private closed = false;
  private active?: string;
  private cancelRequested = false;
  constructor(private readonly options: {
    catalog: DesktopExecutionCatalog;
    session: DesktopExecutionSession;
    availability(): EndpointAvailability;
    onTransportFailure?(): void;
  }) {}
  connect(send: (message: ClientEndpointMessage) => void): void {
    if (this.closed || this.sendMessage) throw new Error('DESKTOP_RELIABLE_CONNECTION_INVALID');
    this.sendMessage = send;
  }
  async disconnect() {
    this.closed = true; this.sendMessage = undefined;
    return this.options.session.close();
  }
  async handleMessage(input: unknown): Promise<void> {
    if (this.closed || !this.sendMessage) return;
    const message = serverEndpointMessageSchema.parse(input), { invocationId } = message.payload;
    if (message.type === 'tool.cancel') {
      if (this.active === invocationId) { this.cancelRequested = true; await this.options.session.cancel(invocationId).catch(() => {}); }
      // The invocation handler emits its one durable outcome; cancel itself never asserts completion.
      return;
    }
    if (this.active) { this.error(invocationId, 'TOOL_BUSY', 'A durable operation is already pending'); return; }
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
        this.send('tool.error', { invocationId, code: 'TOOL_EXECUTION_FAILED', message: 'Executor reported a completed failure',
          operationReceipt: receipt, operationResult: durableEndpointResultSchema.parse(outcome.result) });
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
