import crypto from 'node:crypto';

import {
  ENDPOINT_PROTOCOL_VERSION,
  canonicalJson,
  type EndpointAvailability,
  type EndpointHelloPayload,
  type EndpointKind,
  type EndpointToolDescriptor,
  type ServerEndpointMessage,
} from '@xopcai/endpoint-tools-protocol';
import type { WebSocket } from 'ws';
import { EndpointToolPolicy } from './policy.js';

export interface RegisteredEndpointTool {
  descriptor: EndpointToolDescriptor;
  revision: string;
}

export interface EndpointConnectionSnapshot {
  principalId: string;
  endpointId: string;
  connectionId: string;
  displayName: string;
  kind: EndpointKind;
  platform: string;
  appVersion: string;
  availability: EndpointAvailability;
  lastHeartbeatAt: number;
  tools: RegisteredEndpointTool[];
}

type EndpointConnection = EndpointConnectionSnapshot & {
  socket: WebSocket;
  turnToken: string;
  toolByName: Map<string, RegisteredEndpointTool>;
};

export interface EndpointRegistration {
  connection: EndpointConnectionSnapshot;
  turnToken: string;
}

export function endpointToolRevision(descriptor: EndpointToolDescriptor): string {
  return crypto.createHash('sha256').update(canonicalJson(descriptor)).digest('hex');
}

function snapshot(connection: EndpointConnection): EndpointConnectionSnapshot {
  return {
    principalId: connection.principalId,
    endpointId: connection.endpointId,
    connectionId: connection.connectionId,
    displayName: connection.displayName,
    kind: connection.kind,
    platform: connection.platform,
    appVersion: connection.appVersion,
    availability: connection.availability,
    lastHeartbeatAt: connection.lastHeartbeatAt,
    tools: [...connection.toolByName.values()],
  };
}

export class EndpointRegistry {
  private readonly connectionByEndpointId = new Map<string, EndpointConnection>();

  constructor(private readonly policy = new EndpointToolPolicy()) {}

  register(
    hello: EndpointHelloPayload,
    connectionId: string,
    socket: WebSocket,
    now = Date.now(),
  ): EndpointRegistration {
    const toolByName = new Map<string, RegisteredEndpointTool>();
    for (const descriptor of hello.tools) {
      this.policy.validateDescriptor(hello.kind, descriptor);
      if (toolByName.has(descriptor.name)) {
        throw new Error(`Endpoint catalog contains duplicate tool: ${descriptor.name}`);
      }
      toolByName.set(descriptor.name, {
        descriptor,
        revision: endpointToolRevision(descriptor),
      });
    }

    const previous = this.connectionByEndpointId.get(hello.endpointId);
    if (previous && previous.principalId !== hello.principalId) {
      throw new Error('Endpoint instance belongs to another principal');
    }
    if (previous) previous.socket.close(4001, 'Endpoint connected elsewhere');

    const connection: EndpointConnection = {
      principalId: hello.principalId,
      endpointId: hello.endpointId,
      connectionId,
      displayName: hello.displayName,
      kind: hello.kind,
      platform: hello.platform,
      appVersion: hello.appVersion,
      availability: hello.availability,
      lastHeartbeatAt: now,
      tools: [],
      socket,
      turnToken: crypto.randomBytes(32).toString('base64url'),
      toolByName,
    };
    this.connectionByEndpointId.set(connection.endpointId, connection);
    return { connection: snapshot(connection), turnToken: connection.turnToken };
  }

  remove(endpointId: string, connectionId: string): boolean {
    const connection = this.connectionByEndpointId.get(endpointId);
    if (!connection || connection.connectionId !== connectionId) return false;
    this.connectionByEndpointId.delete(endpointId);
    return true;
  }

  heartbeat(
    endpointId: string,
    connectionId: string,
    availability: EndpointAvailability,
    now = Date.now(),
  ): void {
    const connection = this.requireConnection(endpointId, connectionId);
    connection.availability = availability;
    connection.lastHeartbeatAt = now;
  }

  get(endpointId: string): EndpointConnectionSnapshot | undefined {
    const connection = this.connectionByEndpointId.get(endpointId);
    return connection ? snapshot(connection) : undefined;
  }

  list(): EndpointConnectionSnapshot[] {
    return [...this.connectionByEndpointId.values()].map(snapshot);
  }

  getTool(endpointId: string, toolName: string): RegisteredEndpointTool | undefined {
    return this.connectionByEndpointId.get(endpointId)?.toolByName.get(toolName);
  }

  verifyTurnClaim(endpointId: string, turnToken: string): boolean {
    const connection = this.connectionByEndpointId.get(endpointId);
    if (!connection || connection.socket.readyState !== 1) return false;
    const expected = Buffer.from(connection.turnToken);
    const actual = Buffer.from(turnToken);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  send(endpointId: string, type: 'tool.invoke' | 'tool.cancel', payload: unknown): void {
    const connection = this.connectionByEndpointId.get(endpointId);
    if (!connection || connection.socket.readyState !== 1) {
      throw new Error(`Endpoint is offline: ${endpointId}`);
    }
    const message = {
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type,
      sentAt: Date.now(),
      payload,
    } as ServerEndpointMessage;
    connection.socket.send(JSON.stringify(message));
  }

  disconnect(endpointId: string, code = 4003, reason = 'Endpoint disconnected'): boolean {
    const connection = this.connectionByEndpointId.get(endpointId);
    if (!connection) return false;
    connection.socket.close(code, reason);
    return true;
  }

  closeAll(code = 1001, reason = 'Gateway stopping'): void {
    for (const connection of this.connectionByEndpointId.values()) {
      connection.socket.close(code, reason);
    }
    this.connectionByEndpointId.clear();
  }

  private requireConnection(endpointId: string, connectionId: string): EndpointConnection {
    const connection = this.connectionByEndpointId.get(endpointId);
    if (!connection || connection.connectionId !== connectionId) {
      throw new Error('Endpoint connection is no longer active');
    }
    return connection;
  }
}
