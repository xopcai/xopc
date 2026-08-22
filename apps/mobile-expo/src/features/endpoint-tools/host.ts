import {
  ENDPOINT_PROTOCOL_VERSION,
  canonicalJson,
  endpointHelloSigningPayload,
  endpointToolContentSchema,
  type ClientEndpointMessage,
  type EndpointAvailability,
  type EndpointHelloPayload,
  type EndpointToolContent,
  type EndpointToolDescriptor,
  type ServerEndpointMessage,
} from '@xopcai/endpoint-tools-protocol';
import type { RealtimeEndpointBinding } from '@xopcai/realtime-client';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Device from 'expo-device';
import { Alert, AppState, Platform } from 'react-native';
import { sha256 } from '@noble/hashes/sha256';

import { apiFetch } from '@/api/client';
import {
  attachMobileRealtimeEndpoint,
  sendMobileEndpointMessage,
} from '@/features/gateway/use-gateway-realtime';
import { getMobileEndpointId } from './endpoint-id';
import {
  getOrCreateMobileEndpointIdentity,
  rotateMobileEndpointIdentity,
  signMobileEndpointPayload,
} from './identity';
import {
  clearMobileEndpointTurnClaim,
  publishMobileEndpointTurnClaim,
} from './turn-claim';
import { executeMobileEndpointTool, MOBILE_ENDPOINT_TOOLS } from './tools';

const RECONNECT_DELAY_MS = 2_000;
const ARGUMENT_PREVIEW_LIMIT = 600;
const confirmationByInvocationId = new Map<string, (allowed: boolean) => void>();

export interface MobileEndpointToolExecutionContext {
  uploadFile(file: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<Extract<EndpointToolContent, { type: 'file' }>>;
}

function availability(): EndpointAvailability {
  return AppState.currentState === 'active' ? 'foreground' : 'background';
}

function endpointToolRevision(value: unknown): string {
  return [...sha256(new TextEncoder().encode(canonicalJson(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function formatArguments(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, null, 2);
  return json.length <= ARGUMENT_PREVIEW_LIMIT
    ? json
    : `${json.slice(0, ARGUMENT_PREVIEW_LIMIT)}\n…`;
}

function settleConfirmation(invocationId: string, allowed: boolean): void {
  confirmationByInvocationId.get(invocationId)?.(allowed);
}

function confirm(
  invocationId: string,
  title: string,
  args: Record<string, unknown>,
  deadlineAt: number,
): Promise<boolean> {
  if (deadlineAt <= Date.now()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(false), deadlineAt - Date.now());
    const finish = (allowed: boolean) => {
      if (!confirmationByInvocationId.delete(invocationId)) return;
      clearTimeout(timeout);
      resolve(allowed);
    };
    confirmationByInvocationId.set(invocationId, finish);
    Alert.alert('Allow xopc?', `${title}\n\nArguments:\n${formatArguments(args)}`, [
      { text: 'Deny', style: 'cancel', onPress: () => finish(false) },
      { text: 'Allow', onPress: () => finish(true) },
    ], { cancelable: true, onDismiss: () => finish(false) });
  });
}

function confirmReenrollment(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Re-enroll this endpoint?',
      'This endpoint identity was revoked. Continuing deletes the old key and creates a new identity.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Create new identity', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

interface EndpointChannel {
  readonly readyState: number;
  send(data: string): void;
}

export class MobileEndpointToolHost {
  private channel?: EndpointChannel;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectPromise?: Promise<void>;
  private detachRealtime?: () => void;
  private appStateSubscription?: { remove(): void };
  private stopped = false;
  private registrationBlocked = false;
  private endpointId?: string;
  private turnToken?: string;
  private readonly cancelled = new Set<string>();
  private readonly revisionByTool = new Map(
    MOBILE_ENDPOINT_TOOLS.map((tool) => [tool.name, endpointToolRevision(tool)]),
  );

  async start(): Promise<void> {
    this.stopped = false;
    this.registrationBlocked = false;
    this.appStateSubscription = AppState.addEventListener('change', () => {
      this.send('endpoint.availability_changed', { availability: availability() });
    });
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.appStateSubscription?.remove();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.detachRealtime?.();
    this.detachRealtime = undefined;
    this.channel = undefined;
    clearMobileEndpointTurnClaim(this.turnToken);
    this.turnToken = undefined;
    this.endpointId = undefined;
    for (const invocationId of confirmationByInvocationId.keys()) {
      settleConfirmation(invocationId, false);
    }
  }

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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      const identity = getOrCreateMobileEndpointIdentity();
      const displayName = Device.modelName ?? 'xopc Mobile';
      const registration = await apiFetch('/api/endpoint-tools/principals', {
        method: 'POST',
        body: JSON.stringify({
          principalId: identity.principalId,
          displayName,
          kind: 'mobile',
          platform: Platform.OS,
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
          const confirmed = await confirmReenrollment();
          if (this.stopped) return;
          if (!confirmed) {
            this.registrationBlocked = true;
            return;
          }
          await rotateMobileEndpointIdentity();
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
        createHello: async () => {
          const endpointId = getMobileEndpointId(identity.principalId);
          this.endpointId = endpointId;
          const unsigned: EndpointHelloPayload = {
            principalId: identity.principalId,
            endpointId,
            connectionInstanceId: randomUUID(),
            displayName,
            kind: 'mobile',
            platform: Platform.OS,
            appVersion: Constants.expoConfig?.version ?? '1',
            availability: availability(),
            nonce: randomUUID(),
            signedAt: Date.now(),
            signature: 'pending',
            tools: [...MOBILE_ENDPOINT_TOOLS],
          };
          return {
            ...unsigned,
            signature: signMobileEndpointPayload(
              identity.privateKey,
              endpointHelloSigningPayload(unsigned),
            ),
          };
        },
        onReady: ({ endpointId, turnToken }) => {
          this.endpointId = endpointId;
          this.turnToken = turnToken;
          publishMobileEndpointTurnClaim(endpointId, turnToken);
          this.channel = {
            readyState: 1,
            send: (data) => sendMobileEndpointMessage(JSON.parse(data) as ClientEndpointMessage),
          };
        },
        onMessage: (message) => {
          const channel = this.channel;
          if (channel) void this.handleMessage(message, channel);
        },
        onDisconnected: () => {
          this.channel = undefined;
          clearMobileEndpointTurnClaim(this.turnToken);
          this.turnToken = undefined;
          for (const invocationId of confirmationByInvocationId.keys()) {
            settleConfirmation(invocationId, false);
          }
        },
      };
      this.detachRealtime?.();
      this.detachRealtime = attachMobileRealtimeEndpoint(binding);
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private async handleMessage(message: ServerEndpointMessage, channel: EndpointChannel): Promise<void> {
    if (this.channel !== channel) return;
    if (message.type === 'tool.cancel') {
      this.cancelled.add(message.payload.invocationId);
      settleConfirmation(message.payload.invocationId, false);
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
    const descriptor = MOBILE_ENDPOINT_TOOLS.find((tool) => tool.name === toolName);
    if (!descriptor) {
      this.sendError(channel, invocationId, 'TOOL_NOT_FOUND', 'Mobile tool is not registered');
      return;
    }
    if (this.revisionByTool.get(toolName) !== descriptorRevision) {
      this.sendError(channel, invocationId, 'TOOL_REVISION_MISMATCH', 'Mobile tool contract changed');
      return;
    }
    const localConfirmationRequired = descriptor.confirmation === 'always' || descriptor.effect !== 'read';
    if (confirmationRequired !== localConfirmationRequired) {
      this.sendError(channel, invocationId, 'PROTOCOL_ERROR', 'Mobile confirmation policy mismatch');
      return;
    }
    try {
      if (!this.ensureExecutable(channel, invocationId, descriptor, deadlineAt)) return;
      if (localConfirmationRequired) {
        const allowed = await confirm(invocationId, descriptor.title, args, deadlineAt);
        if (!this.ensureExecutable(channel, invocationId, descriptor, deadlineAt)) return;
        if (!allowed) {
          this.sendError(channel, invocationId, 'USER_DENIED', 'User denied the mobile tool call');
          return;
        }
      }
      const result = await executeMobileEndpointTool(toolName, args, {
        uploadFile: (file) => this.uploadFile(uploadGrant, file),
      });
      if (!this.ensureExecutable(channel, invocationId, descriptor, deadlineAt)) return;
      this.sendOn(channel, 'tool.result', { invocationId, content: result.content });
    } catch (error) {
      this.sendError(
        channel,
        invocationId,
        error instanceof TypeError
          ? 'INVALID_ARGUMENTS'
          : error instanceof Error && error.name === 'AbortError'
            ? 'USER_DENIED'
            : error instanceof Error && error.name === 'NotAllowedError'
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
    if (!grant || !this.endpointId) throw new Error('Mobile file upload grant is unavailable');
    if (
      !file.name
      || file.name.length > 255
      || !file.mimeType
      || file.mimeType.length > 255
      || file.bytes.byteLength > grant.maxBytes
      || grant.expiresAt <= Date.now()
    ) {
      throw new TypeError('Mobile file is invalid');
    }
    const query = new URLSearchParams({ name: file.name });
    const body = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer;
    const response = await apiFetch(`${grant.path}?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.mimeType,
        'x-endpoint-id': this.endpointId,
        'x-endpoint-upload-token': grant.token,
      },
      body,
      timeoutMs: 120_000,
    });
    const json = await response.json().catch(() => null) as { payload?: unknown; error?: { message?: string } } | null;
    if (!response.ok) throw new Error(json?.error?.message ?? `Mobile file upload failed: ${response.status}`);
    const parsed = endpointToolContentSchema.safeParse(json?.payload);
    if (!parsed.success || parsed.data.type !== 'file') {
      throw new Error('Mobile file upload returned an invalid response');
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
      this.sendError(channel, invocationId, 'TOOL_TIMEOUT', 'Mobile tool deadline expired');
      return false;
    }
    if (descriptor.requiresForeground && availability() !== 'foreground') {
      this.sendError(channel, invocationId, 'ENDPOINT_NOT_FOREGROUND', 'Mobile app is not foreground');
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
      messageId: randomUUID(),
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
      messageId: randomUUID(),
      type,
      sentAt: Date.now(),
      payload,
    }));
  }
}
