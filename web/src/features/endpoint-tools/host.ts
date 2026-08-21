import {
  ENDPOINT_PROTOCOL_VERSION,
  canonicalJson,
  endpointHelloSigningPayload,
  endpointToolContentSchema,
  type ClientEndpointMessage,
  type EndpointAvailability,
  type EndpointHelloPayload,
  type EndpointKind,
  type EndpointToolContent,
  type EndpointToolDescriptor,
  type ServerEndpointMessage,
} from '@xopcai/endpoint-tools-protocol';
import type { RealtimeEndpointBinding } from '@xopcai/realtime-client';

import {
  attachGatewayRealtimeEndpoint,
  sendGatewayEndpointMessage,
} from '@/features/gateway/gateway-realtime';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import {
  getEndpointId,
  getOrCreateEndpointIdentity,
  rotateEndpointIdentity,
  signEndpointPayload,
} from './identity';
import {
  cancelAllEndpointConfirmations,
  requestEndpointConfirmation,
  settleEndpointConfirmation,
} from './confirmation-store';
import { clearEndpointTurnClaim, publishEndpointTurnClaim } from './turn-claim';

const RECONNECT_DELAY_MS = 2_000;

function availability(): EndpointAvailability {
  return document.visibilityState === 'visible' && document.hasFocus()
    ? 'foreground'
    : 'background';
}

async function revision(descriptor: EndpointToolDescriptor): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(descriptor)));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export interface EndpointToolExecutionResult {
  content: EndpointToolContent[];
  afterSend?: () => void;
}

export interface EndpointToolExecutionContext {
  uploadFile(file: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<Extract<EndpointToolContent, { type: 'file' }>>;
}

export interface EndpointToolHostConfig {
  kind: Extract<EndpointKind, 'web' | 'desktop'>;
  platform: string;
  displayName: string;
  appVersion: string;
  tools: readonly EndpointToolDescriptor[];
  execute(
    toolName: string,
    args: Record<string, unknown>,
    context: EndpointToolExecutionContext,
  ): Promise<EndpointToolExecutionResult>;
  confirmReenrollment(): Promise<boolean>;
}

interface EndpointChannel {
  readonly readyState: number;
  send(data: string): void;
}

export class EndpointToolHost {
  private channel?: EndpointChannel;
  private reconnectTimer?: number;
  private connectPromise?: Promise<void>;
  private detachRealtime?: () => void;
  private stopped = false;
  private registrationBlocked = false;
  private endpointId?: string;
  private turnToken?: string;
  private readonly cancelled = new Set<string>();
  private readonly revisionByTool = new Map<string, string>();

  constructor(private readonly config: EndpointToolHostConfig) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.registrationBlocked = false;
    for (const descriptor of this.config.tools) {
      this.revisionByTool.set(descriptor.name, await revision(descriptor));
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('token-saved', this.onTokenSaved);
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('token-saved', this.onTokenSaved);
    window.clearTimeout(this.reconnectTimer);
    this.detachRealtime?.();
    this.detachRealtime = undefined;
    this.channel = undefined;
    clearEndpointTurnClaim(this.turnToken);
    this.turnToken = undefined;
    this.endpointId = undefined;
    cancelAllEndpointConfirmations();
  }

  private readonly onTokenSaved = () => {
    this.registrationBlocked = false;
    void this.connect();
  };

  private readonly onVisibilityChange = () => {
    this.send('endpoint.availability_changed', { availability: availability() });
  };

  private connect(allowIdentityRotation = true): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    const pending = this.connectOnce(allowIdentityRotation).finally(() => {
      if (this.connectPromise === pending) this.connectPromise = undefined;
    });
    this.connectPromise = pending;
    return pending;
  }

  private async connectOnce(allowIdentityRotation: boolean): Promise<void> {
    if (this.stopped || this.registrationBlocked) return;
    window.clearTimeout(this.reconnectTimer);
    try {
      const identity = await getOrCreateEndpointIdentity(this.config.kind);
      if (this.stopped) return;
      const registration = await apiFetch(apiUrl('/api/endpoint-tools/principals'), {
        method: 'POST',
        body: JSON.stringify({
          principalId: identity.principalId,
          displayName: this.config.displayName,
          kind: this.config.kind,
          platform: this.config.platform,
          publicKey: identity.publicKey,
        }),
      });
      if (!registration.ok) {
        const body = await registration.json().catch(() => null) as {
          error?: { code?: string };
        } | null;
        if (body?.error?.code === 'PRINCIPAL_REVOKED') {
          if (!allowIdentityRotation) {
            this.registrationBlocked = true;
            return;
          }
          const confirmed = await this.config.confirmReenrollment();
          if (this.stopped) return;
          if (!confirmed) {
            this.registrationBlocked = true;
            return;
          }
          await rotateEndpointIdentity(this.config.kind);
          if (!this.stopped) await this.connectOnce(false);
          return;
        }
        if (registration.status >= 400 && registration.status < 500) {
          this.registrationBlocked = true;
          return;
        }
        throw new Error(`Endpoint registration failed: ${registration.status}`);
      }
      if (this.stopped) return;

      const binding: RealtimeEndpointBinding = {
        createHello: () => this.createHello(identity),
        onReady: ({ endpointId, turnToken }) => {
          this.endpointId = endpointId;
          this.turnToken = turnToken;
          publishEndpointTurnClaim(endpointId, turnToken);
          this.channel = {
            readyState: 1,
            send: (data) => {
              const message = JSON.parse(data) as ClientEndpointMessage;
              this.realtimeSend(message);
            },
          };
        },
        onMessage: (message) => {
          const channel = this.channel;
          if (channel) void this.handleMessage(message, channel);
        },
        onDisconnected: () => {
          this.channel = undefined;
          clearEndpointTurnClaim(this.turnToken);
          this.turnToken = undefined;
          cancelAllEndpointConfirmations();
        },
      };
      this.detachRealtime?.();
      this.detachRealtime = attachGatewayRealtimeEndpoint(binding);
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private async createHello(
    identity: Awaited<ReturnType<typeof getOrCreateEndpointIdentity>>,
  ): Promise<EndpointHelloPayload> {
    const endpointId = getEndpointId(identity.principalId);
    this.endpointId = endpointId;
    const unsigned: EndpointHelloPayload = {
      principalId: identity.principalId,
      endpointId,
      connectionInstanceId: crypto.randomUUID(),
      displayName: this.config.displayName,
      kind: this.config.kind,
      platform: this.config.platform,
      appVersion: this.config.appVersion,
      availability: availability(),
      nonce: crypto.randomUUID(),
      signedAt: Date.now(),
      signature: 'pending',
      tools: [...this.config.tools],
    };
    const signature = await signEndpointPayload(identity.privateKey, endpointHelloSigningPayload(unsigned));
    return { ...unsigned, signature };
  }

  private async handleMessage(message: ServerEndpointMessage, channel: EndpointChannel): Promise<void> {
    if (this.channel !== channel) return;
    if (message.type === 'tool.cancel') {
      this.cancelled.add(message.payload.invocationId);
      settleEndpointConfirmation(message.payload.invocationId, false);
      return;
    }
    await this.invoke(message, channel);
  }

  private async invoke(
    message: Extract<ServerEndpointMessage, { type: 'tool.invoke' }>,
    channel: EndpointChannel,
  ): Promise<void> {
    const {
      invocationId, toolName, arguments: args, descriptorRevision,
      confirmationRequired, deadlineAt, uploadGrant,
    } = message.payload;
    this.sendOn(channel, 'tool.received', { invocationId });
    const descriptor = this.config.tools.find((tool) => tool.name === toolName);
    if (!descriptor) {
      this.sendError(channel, invocationId, 'TOOL_NOT_FOUND', 'Endpoint tool is not registered');
      return;
    }
    if (this.revisionByTool.get(toolName) !== descriptorRevision) {
      this.sendError(channel, invocationId, 'TOOL_REVISION_MISMATCH', 'Endpoint tool contract changed');
      return;
    }
    const localConfirmationRequired = descriptor.confirmation === 'always' || descriptor.effect !== 'read';
    if (confirmationRequired !== localConfirmationRequired) {
      this.sendError(channel, invocationId, 'PROTOCOL_ERROR', 'Endpoint confirmation policy mismatch');
      return;
    }
    try {
      if (!this.ensureExecutable(channel, invocationId, descriptor, deadlineAt)) return;
      if (localConfirmationRequired) {
        const allowed = await requestEndpointConfirmation({
          invocationId,
          title: descriptor.title,
          args,
          deadlineAt,
        });
        if (!this.ensureExecutable(channel, invocationId, descriptor, deadlineAt)) return;
        if (!allowed) {
          this.sendError(channel, invocationId, 'USER_DENIED', 'User denied the endpoint tool call');
          return;
        }
      }
      const result = await this.config.execute(toolName, args, {
        uploadFile: (file) => this.uploadFile(uploadGrant, file),
      });
      if (!this.ensureExecutable(channel, invocationId, descriptor, deadlineAt)) return;
      this.sendOn(channel, 'tool.result', { invocationId, content: result.content });
      if (result.afterSend) {
        window.setTimeout(() => {
          if (
            this.channel === channel
            && channel.readyState === 1
            && Date.now() < deadlineAt
            && (!descriptor.requiresForeground || availability() === 'foreground')
          ) {
            result.afterSend?.();
          }
        }, 50);
      }
    } catch (error) {
      const invalid = error instanceof TypeError;
      const userDenied = error instanceof DOMException && error.name === 'AbortError';
      const permissionDenied = error instanceof DOMException && error.name === 'NotAllowedError';
      this.sendError(
        channel,
        invocationId,
        invalid
          ? 'INVALID_ARGUMENTS'
          : userDenied
            ? 'USER_DENIED'
            : permissionDenied
              ? 'PERMISSION_DENIED'
              : 'PROTOCOL_ERROR',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.cancelled.delete(invocationId);
    }
  }

  private async uploadFile(
    grant: Extract<ServerEndpointMessage, { type: 'tool.invoke' }>['payload']['uploadGrant'],
    file: { name: string; mimeType: string; bytes: Uint8Array },
  ): Promise<Extract<EndpointToolContent, { type: 'file' }>> {
    if (!grant || !this.endpointId) throw new Error('Endpoint file upload grant is unavailable');
    if (
      !file.name
      || file.name.length > 255
      || !file.mimeType
      || file.mimeType.length > 255
      || file.bytes.byteLength > grant.maxBytes
      || grant.expiresAt <= Date.now()
    ) {
      throw new TypeError('Endpoint file is invalid');
    }
    const url = new URL(apiUrl(grant.path), window.location.href);
    url.searchParams.set('name', file.name);
    const body = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer;
    const response = await apiFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': file.mimeType,
        'x-endpoint-id': this.endpointId,
        'x-endpoint-upload-token': grant.token,
      },
      body,
    });
    const json = await response.json().catch(() => null) as { payload?: unknown; error?: { message?: string } } | null;
    if (!response.ok) throw new Error(json?.error?.message ?? `Endpoint file upload failed: ${response.status}`);
    const parsed = endpointToolContentSchema.safeParse(json?.payload);
    if (!parsed.success || parsed.data.type !== 'file') {
      throw new Error('Endpoint file upload returned an invalid response');
    }
    return parsed.data;
  }

  private ensureExecutable(
    channel: EndpointChannel,
    invocationId: string,
    descriptor: EndpointToolDescriptor,
    deadlineAt: number,
  ): boolean {
    if (this.channel !== channel || channel.readyState !== 1) return false;
    if (this.cancelled.delete(invocationId)) {
      this.sendOn(channel, 'tool.cancelled', { invocationId });
      return false;
    }
    if (Date.now() >= deadlineAt) {
      this.sendError(channel, invocationId, 'TOOL_TIMEOUT', 'Endpoint tool deadline expired');
      return false;
    }
    if (descriptor.requiresForeground && availability() !== 'foreground') {
      this.sendError(channel, invocationId, 'ENDPOINT_NOT_FOREGROUND', 'Endpoint is not foreground');
      return false;
    }
    return true;
  }

  private sendError(
    channel: EndpointChannel,
    invocationId: string,
    code: Extract<ClientEndpointMessage, { type: 'tool.error' }>['payload']['code'],
    message: string,
  ): void {
    this.sendOn(channel, 'tool.error', { invocationId, code, message });
  }

  private send<T extends ClientEndpointMessage['type']>(
    type: T,
    payload: Extract<ClientEndpointMessage, { type: T }>['payload'],
  ): void {
    if (!this.channel || this.channel.readyState !== 1) return;
    this.channel.send(JSON.stringify({
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type,
      sentAt: Date.now(),
      payload,
    }));
  }

  private sendOn<T extends ClientEndpointMessage['type']>(
    channel: EndpointChannel,
    type: T,
    payload: Extract<ClientEndpointMessage, { type: T }>['payload'],
  ): void {
    if (channel.readyState !== 1) return;
    channel.send(JSON.stringify({
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type,
      sentAt: Date.now(),
      payload,
    }));
  }

  private realtimeSend(message: ClientEndpointMessage): void {
    if (this.channel) sendGatewayEndpointMessage(message);
  }
}
