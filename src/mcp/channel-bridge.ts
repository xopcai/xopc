import type { Config } from '../config/schema.js';
import { loadConfig } from '../config/loader.js';
import type {
  ApprovalDecision,
  ApprovalKind,
  ClaudeChannelMode,
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
import { loadUndiciRuntimeDeps } from '../infra/undici-fetch.js';

const QUEUE_LIMIT = 1000;

export class XopcChannelBridge {
  private client: GatewayHttpClient | null = null;
  private readonly queue: QueueEvent[] = [];
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private cursor = 0;
  private closed = false;
  private eventsAbort: AbortController | null = null;

  constructor(
    private readonly cfg: Config,
    private readonly params: {
      gatewayUrl?: string;
      gatewayToken?: string;
      claudeChannelMode: ClaudeChannelMode;
      verbose: boolean;
    },
  ) {}

  setServer(_server: unknown): void {
    void _server;
  }

  async start(): Promise<void> {
    this.client = createGatewayHttpClientFromConfig({
      config: this.cfg,
      gatewayUrl: this.params.gatewayUrl,
      gatewayToken: this.params.gatewayToken,
    });
    this.connectEvents();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.eventsAbort?.abort();
    this.eventsAbort = null;
    this.queue.length = 0;
    this.pendingApprovals.clear();
  }

  private connectEvents(): void {
    if (this.closed) {
      return;
    }
    this.eventsAbort?.abort();
    const abort = new AbortController();
    this.eventsAbort = abort;
    const baseUrl = resolveGatewayHttpBaseUrl(this.cfg, this.params.gatewayUrl);
    void this.runEventsLoop(baseUrl, this.params.gatewayToken, abort.signal);
  }

  private async runEventsLoop(
    baseUrl: string,
    token: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const url = new URL(`${baseUrl}/api/events`);
    if (token?.trim()) {
      url.searchParams.set('token', token.trim());
    }
    try {
      const res = await loadUndiciRuntimeDeps().fetch(url.toString(), {
        headers: { Accept: 'text/event-stream' },
        signal,
      });
      if (!res.ok || !res.body) {
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!this.closed && !signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let splitAt = buffer.indexOf('\n\n');
        while (splitAt >= 0) {
          this.handleSseChunk(buffer.slice(0, splitAt));
          buffer = buffer.slice(splitAt + 2);
          splitAt = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Best-effort reconnect while bridge stays open.
    }
    if (!this.closed && !signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (!this.closed) {
        this.connectEvents();
      }
    }
  }

  private handleSseChunk(chunk: string): void {
    let eventName = 'message';
    let data = '';
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += line.slice(5).trim();
      }
    }
    if (!data) {
      return;
    }
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      this.enqueueFromBroadcast({ type: eventName, ...parsed });
    } catch {
      this.enqueueFromBroadcast({ type: eventName, raw: data });
    }
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
    const rows = await client.getJson<SessionRow[] | { sessions?: SessionRow[] }>(
      `/api/sessions${qs ? `?${qs}` : ''}`,
    );
    const sessions = Array.isArray(rows) ? rows : (rows.sessions ?? []);
    return sessions
      .map((row) => toConversation(row))
      .filter((c): c is ConversationDescriptor => c !== null);
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

  async readMessages(
    sessionKey: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const client = this.client!;
    const payload = await client.getJson<{ messages?: Array<Record<string, unknown>> }>(
      `/api/sessions/${encodeURIComponent(sessionKey)}/messages?limit=${limit}`,
    );
    return payload.messages ?? [];
  }

  pollEvents(
    filter: WaitFilter,
    limit: number,
  ): { events: QueueEvent[]; nextCursor: number } {
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
    return client.postJson('/api/agent', {
      sessionKey: params.sessionKey,
      message: params.text,
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
    return client.postJson('/api/mcp/approvals/respond', params);
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

export async function serveXopcChannelMcp(opts: {
  gatewayUrl?: string;
  gatewayToken?: string;
  claudeChannelMode?: ClaudeChannelMode;
  verbose?: boolean;
}): Promise<void> {
  const { serveXopcChannelMcpImpl } = await import('./channel-server.js');
  await serveXopcChannelMcpImpl(opts);
}

export function loadMcpServeConfig(): Config {
  return loadConfig();
}
