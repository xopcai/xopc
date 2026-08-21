import crypto from 'node:crypto';

import {
  ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS,
  ENDPOINT_MAX_CONCURRENT_INVOCATIONS,
  canonicalJson,
  type ClientEndpointMessage,
  type EndpointToolContent,
  type EndpointToolErrorCode,
} from '@xopcai/endpoint-tools-protocol';

import { EndpointRegistry } from './registry.js';
import { EndpointToolPolicy, EndpointToolPolicyError } from './policy.js';
import type { EndpointUploadService } from './upload-service.js';

type ToolClientMessage = Exclude<ClientEndpointMessage, { type: `endpoint.${string}` }>;
type PendingState = 'sent' | 'running';

interface PendingInvocation {
  id: string;
  endpointId: string;
  toolName: string;
  state: PendingState;
  receiptTimer: ReturnType<typeof setTimeout>;
  deadlineTimer: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  onProgress?: (progress: { message?: string; percent?: number }) => void;
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
  content: EndpointToolContent[];
  details?: Record<string, unknown>;
}

export class EndpointToolExecutionError extends Error {
  constructor(
    readonly code: EndpointToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EndpointToolExecutionError';
  }
}

export class EndpointInvocationService {
  private readonly pending = new Map<string, PendingInvocation>();
  private readonly policy: EndpointToolPolicy;

  constructor(
    private readonly registry: EndpointRegistry,
    private readonly options: EndpointInvocationServiceOptions = {},
  ) {
    this.policy = options.policy ?? new EndpointToolPolicy();
  }

  invoke(params: {
    endpointId: string;
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    descriptorRevision: string;
    signal?: AbortSignal;
    onProgress?: (progress: { message?: string; percent?: number }) => void;
  }): Promise<EndpointInvocationResult> {
    const endpoint = this.registry.get(params.endpointId);
    if (!endpoint) return Promise.reject(this.error('ENDPOINT_OFFLINE', 'Endpoint is offline'));
    const tool = this.registry.getTool(params.endpointId, params.toolName);
    if (!tool) return Promise.reject(this.error('TOOL_NOT_FOUND', 'Endpoint tool is unavailable'));
    if (tool.revision !== params.descriptorRevision) {
      return Promise.reject(this.error('TOOL_REVISION_MISMATCH', 'Endpoint tool contract changed'));
    }
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
    if (endpointPending.length >= ENDPOINT_MAX_CONCURRENT_INVOCATIONS) {
      return Promise.reject(this.error('TOOL_BUSY', 'Endpoint has reached its invocation limit'));
    }
    if (endpointPending.filter((item) => item.toolName === params.toolName).length >= tool.descriptor.maxConcurrency) {
      return Promise.reject(this.error('TOOL_BUSY', 'Endpoint tool has reached its invocation limit'));
    }

    const invocationId = crypto.randomUUID();
    const startedAt = Date.now();
    const uploadGrant = tool.descriptor.resultKinds.includes('file')
      ? this.options.uploads?.createGrant(invocationId, params.endpointId, startedAt)
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
        startedAt,
      });
    } catch (error) {
      this.options.uploads?.abort(invocationId);
      return Promise.reject(error);
    }
    return new Promise<EndpointInvocationResult>((resolve, reject) => {
      const pending: PendingInvocation = {
        id: invocationId,
        endpointId: params.endpointId,
        toolName: params.toolName,
        state: 'sent',
        receiptTimer: setTimeout(() => {
          this.fail(invocationId, this.error('TOOL_TIMEOUT', 'Endpoint did not receive the invocation'));
        }, ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS),
        deadlineTimer: setTimeout(() => {
          this.cancel(invocationId, 'Endpoint tool timed out', 'TOOL_TIMEOUT');
        }, tool.descriptor.timeoutMs),
        abortSignal: params.signal,
        onProgress: params.onProgress,
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
          deadlineAt: Date.now() + tool.descriptor.timeoutMs,
          ...(uploadGrant ? { uploadGrant } : {}),
        });
      } catch {
        this.fail(invocationId, this.error('ENDPOINT_DISCONNECTED', 'Endpoint disconnected before invocation'));
      }
    });
  }

  handleMessage(endpointId: string, message: ToolClientMessage): void {
    const invocationId = message.payload.invocationId;
    const pending = this.pending.get(invocationId);
    if (!pending || pending.endpointId !== endpointId) return;

    switch (message.type) {
      case 'tool.received':
        if (pending.state !== 'sent') return;
        pending.state = 'running';
        clearTimeout(pending.receiptTimer);
        return;
      case 'tool.progress':
        if (pending.state !== 'running') return;
        pending.onProgress?.({
          ...(message.payload.message === undefined ? {} : { message: message.payload.message }),
          ...(message.payload.percent === undefined ? {} : { percent: message.payload.percent }),
        });
        return;
      case 'tool.result':
        if (pending.state !== 'running') return;
        try {
          this.options.uploads?.validateAndClose(invocationId, message.payload.content);
        } catch (error) {
          this.fail(invocationId, this.error(
            'PROTOCOL_ERROR',
            error instanceof Error ? error.message : String(error),
          ));
          return;
        }
        this.succeed(invocationId, {
          content: message.payload.content,
          ...(message.payload.details === undefined ? {} : { details: message.payload.details }),
        });
        return;
      case 'tool.error':
        this.fail(invocationId, this.error(message.payload.code, message.payload.message));
        return;
      case 'tool.cancelled':
        this.fail(invocationId, this.error('TOOL_CANCELLED', 'Endpoint cancelled the tool call'));
    }
  }

  failEndpoint(endpointId: string): void {
    for (const pending of this.pending.values()) {
      if (pending.endpointId === endpointId) {
        this.fail(pending.id, this.error('ENDPOINT_DISCONNECTED', 'Endpoint disconnected'));
      }
    }
  }

  close(): void {
    for (const pending of this.pending.values()) {
      this.fail(pending.id, this.error('ENDPOINT_DISCONNECTED', 'Endpoint runtime stopped'));
    }
  }

  private cancel(
    invocationId: string,
    reason: string,
    code: 'TOOL_TIMEOUT' | 'TOOL_CANCELLED',
  ): void {
    const pending = this.pending.get(invocationId);
    if (!pending) return;
    try {
      this.registry.send(pending.endpointId, 'tool.cancel', { invocationId, reason });
    } catch {
      // The local terminal state is authoritative when the endpoint is already gone.
    }
    this.fail(invocationId, this.error(code, reason));
  }

  private succeed(invocationId: string, result: EndpointInvocationResult): void {
    const pending = this.take(invocationId);
    if (!pending) return;
    try {
      this.options.audit?.finished({ id: invocationId, status: 'succeeded', completedAt: Date.now() });
    } finally {
      pending.resolve(result);
    }
  }

  private fail(invocationId: string, error: Error): void {
    const pending = this.take(invocationId);
    if (!pending) return;
    try {
      this.options.uploads?.abort(invocationId);
      this.options.audit?.finished({
        id: invocationId,
        status: 'failed',
        ...(error instanceof EndpointToolExecutionError ? { errorCode: error.code } : {}),
        errorMessage: error.message,
        completedAt: Date.now(),
      });
    } finally {
      pending.reject(error);
    }
  }

  private take(invocationId: string): PendingInvocation | undefined {
    const pending = this.pending.get(invocationId);
    if (!pending) return undefined;
    this.pending.delete(invocationId);
    clearTimeout(pending.receiptTimer);
    clearTimeout(pending.deadlineTimer);
    if (pending.abortSignal && pending.abortHandler) {
      pending.abortSignal.removeEventListener('abort', pending.abortHandler);
    }
    return pending;
  }

  private error(code: EndpointToolErrorCode, message: string): EndpointToolExecutionError {
    return new EndpointToolExecutionError(code, message);
  }
}
