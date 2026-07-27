import {
  redactSensitive,
  TraceEmitter,
  type AgentAdapter,
  type AgentRunResult,
  type RunRequest,
  type TraceEvent,
  type TraceEventType,
} from '@agent-evals/protocol';

interface XopcAdapterConfig {
  baseUrl?: string;
  token?: string;
  thinking?: string;
  cleanupSession?: boolean;
}

interface ActiveRun {
  baseUrl: string;
  token?: string;
  sessionKey: string;
  agentRunId?: string;
  cleanupSession: boolean;
}

interface ParsedSseEvent {
  event: string;
  data: string;
  id?: string;
}

function mapEventType(type: string): TraceEventType {
  if (type === 'run_start') return 'run.started';
  if (type === 'run_end' || type === 'run_complete' || type === 'done') return 'run.completed';
  if (type === 'llm_request' || type === 'model_request') return 'model.request';
  if (type === 'llm_response' || type === 'model_response') return 'model.response';
  if (type.includes('tool') && type.includes('start')) return 'tool.started';
  if (type.includes('tool') && (type.includes('end') || type.includes('result'))) {
    return 'tool.finished';
  }
  if (type.includes('assistant') || type.includes('message')) return 'model.response';
  if (type === 'error') return 'run.failed';
  return 'agent.event';
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ParsedSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseBlock(block);
      if (parsed) yield parsed;
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const parsed = parseSseBlock(buffer);
    if (parsed) yield parsed;
  }
}

function parseSseBlock(block: string): ParsedSseEvent | undefined {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon >= 0 ? line.slice(0, colon) : line;
    const value = colon >= 0 ? line.slice(colon + 1).replace(/^ /, '') : '';
    if (field === 'event') event = value;
    if (field === 'id') id = value;
    if (field === 'data') data.push(value);
  }
  if (data.length === 0) return undefined;
  return { event, data: data.join('\n'), ...(id ? { id } : {}) };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}

function headers(token: string | undefined, accept: string): Record<string, string> {
  return {
    Accept: accept,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function requireOk(response: Response, operation: string): Promise<Response> {
  if (response.ok) return response;
  throw new Error(`xopc ${operation} returned HTTP ${response.status}: ${await response.text()}`);
}

export class XopcGatewayAdapter implements AgentAdapter {
  readonly id = 'xopc';
  private readonly activeRuns = new Map<string, ActiveRun>();

  async run(
    request: RunRequest,
    onEvent: (event: TraceEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<AgentRunResult> {
    const config = (request.variant.config ?? {}) as XopcAdapterConfig;
    const baseUrl = (config.baseUrl ?? process.env.XOPC_EVAL_BASE_URL ?? 'http://127.0.0.1:3000')
      .replace(/\/$/, '');
    const token = process.env.XOPC_EVAL_TOKEN ?? config.token;
    const agentId = request.variant.agentId ?? 'coder';
    const trace = new TraceEmitter(request.runId, onEvent);
    const requestHeaders = headers(token, 'application/json');

    const createResponse = await requireOk(await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        channel: 'webchat',
        agentId,
        chat_id: `eval_${request.runId}`,
      }),
      signal,
    }), 'session creation');
    const createBody = record(await createResponse.json());
    const session = record(createBody.session);
    const sessionKey = typeof session.key === 'string' ? session.key : undefined;
    if (!sessionKey) throw new Error('xopc session creation response did not include session.key');

    this.activeRuns.set(request.runId, {
      baseUrl,
      ...(token ? { token } : {}),
      sessionKey,
      cleanupSession: config.cleanupSession ?? true,
    });

    const sessionConfig = {
      workingDirectory: request.environment.workspace,
      ...(request.variant.model ? { model: request.variant.model } : {}),
      ...(config.thinking ? { thinkingLevel: config.thinking } : {}),
      ...(request.variant.reasoning ? { reasoningLevel: request.variant.reasoning } : {}),
    };
    await requireOk(await fetch(
      `${baseUrl}/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`,
      {
        method: 'PATCH',
        headers: requestHeaders,
        body: JSON.stringify(sessionConfig),
        signal,
      },
    ), 'session configuration');

    let runtimeIdentity: Record<string, unknown> | undefined;
    const identityResponse = await fetch(
      `${baseUrl}/api/eval/runtime-identity?agentId=${encodeURIComponent(agentId)}`,
      {
        headers: requestHeaders,
        signal,
      },
    ).catch(() => undefined);
    if (identityResponse?.ok) {
      const body = record(await identityResponse.json());
      runtimeIdentity = record(body.payload ?? body);
      await trace.emit('agent.event', {
        kind: 'runtime.identity',
        identity: redactSensitive(runtimeIdentity),
      });
    }

    const response = await fetch(`${baseUrl}/api/agent`, {
      method: 'POST',
      headers: headers(token, 'text/event-stream'),
      body: JSON.stringify({
        message: request.evalCase.task,
        channel: 'webchat',
        sessionKey,
        clientCreatedAtMs: Date.now(),
        ...(config.thinking ? { thinking: config.thinking } : {}),
      }),
      signal,
    });
    await requireOk(response, 'agent run');
    if (!response.body) throw new Error('xopc agent run returned an empty response body');

    let finalText = '';
    let agentRunId: string | undefined;
    let failure: string | undefined;
    let usage: Record<string, number> | undefined;
    for await (const event of parseSseStream(response.body)) {
      let decoded: Record<string, unknown>;
      try {
        decoded = record(JSON.parse(event.data));
      } catch {
        decoded = { data: event.data };
      }
      const rawType = typeof decoded.type === 'string' ? decoded.type : event.event;
      const payload = record(decoded.payload);
      if (typeof decoded.runId === 'string') {
        agentRunId = decoded.runId;
        const active = this.activeRuns.get(request.runId);
        if (active) active.agentRunId = agentRunId;
      }
      const delta = payload.delta;
      if (rawType === 'assistant_delta' && typeof delta === 'string') finalText += delta;
      if (rawType === 'error') {
        failure = typeof payload.message === 'string' ? payload.message : event.data;
      }
      if (payload.usage && typeof payload.usage === 'object') {
        usage = Object.fromEntries(
          Object.entries(payload.usage).filter((entry): entry is [string, number] =>
            typeof entry[1] === 'number'),
        );
      }
      await trace.emit(mapEventType(rawType), {
        source: 'xopc-sse',
        rawType,
        sseId: event.id,
        payload: redactSensitive(payload),
      });
    }
    return {
      status: failure ? 'failed' : 'completed',
      finalText,
      sessionKey,
      ...(agentRunId ? { agentRunId } : {}),
      ...(usage ? { usage } : {}),
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
      ...(failure ? { error: failure } : {}),
    };
  }

  async abort(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (!active?.agentRunId) return;
    await fetch(`${active.baseUrl}/api/agent/abort`, {
      method: 'POST',
      headers: headers(active.token, 'application/json'),
      body: JSON.stringify({ runId: active.agentRunId }),
    }).catch(() => {});
  }

  async cleanup(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    this.activeRuns.delete(runId);
    if (!active?.cleanupSession) return;
    await fetch(`${active.baseUrl}/api/sessions/${encodeURIComponent(active.sessionKey)}`, {
      method: 'DELETE',
      headers: headers(active.token, 'application/json'),
    }).catch(() => {});
  }
}
