import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';

import {
  REALTIME_HEARTBEAT_INTERVAL_MS,
  REALTIME_HEARTBEAT_TIMEOUT_MS,
  REALTIME_HELLO_TIMEOUT_MS,
  REALTIME_MAX_CLIENT_FRAME_BYTES,
  REALTIME_PROTOCOL_VERSION,
  parseClientRealtimeMessage,
  parseClientRealtimeJsonFrame,
  type ClientRealtimeMessage,
  type RealtimeSubscription,
  type ServerRealtimeMessage,
} from '@xopcai/realtime-protocol';
import type { RawData, WebSocket } from 'ws';

import type { EndpointToolRuntime } from '../endpoint-tools/runtime.js';
import type { EndpointTransport } from '../endpoint-tools/registry.js';
import { createLogger } from '../utils/logger.js';
import { createPreauthConnectionBudget } from '../gateway/security/preauth-connection-budget.js';
import { RealtimeBroker, type RealtimeSubscriptionHandle } from './broker.js';
import { RealtimeTicketStore } from './tickets.js';
import { RealtimeSocketWriter } from './writer.js';

const log = createLogger('Realtime');
const { WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');
const REALTIME_WS_PATH = '/api/realtime/v1/ws';
const MAX_MESSAGE_CLOCK_SKEW_MS = 60_000;
const MAX_SUBSCRIPTIONS = 100;
const MAX_CONNECTIONS = 100;

function serverMessage<T extends ServerRealtimeMessage['kind']>(
  kind: T,
  payload: Extract<ServerRealtimeMessage, { kind: T }>['payload'],
): Extract<ServerRealtimeMessage, { kind: T }> {
  return {
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    messageId: crypto.randomUUID(),
    kind,
    sentAt: Date.now(),
    payload,
  } as Extract<ServerRealtimeMessage, { kind: T }>;
}

function isAuthorizedTopic(topic: string): boolean {
  return topic === 'gateway'
    || topic === 'sessions'
    || topic === 'logs'
    || (topic.startsWith('session:') && topic.length > 'session:'.length)
    || (topic.startsWith('run:') && topic.length > 'run:'.length)
    || (topic.startsWith('workflow:') && topic.length > 'workflow:'.length);
}

export class RealtimeRuntime {
  readonly broker = new RealtimeBroker(undefined, (error, topic) => {
    log.warn({ err: error, topic }, 'Realtime subscriber failed');
  });
  readonly tickets = new RealtimeTicketStore();

  private readonly preauthBudget = createPreauthConnectionBudget();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: REALTIME_MAX_CLIENT_FRAME_BYTES,
    perMessageDeflate: false,
  });
  private readonly topicCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;

  constructor(private readonly endpointTools?: EndpointToolRuntime) {
    this.wss.on('connection', (socket, request) => this.handleConnection(socket, request));
    this.wss.on('error', (err) => log.error({ err }, 'Realtime WebSocket server failed'));
  }

  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
    const pathname = new URL(req.url ?? '/', 'http://gateway.local').pathname;
    if (pathname !== REALTIME_WS_PATH) return false;
    if (this.closed) {
      socket.destroy();
      return true;
    }
    if (this.wss.clients.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return true;
    }
    const clientIp = req.socket.remoteAddress;
    if (!this.preauthBudget.acquire(clientIp)) {
      socket.destroy();
      return true;
    }
    try {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    } catch (error) {
      this.preauthBudget.release(clientIp);
      throw error;
    }
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const client of this.wss.clients) client.close(1001, 'Gateway stopping');
    for (const timer of this.topicCleanupTimers.values()) clearTimeout(timer);
    this.topicCleanupTimers.clear();
    this.wss.close();
  }

  completeTopic(topic: string, ttlMs = 5 * 60_000): void {
    const existing = this.topicCleanupTimers.get(topic);
    if (existing) clearTimeout(existing);
    this.topicCleanupTimers.set(topic, setTimeout(() => {
      this.topicCleanupTimers.delete(topic);
      this.broker.removeTopic(topic);
    }, ttlMs));
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const clientIp = request.socket.remoteAddress;
    const writer = new RealtimeSocketWriter(socket);
    const subscriptions = new Map<string, RealtimeSubscriptionHandle>();
    let authenticated = false;
    let lastSeenAt = Date.now();
    let connectionId: string | undefined;
    let endpointId: string | undefined;
    let budgetHeld = true;

    const releaseBudget = () => {
      if (!budgetHeld) return;
      budgetHeld = false;
      this.preauthBudget.release(clientIp);
    };
    const helloTimer = setTimeout(() => socket.close(4401, 'Realtime hello timeout'), REALTIME_HELLO_TIMEOUT_MS);
    const heartbeatTimer = setInterval(() => {
      if (Date.now() - lastSeenAt > REALTIME_HEARTBEAT_TIMEOUT_MS) {
        socket.close(4408, 'Realtime heartbeat timeout');
      }
    }, REALTIME_HEARTBEAT_INTERVAL_MS);

    const sendError = (code: string, message: string) => {
      writer.enqueue(serverMessage('realtime.error', { code, message }), 'critical');
    };

    const subscribe = (requested: RealtimeSubscription[]): boolean => {
      const authorized = requested.filter((item) => {
        if (isAuthorizedTopic(item.topic)) return true;
        sendError('FORBIDDEN_TOPIC', `Topic is not available: ${item.topic}`);
        return false;
      });
      const topics = new Set([...subscriptions.keys(), ...authorized.map((item) => item.topic)]);
      if (topics.size > MAX_SUBSCRIPTIONS) {
        sendError('TOO_MANY_SUBSCRIPTIONS', `At most ${MAX_SUBSCRIPTIONS} topics may be subscribed`);
        return false;
      }
      for (const item of authorized) {
        if (item.topic.startsWith('run:') && item.afterSeq !== undefined && !this.broker.hasTopic(item.topic)) {
          writer.enqueue(serverMessage('realtime.gap', {
            topic: item.topic,
            requestedSeq: item.afterSeq,
            earliestSeq: 1,
          }));
          continue;
        }
        subscriptions.get(item.topic)?.unsubscribe();
        const handle = this.broker.subscribe(item.topic, item.afterSeq, (event) => {
          writer.enqueue(event);
        });
        subscriptions.set(item.topic, handle);
        for (const message of handle.initial) {
          writer.enqueue(message);
        }
      }
      return true;
    };

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        socket.close(4400, 'Binary realtime frames are not supported');
        return;
      }
      let message: ClientRealtimeMessage;
      try {
        message = parseClientRealtimeMessage(parseClientRealtimeJsonFrame(this.rawDataToText(data)));
        if (Math.abs(Date.now() - message.sentAt) > MAX_MESSAGE_CLOCK_SKEW_MS) {
          throw new Error('Realtime message timestamp is outside the allowed window');
        }
      } catch (error) {
        log.warn({ err: error }, 'Realtime client sent an invalid frame');
        socket.close(4400, 'Invalid realtime protocol frame');
        return;
      }
      lastSeenAt = Date.now();

      if (!authenticated) {
        if (message.kind !== 'realtime.hello') {
          socket.close(4401, 'First realtime message must be hello');
          return;
        }
        const claim = this.tickets.consume(
          message.payload.ticket,
          message.payload.clientId,
          message.payload.clientKind,
        );
        if (!claim) {
          socket.close(4401, 'Realtime authentication failed');
          return;
        }
        authenticated = true;
        connectionId = crypto.randomUUID();
        let endpointReady: { endpointId: string; turnToken: string } | undefined;
        if (message.payload.endpoint) {
          if (!this.endpointTools || message.payload.endpoint.kind !== message.payload.clientKind) {
            socket.close(4401, 'Realtime endpoint identity is invalid');
            return;
          }
          const transport: EndpointTransport = {
            get readyState() {
              return socket.readyState;
            },
            send: (data) => {
              writer.enqueue(serverMessage('endpoint.message', JSON.parse(data)), 'critical');
            },
            close: (code, reason) => socket.close(code, reason),
          };
          try {
            const registration = this.endpointTools.connect(
              message.payload.endpoint,
              connectionId,
              transport,
            );
            endpointId = message.payload.endpoint.endpointId;
            endpointReady = { endpointId, turnToken: registration.turnToken };
          } catch (error) {
            log.warn({ err: error, principalId: message.payload.endpoint.principalId }, 'Realtime endpoint authentication failed');
            socket.close(4401, 'Realtime endpoint authentication failed');
            return;
          }
        }
        clearTimeout(helloTimer);
        releaseBudget();
        writer.enqueue(serverMessage('realtime.ready', {
          connectionId,
          heartbeatIntervalMs: REALTIME_HEARTBEAT_INTERVAL_MS,
          heartbeatTimeoutMs: REALTIME_HEARTBEAT_TIMEOUT_MS,
          ...(endpointReady ? { endpoint: endpointReady } : {}),
        }), 'critical');
        subscribe(message.payload.subscriptions);
        log.info({ connectionId, clientId: claim.clientId, clientKind: claim.clientKind }, 'Realtime client connected');
        return;
      }

      if (message.kind === 'realtime.hello') {
        socket.close(4400, 'Realtime hello may only be sent once');
      } else if (message.kind === 'realtime.subscribe') {
        subscribe(message.payload.subscriptions);
      } else if (message.kind === 'realtime.unsubscribe') {
        for (const topic of message.payload.topics) {
          subscriptions.get(topic)?.unsubscribe();
          subscriptions.delete(topic);
        }
      } else if (message.kind === 'realtime.ping') {
        if (endpointId && connectionId) this.endpointTools?.touch(endpointId, connectionId);
        writer.enqueue(serverMessage('realtime.pong', {}), 'critical');
      } else if (!endpointId || !connectionId || !this.endpointTools) {
        sendError('ENDPOINT_NOT_REGISTERED', 'Endpoint messages require an endpoint identity');
      } else {
        try {
          this.endpointTools.handleMessage(endpointId, connectionId, message.payload);
        } catch (error) {
          log.warn({ err: error, endpointId, connectionId }, 'Realtime endpoint message failed');
          socket.close(4400, 'Invalid endpoint message');
        }
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeatTimer);
      releaseBudget();
      writer.close();
      for (const handle of subscriptions.values()) handle.unsubscribe();
      subscriptions.clear();
      if (endpointId && connectionId) this.endpointTools?.remove(endpointId, connectionId);
      if (connectionId) log.info({ connectionId }, 'Realtime client disconnected');
    });
  }

  private rawDataToText(data: RawData): string {
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
    return data.toString('utf8');
  }
}
