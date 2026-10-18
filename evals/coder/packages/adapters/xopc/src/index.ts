import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

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
  conversationId: string;
  agentRunId?: string;
  cleanupSession: boolean;
}

function mapEventType(type: string): TraceEventType {
  if (type === 'run_start') return 'run.started';
  if (type === 'run_end') return 'run.completed';
  if (type === 'assistant_message_start') return 'model.request';
  if (type === 'assistant_message_end') return 'model.response';
  if (type.includes('tool') && type.includes('start')) return 'tool.started';
  if (type.includes('tool') && (type.includes('end') || type.includes('result'))) {
    return 'tool.finished';
  }
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

export interface XopcAdapterTurnContext {
  baseUrl: string;
  headers: Record<string, string>;
  conversationId: string;
  transcriptId: string;
  turnIndex: number;
  signal: AbortSignal;
}

export interface XopcAdapterHooks {
  onSession?(request: RunRequest, context: XopcAdapterTurnContext): Promise<void>;
  beforeTurn?(request: RunRequest, context: XopcAdapterTurnContext): Promise<void>;
  afterTurn?(request: RunRequest, context: XopcAdapterTurnContext, finalText: string): Promise<void>;
}

export class XopcGatewayAdapter implements AgentAdapter {
  readonly id = 'xopc';
  constructor(private readonly hooks: XopcAdapterHooks = {}) {}
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

    const conversationId = randomUUID();
    const thinkingLevel = config.thinking ?? request.variant.reasoning ?? 'off';
    const createResponse = await requireOk(await fetch(`${baseUrl}/api/sessions/${conversationId}/materialize`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        commandId: randomUUID(),
        purpose: 'session_resources',
        creation: {
          agentId,
          projectId: null,
          execution: null,
          temporary: true,
          model: request.variant.model,
          thinkingLevel,
        },
      }),
      signal,
    }), 'session materialization');
    const createBody = record(await createResponse.json());
    const created = record(createBody.payload);
    const session = record(created.session);
    const transcriptId = typeof session.transcriptId === 'string' ? session.transcriptId : undefined;
    if (!transcriptId) throw new Error('xopc session materialization response did not include session.transcriptId');

    this.activeRuns.set(request.runId, {
      baseUrl,
      ...(token ? { token } : {}),
      conversationId,
      cleanupSession: config.cleanupSession ?? true,
    });

    const sessionConfig = {
      workingDirectory: request.environment.workspace,
      ...(request.variant.model ? { model: request.variant.model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
    const configResponse = await requireOk(await fetch(
      `${baseUrl}/api/sessions/${encodeURIComponent(conversationId)}/agent-config`,
      {
        method: 'PATCH',
        headers: requestHeaders,
        body: JSON.stringify(sessionConfig),
        signal,
      },
    ), 'session configuration');
    const configured = record(record(await configResponse.json()).payload);
    let configVersion = typeof configured.configVersion === 'number' ? configured.configVersion : undefined;
    if (configVersion === undefined) throw new Error('xopc session configuration response did not include configVersion');

    const turnContext = { baseUrl, headers: requestHeaders, conversationId, transcriptId, turnIndex: 0, signal };
    await this.hooks.onSession?.(request, turnContext);

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
        `${baseUrl}/api/sessions/${encodeURIComponent(conversationId)}/agent-config`,
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
    let agentRunId: string | undefined;
    const turns = [{ message: request.evalCase.task }, ...(request.evalCase.followUps ?? [])];
    for (const [turnIndex, turn] of turns.entries()) {
      if (signal.aborted) throw new Error('Evaluation aborted');
      const currentTurn = { ...turnContext, turnIndex };
      await this.hooks.beforeTurn?.(request, currentTurn);
      if (this.hooks.beforeTurn || this.hooks.onSession) {
        const selection = record(record(await (await requireOk(await fetch(
          `${baseUrl}/api/sessions/${encodeURIComponent(conversationId)}/agent-config`,
          {headers:requestHeaders,signal}), 'refresh configuration')).json()).payload);
        if (selection.model !== request.variant.model || selection.thinkingLevel !== thinkingLevel) throw new Error('Model or thinking drift before turn');
        configVersion = Number(selection.configVersion);
      }
      if (this.hooks.onSession || this.hooks.beforeTurn || this.hooks.afterTurn) await trace.emit('agent.event', {kind:'harness.input', turnIndex, message:turn.message});
      for (const path of 'removeFiles' in turn ? turn.removeFiles ?? [] : []) {
        const root = await realpath(request.environment.workspace);
        const target = resolve(root, path);
        const rel = relative(root, target);
        if (isAbsolute(path) || !rel || rel === '..' || rel.startsWith(`..${sep}`)
          || (await realpath(target)) !== target || !(await lstat(target)).isFile()) {
          throw new Error('Fault target must be an existing regular file inside the workspace');
        }
        const bytes = await readFile(target);
        if (!bytes.length) throw new Error('Fault target must not be empty');
        await unlink(target);
        await trace.emit('agent.event', { kind: 'harness.file_removed', turnIndex, path,
          sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length });
      }
      if (turnIndex > 0) await trace.emit('agent.event', { kind: 'harness.follow_up', turnIndex, message: turn.message });
      finalText = '';
      agentRunId = await runRealtimeInput({
        baseUrl, headers: requestHeaders, conversationId, transcriptId, configVersion, message: turn.message, signal,
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
          if (rawType === 'run_end' && payload.status !== 'success') {
            failure = typeof payload.summary === 'string' ? payload.summary : `Run ended with status ${String(payload.status)}`;
          }
          if (rawType === 'assistant_message_end' && payload.usage && typeof payload.usage === 'object') {
            const reported = record(payload.usage);
            const normalized: Record<string, number> = {};
            for (const [key, field] of Object.entries({ input: 'inputTokens', output: 'outputTokens', cacheRead: 'cacheReadTokens', cacheWrite: 'cacheWriteTokens', total: 'totalTokens', cost: 'cost' })) {
              if (typeof reported[field] === 'number') normalized[key] = reported[field];
            }
            usage ??= {};
            for (const [key, value] of Object.entries(normalized)) usage[key] = (usage[key] ?? 0) + value;
            payload.usage = normalized;
          }
          await trace.emit(mapEventType(rawType), {
            source: 'xopc-realtime', rawType, seq, turnIndex, payload: redactSensitive(payload),
          });
        },
      });
      if (this.hooks.onSession || this.hooks.beforeTurn || this.hooks.afterTurn) await trace.emit('agent.event', {kind:'harness.answer', turnIndex, finalText, failure:failure??null});
      await this.hooks.afterTurn?.(request, currentTurn, finalText);
      if (failure) break;
    }
    return {
      status: failure ? 'failed' : 'completed',
      finalText,
      conversationId,
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
    await fetch(`${active.baseUrl}/api/sessions/${encodeURIComponent(active.conversationId)}`, {
      method: 'DELETE',
      headers: headers(active.token, 'application/json'),
    }).catch(() => {});
  }
}
