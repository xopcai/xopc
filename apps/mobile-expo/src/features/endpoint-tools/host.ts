import {
  ENDPOINT_HEARTBEAT_INTERVAL_MS,
  ENDPOINT_PROTOCOL_VERSION,
  canonicalJson,
  endpointHelloSigningPayload,
  parseServerEndpointMessage,
  type ClientEndpointMessage,
  type EndpointAvailability,
  type EndpointHelloPayload,
  type EndpointToolDescriptor,
  type ServerEndpointMessage,
} from '@xopcai/endpoint-tools-protocol';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Alert, AppState, Platform } from 'react-native';
import { sha256 } from '@noble/hashes/sha256';

import { apiFetch } from '@/api/client';
import { useGatewayStore } from '@/stores/gateway-store';
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

function availability(): EndpointAvailability {
  return AppState.currentState === 'active' ? 'foreground' : 'background';
}

function endpointToolRevision(value: unknown): string {
  return [...sha256(new TextEncoder().encode(canonicalJson(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function websocketUrl(): string {
  const url = new URL(useGatewayStore.getState().apiUrl('/api/endpoint-tools/v1/ws'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
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

export class MobileEndpointToolHost {
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private connectPromise?: Promise<void>;
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
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.socket?.close(1000, 'Mobile endpoint host stopped');
    this.socket = undefined;
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
    if (this.stopped || this.registrationBlocked || this.socket?.readyState === WebSocket.OPEN) return;
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

      const socket = new WebSocket(websocketUrl());
      this.socket = socket;
      socket.onopen = () => {
        const endpointId = getMobileEndpointId(identity.principalId);
        this.endpointId = endpointId;
        const unsigned: EndpointHelloPayload = {
          principalId: identity.principalId,
          endpointId,
          connectionInstanceId: crypto.randomUUID(),
          displayName,
          kind: 'mobile',
          platform: Platform.OS,
          appVersion: Constants.expoConfig?.version ?? '1',
          availability: availability(),
          nonce: crypto.randomUUID(),
          signedAt: Date.now(),
          signature: 'pending',
          tools: [...MOBILE_ENDPOINT_TOOLS],
        };
        this.send('endpoint.hello', {
          ...unsigned,
          signature: signMobileEndpointPayload(
            identity.privateKey,
            endpointHelloSigningPayload(unsigned),
          ),
        });
      };
      socket.onmessage = (event) => void this.handleMessage(event.data, socket);
      socket.onclose = () => {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.socket === socket) {
          this.socket = undefined;
          clearMobileEndpointTurnClaim(this.turnToken);
          this.turnToken = undefined;
          for (const invocationId of confirmationByInvocationId.keys()) {
            settleConfirmation(invocationId, false);
          }
        }
        this.scheduleReconnect();
      };
      socket.onerror = () => socket.close();
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

  private async handleMessage(raw: unknown, socket: WebSocket): Promise<void> {
    if (this.socket !== socket) return;
    if (typeof raw !== 'string') {
      socket.close(4400, 'Binary endpoint frames are not supported');
      return;
    }
    let message: ServerEndpointMessage;
    try {
      message = parseServerEndpointMessage(JSON.parse(raw));
    } catch {
      socket.close(4400, 'Invalid endpoint protocol frame');
      return;
    }
    if (message.type === 'endpoint.ready') {
      if (!this.endpointId) {
        socket.close(4400, 'Endpoint connection state is invalid');
        return;
      }
      this.turnToken = message.payload.turnToken;
      publishMobileEndpointTurnClaim(this.endpointId, message.payload.turnToken);
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        this.send('endpoint.heartbeat', { availability: availability() });
      }, ENDPOINT_HEARTBEAT_INTERVAL_MS);
      return;
    }
    if (message.type === 'tool.cancel') {
      this.cancelled.add(message.payload.invocationId);
      settleConfirmation(message.payload.invocationId, false);
      return;
    }
    await this.invoke(message, socket);
  }

  private async invoke(
    message: Extract<ServerEndpointMessage, { type: 'tool.invoke' }>,
    socket: WebSocket,
  ): Promise<void> {
    const {
      invocationId, toolName, arguments: args, descriptorRevision,
      confirmationRequired, deadlineAt,
    } = message.payload;
    this.sendOn(socket, 'tool.received', { invocationId });
    const descriptor = MOBILE_ENDPOINT_TOOLS.find((tool) => tool.name === toolName);
    if (!descriptor) {
      this.sendError(socket, invocationId, 'TOOL_NOT_FOUND', 'Mobile tool is not registered');
      return;
    }
    if (this.revisionByTool.get(toolName) !== descriptorRevision) {
      this.sendError(socket, invocationId, 'TOOL_REVISION_MISMATCH', 'Mobile tool contract changed');
      return;
    }
    const localConfirmationRequired = descriptor.confirmation === 'always' || descriptor.effect !== 'read';
    if (confirmationRequired !== localConfirmationRequired) {
      this.sendError(socket, invocationId, 'PROTOCOL_ERROR', 'Mobile confirmation policy mismatch');
      return;
    }
    try {
      if (!this.ensureExecutable(socket, invocationId, descriptor, deadlineAt)) return;
      if (localConfirmationRequired) {
        const allowed = await confirm(invocationId, descriptor.title, args, deadlineAt);
        if (!this.ensureExecutable(socket, invocationId, descriptor, deadlineAt)) return;
        if (!allowed) {
          this.sendError(socket, invocationId, 'USER_DENIED', 'User denied the mobile tool call');
          return;
        }
      }
      const text = await executeMobileEndpointTool(toolName, args);
      if (!this.ensureExecutable(socket, invocationId, descriptor, deadlineAt)) return;
      this.sendOn(socket, 'tool.result', { invocationId, content: [{ type: 'text', text }] });
    } catch (error) {
      this.sendError(
        socket,
        invocationId,
        error instanceof TypeError ? 'INVALID_ARGUMENTS' : 'PROTOCOL_ERROR',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.cancelled.delete(invocationId);
    }
  }

  private ensureExecutable(
    socket: WebSocket,
    invocationId: string,
    descriptor: EndpointToolDescriptor,
    deadlineAt: number,
  ): boolean {
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return false;
    if (this.cancelled.delete(invocationId)) {
      this.sendOn(socket, 'tool.cancelled', { invocationId });
      return false;
    }
    if (Date.now() >= deadlineAt) {
      this.sendError(socket, invocationId, 'TOOL_TIMEOUT', 'Mobile tool deadline expired');
      return false;
    }
    if (descriptor.requiresForeground && availability() !== 'foreground') {
      this.sendError(socket, invocationId, 'ENDPOINT_NOT_FOREGROUND', 'Mobile app is not foreground');
      return false;
    }
    return true;
  }

  private sendError(
    socket: WebSocket,
    invocationId: string,
    code: Extract<ClientEndpointMessage, { type: 'tool.error' }>['payload']['code'],
    message: string,
  ): void {
    this.sendOn(socket, 'tool.error', { invocationId, code, message });
  }

  private send<T extends ClientEndpointMessage['type']>(
    type: T,
    payload: Extract<ClientEndpointMessage, { type: T }>['payload'],
  ): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type,
      sentAt: Date.now(),
      payload,
    }));
  }

  private sendOn<T extends ClientEndpointMessage['type']>(
    socket: WebSocket,
    type: T,
    payload: Extract<ClientEndpointMessage, { type: T }>['payload'],
  ): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type,
      sentAt: Date.now(),
      payload,
    }));
  }
}
