import {
  EndpointToolHostController,
  EndpointToolRegistry,
  type EndpointToolApprovalRequest,
  type EndpointToolFile,
  type EndpointToolUploadGrant,
} from '@xopcai/endpoint-tools-client';
import {
  endpointHelloSigningPayload,
  endpointToolContentSchema,
  type EndpointAvailability,
  type EndpointHelloPayload,
  type EndpointToolContent,
} from '@xopcai/endpoint-tools-protocol';
import type { RealtimeEndpointBinding } from '@xopcai/realtime-client';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Device from 'expo-device';
import { Alert, AppState, Platform } from 'react-native';

import { apiFetch } from '@/api/client';
import { dataSharingConsent } from '../privacy/data-sharing-consent';
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
import { MOBILE_ENDPOINT_TOOL_DEFINITIONS } from './tools';

const RECONNECT_DELAY_MS = 2_000;
const ARGUMENT_PREVIEW_LIMIT = 600;
const confirmationByInvocationId = new Map<string, (allowed: boolean) => void>();

function availability(): EndpointAvailability {
  return AppState.currentState === 'active' ? 'foreground' : 'background';
}

function formatArguments(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, null, 2);
  return json.length <= ARGUMENT_PREVIEW_LIMIT
    ? json
    : `${json.slice(0, ARGUMENT_PREVIEW_LIMIT)}\n…`;
}

async function confirm(request: EndpointToolApprovalRequest): Promise<boolean> {
  try { await dataSharingConsent.ensure(); } catch { return false; }
  const { invocationId, descriptor, arguments: args, deadlineAt, signal } = request;
  if (deadlineAt <= Date.now()) return Promise.resolve(false);
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(false), deadlineAt - Date.now());
    const finish = (allowed: boolean) => {
      if (!confirmationByInvocationId.delete(invocationId)) return;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve(allowed);
    };
    const onAbort = () => finish(false);
    confirmationByInvocationId.set(invocationId, finish);
    signal.addEventListener('abort', onAbort, { once: true });
    Alert.alert('Allow xopc?', `${descriptor.title}\n\nArguments:\n${formatArguments(args)}`, [
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

export class MobileEndpointToolHost {
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectPromise?: Promise<void>;
  private detachRealtime?: () => void;
  private appStateSubscription?: { remove(): void };
  private stopped = false;
  private registrationBlocked = false;
  private endpointId?: string;
  private turnToken?: string;
  private readonly registry = new EndpointToolRegistry(MOBILE_ENDPOINT_TOOL_DEFINITIONS);
  private readonly controller = new EndpointToolHostController({
    registry: this.registry,
    getAvailability: availability,
    confirm,
    uploadFile: (grant, file) => this.uploadFile(grant, file),
    createMessageId: randomUUID,
  });

  async start(): Promise<void> {
    this.stopped = false;
    this.registrationBlocked = false;
    this.appStateSubscription = AppState.addEventListener('change', () => {
      this.controller.publishAvailability();
    });
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.appStateSubscription?.remove();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.detachRealtime?.();
    this.detachRealtime = undefined;
    this.controller.disconnect();
    clearMobileEndpointTurnClaim(this.turnToken);
    this.turnToken = undefined;
    this.endpointId = undefined;
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
            tools: this.registry.descriptors(),
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
          this.controller.connect(sendMobileEndpointMessage);
        },
        onMessage: (message) => {
          void this.controller.handleMessage(message);
        },
        onDisconnected: () => {
          this.controller.disconnect();
          clearMobileEndpointTurnClaim(this.turnToken);
          this.turnToken = undefined;
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

  private async uploadFile(
    grant: EndpointToolUploadGrant,
    file: EndpointToolFile,
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

}
