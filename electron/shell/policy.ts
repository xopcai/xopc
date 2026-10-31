import { sessionInputCommandSchema } from '@xopcai/gateway-contract';

import { parseClientRealtimeMessage, parseServerRealtimeMessage, type ClientRealtimeMessage, type ServerRealtimeMessage } from '@xopcai/realtime-protocol';

const ID = '[A-Za-z0-9_-]{1,160}';
const topic = (value: string) => value === 'sessions' || new RegExp(`^(?:session|run):${ID}$`).test(value);

/** Reject ambiguous encodings before URL normalization and allow each query key once. */
export function shellRoute(method: string, raw: string): 'json' | 'ticket' | 'media' | 'input' | 'stop' | undefined {
  if (raw.length > 4096 || !raw.startsWith('/') || /[%\\#\x00-\x20]/.test(raw.split('?')[0]) || raw.startsWith('//') || raw.includes('/../') || raw.includes('/./')) return;
  const url = new URL(raw, 'http://shell.invalid');
  const keys = [...url.searchParams.keys()];
  if (keys.length !== new Set(keys).size || keys.length > 8 || [...url.searchParams.values()].some(v => v.length > 2048)) return;
  let allowed: string[];
  let result: 'json' | 'ticket' | 'media' | 'input' | 'stop';
  if (method === 'POST' && /^\/api\/sessions\/[0-9a-f-]{36}\/inputs$/.test(url.pathname)) { allowed = []; result = 'input'; }
  else if (method === 'POST' && url.pathname === '/api/agent/abort') { allowed = []; result = 'stop'; }
  else if (method === 'GET' && new RegExp(`^/api/sessions/${ID}/input-receipts/${ID}$`).test(url.pathname)) { allowed = []; result = 'json'; }
  else if (method === 'POST' && url.pathname === '/api/realtime/tickets') { allowed = []; result = 'ticket'; }
  else if (method === 'GET' && url.pathname === '/api/media/read') {
    allowed = ['uri', 'conversationId', 'taskId']; result = 'media';
    if (!url.searchParams.get('uri') || (!url.searchParams.get('conversationId') && !url.searchParams.get('taskId'))) return;
  } else if (method === 'GET' && ['/api/models', '/api/agents'].includes(url.pathname)) { allowed = []; result = 'json'; }
  else if (method === 'GET' && url.pathname === '/api/sessions') { allowed = ['limit', 'offset', 'agentId']; result = 'json'; }
  else if (method === 'GET' && new RegExp(`^/api/sessions/${ID}(?:/(?:messages|history|timeline|agent-config|input-state|run))?$`).test(url.pathname)) {
    allowed = ['limit', 'offset', 'before', 'include']; result = 'json';
  } else return;
  return keys.every(key => allowed.includes(key)) ? result : undefined;
}

export function filterRealtime(text: string, direction: 'client' | 'server'): ClientRealtimeMessage | ServerRealtimeMessage {
  const raw = JSON.parse(text);
  const parsed = direction === 'client' ? parseClientRealtimeMessage(raw) : parseServerRealtimeMessage(raw);
  if (parsed.kind === 'endpoint.message' || ('endpoint' in parsed.payload)) throw new Error('SHELL_CAPABILITY_DENIED');
  if (direction === 'client') {
    if (parsed.kind === 'realtime.hello' && (parsed.payload.clientKind !== 'web' || raw.payload.endpoint !== undefined)) throw new Error('SHELL_CAPABILITY_DENIED');
    if ('subscriptions' in parsed.payload && !parsed.payload.subscriptions.every(s => topic(s.topic))) throw new Error('SHELL_TOPIC_DENIED');
    if ('topics' in parsed.payload && !parsed.payload.topics.every(topic)) throw new Error('SHELL_TOPIC_DENIED');
  } else if ('topic' in parsed.payload && !topic(parsed.payload.topic)) throw new Error('SHELL_TOPIC_DENIED');
  return parsed;
}

export class ShellSlots {
  private active = 0;
  private waiting: Array<() => void> = [];
  private closed = false;
  constructor(private readonly maximum = 16, private readonly queued = 16) {}
  async acquire(signal: AbortSignal): Promise<() => void> {
    if (this.closed || signal.aborted) throw new Error('SHELL_CLOSED');
    if (this.active >= this.maximum) {
      if (this.waiting.length >= this.queued) throw new Error('SHELL_BUSY');
      await new Promise<void>((resolve, reject) => {
        const wake = () => { signal.removeEventListener('abort', abort); this.closed ? reject(new Error('SHELL_CLOSED')) : resolve(); };
        const abort = () => { this.waiting = this.waiting.filter(w => w !== wake); reject(new Error('SHELL_CANCELLED')); };
        this.waiting.push(wake); signal.addEventListener('abort', abort, { once: true });
      });
    } else this.active++;
    if (this.closed || signal.aborted) { this.release(); throw new Error('SHELL_CLOSED'); }
    let released = false;
    return () => { if (!released) { released = true; this.release(); } };
  }
  private release() { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  close() { this.closed = true; for (const wake of this.waiting.splice(0)) wake(); }
}

/** Restrict the existing owner command contract to server-side plain text turns. */
export function shellWrite(route: 'input' | 'stop', value: unknown): string {
  if (route === 'stop') {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 1 || !('runId' in value) || typeof value.runId !== 'string'
      || !/^[A-Za-z0-9_-]{1,160}$/.test(value.runId)) throw new Error('SHELL_INPUT_DENIED');
    return JSON.stringify({ runId: value.runId });
  }
  const parsed = sessionInputCommandSchema.safeParse(value);
  if (!parsed.success) throw new Error('SHELL_INPUT_DENIED');
  const command = parsed.data;
  if (!/^[0-9a-f-]{36}$/.test(command.clientMessageId) || command.origin.type !== 'system'
    || Object.keys(command.input).some(key => key !== 'content') || !command.input.content.trim()
    || command.input.content.length > 8192
    || (command.kind === 'start' ? command.creation.projectId !== null || command.creation.execution !== null || command.creation.temporary
      : command.delivery !== 'next' || command.interrupt !== undefined || command.execution !== undefined)) throw new Error('SHELL_INPUT_DENIED');
  return JSON.stringify(command);
}
