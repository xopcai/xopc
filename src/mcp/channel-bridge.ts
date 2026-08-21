import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';
import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

import type { Config } from '../config/schema.js';
import { loadConfig } from '../config/loader.js';
import type {
  ApprovalDecision,
  ApprovalKind,
  ConversationDescriptor,
  PendingApproval,
  QueueEvent,
  SessionRow,
  WaitFilter,
} from './channel-shared.js';
import { toConversation } from './channel-shared.js';
import {
  createGatewayHttpClientFromConfig,
  resolveGatewayHttpBaseUrl,
  type GatewayHttpClient,
} from './gateway-http-client.js';
import { createLogger } from '../utils/logger.js';
import type { GatewayCredential } from '../gateway/credential.js';

const log = createLogger('Mcp:Bridge');
const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

const QUEUE_LIMIT = 1000;

export class XopcChannelBridge {
  private client: GatewayHttpClient | null = null;
  private readonly queue: QueueEvent[] = [];
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private cursor = 0;
  private closed = false;
  private readonly realtimeClientId = `mcp-${crypto.randomUUID()}`;
  private realtime: RealtimeClient | null = null;

  constructor(
    private readonly cfg: Config,
    private readonly params: {
      gatewayUrl?: string;
      gatewayCredential?: GatewayCredential;
    },
  ) {}

  async start(): Promise<void> {
    log.info({ phase: 'mcp.bridge.connect' }, 'MCP channel bridge starting');
    this.client = createGatewayHttpClientFromConfig({
      config: this.cfg,
      gatewayUrl: this.params.gatewayUrl,
      gatewayCredential: this.params.gatewayCredential,
    });
    this.connectRealtime();
  }

  async close(): Promise<void> {
    log.info({ phase: 'mcp.bridge.connect', queueSize: this.queue.length }, 'MCP channel bridge closing');
    this.closed = true;
    this.realtime?.disconnect();
    this.realtime = null;
    this.queue.length = 0;
    this.pendingApprovals.clear();
  }

  private connectRealtime(): void {
    if (this.closed) return;
    const baseUrl = resolveGatewayHttpBaseUrl(this.cfg, this.params.gatewayUrl);
    this.realtime?.disconnect();
    this.realtime = new RealtimeClient({
      clientId: this.realtimeClientId,
      clientKind: 'mcp',
      getWebSocketUrl: () => {
        const url = new URL(baseUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/api/realtime/v1/ws';
        url.search = '';
        url.hash = '';
        return url.toString();
      },
      issueTicket: async () => {
        const response = await this.client!.postJson<{
          payload?: { ticket?: string };
          error?: { message?: string };
        }>('/api/realtime/tickets', {
          clientId: this.realtimeClientId,
          clientKind: 'mcp',
        });
        if (!response.payload?.ticket) {
          throw new Error(response.error?.message ?? 'Realtime ticket response is invalid');
        }
        return response.payload.ticket;
      },
      createWebSocket: (url) => new WebSocket(url) as unknown as RealtimeWebSocket,
      onEvent: (event) => this.handleRealtimeEvent(event),
      onStateChange: (state, error) => {
        if (state === 'error') {
          log.warn({ errorMessage: error, phase: 'mcp.bridge.realtime', baseUrl }, `Gateway realtime connection failed: ${error ?? 'unknown error'}`);
        }
      },
    });
    this.realtime.subscribe('gateway');
    this.realtime.subscribe('sessions');
    this.realtime.connect();
  }

  private handleRealtimeEvent(event: RealtimeEventPayload): void {
    if (event.topic !== 'gateway' && event.topic !== 'sessions') return;
    const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
      ? event.data as Record<string, unknown>
      : { raw: event.data };
    this.enqueueFromBroadcast({ ...data, type: event.event });
  }

  private enqueueFromBroadcast(data: Record<string, unknown>): void {
    const type = String(data.type ?? data.event ?? '');
    if (!type) {
      return;
    }
    if (type.includes('message') || type.includes('session')) {
      this.pushEvent({
        cursor: ++this.cursor,
        type: 'message',
        sessionKey: String(data.sessionKey ?? data.key ?? ''),
        raw: data,
      });
    }
  }

  private pushEvent(event: QueueEvent): void {
    this.queue.push(event);
    while (this.queue.length > QUEUE_LIMIT) {
      this.queue.shift();
    }
  }

  async listConversations(args: {
    limit?: number;
    search?: string;
    channel?: string;
  }): Promise<ConversationDescriptor[]> {
    const client = this.client!;
    const query = new URLSearchParams();
    if (args.limit) query.set('limit', String(args.limit));
    if (args.search) query.set('search', args.search);
    if (args.channel) query.set('channel', args.channel);
    const qs = query.toString();
    const rows = await client.getJson<SessionRow[] | { sessions?: SessionRow[] }>(`/api/sessions${qs ? `?${qs}` : ''}`);
    const sessions = Array.isArray(rows) ? rows : (rows.sessions ?? []);
    return sessions.map((row) => toConversation(row)).filter((c): c is ConversationDescriptor => c !== null);
  }

  async getConversation(sessionKey: string): Promise<ConversationDescriptor | null> {
    const client = this.client!;
    try {
      const row = await client.getJson<SessionRow>(`/api/sessions/${encodeURIComponent(sessionKey)}`);
      return toConversation(row);
    } catch {
      return null;
    }
  }

  async readMessages(sessionKey: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const client = this.client!;
    const payload = await client.getJson<{
      messages?: Array<Record<string, unknown>>;
    }>(`/api/sessions/${encodeURIComponent(sessionKey)}/messages?limit=${limit}`);
    return payload.messages ?? [];
  }

  pollEvents(filter: WaitFilter, limit: number): { events: QueueEvent[]; nextCursor: number } {
    const events = this.queue
      .filter((e) => e.cursor > filter.afterCursor)
      .filter((e) => !filter.sessionKey || ('sessionKey' in e && e.sessionKey === filter.sessionKey))
      .slice(0, limit);
    const nextCursor = events.length > 0 ? events[events.length - 1]!.cursor : filter.afterCursor;
    return { events, nextCursor };
  }

  async waitForEvent(filter: WaitFilter, timeoutMs: number): Promise<QueueEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.closed) {
      const polled = this.pollEvents(filter, 1);
      if (polled.events.length > 0) {
        return polled.events[0] ?? null;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  async sendMessage(params: { sessionKey: string; text: string }): Promise<Record<string, unknown>> {
    const client = this.client!;
    return client.postJson(`/api/sessions/${encodeURIComponent(params.sessionKey)}/inputs`, {
      clientMessageId: crypto.randomUUID(),
      delivery: 'next',
      content: params.text,
    });
  }

  listPendingApprovals(): PendingApproval[] {
    return Array.from(this.pendingApprovals.values());
  }

  async respondToApproval(params: {
    kind: ApprovalKind;
    id: string;
    decision: ApprovalDecision;
  }): Promise<Record<string, unknown>> {
    const client = this.client!;
    return client.postJson('/api/connectors/approvals/respond', params);
  }

  async handleClaudePermissionRequest(_params: {
    requestId: string;
    toolName: string;
    description: string;
    inputPreview: string;
  }): Promise<void> {
    void _params;
  }
}

export function loadMcpServeConfig(): Config {
  return loadConfig();
}
