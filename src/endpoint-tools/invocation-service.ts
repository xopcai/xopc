import crypto from 'node:crypto';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { z } from 'zod';
import { REMOTE_BROWSER_CONTROL_TOOL } from '@xopcai/browser-control-contract/remote';
import { REMOTE_COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';

import {
  ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS,
  ENDPOINT_MAX_CONCURRENT_INVOCATIONS,
  canonicalJson,
  assertProviderSchemaBudget,
  DESKTOP_COMMAND_ARGV_BYTES,
  desktopOperationReceiptSchema,
  type DesktopOperationIntent,
  type ProviderOperationIntent,
  type ProviderOperationReceipt,
  type ClientEndpointMessage,
  type EndpointToolContent,
  type EndpointToolDescriptor,
  type EndpointToolErrorCode,
} from '@xopcai/endpoint-tools-protocol';

import { getOrCreateGatewayIdentity } from '../storage/sqlite/gateway-identity-repository.js';
import { recordDesktopOperationIntent, recordDesktopOperationReceipt, getDesktopOperationIntent } from '../storage/sqlite/desktop-operation-repository.js';
import { getDesktopExecutionGrant } from '../storage/sqlite/desktop-execution-repository.js';
import { createLogger } from '../utils/logger.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { appendTranscriptEntry } from '../storage/sqlite/transcript-repository.js';
import { emitSessionTranscriptUpdate } from '../session/transcript-events.js';

import { EndpointRegistry, endpointToolRevision } from './registry.js';
import { EndpointToolPolicy, EndpointToolPolicyError } from './policy.js';
import type { EndpointInvocationScope, EndpointUploadService } from './upload-service.js';

const log = createLogger('EndpointInvocations');

type ToolClientMessage = Exclude<ClientEndpointMessage, { type: `endpoint.${string}` | `provider.${string}` }>;
type PendingState = 'sent' | 'running';
type DeviceInteraction = Extract<ClientEndpointMessage, { type: 'provider.interaction.request' }>['payload'];
type InteractionOrigin = EndpointInvocationScope & { runId: string; targetRef?: string };
type InteractionCheckpoint = {
  origin: InteractionOrigin; endpointId: string; principalId: string; toolName: string; toolRevision: string;
  providerDigest: string; deadlineAt: number; request: DeviceInteraction; requestIds: string[];
  operation?: ProviderOperationIntent;
};

interface PendingInvocation {
  id: string;
  endpointId: string;
  toolName: string;
  descriptor: EndpointToolDescriptor;
  providerDigest?: string;
  resourceKey?: string;
  arguments: Record<string, unknown>;
  deadlineAt: number;
  interactionScope?: EndpointInvocationScope;
  interaction?: DeviceInteraction;
  interactionRequests?: Set<string>;
  interactionOrigin?: InteractionOrigin;
  recovered?: boolean;
  state: PendingState;
  operationQuery?: DesktopOperationIntent;
  providerExecution?: ProviderOperationIntent;
  execution?: { intent: DesktopOperationIntent; connectionInstanceId: string };
  stopTimer?: ReturnType<typeof setTimeout>;
  receiptTimer?: ReturnType<typeof setTimeout>;
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
    recovered?: true;
  }): void;
}

export interface EndpointInvocationServiceOptions {
  authorizeProvider?: (endpointId: string, toolName: string) => void;
  audit?: EndpointInvocationAuditSink;
  uploads?: EndpointUploadService;
  policy?: EndpointToolPolicy;
  authorizeInteractionRecovery?: (origin: InteractionOrigin, endpointId: string) => boolean;
}

export interface EndpointInvocationResult {
  invocationId?: string;
  providerReceipt?: ProviderOperationReceipt;
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
  private readonly interactionCheckpoints = new DurableState<InteractionCheckpoint>('device.interaction-checkpoints');
  private nextInteractionPruneAt = 0;
  private readonly pending = new Map<string, PendingInvocation>();
  private readonly policy: EndpointToolPolicy;
  private readonly ajv = new Ajv2020({ strict: false });
  private readonly validators = new WeakMap<object, ValidateFunction>();

  constructor(
    private readonly registry: EndpointRegistry,
    private readonly options: EndpointInvocationServiceOptions = {},
  ) {
    this.policy = options.policy ?? new EndpointToolPolicy();
    // Match the z.url() format emitted by the Computer model-binding contract.
    this.ajv.addFormat('uri', { type: 'string', validate: (value: string) => z.url().safeParse(value).success });
  }

  private validator(schema: Record<string, unknown>): ValidateFunction {
    const cached = this.validators.get(schema);
    if (cached) return cached;
    // Isolate $id namespaces and let retired contracts be garbage collected.
    const compiler = new Ajv2020({ strict: false, inlineRefs: false });
    compiler.addFormat('uri', { type: 'string', validate: value => z.url().safeParse(value).success });
    const validate = compiler.compile(schema);
    this.validators.set(schema, validate);
    return validate;
  }

  invoke(params: {
    endpointId: string;
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    descriptorRevision: string;
    operationId?: string;
    invocationScope?: EndpointInvocationScope;
    interactionOrigin?: InteractionOrigin;
    signal?: AbortSignal;
    onProgress?: (progress: { message?: string; percent?: number }) => void;
    onTerminal?: PendingInvocation['onTerminal'];
  }): Promise<EndpointInvocationResult> {
    if (params.operationId !== undefined && !z.uuid().safeParse(params.operationId).success) {
      return Promise.reject(new EndpointToolExecutionError('INVALID_ARGUMENTS', 'Invalid stable operation identity', true));
    }
    const endpoint = this.registry.get(params.endpointId);
    if (!endpoint) return Promise.reject(new EndpointToolExecutionError('ENDPOINT_OFFLINE', 'Endpoint is offline', true));
    if ([REMOTE_COMPUTER_CONTROL_TOOL, REMOTE_BROWSER_CONTROL_TOOL].includes(params.toolName) && !endpoint.executionAuthority) {
      return Promise.reject(new EndpointToolExecutionError('PERMISSION_DENIED', 'Remote device control requires independent desktop execution authority', true));
    }
    const tool = this.registry.getTool(params.endpointId, params.toolName);
    if (!tool) return Promise.reject(new EndpointToolExecutionError('TOOL_NOT_FOUND', 'Endpoint tool is unavailable', true));
    try { this.options.authorizeProvider?.(params.endpointId, params.toolName); }
    catch { return Promise.reject(new EndpointToolExecutionError('PERMISSION_DENIED', 'Provider is not admitted or ready', true)); }
    if (tool.revision !== params.descriptorRevision) {
      return Promise.reject(new EndpointToolExecutionError('TOOL_REVISION_MISMATCH', 'Endpoint tool contract changed', true));
    }
    {
      const validateInput = this.validator(tool.descriptor.inputSchema);
      if (!validateInput(params.arguments)) return Promise.reject(new EndpointToolExecutionError('INVALID_ARGUMENTS', 'Invalid endpoint tool arguments', params.toolName === 'desktop.command.run'));
    }
    if (params.toolName.startsWith('mobile.calendar.')) {
      const { startAt, endAt } = params.arguments;
      if (typeof startAt !== 'number' || typeof endAt !== 'number' || endAt <= startAt || endAt - startAt > 7 * 86400000) {
        return Promise.reject(new EndpointToolExecutionError('INVALID_ARGUMENTS', 'Calendar range must be positive and at most seven days', true));
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
        return Promise.reject(new EndpointToolExecutionError('ENDPOINT_NOT_FOREGROUND', error.message, true));
      }
      throw error;
    }
    if (params.signal?.aborted) {
      return Promise.reject(new EndpointToolExecutionError('TOOL_CANCELLED', 'Endpoint tool call was cancelled', true));
    }
    const endpointPending = [...this.pending.values()].filter((item) => item.endpointId === params.endpointId);
    const resourceKey = tool.provider?.resourceId ? JSON.stringify([endpoint.principalId, tool.provider.resourceId]) : undefined;
    if (resourceKey && [...this.pending.values()].some(item => item.resourceKey === resourceKey)) {
      return Promise.reject(new EndpointToolExecutionError('TOOL_BUSY', 'A device resource is already in use', true));
    }
    if (tool.descriptor.sensitivity === 'personal' && tool.descriptor.requiresForeground
      && endpointPending.some(item => item.descriptor.sensitivity === 'personal' && item.descriptor.requiresForeground)) {
      return Promise.reject(new EndpointToolExecutionError('TOOL_BUSY', 'A personal device request is already awaiting user participation', true));
    }
    if (endpointPending.length >= ENDPOINT_MAX_CONCURRENT_INVOCATIONS) {
      return Promise.reject(new EndpointToolExecutionError('TOOL_BUSY', 'Endpoint has reached its invocation limit', true));
    }
    if (endpointPending.filter((item) => item.toolName === params.toolName).length >= tool.descriptor.maxConcurrency) {
      return Promise.reject(new EndpointToolExecutionError('TOOL_BUSY', 'Endpoint tool has reached its invocation limit', true));
    }

    const invocationId = crypto.randomUUID();
    const startedAt = Date.now();
    let execution: PendingInvocation['execution'];
    const deadlineAt = Math.min(startedAt + tool.descriptor.timeoutMs, endpoint.executionAuthority?.expiresAt ?? Infinity);
    if ((params.toolName.startsWith('desktop.workspace.') || ['desktop.command.run', 'desktop.terminal.open'].includes(params.toolName)) && (!endpoint.executionAuthority?.workspaceId
      || params.arguments.workspaceId !== endpoint.executionAuthority.workspaceId)) {
      return Promise.reject(new EndpointToolExecutionError('PROTOCOL_ERROR', 'The selected workspace is not authorized for this device connection', true));
    }
    if (endpoint.executionAuthority && !tool.provider && tool.descriptor.effect !== 'read') {
      try {
        const authority = endpoint.executionAuthority, grant = getDesktopExecutionGrant(authority.deviceId, startedAt);
        if (!params.operationId || !confirmationRequired || !grant?.active || grant.revision !== authority.authorizationRevision
          || grant.grant?.grantId !== authority.grantId || getOrCreateGatewayIdentity().id !== authority.gatewayId) throw new Error('Desktop execution authority is no longer active');
        execution = { intent: recordDesktopOperationIntent({ operationId: params.operationId, gatewayId: authority.gatewayId,
          deviceId: authority.deviceId, tool: params.toolName, ...(authority.workspaceId ? { workspaceId: authority.workspaceId } : {}), argumentHash: crypto.createHash('sha256').update(canonicalJson(params.arguments)).digest('hex'),
          toolRevision: tool.revision, authorizationRevision: authority.authorizationRevision, expiresAt: deadlineAt }, authority.grantId, startedAt),
          connectionInstanceId: authority.connectionInstanceId };
      } catch { return Promise.reject(new EndpointToolExecutionError('PROTOCOL_ERROR', 'Durable desktop intent could not be recorded', true)); }
    }
    let providerExecution: ProviderOperationIntent | undefined;
    if (tool.provider?.durableOperations === 1 && tool.descriptor.effect !== 'read') {
      if (!params.operationId) return Promise.reject(new EndpointToolExecutionError('PROTOCOL_ERROR', 'Durable Provider requires an operation identity', true));
      providerExecution = { operationId: params.operationId, providerDigest: tool.provider.digest, toolRevision: tool.revision,
        argumentsDigest: crypto.createHash('sha256').update(canonicalJson(params.arguments)).digest('hex') };
    }
    let operationQuery: DesktopOperationIntent | undefined;
    if (params.toolName === 'desktop.operation.get_status') {
      const authority = endpoint.executionAuthority, grant = authority && getDesktopExecutionGrant(authority.deviceId, startedAt);
      if (!authority?.operationStatus || !grant?.active || grant.revision !== authority.authorizationRevision || grant.grant?.grantId !== authority.grantId
        || typeof params.arguments.operationId !== 'string') return Promise.reject(new EndpointToolExecutionError('PERMISSION_DENIED', 'Operation status is not authorized', true));
      operationQuery = getDesktopOperationIntent(params.arguments.operationId, authority.deviceId, authority.gatewayId);
      if (!operationQuery) return Promise.reject(new EndpointToolExecutionError('TOOL_NOT_FOUND', 'Operation metadata is not available for this device', true));
    }
    const artifact = tool.provider?.artifactInput && params.invocationScope
      ? this.options.uploads?.bindTransfer(params.arguments[tool.provider.artifactInput], {
        scope: params.invocationScope, endpointId: endpoint.endpointId, connectionId: endpoint.connectionId,
        toolName: params.toolName, providerDigest: tool.provider.digest,
      }, invocationId, deadlineAt) : undefined;
    if (tool.provider?.artifactInput && !artifact) {
      return Promise.reject(new EndpointToolExecutionError('PERMISSION_DENIED', 'Artifact transfer is unavailable for this device, tool or conversation', true));
    }
    const uploadGrant = tool.descriptor.resultKinds.includes('file')
      ? this.options.uploads?.createGrant(invocationId, params.endpointId, startedAt, ['desktop.computer.control', REMOTE_COMPUTER_CONTROL_TOOL, REMOTE_BROWSER_CONTROL_TOOL, 'desktop.screen.capture'].includes(params.toolName) ? 'computer-frame' : params.toolName.startsWith('mobile.') ? 'personal' : 'durable', endpoint.principalId, params.invocationScope)
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
      this.options.uploads?.closeTransfer(invocationId);
      return Promise.reject(error);
    }
    return new Promise<EndpointInvocationResult>((resolve, reject) => {
      const pending: PendingInvocation = {
        id: invocationId,
        endpointId: params.endpointId,
        toolName: params.toolName,
        descriptor: tool.descriptor,
        providerDigest: tool.provider?.digest,
        resourceKey,
        arguments: params.arguments,
        deadlineAt,
        ...(tool.provider?.gatewayFormInput && params.invocationScope ? { interactionScope: params.invocationScope } : {}),
        ...(tool.provider?.gatewayFormInput && params.interactionOrigin && !uploadGrant && !artifact
          && (tool.descriptor.effect === 'read' || providerExecution) ? { interactionOrigin: params.interactionOrigin } : {}),
        state: 'sent',
        ...(execution ? { execution } : {}),
        ...(operationQuery ? { operationQuery } : {}),
        ...(providerExecution ? { providerExecution } : {}),
        receiptTimer: setTimeout(() => {
          this.fail(invocationId, this.error(execution || tool.descriptor.effect !== 'read' ? 'OUTCOME_UNKNOWN' : 'TOOL_TIMEOUT', 'Endpoint did not acknowledge the invocation'));
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
          ...(providerExecution ? { providerExecution } : {}),
          ...(artifact ? { artifact } : {}),
          ...(pending.interactionScope ? { interactionAllowed: true } : {}),
          ...(pending.interactionOrigin ? { interactionRecoverable: true } : {}),
          ...(uploadGrant ? { uploadGrant } : {}),
        });
      } catch {
        this.fail(invocationId, this.error(execution || tool.descriptor.effect !== 'read' ? 'OUTCOME_UNKNOWN' : 'ENDPOINT_DISCONNECTED', 'Endpoint disconnected before acknowledgement'));
      }
    });
  }

  requestInteraction(endpointId: string, request: DeviceInteraction): void {
    const pending = this.pending.get(request.invocationId);
    if (!pending) {
      if (!this.reattachInteraction(endpointId, request)) {
        this.registry.send(endpointId, 'tool.cancel', { invocationId: request.invocationId, reason: 'Original form cannot be recovered' });
      }
      return;
    }
    if (pending.endpointId !== endpointId || pending.state !== 'running') return;
    if (pending.interactionRequests?.has(request.requestId)) return;
    try {
      if (!pending.interactionScope || pending.interaction || (pending.interactionRequests?.size ?? 0) >= 3
        || pending.deadlineAt <= Date.now()) throw new Error('Device interaction is unavailable');
      (pending.interactionRequests ??= new Set()).add(request.requestId);
      if (Buffer.byteLength(JSON.stringify(request.inputSchema)) > 8_192
        || request.inputSchema.type !== 'object') throw new Error('Device interaction is unavailable');
      assertProviderSchemaBudget(request.inputSchema);
      const inputSchema = { ...request.inputSchema, additionalProperties: false };
      this.validator(inputSchema);
      if (pending.interactionOrigin && pending.providerDigest) {
        const endpoint = this.registry.get(endpointId);
        if (!endpoint) throw new Error('Device disconnected');
        const checkpoint: InteractionCheckpoint = { origin: pending.interactionOrigin, endpointId, principalId: endpoint.principalId,
          toolName: pending.toolName, toolRevision: endpointToolRevision(pending.descriptor), providerDigest: pending.providerDigest,
          deadlineAt: pending.deadlineAt, request, requestIds: [...pending.interactionRequests], operation: pending.providerExecution };
        this.pruneInteractionCheckpoints();
        if (!this.interactionCheckpoints.get(pending.id) && this.interactionCheckpoints.values(256).length >= 256) throw new Error('Device interaction capacity reached');
        this.interactionCheckpoints.set(pending.id, checkpoint);
      }
      pending.interaction = { ...request, inputSchema };
      pending.onProgress?.({ message: 'Waiting for device input' });
    } catch {
      this.registry.send(endpointId, 'provider.interaction.response', { invocationId: request.invocationId, requestId: request.requestId, action: 'decline' });
    }
  }

  private reattachInteraction(endpointId: string, request: DeviceInteraction): boolean {
    if (!isXopcDatabaseOpen()) return false;
    const checkpoint = this.interactionCheckpoints.get(request.invocationId);
    const endpoint = this.registry.get(endpointId);
    if (!checkpoint || checkpoint.deadlineAt <= Date.now() || checkpoint.endpointId !== endpointId
      || endpoint?.principalId !== checkpoint.principalId || canonicalJson(checkpoint.request) !== canonicalJson(request)
      || !this.options.authorizeInteractionRecovery?.(checkpoint.origin, endpointId)) return false;
    const tool = this.registry.getTool(endpointId, checkpoint.toolName);
    if (!tool || tool.revision !== checkpoint.toolRevision || tool.provider?.digest !== checkpoint.providerDigest) return false;
    try { this.options.authorizeProvider?.(endpointId, checkpoint.toolName); }
    catch { return false; }
    const resourceKey = tool.provider.resourceId ? JSON.stringify([endpoint.principalId, tool.provider.resourceId]) : undefined;
    this.pending.set(request.invocationId, {
      id: request.invocationId, endpointId, toolName: checkpoint.toolName, descriptor: tool.descriptor, arguments: {},
      providerDigest: checkpoint.providerDigest, resourceKey, state: 'running', deadlineAt: checkpoint.deadlineAt,
      interactionScope: checkpoint.origin, interactionOrigin: checkpoint.origin, recovered: true,
      interaction: { ...request, inputSchema: { ...request.inputSchema, additionalProperties: false } },
      interactionRequests: new Set(checkpoint.requestIds), providerExecution: checkpoint.operation,
      deadlineTimer: setTimeout(() => this.cancel(request.invocationId, 'Recovered device form timed out', 'TOOL_TIMEOUT'), checkpoint.deadlineAt - Date.now()),
      resolve: () => {}, reject: () => {},
    });
    return true;
  }

  listInteractions(scope: EndpointInvocationScope, activeActor = true) {
    this.pruneInteractionCheckpoints();
    return [...this.pending.values()].filter(pending => (activeActor || pending.recovered) && this.interactionMatches(pending, scope)).map(pending => ({
      ...pending.interaction!, endpointId: pending.endpointId, toolName: pending.toolName, deadlineAt: pending.deadlineAt,
    }));
  }

  answerInteraction(scope: EndpointInvocationScope, requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>, activeActor = true): boolean {
    const pending = [...this.pending.values()].find(item => (activeActor || item.recovered) && item.interaction?.requestId === requestId && this.interactionMatches(item, scope));
    if (!pending || !pending.interaction) return false;
    if (action === 'accept' && (!content || !this.validator(pending.interaction.inputSchema)(content))) return false;
    if (action !== 'accept' && content !== undefined) return false;
    try {
      this.options.authorizeProvider?.(pending.endpointId, pending.toolName);
      this.registry.send(pending.endpointId, 'provider.interaction.response', { invocationId: pending.id, requestId, action, ...(content ? { content } : {}) });
      pending.interaction = undefined;
      return true;
    } catch { return false; }
  }

  private interactionMatches(pending: PendingInvocation, scope: EndpointInvocationScope): boolean {
    return Boolean(pending.interaction && pending.deadlineAt > Date.now()
      && (!pending.interactionOrigin || this.options.authorizeInteractionRecovery?.(pending.interactionOrigin, pending.endpointId))
      && pending.interactionScope?.actorPrincipalId === scope.actorPrincipalId && pending.interactionScope.conversationId === scope.conversationId
      && pending.interactionScope.transcriptId === scope.transcriptId);
  }

  handleMessage(endpointId: string, message: ToolClientMessage): void {
    const invocationId = message.payload.invocationId;
    const pending = this.pending.get(invocationId);
    if (!pending || pending.endpointId !== endpointId) return;

    if (['tool.result', 'tool.error', 'tool.cancelled'].includes(message.type)) {
      try { this.verifyExecutionReceipt(pending, message); }
      catch { this.fail(invocationId, this.error(pending.execution || pending.descriptor.effect !== 'read' ? 'OUTCOME_UNKNOWN' : 'PROTOCOL_ERROR', 'Endpoint operation evidence is invalid')); return; }
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
          const validate = this.validator(pending.descriptor.outputSchema);
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
            pending.execution || pending.descriptor.effect !== 'read' ? 'OUTCOME_UNKNOWN' : 'PROTOCOL_ERROR',
            (pending.descriptor.sensitivity === 'personal' && pending.descriptor.effect === 'read') ? 'Invalid personal device result' : error instanceof Error ? error.message : String(error),
          ));
          return;
        }
        this.succeed(invocationId, {
          content: message.payload.content,
          ...(message.payload.providerReceipt ? { providerReceipt: message.payload.providerReceipt } : {}),
          ...(message.payload.details === undefined || (pending.descriptor.sensitivity === 'personal' && pending.descriptor.effect === 'read') ? {} : { details: message.payload.details }),
        });
        return;
      case 'tool.error': {
        const content = message.payload.operationResult?.content[0], value = content?.type === 'json' && content.value && typeof content.value === 'object'
          ? content.value as Record<string, unknown> : undefined;
        const noEffect = pending.toolName === 'desktop.workspace.write' && Boolean(pending.execution)
          && message.payload.operationReceipt?.state === 'failed' && typeof value?.error === 'string'
          && ['WORKSPACE_PATH_INVALID', 'WORKSPACE_PATH_DENIED', 'WORKSPACE_ARGUMENT_INVALID', 'WORKSPACE_FILE_DENIED', 'WORKSPACE_FILE_TOO_LARGE', 'WORKSPACE_VERSION_CONFLICT', 'WORKSPACE_FILE_BUSY'].includes(value.error);
        const code = !pending.execution && pending.descriptor.effect !== 'read'
          && !(pending.descriptor.confirmation === 'always' && message.payload.code === 'USER_DENIED') ? 'OUTCOME_UNKNOWN' : message.payload.code;
        this.fail(invocationId, new EndpointToolExecutionError(code, (pending.descriptor.sensitivity === 'personal' && pending.descriptor.effect === 'read') ? `Personal device request failed: ${message.payload.code}` : message.payload.message, noEffect));
        return;
      }
      case 'tool.cancelled':
        this.fail(invocationId, this.error(!pending.execution && pending.descriptor.effect !== 'read' ? 'OUTCOME_UNKNOWN' : 'TOOL_CANCELLED', 'Endpoint cancelled the tool call'));
    }
  }

  failEndpoint(endpointId: string): void {
    for (const pending of this.pending.values()) {
      if (pending.endpointId === endpointId) {
        this.fail(pending.id, this.error(pending.execution || pending.descriptor.effect !== 'read' ? 'OUTCOME_UNKNOWN' : 'ENDPOINT_DISCONNECTED', 'Endpoint disconnected'), true);
      }
    }
  }

  invalidateContracts(endpointId: string): void {
    for (const pending of this.pending.values()) {
      if (pending.endpointId !== endpointId) continue;
      const tool = this.registry.getTool(endpointId, pending.toolName);
      if (tool?.revision === endpointToolRevision(pending.descriptor) && tool?.provider?.digest === pending.providerDigest) continue;
      try { this.registry.send(endpointId, 'tool.cancel', { invocationId: pending.id, reason: 'Tool contract or authorization changed' }); }
      catch { /* The disconnected endpoint is already unable to receive further work. */ }
      this.fail(pending.id, this.error(pending.descriptor.effect === 'read' ? 'PERMISSION_DENIED' : 'OUTCOME_UNKNOWN',
        'Tool contract or authorization changed during execution'));
    }
  }

  close(): void {
    for (const pending of this.pending.values()) {
      this.fail(pending.id, this.error(pending.execution || pending.descriptor.effect !== 'read' ? 'OUTCOME_UNKNOWN' : 'ENDPOINT_DISCONNECTED', 'Endpoint runtime stopped'), true);
    }
  }

  discardDetachedInteractions(): void {
    this.pruneInteractionCheckpoints(true);
  }

  private pruneInteractionCheckpoints(discardAll = false): void {
    const now = Date.now();
    if (!isXopcDatabaseOpen() || !discardAll && now < this.nextInteractionPruneAt) return;
    this.nextInteractionPruneAt = now + 5_000;
    for (const [id, checkpoint] of this.interactionCheckpoints.entries()) {
      if (!discardAll && (checkpoint.deadlineAt > now || this.pending.has(id))) continue;
      runSqliteWriteTransaction(() => {
        this.markInteractionUnknown(checkpoint.operation);
        this.options.audit?.finished({ id, status: 'failed', errorCode: checkpoint.operation ? 'OUTCOME_UNKNOWN' : 'ENDPOINT_DISCONNECTED',
          errorMessage: 'Device interaction recovery expired or was disabled', completedAt: now });
        this.interactionCheckpoints.delete(id);
      });
    }
  }

  private markInteractionUnknown(operation?: ProviderOperationIntent): void {
    if (!operation) return;
    runSqliteWriteTransaction(db => {
      const changed = db.prepare(`UPDATE capability_operations SET state='unknown', lease_expires_at=NULL
        WHERE operation_id=? AND descriptor_digest=? AND request_digest=? AND recovery_mode='manual' AND state='running'`)
        .run(operation.operationId, operation.providerDigest, operation.argumentsDigest).changes;
      if (changed) db.prepare(`UPDATE capability_invocations SET state='unknown', finished_at=? WHERE operation_id=? AND state='running'`)
        .run(Date.now(), operation.operationId);
    });
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
    if (!pending.execution) this.fail(invocationId, this.error(pending.descriptor.effect === 'read' ? code : 'OUTCOME_UNKNOWN', reason));
  }

  private verifyExecutionReceipt(pending: PendingInvocation, message: ToolClientMessage): void {
    if (message.type !== 'tool.result' && message.type !== 'tool.error' && message.type !== 'tool.cancelled') return;
    const providerReceipt = message.payload.providerReceipt;
    if (pending.providerExecution) {
      if (message.payload.operationReceipt || message.type === 'tool.error' && message.payload.operationResult) throw new Error('Unexpected Desktop evidence');
      if (providerReceipt && canonicalJson(providerReceipt.intent) !== canonicalJson(pending.providerExecution)) throw new Error('Provider operation identity changed');
      if (message.type === 'tool.result') {
        const result = { content: message.payload.content, ...(message.payload.details ? { details: message.payload.details } : {}) };
        if (!providerReceipt || providerReceipt.state !== 'succeeded'
          || providerReceipt.resultDigest !== crypto.createHash('sha256').update(canonicalJson(result)).digest('hex')) throw new Error('Provider result digest mismatch');
      }
      return;
    }
    if (providerReceipt) throw new Error('Unexpected Provider operation evidence');
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
      if (!this.validator(pending.descriptor.outputSchema)(result.content)) throw new Error('Operation result contract mismatch');
    } else if (message.type === 'tool.cancelled') {
      if (parsed.state !== 'stopped' || !parsed.executionStopped) throw new Error('Executor has not stopped');
    } else if (message.payload.code !== 'OUTCOME_UNKNOWN' || parsed.state !== 'unknown') throw new Error('Unexpected operation outcome');
    recordDesktopOperationReceipt(execution.intent, parsed);
  }

  private succeed(invocationId: string, result: EndpointInvocationResult): void {
    const invocation = this.pending.get(invocationId);
    if (invocation?.recovered && invocation.interactionOrigin) {
      const origin = invocation.interactionOrigin;
      try {
        const published = runSqliteWriteTransaction(db => {
          const operation = invocation.providerExecution;
          if (operation) {
            const json = JSON.stringify(result);
            const changed = db.prepare(`UPDATE capability_operations SET state='succeeded', result_json=?, evidence_json=?, lease_expires_at=NULL
              WHERE operation_id=? AND descriptor_digest=? AND request_digest=? AND recovery_mode='manual' AND state IN ('running','unknown')`)
              .run(json, json, operation.operationId, operation.providerDigest, operation.argumentsDigest).changes;
            if (!changed) throw new Error('Recovered operation no longer owns its journal entry');
            db.prepare(`UPDATE capability_invocations SET state='succeeded', finished_at=? WHERE operation_id=? AND state IN ('running','unknown')`)
              .run(Date.now(), operation.operationId);
          }
          this.interactionCheckpoints.delete(invocationId);
          if (!this.options.authorizeInteractionRecovery?.(origin, invocation.endpointId)) return false;
          const content = result.content.map(block => block.type === 'text' ? block.text : block.type === 'json' ? JSON.stringify(block.value) : '').join('\n');
          appendTranscriptEntry(origin.conversationId, { role: 'custom', customType: 'device_interaction_result', display: true,
            content: `Device request completed.\n${content.slice(0, 8192)}`, details: { invocationId }, timestamp: Date.now() }, { transcriptId: origin.transcriptId });
          return true;
        });
        if (published) emitSessionTranscriptUpdate({ conversationId: origin.conversationId });
      } catch {
        this.fail(invocationId, this.error('OUTCOME_UNKNOWN', 'Recovered device result could not be committed'));
        return;
      }
    }
    const pending = this.take(invocationId);
    if (!pending) return;
    this.finishAudit(pending, { id: invocationId, status: 'succeeded', completedAt: Date.now(), ...(pending.recovered ? { recovered: true } : {}) });
    pending.resolve(['desktop.computer.control', REMOTE_COMPUTER_CONTROL_TOOL, REMOTE_BROWSER_CONTROL_TOOL, 'desktop.screen.capture'].includes(pending.toolName) ? { ...result, invocationId } : result);
  }

  private fail(invocationId: string, error: Error, preserveInteraction = false): void {
    const pending = this.take(invocationId, preserveInteraction);
    if (!pending) return;
    if (pending.recovered) {
      try { this.markInteractionUnknown(pending.providerExecution); }
      catch (err) { log.error({ err, invocationId }, 'Could not record interrupted device interaction'); }
    }
    this.abortUploads(invocationId, pending.endpointId, pending.toolName);
    if (!preserveInteraction || !pending.interaction || !pending.interactionOrigin || !this.interactionCheckpoints.get(invocationId)) this.finishAudit(pending, {
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

  private take(invocationId: string, preserveInteraction = false): PendingInvocation | undefined {
    const pending = this.pending.get(invocationId);
    if (!pending) return undefined;
    this.pending.delete(invocationId);
    if (pending.interactionOrigin && !preserveInteraction) {
      try { this.interactionCheckpoints.delete(invocationId); }
      catch (err) { log.error({ err, invocationId }, 'Could not remove device interaction checkpoint'); }
    }
    this.options.uploads?.closeTransfer(invocationId);
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
