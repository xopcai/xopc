import { runRealtimeInput } from './realtime-run.js';

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

    const thinkingLevel = config.thinking ?? request.variant.reasoning;
    const sessionConfig = {
      workingDirectory: request.environment.workspace,
      ...(request.variant.model ? { model: request.variant.model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
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
    const [identityResponse, sessionConfigResponse] = await Promise.all([
      fetch(
        `${baseUrl}/api/eval/runtime-identity?agentId=${encodeURIComponent(agentId)}`,
        {
          headers: requestHeaders,
          signal,
        },
      ).catch(() => undefined),
      fetch(
        `${baseUrl}/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`,
        {
          headers: requestHeaders,
          signal,
        },
      ).catch(() => undefined),
    ]);
    if (identityResponse?.ok) {
      const body = record(await identityResponse.json());
      runtimeIdentity = record(body.payload ?? body);
      if (sessionConfigResponse?.ok) {
        const sessionBody = record(await sessionConfigResponse.json());
        const effectiveSession = record(sessionBody.payload ?? sessionBody);
        runtimeIdentity = {
          ...runtimeIdentity,
          effectiveModelRef: effectiveSession.model ?? null,
          effectiveThinkingLevel: effectiveSession.thinkingLevel ?? null,
          effectiveReasoningVisibility: effectiveSession.reasoningLevel ?? null,
          effectiveWorkspacePath: effectiveSession.effectiveWorkspacePath ?? null,
        };
      }
      await trace.emit('agent.event', {
        kind: 'runtime.identity',
        identity: redactSensitive(runtimeIdentity),
      });
    }

    let finalText = '';
    let failure: string | undefined;
    let usage: Record<string, number> | undefined;
    const agentRunId = await runRealtimeInput({
      baseUrl, headers: requestHeaders, sessionKey, message: request.evalCase.task, signal,
      ...(thinkingLevel ? { thinking: thinkingLevel } : {}),
      onRunId: runId => {
        const active = this.activeRuns.get(request.runId);
        if (active) active.agentRunId = runId;
      },
      onEvent: async (event, decoded, seq) => {
        const rawType = typeof decoded.type === 'string' ? decoded.type : event;
        const payload = record(decoded.payload);
        if (rawType === 'assistant_delta' && typeof payload.delta === 'string') finalText += payload.delta;
        if (rawType === 'error') failure = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload);
        if (payload.usage && typeof payload.usage === 'object') {
          usage = Object.fromEntries(Object.entries(payload.usage).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
        }
        await trace.emit(mapEventType(rawType), {
          source: 'xopc-realtime', rawType, seq, payload: redactSensitive(payload),
        });
      },
    });
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
