import crypto from 'node:crypto';

import Ajv2020 from 'ajv/dist/2020.js';
import { z } from 'zod';
import { REMOTE_COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';

import {
  ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS,
  ENDPOINT_MAX_CONCURRENT_INVOCATIONS,
  canonicalJson,
  DESKTOP_COMMAND_ARGV_BYTES,
  desktopOperationReceiptSchema,
  type DesktopOperationIntent,
  type ClientEndpointMessage,
  type EndpointToolContent,
  type EndpointToolDescriptor,
  type EndpointToolErrorCode,
} from '@xopcai/endpoint-tools-protocol';

import { getOrCreateGatewayIdentity } from '../storage/sqlite/gateway-identity-repository.js';
import { recordDesktopOperationIntent, recordDesktopOperationReceipt, getDesktopOperationIntent } from '../storage/sqlite/desktop-operation-repository.js';
import { getDesktopExecutionGrant } from '../storage/sqlite/desktop-execution-repository.js';
import { createLogger } from '../utils/logger.js';

import { EndpointRegistry } from './registry.js';
import { EndpointToolPolicy, EndpointToolPolicyError } from './policy.js';
import type { EndpointUploadService } from './upload-service.js';

const log = createLogger('EndpointInvocations');

type ToolClientMessage = Exclude<ClientEndpointMessage, { type: `endpoint.${string}` }>;
type PendingState = 'sent' | 'running';

interface PendingInvocation {
  id: string;
  endpointId: string;
  toolName: string;
  descriptor: EndpointToolDescriptor;
  arguments: Record<string, unknown>;
  state: PendingState;
  operationQuery?: DesktopOperationIntent;
  execution?: { intent: DesktopOperationIntent; connectionInstanceId: string };
  stopTimer?: ReturnType<typeof setTimeout>;
  receiptTimer: ReturnType<typeof setTimeout>;
  deadlineTimer: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  onProgress?: (progress: { message?: string; percent?: number }) => void;
  onTerminal?: (invocationId: string, event: Extract<ClientEndpointMessage, { type: 'terminal.event' }>['payload']['event']) => void;
  resolve: (result: EndpointInvocationResult) => void;
  reject: (error: Error) => void;
}

export interface EndpointInvocationAuditSink {
  started(params: {
    id: string;
    principalId: string;
    endpointId: string;
    toolCallId: string;
    toolName: string;
    effect: 'read' | 'write' | 'destructive';
    confirmationRequired: boolean;
    argumentsSha256: string;
    operationId?: string;
    startedAt: number;
  }): void;
  finished(params: {
    id: string;
    status: 'succeeded' | 'failed';
    errorCode?: EndpointToolErrorCode;
    errorMessage?: string;
    completedAt: number;
  }): void;
}

export interface EndpointInvocationServiceOptions {
  audit?: EndpointInvocationAuditSink;
  uploads?: EndpointUploadService;
  policy?: EndpointToolPolicy;
}

export interface EndpointInvocationResult {
  invocationId?: string;
  content: EndpointToolContent[];
  details?: Record<string, unknown>;
}

export class EndpointToolExecutionError extends Error {
  constructor(
    readonly code: EndpointToolErrorCode,
    message: string,
    readonly confirmedNoEffect = false,
  ) {
    super(message);
    this.name = 'EndpointToolExecutionError';
  }
}

export class EndpointInvocationService {
  private readonly pending = new Map<string, PendingInvocation>();
  private readonly policy: EndpointToolPolicy;
  private readonly ajv = new Ajv2020({ allErrors: true, strict: true });

  constructor(
    private readonly registry: EndpointRegistry,
    private readonly options: EndpointInvocationServiceOptions = {},
  ) {
    this.policy = options.policy ?? new EndpointToolPolicy();
    // Match the z.url() format emitted by the Computer model-binding contract.
    this.ajv.addFormat('uri', { type: 'string', validate: (value: string) => z.url().safeParse(value).success });
  }

  invoke(params: {
    endpointId: string;
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    descriptorRevision: string;
    operationId?: string;
    signal?: AbortSignal;
    onProgress?: (progress: { message?: string; percent?: number }) => void;
    onTerminal?: PendingInvocation['onTerminal'];
  }): Promise<EndpointInvocationResult> {
    if (params.operationId !== undefined && !z.uuid().safeParse(params.operationId).success) {
      return Promise.reject(this.error('INVALID_ARGUMENTS', 'Invalid stable operation identity'));
    }
    const endpoint = this.registry.get(params.endpointId);
    if (!endpoint) return Promise.reject(this.error('ENDPOINT_OFFLINE', 'Endpoint is offline'));
    if (params.toolName === REMOTE_COMPUTER_CONTROL_TOOL && !endpoint.executionAuthority) {
      return Promise.reject(new EndpointToolExecutionError('PERMISSION_DENIED', 'Remote Computer control requires independent desktop execution authority', true));
    }
    const tool = this.registry.getTool(params.endpointId, params.toolName);
    if (!tool) return Promise.reject(this.error('TOOL_NOT_FOUND', 'Endpoint tool is unavailable'));
    if (tool.revision !== params.descriptorRevision) {
      return Promise.reject(this.error('TOOL_REVISION_MISMATCH', 'Endpoint tool contract changed'));
    }
    {
      const validateInput = this.ajv.compile(tool.descriptor.inputSchema);
      if (!validateInput(params.arguments)) return Promise.reject(new EndpointToolExecutionError('INVALID_ARGUMENTS', 'Invalid endpoint tool arguments', params.toolName === 'desktop.command.run'));
    }
    if (params.toolName.startsWith('mobile.calendar.')) {
      const { startAt, endAt } = params.arguments;
      if (typeof startAt !== 'number' || typeof endAt !== 'number' || endAt <= startAt || endAt - startAt > 7 * 86400000) {
        return Promise.reject(this.error('INVALID_ARGUMENTS', 'Calendar range must be positive and at most seven days'));
      }
    }
    if (['desktop.command.run', 'desktop.terminal.open'].includes(params.toolName) && (!Array.isArray(params.arguments.argv) || !params.arguments.argv[0]
      || params.arguments.argv.some(value => typeof value !== 'string' || value.includes('\0'))
      || Buffer.byteLength(JSON.stringify(params.arguments.argv)) > DESKTOP_COMMAND_ARGV_BYTES)) return Promise.reject(new EndpointToolExecutionError('INVALID_ARGUMENTS', 'Container argv exceeds its bounded contract', true));
    let confirmationRequired: boolean;
    try {
      confirmationRequired = this.policy.evaluate(tool.descriptor, endpoint.availability).confirmationRequired;
    } catch (error) {
      if (error instanceof EndpointToolPolicyError) {
        return Promise.reject(this.error('ENDPOINT_NOT_FOREGROUND', error.message));
      }
      throw error;
    }
    if (params.signal?.aborted) {
      return Promise.reject(this.error('TOOL_CANCELLED', 'Endpoint tool call was cancelled'));
    }
    const endpointPending = [...this.pending.values()].filter((item) => item.endpointId === params.endpointId);
    if (tool.descriptor.sensitivity === 'personal' && tool.descriptor.requiresForeground
      && endpointPending.some(item => item.descriptor.sensitivity === 'personal' && item.descriptor.requiresForeground)) {
      return Promise.reject(this.error('TOOL_BUSY', 'A personal device request is already awaiting user participation'));
    }
    if (endpointPending.length >= ENDPOINT_MAX_CONCURRENT_INVOCATIONS) {
      return Promise.reject(this.error('TOOL_BUSY', 'Endpoint has reached its invocation limit'));
    }
    if (endpointPending.filter((item) => item.toolName === params.toolName).length >= tool.descriptor.maxConcurrency) {
      return Promise.reject(this.error('TOOL_BUSY', 'Endpoint tool has reached its invocation limit'));
    }

    const invocationId = crypto.randomUUID();
    const startedAt = Date.now();
    let execution: PendingInvocation['execution'];
    const deadlineAt = Math.min(startedAt + tool.descriptor.timeoutMs, endpoint.executionAuthority?.expiresAt ?? Infinity);
    if ((params.toolName.startsWith('desktop.workspace.') || ['desktop.command.run', 'desktop.terminal.open'].includes(params.toolName)) && (!endpoint.executionAuthority?.workspaceId
      || params.arguments.workspaceId !== endpoint.executionAuthority.workspaceId)) {
      return Promise.reject(new EndpointToolExecutionError('PROTOCOL_ERROR', 'The selected workspace is not authorized for this device connection', true));
    }
    if (endpoint.executionAuthority && tool.descriptor.effect !== 'read') {
      try {
        const authority = endpoint.executionAuthority, grant = getDesktopExecutionGrant(authority.deviceId, startedAt);
        if (!params.operationId || !confirmationRequired || !grant?.active || grant.revision !== authority.authorizationRevision
          || grant.grant?.grantId !== authority.grantId || getOrCreateGatewayIdentity().id !== authority.gatewayId) throw new Error('Desktop execution authority is no longer active');
        execution = { intent: recordDesktopOperationIntent({ operationId: params.operationId, gatewayId: authority.gatewayId,
          deviceId: authority.deviceId, tool: params.toolName, ...(authority.workspaceId ? { workspaceId: authority.workspaceId } : {}), argumentHash: crypto.createHash('sha256').update(canonicalJson(params.arguments)).digest('hex'),
          toolRevision: tool.revision, authorizationRevision: authority.authorizationRevision, expiresAt: deadlineAt }, authority.grantId, startedAt),
          connectionInstanceId: authority.connectionInstanceId };
      } catch { return Promise.reject(this.error('PROTOCOL_ERROR', 'Durable desktop intent could not be recorded')); }
    }
    let operationQuery: DesktopOperationIntent | undefined;
    if (params.toolName === 'desktop.operation.get_status') {
      const authority = endpoint.executionAuthority, grant = authority && getDesktopExecutionGrant(authority.deviceId, startedAt);
      if (!authority?.operationStatus || !grant?.active || grant.revision !== authority.authorizationRevision || grant.grant?.grantId !== authority.grantId
        || typeof params.arguments.operationId !== 'string') return Promise.reject(this.error('PERMISSION_DENIED', 'Operation status is not authorized'));
      operationQuery = getDesktopOperationIntent(params.arguments.operationId, authority.deviceId, authority.gatewayId);
      if (!operationQuery) return Promise.reject(this.error('TOOL_NOT_FOUND', 'Operation metadata is not available for this device'));
    }
    const uploadGrant = tool.descriptor.resultKinds.includes('file')
      ? this.options.uploads?.createGrant(invocationId, params.endpointId, startedAt, ['desktop.computer.control', REMOTE_COMPUTER_CONTROL_TOOL, 'desktop.screen.capture'].includes(params.toolName) ? 'computer-frame' : params.toolName.startsWith('mobile.') ? 'personal' : 'durable', endpoint.principalId)
      : undefined;
    try {
      this.options.audit?.started({
        id: invocationId,
        principalId: endpoint.principalId,
        endpointId: params.endpointId,
        toolCallId: params.toolCallId,
        toolName: params.toolName,
        effect: tool.descriptor.effect,
        confirmationRequired,
        argumentsSha256: crypto.createHash('sha256').update(canonicalJson(params.arguments)).digest('hex'),
        ...(params.operationId ? { operationId: params.operationId } : {}),
        startedAt,
      });
    } catch (error) {
      this.abortUploads(invocationId, params.endpointId, params.toolName);
      return Promise.reject(error);
    }
    return new Promise<EndpointInvocationResult>((resolve, reject) => {
      const pending: PendingInvocation = {
        id: invocationId,
        endpointId: params.endpointId,
        toolName: params.toolName,
        descriptor: tool.descriptor,
        arguments: params.arguments,
        state: 'sent',
        ...(execution ? { execution } : {}),
        ...(operationQuery ? { operationQuery } : {}),
        receiptTimer: setTimeout(() => {
          this.fail(invocationId, this.error(execution ? 'OUTCOME_UNKNOWN' : 'TOOL_TIMEOUT', 'Endpoint did not acknowledge the invocation'));
        }, ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS),
        deadlineTimer: setTimeout(() => {
          this.cancel(invocationId, 'Endpoint tool timed out', 'TOOL_TIMEOUT');
        }, Math.max(1, deadlineAt - Date.now())),
        abortSignal: params.signal,
        onProgress: params.onProgress,
        onTerminal: params.onTerminal,
        resolve,
        reject,
      };
      if (params.signal) {
        pending.abortHandler = () => this.cancel(invocationId, 'Agent cancelled the tool call', 'TOOL_CANCELLED');
        params.signal.addEventListener('abort', pending.abortHandler, { once: true });
      }
      this.pending.set(invocationId, pending);
      try {
        this.registry.send(params.endpointId, 'tool.invoke', {
          invocationId,
          toolCallId: params.toolCallId,
          toolName: params.toolName,
          arguments: params.arguments,
          descriptorRevision: params.descriptorRevision,
          confirmationRequired,
          deadlineAt,
          ...(execution ? { execution: execution.intent } : {}),
          ...(operationQuery ? { operationQuery } : {}),
          ...(uploadGrant ? { uploadGrant } : {}),
        });
      } catch {
        this.fail(invocationId, this.error(execution ? 'OUTCOME_UNKNOWN' : 'ENDPOINT_DISCONNECTED', 'Endpoint disconnected before acknowledgement'));
      }
    });
  }

  handleMessage(endpointId: string, message: ToolClientMessage): void {
    const invocationId = message.payload.invocationId;
    const pending = this.pending.get(invocationId);
    if (!pending || pending.endpointId !== endpointId) return;

    if (['tool.result', 'tool.error', 'tool.cancelled'].includes(message.type)) {
      try { this.verifyExecutionReceipt(pending, message); }
      catch { this.fail(invocationId, this.error(pending.execution ? 'OUTCOME_UNKNOWN' : 'PROTOCOL_ERROR', 'Endpoint operation evidence is invalid')); return; }
    }
    switch (message.type) {
      case 'terminal.event':
        if (pending.state !== 'running' || pending.toolName !== 'desktop.terminal.open' || !pending.execution || !pending.onTerminal
          || message.payload.event.connectionInstanceId !== pending.execution.connectionInstanceId) {
          this.fail(invocationId, this.error('PROTOCOL_ERROR', 'Terminal event is outside its running root')); return;
        }
        try { pending.onTerminal(invocationId, message.payload.event); }
        catch { this.cancel(invocationId, 'Terminal event failed its scope check', 'TOOL_CANCELLED'); }
        return;
      case 'tool.received':
        if (pending.state !== 'sent') return;
        pending.state = 'running';
        clearTimeout(pending.receiptTimer);
        return;
      case 'tool.progress':
        if ((pending.descriptor.sensitivity === 'personal' && pending.descriptor.effect === 'read')) return;
        if (pending.state !== 'running') return;
        pending.onProgress?.({
          ...(message.payload.message === undefined ? {} : { message: message.payload.message }),
          ...(message.payload.percent === undefined ? {} : { percent: message.payload.percent }),
        });
        return;
      case 'tool.result':
        if (pending.state !== 'running') return;
        try {
          const validate = this.ajv.compile(pending.descriptor.outputSchema);
          if (!validate(message.payload.content)) {
            throw new Error(`Endpoint result does not match its contract: ${this.ajv.errorsText(validate.errors)}`);
          }
          const reading = message.payload.content[0];
          if (pending.operationQuery) {
            const value = reading?.type === 'json' ? reading.value as { operationId?: string; status?: string; receipt?: unknown } : undefined;
            if (!value || value.operationId !== pending.operationQuery.operationId || message.payload.details !== undefined
              || value.status === 'not-found' && value.receipt !== undefined || value.status === 'recorded'
              && desktopOperationReceiptSchema.parse(value.receipt).operationId !== pending.operationQuery.operationId) throw new Error('Operation status identity changed');
          }
          if (pending.toolName.startsWith('mobile.calendar.') && reading?.type === 'json') {
            const value = reading.value as { startAt: number; endAt: number; events: Array<{ title?: string; startAt: number; endAt: number }> };
            if (value.startAt !== pending.arguments.startAt || value.endAt !== pending.arguments.endAt
              || value.events.some(event => event.endAt <= event.startAt || event.endAt <= value.startAt || event.startAt >= value.endAt)
              || (pending.toolName.endsWith('free_busy') && value.events.some(event => event.title !== undefined))) {
              throw new Error('Calendar result exceeded the approved scope');
            }
          }
          if (pending.toolName === 'mobile.contacts.pick' && reading?.type === 'json' && pending.arguments.field) {
            const value = reading.value as { phones: string[]; emails: string[] };
            if ((pending.arguments.field === 'phone' && (value.phones.length > 1 || value.emails.length))
              || (pending.arguments.field === 'email' && (value.emails.length > 1 || value.phones.length))) {
              throw new Error('Contact result exceeded the selected field');
            }
          }
          this.options.uploads?.validateAndClose(invocationId, message.payload.content);
        } catch (error) {
          this.fail(invocationId, this.error(
            pending.execution ? 'OUTCOME_UNKNOWN' : 'PROTOCOL_ERROR',
            (pending.descriptor.sensitivity === 'personal' && pending.descriptor.effect === 'read') ? 'Invalid personal device result' : error instanceof Error ? error.message : String(error),
          ));
          return;
        }
        this.succeed(invocationId, {
          content: message.payload.content,
          ...(message.payload.details === undefined || (pending.descriptor.sensitivity === 'personal' && pending.descriptor.effect === 'read') ? {} : { details: message.payload.details }),
        });
        return;
      case 'tool.error': {
        const content = message.payload.operationResult?.content[0], value = content?.type === 'json' && content.value && typeof content.value === 'object'
          ? content.value as Record<string, unknown> : undefined;
        const noEffect = pending.toolName === 'desktop.workspace.write' && Boolean(pending.execution)
          && message.payload.operationReceipt?.state === 'failed' && typeof value?.error === 'string'
          && ['WORKSPACE_PATH_INVALID', 'WORKSPACE_PATH_DENIED', 'WORKSPACE_ARGUMENT_INVALID', 'WORKSPACE_FILE_DENIED', 'WORKSPACE_FILE_TOO_LARGE', 'WORKSPACE_VERSION_CONFLICT', 'WORKSPACE_FILE_BUSY'].includes(value.error);
        this.fail(invocationId, new EndpointToolExecutionError(message.payload.code, (pending.descriptor.sensitivity === 'personal' && pending.descriptor.effect === 'read') ? `Personal device request failed: ${message.payload.code}` : message.payload.message, noEffect));
        return;
      }
      case 'tool.cancelled':
        this.fail(invocationId, this.error('TOOL_CANCELLED', 'Endpoint cancelled the tool call'));
    }
  }

  failEndpoint(endpointId: string): void {
    for (const pending of this.pending.values()) {
      if (pending.endpointId === endpointId) {
        this.fail(pending.id, this.error(pending.execution ? 'OUTCOME_UNKNOWN' : 'ENDPOINT_DISCONNECTED', 'Endpoint disconnected'));
      }
    }
  }

  close(): void {
    for (const pending of this.pending.values()) {
      this.fail(pending.id, this.error(pending.execution ? 'OUTCOME_UNKNOWN' : 'ENDPOINT_DISCONNECTED', 'Endpoint runtime stopped'));
    }
  }

  private cancel(
    invocationId: string,
    reason: string,
    code: 'TOOL_TIMEOUT' | 'TOOL_CANCELLED',
  ): void {
    const pending = this.pending.get(invocationId);
    if (!pending) return;
    if (pending.execution && pending.stopTimer) return;
    if (pending.execution) {
      clearTimeout(pending.receiptTimer);
      clearTimeout(pending.deadlineTimer);
      pending.stopTimer = setTimeout(() => this.fail(invocationId, this.error('OUTCOME_UNKNOWN', 'Desktop stop could not be confirmed')), 3000);
    }
    try {
      this.registry.send(pending.endpointId, 'tool.cancel', { invocationId, reason });
    } catch {
      // The local terminal state is authoritative when the endpoint is already gone.
    }
    if (!pending.execution) this.fail(invocationId, this.error(code, reason));
  }

  private verifyExecutionReceipt(pending: PendingInvocation, message: ToolClientMessage): void {
    if (message.type !== 'tool.result' && message.type !== 'tool.error' && message.type !== 'tool.cancelled') return;
    const receipt = message.payload.operationReceipt;
    if (!pending.execution) {
      if (receipt || message.type === 'tool.error' && message.payload.operationResult) throw new Error('Unexpected execution evidence');
      return;
    }
    // A signed denial before recording an operation proves that this particular attempt applied no effect.
    if (!receipt && message.type === 'tool.error' && message.payload.code === 'USER_DENIED') return;
    const parsed = desktopOperationReceiptSchema.parse(receipt), execution = pending.execution;
    if (parsed.operationId !== execution.intent.operationId || parsed.invocationId !== pending.id
      || parsed.connectionInstanceId !== execution.connectionInstanceId) throw new Error('Operation attempt changed');
    if (message.type === 'tool.result' || message.type === 'tool.error' && message.payload.code === 'TOOL_EXECUTION_FAILED') {
      const result = message.type === 'tool.result' ? { content: message.payload.content,
        ...(message.payload.details === undefined ? {} : { details: message.payload.details }) } : message.payload.operationResult;
      const expectedState = message.type === 'tool.result' ? 'succeeded' : 'failed';
      if (!result || parsed.state !== expectedState || !parsed.executionStopped
        || parsed.resultHash !== crypto.createHash('sha256').update(canonicalJson(result)).digest('hex')) throw new Error('Operation result hash mismatch');
      if (!this.ajv.compile(pending.descriptor.outputSchema)(result.content)) throw new Error('Operation result contract mismatch');
    } else if (message.type === 'tool.cancelled') {
      if (parsed.state !== 'stopped' || !parsed.executionStopped) throw new Error('Executor has not stopped');
    } else if (message.payload.code !== 'OUTCOME_UNKNOWN' || parsed.state !== 'unknown') throw new Error('Unexpected operation outcome');
    recordDesktopOperationReceipt(execution.intent, parsed);
  }

  private succeed(invocationId: string, result: EndpointInvocationResult): void {
    const pending = this.take(invocationId);
    if (!pending) return;
    this.finishAudit(pending, { id: invocationId, status: 'succeeded', completedAt: Date.now() });
    pending.resolve(['desktop.computer.control', REMOTE_COMPUTER_CONTROL_TOOL, 'desktop.screen.capture'].includes(pending.toolName) ? { ...result, invocationId } : result);
  }

  private fail(invocationId: string, error: Error): void {
    const pending = this.take(invocationId);
    if (!pending) return;
    this.abortUploads(invocationId, pending.endpointId, pending.toolName);
    this.finishAudit(pending, {
      id: invocationId,
      status: 'failed',
      ...(error instanceof EndpointToolExecutionError ? { errorCode: error.code } : {}),
      errorMessage: error.message,
      completedAt: Date.now(),
    });
    pending.reject(error);
  }

  // Completion also runs from timers and abort listeners, outside the caller's try/catch.
  private finishAudit(
    pending: PendingInvocation,
    result: Parameters<EndpointInvocationAuditSink['finished']>[0],
  ): void {
    try {
      this.options.audit?.finished(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({
        err, errorMessage, invocationId: pending.id, endpointId: pending.endpointId,
        toolName: pending.toolName, phase: 'audit_finish', status: result.status,
      }, `Endpoint invocation audit failed: ${errorMessage}`);
    }
  }

  private abortUploads(invocationId: string, endpointId: string, toolName: string): void {
    try {
      this.options.uploads?.abort(invocationId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err, errorMessage, invocationId, endpointId, toolName, phase: 'upload_abort' },
        `Endpoint upload cleanup failed: ${errorMessage}`);
    }
  }

  private take(invocationId: string): PendingInvocation | undefined {
    const pending = this.pending.get(invocationId);
    if (!pending) return undefined;
    this.pending.delete(invocationId);
    clearTimeout(pending.receiptTimer);
    clearTimeout(pending.deadlineTimer);
    clearTimeout(pending.stopTimer);
    if (pending.abortSignal && pending.abortHandler) {
      pending.abortSignal.removeEventListener('abort', pending.abortHandler);
    }
    return pending;
  }

  private error(code: EndpointToolErrorCode, message: string): EndpointToolExecutionError {
    return new EndpointToolExecutionError(code, message);
  }
}
