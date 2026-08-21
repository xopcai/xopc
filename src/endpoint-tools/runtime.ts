import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import { join } from 'node:path';

import {
  ENDPOINT_HEARTBEAT_INTERVAL_MS,
  ENDPOINT_HEARTBEAT_TIMEOUT_MS,
  ENDPOINT_HELLO_TIMEOUT_MS,
  ENDPOINT_MAX_CONCURRENT_INVOCATIONS,
  ENDPOINT_MAX_JSON_FRAME_BYTES,
  ENDPOINT_PROTOCOL_VERSION,
  parseClientEndpointMessage,
  parseJsonFrame,
  type ClientEndpointMessage,
} from '@xopcai/endpoint-tools-protocol';
import type { RawData, WebSocket } from 'ws';

import { createLogger } from '../utils/logger.js';
import { resolveStateDir } from '../config/paths.js';
import {
  bindEndpointPrincipal,
  finishEndpointToolInvocationAudit,
  getEndpointPrincipal,
  startEndpointToolInvocationAudit,
  touchEndpointPrincipal,
} from '../storage/sqlite/index.js';
import { EndpointAuthenticator, type EndpointAuthenticatorDeps } from './auth.js';
import {
  EndpointInvocationService,
  type EndpointInvocationAuditSink,
} from './invocation-service.js';
import { EndpointToolPolicy } from './policy.js';
import { EndpointRegistry } from './registry.js';
import { EndpointUploadService } from './upload-service.js';

const log = createLogger('EndpointTools');
const { WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');
const ENDPOINT_WS_PATH = '/api/endpoint-tools/v1/ws';
const MAX_MESSAGE_CLOCK_SKEW_MS = 60_000;

export class EndpointToolRuntime {
  readonly registry: EndpointRegistry;
  readonly invocations: EndpointInvocationService;
  readonly uploads: EndpointUploadService;

  private readonly authenticator: EndpointAuthenticator;
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: ENDPOINT_MAX_JSON_FRAME_BYTES,
    perMessageDeflate: false,
  });
  private closed = false;

  constructor(options: {
    auth?: EndpointAuthenticatorDeps;
    audit?: EndpointInvocationAuditSink;
    uploadRoot?: string;
  } = {}) {
    const policy = new EndpointToolPolicy();
    this.registry = new EndpointRegistry(policy);
    this.authenticator = new EndpointAuthenticator(options.auth ?? {
      getPrincipal: getEndpointPrincipal,
      bindEndpoint: bindEndpointPrincipal,
      touchPrincipal: touchEndpointPrincipal,
    });
    this.uploads = new EndpointUploadService(
      options.uploadRoot ?? join(resolveStateDir(), 'endpoint-tool-files'),
    );
    this.invocations = new EndpointInvocationService(this.registry, {
      audit: options.audit ?? {
        started: startEndpointToolInvocationAudit,
        finished: finishEndpointToolInvocationAudit,
      },
      uploads: this.uploads,
      policy,
    });
    this.wss.on('connection', (socket) => this.handleConnection(socket));
    this.wss.on('error', (err) => log.error({ err }, 'Endpoint WebSocket server failed'));
  }

  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
    const pathname = new URL(req.url ?? '/', 'http://gateway.local').pathname;
    if (pathname !== ENDPOINT_WS_PATH) return false;
    if (this.closed) {
      socket.destroy();
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
    return true;
  }

  disconnect(endpointId: string, reason: string): void {
    this.registry.disconnect(endpointId, 4003, reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.invocations.close();
    this.registry.closeAll();
    this.wss.close();
  }

  private handleConnection(socket: WebSocket): void {
    let endpointId: string | undefined;
    let connectionId: string | undefined;
    let authenticated = false;
    const helloTimer = setTimeout(() => socket.close(4401, 'Endpoint hello timeout'), ENDPOINT_HELLO_TIMEOUT_MS);
    const heartbeatTimer = setInterval(() => {
      if (!endpointId || !connectionId) return;
      const endpoint = this.registry.get(endpointId);
      if (!endpoint || endpoint.connectionId !== connectionId) return;
      if (Date.now() - endpoint.lastHeartbeatAt > ENDPOINT_HEARTBEAT_TIMEOUT_MS) {
        socket.close(4408, 'Endpoint heartbeat timeout');
      }
    }, ENDPOINT_HEARTBEAT_INTERVAL_MS);

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        socket.close(4400, 'Binary control frames are not supported');
        return;
      }
      let message: ClientEndpointMessage;
      try {
        const text = this.rawDataToText(data);
        message = parseClientEndpointMessage(parseJsonFrame(text));
        if (Math.abs(Date.now() - message.sentAt) > MAX_MESSAGE_CLOCK_SKEW_MS) {
          throw new Error('Endpoint message timestamp is outside the allowed window');
        }
      } catch (err) {
        log.warn({ err }, 'Endpoint sent an invalid protocol frame');
        socket.close(4400, 'Invalid endpoint protocol frame');
        return;
      }

      if (!authenticated) {
        if (message.type !== 'endpoint.hello') {
          socket.close(4401, 'First endpoint message must be hello');
          return;
        }
        try {
          this.authenticator.authenticate(message.payload);
          connectionId = crypto.randomUUID();
          endpointId = message.payload.endpointId;
          const registration = this.registry.register(message.payload, connectionId, socket);
          authenticated = true;
          clearTimeout(helloTimer);
          socket.send(JSON.stringify({
            protocolVersion: ENDPOINT_PROTOCOL_VERSION,
            messageId: crypto.randomUUID(),
            type: 'endpoint.ready',
            sentAt: Date.now(),
            payload: {
              connectionId,
              turnToken: registration.turnToken,
              heartbeatIntervalMs: ENDPOINT_HEARTBEAT_INTERVAL_MS,
              heartbeatTimeoutMs: ENDPOINT_HEARTBEAT_TIMEOUT_MS,
              maxConcurrentInvocations: ENDPOINT_MAX_CONCURRENT_INVOCATIONS,
            },
          }));
          log.info({ endpointId, connectionId, kind: message.payload.kind }, 'Endpoint connected');
        } catch (err) {
          log.warn({ err, principalId: message.payload.principalId }, 'Endpoint authentication failed');
          socket.close(4401, 'Endpoint authentication failed');
        }
        return;
      }

      if (!endpointId || !connectionId) {
        socket.close(4400, 'Endpoint connection state is invalid');
        return;
      }
      if (message.type === 'endpoint.hello') {
        socket.close(4400, 'Endpoint hello may only be sent once');
      } else if (
        message.type === 'endpoint.heartbeat'
        || message.type === 'endpoint.availability_changed'
      ) {
        this.registry.heartbeat(endpointId, connectionId, message.payload.availability);
      } else {
        this.invocations.handleMessage(endpointId, message);
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeatTimer);
      if (endpointId && connectionId && this.registry.remove(endpointId, connectionId)) {
        this.invocations.failEndpoint(endpointId);
        log.info({ endpointId, connectionId }, 'Endpoint disconnected');
      }
    });
  }

  private rawDataToText(data: RawData): string {
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
    return data.toString('utf8');
  }
}
