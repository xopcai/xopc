import {
  EndpointToolHostController,
  EndpointToolRegistry,
  type EndpointToolApprovalRequest,
  type EndpointToolDefinition,
  type EndpointToolFile,
  type EndpointToolUploadGrant,
} from '@xopcai/endpoint-tools-client';
import {
  endpointHelloSigningPayload,
  endpointToolContentSchema,
  type EndpointAvailability,
  type EndpointHelloPayload,
  type EndpointKind,
  type EndpointToolContent,
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

export interface EndpointToolHostConfig {
  kind: Extract<EndpointKind, 'web' | 'desktop'>;
  platform: string;
  displayName: string;
  appVersion: string;
  definitions: readonly EndpointToolDefinition[];
  confirmReenrollment(): Promise<boolean>;
}

async function confirmEndpointTool(request: EndpointToolApprovalRequest): Promise<boolean> {
  if (request.signal.aborted) return false;
  const onAbort = () => settleEndpointConfirmation(request.invocationId, false);
  request.signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await requestEndpointConfirmation({
      invocationId: request.invocationId,
      title: request.descriptor.title,
      args: request.arguments,
      deadlineAt: request.deadlineAt,
    });
  } finally {
    request.signal.removeEventListener('abort', onAbort);
  }
}

export class EndpointToolHost {
  private reconnectTimer?: number;
  private connectPromise?: Promise<void>;
  private detachRealtime?: () => void;
  private stopped = false;
  private registrationBlocked = false;
  private endpointId?: string;
  private turnToken?: string;
  private readonly registry: EndpointToolRegistry;
  private readonly controller: EndpointToolHostController;

  constructor(private readonly config: EndpointToolHostConfig) {
    this.registry = new EndpointToolRegistry(config.definitions);
    this.controller = new EndpointToolHostController({
      registry: this.registry,
      getAvailability: availability,
      confirm: confirmEndpointTool,
      uploadFile: (grant, file) => this.uploadFile(grant, file),
      createMessageId: () => crypto.randomUUID(),
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.registrationBlocked = false;
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
    this.controller.disconnect();
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
    this.controller.publishAvailability();
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
          this.controller.connect(sendGatewayEndpointMessage);
        },
        onMessage: (message) => {
          void this.controller.handleMessage(message);
        },
        onDisconnected: () => {
          this.controller.disconnect();
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
      tools: this.registry.descriptors(),
    };
    const signature = await signEndpointPayload(identity.privateKey, endpointHelloSigningPayload(unsigned));
    return { ...unsigned, signature };
  }

  private async uploadFile(
    grant: EndpointToolUploadGrant,
    file: EndpointToolFile,
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

}
