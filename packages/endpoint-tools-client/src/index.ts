import { sha256 } from '@noble/hashes/sha256';
export { EndpointContextPublisher, type EndpointContextPublisherOptions } from './context.js';
import {
  ENDPOINT_PROTOCOL_VERSION,
  canonicalJson,
  assertProviderSchemaBudget,
  endpointToolContentSchema,
  capabilityProviderSchema,
  providerCatalogSchema,
  providerEndpointDescriptor,
  type CapabilityProvider,
  type ProviderTool,
  type ProviderOperationIntent,
  type ProviderOperationReceipt,
  type ProviderState,
  type ClientEndpointMessage,
  type EndpointAvailability,
  type EndpointToolContent,
  type EndpointToolDescriptor,
  type EndpointToolErrorCode,
  type ServerEndpointMessage,
} from '@xopcai/endpoint-tools-protocol';

export interface EndpointToolFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface EndpointToolExecutionResult {
  content: EndpointToolContent[];
  details?: Record<string, unknown>;
  afterSend?: () => void;
}

export interface EndpointToolExecutionContext {
  invocationId: string;
  signal: AbortSignal;
  reportProgress(progress: { message?: string; percent?: number }): void;
  uploadFile(file: EndpointToolFile): Promise<Extract<EndpointToolContent, { type: 'file' }>>;
  readArtifact?(): Promise<Uint8Array>;
  requestInput?(message: string, inputSchema: Record<string, unknown>): Promise<EndpointInteractionResponse>;
}

export type EndpointInteractionResponse = Pick<Extract<ServerEndpointMessage, { type: 'provider.interaction.response' }>['payload'], 'action' | 'content'>;

export interface EndpointToolDefinition {
  descriptor: EndpointToolDescriptor;
  execute(
    args: Record<string, unknown>,
    context: EndpointToolExecutionContext,
  ): Promise<EndpointToolExecutionResult>;
}

export interface CapabilityProviderDefinition extends Omit<CapabilityProvider, 'tools'> {
  tools: Array<{ descriptor: ProviderTool; execute: EndpointToolDefinition['execute'] }>;
  getState?: () => ProviderState['reason'];
}

export interface EndpointToolApprovalRequest {
  invocationId: string;
  descriptor: EndpointToolDescriptor;
  arguments: Record<string, unknown>;
  deadlineAt: number;
  signal: AbortSignal;
}

type ToolInvokeMessage = Extract<ServerEndpointMessage, { type: 'tool.invoke' }>;
export type EndpointToolUploadGrant = ToolInvokeMessage['payload']['uploadGrant'];

export class EndpointToolClientError extends Error {
  constructor(
    readonly code: EndpointToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EndpointToolClientError';
  }
}

export function endpointValueDigest(value: unknown): string {
  return [...sha256(new TextEncoder().encode(canonicalJson(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function endpointToolRevision(descriptor: EndpointToolDescriptor): string { return endpointValueDigest(descriptor); }

export class EndpointToolRegistry {
  private readonly tools = new Map<string, {
    definition: EndpointToolDefinition;
    revision: string;
    provider?: { digest: string; durable: boolean; artifactInput?: string; gatewayFormInput?: 1; resourceId?: string };
  }>();
  private readonly providers = new Map<string, CapabilityProviderDefinition>();
  private readonly listeners = new Set<() => void>();
  private revision = 1;

  constructor(definitions: readonly EndpointToolDefinition[]) {
    for (const definition of definitions) {
      const name = definition.descriptor.name;
      if (this.tools.has(name)) throw new Error(`Duplicate endpoint tool: ${name}`);
      this.tools.set(name, {
        definition,
        revision: endpointToolRevision(definition.descriptor),
      });
    }
  }

  descriptors(): EndpointToolDescriptor[] {
    return [...this.tools.values()].filter(({ definition }) => definition.descriptor.policyId !== 'provider.manifest')
      .map(({ definition }) => definition.descriptor);
  }

  registerProvider(definition: CapabilityProviderDefinition): void {
    const catalog = capabilityProviderSchema.parse({ localId: definition.localId, title: definition.title,
      summary: definition.summary, instructions: definition.instructions, durableOperations: definition.durableOperations,
      gatewayFormInput: definition.gatewayFormInput, tools: definition.tools.map(tool => tool.descriptor) });
    const provider = { digest: endpointValueDigest(JSON.parse(JSON.stringify(catalog))), durable: catalog.durableOperations === 1, gatewayFormInput: catalog.gatewayFormInput };
    const next = new Map(this.tools);
    const previous = this.providers.get(definition.localId);
    if (previous) for (const tool of previous.tools) next.delete(providerEndpointDescriptor(definition.localId, tool.descriptor).name);
    for (const [index, tool] of catalog.tools.entries()) {
      assertProviderSchemaBudget(tool.inputSchema);
      if (tool.outputSchema) assertProviderSchemaBudget(tool.outputSchema);
      const descriptor = providerEndpointDescriptor(catalog.localId, tool);
      if (next.has(descriptor.name)) throw new Error('Provider tool name conflicts with another tool');
      next.set(descriptor.name, { definition: { descriptor, execute: definition.tools[index].execute }, revision: endpointToolRevision(descriptor),
        provider: { ...provider, artifactInput: tool.artifactInput, resourceId: tool.resourceId } });
    }
    providerCatalogSchema.parse({ revision: this.revision + 1, providers: [
      ...[...this.providers.values()].filter(provider => provider.localId !== catalog.localId).map(provider => ({
        localId: provider.localId, title: provider.title, summary: provider.summary, instructions: provider.instructions, durableOperations: provider.durableOperations,
        gatewayFormInput: provider.gatewayFormInput,
        tools: provider.tools.map(tool => tool.descriptor),
      })), catalog,
    ] });
    this.tools.clear();
    for (const [name, tool] of next) this.tools.set(name, tool);
    this.providers.set(definition.localId, { ...definition, tools: definition.tools.map((tool, index) => ({ ...tool, descriptor: catalog.tools[index] })) });
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  removeProvider(localId: string): void {
    const previous = this.providers.get(localId);
    if (!previous) return;
    for (const tool of previous.tools) this.tools.delete(providerEndpointDescriptor(localId, tool.descriptor).name);
    this.providers.delete(localId);
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  providerCatalog() {
    return { revision: this.revision, providers: [...this.providers.values()].map(provider => capabilityProviderSchema.parse({
      localId: provider.localId, title: provider.title, summary: provider.summary, instructions: provider.instructions, durableOperations: provider.durableOperations,
      gatewayFormInput: provider.gatewayFormInput,
      tools: provider.tools.map(tool => tool.descriptor),
    })) };
  }

  providerRevision(): number { return this.revision; }

  providerStates(): Array<{ localId: string; reason: ProviderState['reason'] }> {
    return [...this.providers.values()].map(provider => {
      try { return { localId: provider.localId, reason: provider.getState?.() ?? 'ready' }; }
      catch { return { localId: provider.localId, reason: 'unavailable' as const }; }
    });
  }

  onProvidersChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get(name: string) {
    return this.tools.get(name);
  }
}

export interface ProviderOperationJournal {
  begin(intent: ProviderOperationIntent): Promise<'started' | 'exists'>;
  finish(intent: ProviderOperationIntent, resultDigest?: string): Promise<ProviderOperationReceipt>;
  status(operationId: string): Promise<ProviderOperationReceipt | undefined>;
}

export interface EndpointToolHostControllerOptions {
  onProviderCatalogAck?(ack: Extract<ServerEndpointMessage, { type: 'provider.catalog.ack' }>['payload']): void;
  journal?: ProviderOperationJournal;
  registry: EndpointToolRegistry;
  getAvailability(): EndpointAvailability;
  authorize?(request: EndpointToolApprovalRequest): Promise<void>;
  confirm(request: EndpointToolApprovalRequest): Promise<boolean>;
  uploadFile(grant: EndpointToolUploadGrant, file: EndpointToolFile, context: { signal: AbortSignal; invocationId: string }): Promise<Extract<EndpointToolContent, { type: 'file' }>>;
  downloadArtifact?(artifact: NonNullable<ToolInvokeMessage['payload']['artifact']>, context: { signal: AbortSignal; invocationId: string }): Promise<Uint8Array>;
  createMessageId(): string;
  now?: () => number;
  afterSendDelayMs?: number;
}

interface ActiveInvocation {
  controller: AbortController;
  generation: number;
  providerDigest?: string;
  resumableForm?: boolean;
}

export class EndpointToolHostController {
  private readonly executing = new Map<string, number>();
  private readonly resources = new Set<string>();
  private readonly active = new Map<string, ActiveInvocation>();
  private readonly interactions = new Map<string, { request: Extract<ClientEndpointMessage, { type: 'provider.interaction.request' }>['payload']; complete(response: EndpointInteractionResponse): void }>();
  private readonly now: () => number;
  private sendMessage?: (message: ClientEndpointMessage) => void;
  private generation = 0;
  private providerTimer?: ReturnType<typeof setInterval>;
  private unsubscribeProviders?: () => void;
  private providerSequence = 0;
  private acknowledgedProviderRevision?: number;

  constructor(private readonly options: EndpointToolHostControllerOptions) {
    this.now = options.now ?? Date.now;
  }

  connect(sendMessage: (message: ClientEndpointMessage) => void): void {
    this.disconnect(true);
    this.sendMessage = sendMessage;
    const publish = () => {
      this.send('provider.catalog.replace', this.options.registry.providerCatalog());
    };
    this.unsubscribeProviders = this.options.registry.onProvidersChanged(publish);
    if (this.options.registry.providerCatalog().providers.length) publish();
    this.providerTimer = setInterval(() => this.publishProviderStates(), 15_000);
    (this.providerTimer as unknown as { unref?: () => void }).unref?.();
  }

  disconnect(preserveForms = false): void {
    clearInterval(this.providerTimer);
    this.unsubscribeProviders?.();
    this.unsubscribeProviders = undefined;
    this.generation += 1;
    this.acknowledgedProviderRevision = undefined;
    this.sendMessage = undefined;
    for (const [id, invocation] of this.active) {
      if (preserveForms && invocation.resumableForm && this.interactions.has(id)) continue;
      invocation.controller.abort();
      this.active.delete(id);
    }
  }

  publishAvailability(): void {
    this.send('endpoint.availability_changed', {
      availability: this.options.getAvailability(),
    });
  }

  private publishProviderStates(): void {
    if (this.acknowledgedProviderRevision !== this.options.registry.providerRevision()) return;
    for (const state of this.options.registry.providerStates()) {
      this.send('provider.state.changed', { ...state, catalogRevision: this.options.registry.providerRevision(), sequence: ++this.providerSequence, validForMs: 45_000 });
    }
  }

  async handleMessage(message: ServerEndpointMessage): Promise<void> {
    if (message.type === 'provider.interaction.response') {
      const { invocationId, requestId, action, content } = message.payload;
      const pending = this.interactions.get(invocationId);
      const invocation = this.active.get(invocationId);
      if (invocation && this.isCurrent(invocationId, invocation) && pending?.request.requestId === requestId) pending.complete({ action, content });
      return;
    }
    if (message.type === 'provider.catalog.ack') {
      const ack = message.payload;
      if (!this.sendMessage || ack.revision !== this.options.registry.providerRevision()) return;
      this.acknowledgedProviderRevision = ack.accepted ? ack.revision : undefined;
      if (ack.accepted) {
        this.publishProviderStates();
        for (const [id, form] of this.interactions) {
          const invocation = this.active.get(id);
          if (!invocation?.resumableForm || invocation.generation === this.generation) continue;
          invocation.generation = this.generation;
          this.send('provider.interaction.request', form.request);
        }
      }
      this.options.onProviderCatalogAck?.(ack);
      return;
    }
    if (message.type === 'provider.operation.query') {
      const generation = this.generation;
      const receipt = await this.options.journal?.status(message.payload.operationId).catch(() => undefined);
      if (generation !== this.generation) return;
      this.send('provider.operation.status', { ...message.payload, ...(receipt?.intent.providerDigest === message.payload.providerDigest ? { receipt } : {}) });
      return;
    }
    if (message.type === 'terminal.command') {
      this.sendError(message.payload.invocationId, 'PROTOCOL_ERROR', 'Terminal control requires its dedicated negotiated controller');
      return;
    }
    if (message.type === 'tool.cancel') {
      this.cancel(message.payload.invocationId);
      return;
    }
    await this.invoke(message);
  }

  private async invoke(message: ToolInvokeMessage): Promise<void> {
    if (message.payload.execution || message.payload.operationQuery) {
      this.sendError(message.payload.invocationId, 'PROTOCOL_ERROR', 'Reliable execution requires an explicitly negotiated durable controller');
      return;
    }
    const {
      invocationId,
      toolName,
      arguments: args,
      descriptorRevision,
      confirmationRequired,
      deadlineAt,
      uploadGrant,
      providerExecution,
      artifact,
      interactionAllowed,
      interactionRecoverable,
    } = message.payload;
    if (this.active.has(invocationId)) {
      this.sendError(invocationId, 'PROTOCOL_ERROR', 'Endpoint invocation is already running');
      return;
    }
    this.send('tool.received', { invocationId });
    const registered = this.options.registry.get(toolName);
    if (!registered) {
      this.sendError(invocationId, 'TOOL_NOT_FOUND', 'Endpoint tool is not registered');
      return;
    }
    if (registered.revision !== descriptorRevision
      || registered.provider && this.acknowledgedProviderRevision !== this.options.registry.providerRevision()) {
      this.sendError(invocationId, 'TOOL_REVISION_MISMATCH', 'Endpoint tool contract changed');
      return;
    }
    const descriptor = registered.definition.descriptor;
    if (Boolean(artifact) !== Boolean(registered.provider?.artifactInput) || artifact && !this.options.downloadArtifact) {
      this.sendError(invocationId, 'PERMISSION_DENIED', 'Artifact transfer is not supported by this tool');
      return;
    }
    const durable = registered.provider?.durable && descriptor.effect !== 'read';
    if (Boolean(providerExecution) !== Boolean(durable) || providerExecution && (!this.options.journal
      || providerExecution.providerDigest !== registered.provider?.digest || providerExecution.toolRevision !== registered.revision
      || providerExecution.argumentsDigest !== endpointValueDigest(args))) {
      this.sendError(invocationId, 'PROTOCOL_ERROR', 'Provider execution intent does not match the local contract');
      return;
    }
    const localConfirmationRequired = descriptor.confirmation === 'always';
    if (confirmationRequired !== localConfirmationRequired) {
      this.sendError(invocationId, 'PROTOCOL_ERROR', 'Endpoint confirmation policy mismatch');
      return;
    }

    const resourceId = registered.provider?.resourceId;
    if ((this.executing.get(toolName) ?? 0) >= descriptor.maxConcurrency || resourceId && this.resources.has(resourceId)) {
      this.sendError(invocationId, 'TOOL_BUSY', 'An earlier device execution has not settled');
      return;
    }
    this.executing.set(toolName, (this.executing.get(toolName) ?? 0) + 1);
    if (resourceId) this.resources.add(resourceId);
    const invocation: ActiveInvocation = {
      controller: new AbortController(),
      generation: this.generation,
      providerDigest: registered.provider?.digest,
      resumableForm: interactionRecoverable === true,
    };
    this.active.set(invocationId, invocation);
    let journalStarted = false;
    let providerReceipt: ProviderOperationReceipt | undefined;
    try {
      this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
      const authorizationRequest = {
        invocationId,
        descriptor,
        arguments: args,
        deadlineAt,
        signal: invocation.controller.signal,
      };
      await this.options.authorize?.(authorizationRequest);
      this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
      if (localConfirmationRequired) {
        this.send('tool.progress', { invocationId, message: 'Waiting for approval' });
        const allowed = await this.options.confirm(authorizationRequest);
        this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
        if (!allowed) throw new EndpointToolClientError('USER_DENIED', 'User denied the endpoint tool call');
      }
      if (providerExecution) {
        if (await this.options.journal!.begin(providerExecution) !== 'started') throw new EndpointToolClientError('OUTCOME_UNKNOWN', 'Operation already recorded; check device status');
        journalStarted = true;
        this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
      }
      const result = await registered.definition.execute(args, {
        invocationId,
        signal: invocation.controller.signal,
        reportProgress: (progress) => {
          if (this.isCurrent(invocationId, invocation)) {
            this.send('tool.progress', { invocationId, ...progress });
          }
        },
        uploadFile: (file) => {
          this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
          return this.options.uploadFile(uploadGrant, file, { signal: invocation.controller.signal, invocationId });
        },
        ...(artifact ? { readArtifact: async () => {
          this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
          const bytes = await this.options.downloadArtifact!(artifact, { signal: invocation.controller.signal, invocationId });
          this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
          return bytes;
        } } : {}),
        ...(interactionAllowed && registered.provider?.gatewayFormInput ? { requestInput: (message: string, inputSchema: Record<string, unknown>) => {
          this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
          if (this.interactions.has(invocationId)) throw new Error('A device form is already open');
          const requestId = this.options.createMessageId();
          const signal = invocation.controller.signal;
          return new Promise<EndpointInteractionResponse>(resolve => {
            const cancel = () => complete({ action: 'cancel' });
            const timer = setTimeout(() => invocation.controller.abort(new EndpointToolClientError('TOOL_TIMEOUT', 'Device form timed out')),
              Math.max(0, deadlineAt - this.now()));
            const complete = (response: EndpointInteractionResponse) => {
              clearTimeout(timer);
              this.interactions.delete(invocationId);
              signal.removeEventListener('abort', cancel);
              resolve(response);
            };
            this.interactions.set(invocationId, { request: { invocationId, requestId, message, inputSchema }, complete });
            signal.addEventListener('abort', cancel, { once: true });
            try { this.send('provider.interaction.request', { invocationId, requestId, message, inputSchema }); }
            catch { cancel(); }
          }).then(response => {
            this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
            return response;
          });
        } } : {}),
      });
      const content = endpointToolContentSchema.array().min(1).max(20).parse(result.content);
      if (resourceId && result.afterSend) throw new Error('Resource work must settle before releasing the device');
      if (providerExecution) {
        if (result.afterSend) throw new Error('Journaled provider operations must settle before returning');
        providerReceipt = await this.options.journal!.finish(providerExecution, endpointValueDigest({ content, ...(result.details ? { details: result.details } : {}) }));
      }
      this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
      this.send('tool.result', {
        invocationId,
        content,
        ...(result.details ? { details: result.details } : {}),
        ...(providerReceipt ? { providerReceipt } : {}),
      });
      this.active.delete(invocationId);
      if (result.afterSend) {
        const generation = invocation.generation;
        setTimeout(() => {
          if (
            this.generation === generation
            && this.now() < deadlineAt
            && (!descriptor.requiresForeground || this.options.getAvailability() === 'foreground')
          ) {
            result.afterSend?.();
          }
        }, this.options.afterSendDelayMs ?? 50);
      }
    } catch (error) {
      if (providerExecution && journalStarted && !providerReceipt) providerReceipt = await this.options.journal!.finish(providerExecution).catch(() => undefined);
      if (!this.isCurrent(invocationId, invocation)) return;
      this.active.delete(invocationId);
      if (invocation.controller.signal.aborted) {
        const reason: unknown = invocation.controller.signal.reason;
        if (reason instanceof EndpointToolClientError && reason.code === 'TOOL_TIMEOUT') {
          this.send('tool.error', { invocationId, code: 'TOOL_TIMEOUT', message: reason.message,
            ...(providerReceipt ? { providerReceipt } : {}) });
          return;
        }
        this.send('tool.cancelled', { invocationId, ...(providerReceipt ? { providerReceipt } : {}) });
        return;
      }
      const normalized = this.normalizeError(error);
      if (providerReceipt) this.send('tool.error', { invocationId, code: 'OUTCOME_UNKNOWN', message: normalized.message, providerReceipt });
      else this.sendError(invocationId, normalized.code, normalized.message);
    } finally {
      this.interactions.get(invocationId)?.complete({ action: 'cancel' });
      if (this.active.get(invocationId) === invocation) this.active.delete(invocationId);
      const remaining = (this.executing.get(toolName) ?? 1) - 1;
      if (remaining) this.executing.set(toolName, remaining); else this.executing.delete(toolName);
      if (resourceId) this.resources.delete(resourceId);
    }
  }

  private cancel(invocationId: string): void {
    const invocation = this.active.get(invocationId);
    if (!invocation) return;
    // A cancellation request is not proof that the adapter has stopped. Keep the
    // invocation reserved until its execution promise settles.
    invocation.controller.abort();
  }

  private assertExecutable(
    invocationId: string,
    invocation: ActiveInvocation,
    descriptor: EndpointToolDescriptor,
    deadlineAt: number,
  ): void {
    if (!this.isCurrent(invocationId, invocation) || invocation.controller.signal.aborted) {
      throw new EndpointToolClientError('TOOL_CANCELLED', 'Endpoint tool call was cancelled');
    }
    if (this.now() >= deadlineAt) {
      throw new EndpointToolClientError('TOOL_TIMEOUT', 'Endpoint tool deadline expired');
    }
    const current = this.options.registry.get(descriptor.name);
    if (!current || current.revision !== endpointToolRevision(descriptor) || current.provider?.digest !== invocation.providerDigest
      || current.provider && this.acknowledgedProviderRevision !== this.options.registry.providerRevision()) {
      throw new EndpointToolClientError('TOOL_REVISION_MISMATCH', 'Endpoint tool contract changed during execution');
    }
    if (descriptor.requiresForeground && this.options.getAvailability() !== 'foreground') {
      throw new EndpointToolClientError('ENDPOINT_NOT_FOREGROUND', 'Endpoint is not foreground');
    }
  }

  private isCurrent(invocationId: string, invocation: ActiveInvocation): boolean {
    return this.active.get(invocationId) === invocation
      && invocation.generation === this.generation
      && this.sendMessage !== undefined;
  }

  private normalizeError(error: unknown): EndpointToolClientError {
    if (error instanceof EndpointToolClientError) return error;
    if (error instanceof Error && error.name === 'RealtimeFrameTooLargeError') {
      return new EndpointToolClientError('RESULT_TOO_LARGE', error.message);
    }
    if (error instanceof TypeError) {
      return new EndpointToolClientError('INVALID_ARGUMENTS', error.message);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return new EndpointToolClientError('USER_DENIED', error.message);
    }
    if (error instanceof Error && error.name === 'NotAllowedError') {
      return new EndpointToolClientError('PERMISSION_DENIED', error.message);
    }
    return new EndpointToolClientError(
      'PROTOCOL_ERROR',
      error instanceof Error ? error.message : String(error),
    );
  }

  private sendError(invocationId: string, code: EndpointToolErrorCode, message: string): void {
    this.send('tool.error', { invocationId, code, message });
  }

  private send<T extends ClientEndpointMessage['type']>(
    type: T,
    payload: Extract<ClientEndpointMessage, { type: T }>['payload'],
  ): void {
    this.sendMessage?.({
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: this.options.createMessageId(),
      type,
      sentAt: this.now(),
      payload,
    } as ClientEndpointMessage);
  }
}
