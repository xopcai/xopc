import { sha256 } from '@noble/hashes/sha256';
import {
  ENDPOINT_PROTOCOL_VERSION,
  canonicalJson,
  endpointToolContentSchema,
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
}

export interface EndpointToolDefinition {
  descriptor: EndpointToolDescriptor;
  execute(
    args: Record<string, unknown>,
    context: EndpointToolExecutionContext,
  ): Promise<EndpointToolExecutionResult>;
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

export function endpointToolRevision(descriptor: EndpointToolDescriptor): string {
  return [...sha256(new TextEncoder().encode(canonicalJson(descriptor)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export class EndpointToolRegistry {
  private readonly tools = new Map<string, {
    definition: EndpointToolDefinition;
    revision: string;
  }>();

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
    return [...this.tools.values()].map(({ definition }) => definition.descriptor);
  }

  get(name: string) {
    return this.tools.get(name);
  }
}

export interface EndpointToolHostControllerOptions {
  registry: EndpointToolRegistry;
  getAvailability(): EndpointAvailability;
  confirm(request: EndpointToolApprovalRequest): Promise<boolean>;
  uploadFile(grant: EndpointToolUploadGrant, file: EndpointToolFile): Promise<Extract<EndpointToolContent, { type: 'file' }>>;
  createMessageId(): string;
  now?: () => number;
  afterSendDelayMs?: number;
}

interface ActiveInvocation {
  controller: AbortController;
  generation: number;
}

export class EndpointToolHostController {
  private readonly active = new Map<string, ActiveInvocation>();
  private readonly now: () => number;
  private sendMessage?: (message: ClientEndpointMessage) => void;
  private generation = 0;

  constructor(private readonly options: EndpointToolHostControllerOptions) {
    this.now = options.now ?? Date.now;
  }

  connect(sendMessage: (message: ClientEndpointMessage) => void): void {
    this.disconnect();
    this.sendMessage = sendMessage;
  }

  disconnect(): void {
    this.generation += 1;
    this.sendMessage = undefined;
    for (const invocation of this.active.values()) invocation.controller.abort();
    this.active.clear();
  }

  publishAvailability(): void {
    this.send('endpoint.availability_changed', {
      availability: this.options.getAvailability(),
    });
  }

  async handleMessage(message: ServerEndpointMessage): Promise<void> {
    if (message.type === 'tool.cancel') {
      this.cancel(message.payload.invocationId);
      return;
    }
    await this.invoke(message);
  }

  private async invoke(message: ToolInvokeMessage): Promise<void> {
    const {
      invocationId,
      toolName,
      arguments: args,
      descriptorRevision,
      confirmationRequired,
      deadlineAt,
      uploadGrant,
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
    if (registered.revision !== descriptorRevision) {
      this.sendError(invocationId, 'TOOL_REVISION_MISMATCH', 'Endpoint tool contract changed');
      return;
    }
    const descriptor = registered.definition.descriptor;
    const localConfirmationRequired = descriptor.confirmation === 'always' || descriptor.effect !== 'read';
    if (confirmationRequired !== localConfirmationRequired) {
      this.sendError(invocationId, 'PROTOCOL_ERROR', 'Endpoint confirmation policy mismatch');
      return;
    }

    const invocation: ActiveInvocation = {
      controller: new AbortController(),
      generation: this.generation,
    };
    this.active.set(invocationId, invocation);
    try {
      this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
      if (localConfirmationRequired) {
        this.send('tool.progress', { invocationId, message: 'Waiting for approval' });
        const allowed = await this.options.confirm({
          invocationId,
          descriptor,
          arguments: args,
          deadlineAt,
          signal: invocation.controller.signal,
        });
        this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
        if (!allowed) throw new EndpointToolClientError('USER_DENIED', 'User denied the endpoint tool call');
      }
      const result = await registered.definition.execute(args, {
        invocationId,
        signal: invocation.controller.signal,
        reportProgress: (progress) => {
          if (this.isCurrent(invocationId, invocation)) {
            this.send('tool.progress', { invocationId, ...progress });
          }
        },
        uploadFile: (file) => this.options.uploadFile(uploadGrant, file),
      });
      this.assertExecutable(invocationId, invocation, descriptor, deadlineAt);
      const content = endpointToolContentSchema.array().min(1).max(20).parse(result.content);
      this.send('tool.result', {
        invocationId,
        content,
        ...(result.details ? { details: result.details } : {}),
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
      if (!this.isCurrent(invocationId, invocation)) return;
      this.active.delete(invocationId);
      const normalized = this.normalizeError(error);
      this.sendError(invocationId, normalized.code, normalized.message);
    }
  }

  private cancel(invocationId: string): void {
    const invocation = this.active.get(invocationId);
    if (!invocation) return;
    this.active.delete(invocationId);
    invocation.controller.abort();
    this.send('tool.cancelled', { invocationId });
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
