import type { ToolCall } from '@earendil-works/pi-ai';

import type { ExternalAgentKind } from '../../../agent-config/schema.js';
import type {
  ExternalAgentDriver,
  ExternalDriverTurnContext,
  ExternalRuntimeCapabilities,
  ExternalRuntimeToolCall,
  ExternalRuntimeToolResult,
} from '../types.js';
import { AcpJsonRpcClient, AcpRpcError, asRecord, type AcpRecord } from './json-rpc-client.js';

const MAX_TOOL_TEXT = 32_000;
const STOP_TIMEOUT_MS = 5_000;

export interface AcpSpawnConfig {
  command: string;
  args: ReadonlyArray<string>;
  env?: NodeJS.ProcessEnv;
}

export interface AcpDriverConfig {
  kind: ExternalAgentKind;
  label: string;
  transcriptProvider: string;
  defaultModelName: string;
  capabilities?: Partial<ExternalRuntimeCapabilities>;
  resolveSpawn: (cwd: string) => AcpSpawnConfig;
  notFoundMessage: string;
  signInRequiredMessage: string;
  /** Optional auth method id passed to `authenticate` (either eagerly or on -32000). */
  authMethodId?: () => string | undefined;
  /** Whether to call `authenticate` before `session/new` when authMethodId is available. */
  authenticateEagerly?: boolean;
  /** Optional `_meta` payload attached to `session/new` / `session/resume` / `session/load`. */
  buildSessionMeta?: (initializeResult: AcpRecord, instructions?: string) => AcpRecord | undefined;
  /** Optional stdout non-JSON line interceptor (e.g. Antigravity auth link). */
  onNonJsonLine?: (line: string) => Error | undefined;
  /** Optional stderr line interceptor. */
  onStderrLine?: (line: string) => Error | undefined;
  /** Optional error classifier for sign-in required failures. */
  isSignInRequiredError?: (error: unknown) => boolean;
  /** Optional filter for internal tool calls that should not appear in transcript/UI. */
  ignoreToolCall?: (update: AcpRecord) => boolean;
}

type TrackedTool = {
  tool: ExternalRuntimeToolCall;
  kind: string;
  output: string;
  diffChanges: Array<{ path: string; kind: string; diff: string }>;
};

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function contentBlockText(block: unknown): string {
  const rec = asRecord(block);
  if (!rec) return '';
  if (rec.type === 'text') return str(rec.text);
  if (rec.type === 'resource') {
    const resource = asRecord(rec.resource);
    return str(resource?.text);
  }
  if (rec.type === 'resource_link') {
    const title = firstNonEmpty(rec.title, rec.name);
    const uri = str(rec.uri);
    return title && uri ? `${title} (${uri})` : title || uri;
  }
  return '';
}

function extractToolTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec.type === 'content') {
      const text = contentBlockText(rec.content);
      if (text) parts.push(text);
    } else if (rec.type === 'text') {
      const text = str(rec.text);
      if (text) parts.push(text);
    }
  }
  return parts.join('\n');
}

function extractDiffChanges(
  content: unknown,
  locations: unknown,
  kind: string,
): Array<{ path: string; kind: string; diff: string }> {
  const changes: Array<{ path: string; kind: string; diff: string }> = [];
  if (Array.isArray(content)) {
    for (const item of content.slice(0, 100)) {
      const rec = asRecord(item);
      if (!rec || rec.type !== 'diff' || typeof rec.path !== 'string') continue;
      const oldText = str(rec.oldText);
      const newText = str(rec.newText);
      const diffLines = [
        `--- ${rec.path}`,
        `+++ ${rec.path}`,
        ...(oldText ? oldText.split('\n').map(line => `-${line}`) : []),
        ...(newText ? newText.split('\n').map(line => `+${line}`) : []),
      ];
      changes.push({
        path: rec.path,
        kind: kind === 'delete' ? 'delete' : oldText ? 'update' : 'create',
        diff: diffLines.join('\n').slice(0, 4_000),
      });
    }
  }
  if (changes.length === 0 && Array.isArray(locations)) {
    for (const loc of locations.slice(0, 100)) {
      const rec = asRecord(loc);
      if (rec && typeof rec.path === 'string' && rec.path.trim()) {
        changes.push({ path: rec.path, kind: kind || 'update', diff: '' });
      }
    }
  }
  return changes;
}

function normalizeToolCall(id: string, update: AcpRecord): { tool: ExternalRuntimeToolCall; kind: string } {
  const kind = str(update.kind).toLowerCase() || 'other';
  const title = str(update.title).trim();
  const rawInput = asRecord(update.rawInput);
  if (kind === 'execute') {
    const cmd = firstNonEmpty(
      rawInput?.CommandLine,
      rawInput?.command_line,
      rawInput?.commandLine,
      rawInput?.command,
      title,
    );
    const cwd = firstNonEmpty(
      rawInput?.Cwd,
      rawInput?.WorkingDirectory,
      rawInput?.working_dir,
      rawInput?.workingDir,
      rawInput?.cwd,
    );
    return { kind, tool: { id, toolName: 'exec_command', args: { cmd, ...(cwd ? { cwd } : {}) } } };
  }
  if (kind === 'edit' || kind === 'delete' || kind === 'move') {
    const path = firstNonEmpty(
      rawInput?.TargetFile,
      rawInput?.AbsolutePath,
      rawInput?.path,
      rawInput?.file_path,
      rawInput?.filePath,
    );
    return { kind, tool: { id, toolName: 'apply_patch', args: path ? { path } : {} } };
  }
  if (kind === 'search' || kind === 'fetch') {
    const query = firstNonEmpty(rawInput?.query, rawInput?.Query, rawInput?.url, rawInput?.Url, title);
    return { kind, tool: { id, toolName: 'web_search', args: query ? { query } : {} } };
  }
  const toolName = firstNonEmpty(update.name, title, 'acp_tool').slice(0, 128);
  const args: ToolCall['arguments'] = {};
  if (rawInput) {
    for (const [key, value] of Object.entries(rawInput).slice(0, 12)) {
      if (typeof value === 'string') args[key] = value.slice(0, 500);
      else if (typeof value === 'number' || typeof value === 'boolean') args[key] = value;
      else if (value === null) args[key] = null;
    }
  }
  return { kind, tool: { id, toolName, args } };
}

function firstNonEmptyRaw(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function extractRawOutputText(rawOutput: unknown): string {
  if (typeof rawOutput === 'string') return rawOutput;
  const rec = asRecord(rawOutput);
  if (!rec) return '';
  return firstNonEmptyRaw(
    rec.aggregatedOutput,
    rec.combinedOutput,
    rec.combined_output,
    rec.output,
    rec.stdout,
    rec.text,
    rec.content,
    rec.error,
    asRecord(rec.error)?.message,
  );
}

function buildToolResult(tracked: TrackedTool, update: AcpRecord): ExternalRuntimeToolResult {
  const status = str(update.status).toLowerCase();
  const rawOutput = asRecord(update.rawOutput);
  const exitCode = typeof rawOutput?.exitCode === 'number'
    ? rawOutput.exitCode
    : typeof rawOutput?.exit_code === 'number'
      ? rawOutput.exit_code
      : null;
  const isError = status === 'failed' || status === 'cancelled' || (exitCode !== null && exitCode !== 0);
  const contentText = extractToolTextFromContent(update.content);
  const rawText = extractRawOutputText(update.rawOutput);
  const output = contentText || rawText || tracked.output;

  if (tracked.tool.toolName === 'exec_command') {
    return {
      id: tracked.tool.id,
      isError,
      content: output ? [{ type: 'text', text: output.slice(0, MAX_TOOL_TEXT) }] : [],
      details: {
        command: str(tracked.tool.args.cmd),
        cwd: str(tracked.tool.args.cwd),
        exitCode,
        truncated: output.length > MAX_TOOL_TEXT,
      },
    };
  }
  if (tracked.tool.toolName === 'apply_patch') {
    const latestChanges = extractDiffChanges(update.content, update.locations, tracked.kind);
    const changes = latestChanges.length > 0 ? latestChanges : tracked.diffChanges;
    const diff = changes.map(change => change.diff).filter(Boolean).join('\n').slice(0, MAX_TOOL_TEXT);
    const lines = diff ? diff.split('\n') : [];
    return {
      id: tracked.tool.id,
      isError,
      content: changes.length
        ? [{ type: 'text', text: changes.map(change => change.path).join('\n') }]
        : output ? [{ type: 'text', text: output.slice(0, MAX_TOOL_TEXT) }] : [],
      details: {
        changes: changes.map(({ path, kind }) => ({ path, kind })),
        diff,
        added: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
        removed: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length,
      },
    };
  }
  return {
    id: tracked.tool.id,
    isError,
    content: output ? [{ type: 'text', text: output.slice(0, MAX_TOOL_TEXT) }] : [],
    details: {},
  };
}

function selectAutoPermissionResponse(params: AcpRecord): AcpRecord {
  const toolCall = asRecord(params.toolCall);
  const toolCallId = str(toolCall?.toolCallId);
  // Antigravity encodes native user-input questions as permission requests with `interaction_*` IDs.
  if (toolCallId.startsWith('interaction_')) {
    return { outcome: { outcome: 'cancelled' } };
  }
  const options = Array.isArray(params.options) ? params.options.map(asRecord).filter((opt): opt is AcpRecord => Boolean(opt)) : [];
  const preferred =
    options.find(opt => opt.kind === 'allow_always' && str(opt.optionId).trim())
    ?? options.find(opt => opt.kind === 'allow_once' && str(opt.optionId).trim());
  if (preferred) {
    return { outcome: { outcome: 'selected', optionId: str(preferred.optionId) } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

function extractCurrentModel(sessionResult: AcpRecord): string | undefined {
  const models = asRecord(sessionResult.models);
  if (typeof models?.currentModelId === 'string' && models.currentModelId.trim()) {
    return models.currentModelId.trim();
  }
  if (Array.isArray(sessionResult.configOptions)) {
    for (const raw of sessionResult.configOptions) {
      const opt = asRecord(raw);
      if (opt?.id === 'model' && typeof opt.currentValue === 'string' && opt.currentValue.trim()) {
        return opt.currentValue.trim();
      }
    }
  }
  return undefined;
}

function selectAuthMethodId(initializeResult: AcpRecord, preferred?: string): string | undefined {
  if (preferred?.trim()) return preferred.trim();
  const methods = Array.isArray(initializeResult.authMethods)
    ? initializeResult.authMethods.map(asRecord).filter((m): m is AcpRecord => Boolean(m))
    : [];
  const agentMethod = methods.find(m => (!m.type || m.type === 'agent') && str(m.id).trim());
  return agentMethod ? str(agentMethod.id).trim() : undefined;
}

function isAuthRequiredRpcError(error: unknown): boolean {
  return error instanceof AcpRpcError && error.code === -32000;
}

export function createAcpExternalDriver(config: AcpDriverConfig): ExternalAgentDriver {
  const capabilities: ExternalRuntimeCapabilities = {
    supportsAttachments: false,
    managesOwnModel: true,
    requiresWorkspace: true,
    requiresWorkspaceWrite: true,
    ...config.capabilities,
  };

  return {
    kind: config.kind,
    label: config.label,
    transcriptProvider: config.transcriptProvider,
    transcriptApi: 'acp',
    defaultModelName: config.defaultModelName,
    capabilities,

    async runTurn(context: ExternalDriverTurnContext): Promise<void> {
      const { cwd, content, instructions, existingBinding, signal, emit } = context;
      const spawnConfig = config.resolveSpawn(cwd);
      const tools = new Map<string, TrackedTool>();
      const finishedTools = new Set<string>();
      const ignoredTools = new Set<string>();

      let client: AcpJsonRpcClient | undefined;
      let sessionId: string | undefined;
      let acceptingPromptUpdates = false;
      let activeMessageId: string | undefined;
      let messageSeq = 0;
      let cancelSent = false;
      let stopTimer: NodeJS.Timeout | undefined;
      let failed = false;
      const promptAbort = new AbortController();

      const flushActiveMessage = () => {
        if (!activeMessageId) return;
        emit({ type: 'text_done', itemId: activeMessageId });
        activeMessageId = undefined;
      };

      const sendCancel = () => {
        if (!client || !sessionId || !signal.aborted || cancelSent) return;
        cancelSent = true;
        try {
          client.notify('session/cancel', { sessionId });
        } catch {
          // Process may already be shutting down.
        }
      };

      const onAbort = () => {
        stopTimer = setTimeout(() => {
          promptAbort.abort(signal.reason);
        }, STOP_TIMEOUT_MS);
        sendCancel();
      };

      const handleSessionUpdate = (params: AcpRecord) => {
        if (!acceptingPromptUpdates || !sessionId || params.sessionId !== sessionId) return;
        const update = asRecord(params.update);
        if (!update) return;
        const kind = str(update.sessionUpdate);

        if (kind === 'agent_message_chunk') {
          const text = contentBlockText(update.content);
          if (!text) return;
          const nextId = str(update.messageId) || activeMessageId || `msg-${++messageSeq}`;
          if (activeMessageId && activeMessageId !== nextId) {
            emit({ type: 'text_done', itemId: activeMessageId });
          }
          activeMessageId = nextId;
          emit({ type: 'text_delta', itemId: nextId, delta: text });
          return;
        }

        if (kind === 'agent_thought_chunk') {
          const text = contentBlockText(update.content);
          if (text) emit({ type: 'thinking_delta', itemId: activeMessageId ?? 'thought', delta: text });
          return;
        }

        if (kind === 'usage_update') {
          const used = typeof update.used === 'number' ? update.used : undefined;
          if (used !== undefined) {
            emit({ type: 'usage', usage: { input: 0, output: 0, totalTokens: used } });
          }
          return;
        }

        if (kind === 'tool_call' || kind === 'tool_call_update') {
          const toolCallId = str(update.toolCallId).trim();
          if (!toolCallId) return;
          if (ignoredTools.has(toolCallId)) {
            const status = str(update.status).toLowerCase();
            if (status === 'completed' || status === 'failed' || status === 'cancelled') {
              ignoredTools.delete(toolCallId);
            }
            return;
          }
          if (config.ignoreToolCall?.(update)) {
            ignoredTools.add(toolCallId);
            return;
          }
          if (finishedTools.has(toolCallId)) return;

          flushActiveMessage();
          let tracked = tools.get(toolCallId);
          if (!tracked) {
            const normalized = normalizeToolCall(toolCallId, update);
            tracked = {
              tool: normalized.tool,
              kind: normalized.kind,
              output: '',
              diffChanges: extractDiffChanges(update.content, update.locations, normalized.kind),
            };
            tools.set(toolCallId, tracked);
            emit({ type: 'tool_start', tool: tracked.tool });
          } else {
            const diffChanges = extractDiffChanges(update.content, update.locations, tracked.kind);
            if (diffChanges.length > 0) tracked.diffChanges = diffChanges;
          }

          const nextText = extractToolTextFromContent(update.content) || extractRawOutputText(update.rawOutput);
          if (nextText && nextText !== tracked.output) {
            const delta = nextText.startsWith(tracked.output)
              ? nextText.slice(tracked.output.length)
              : nextText;
            const boundedDelta = delta.slice(0, Math.max(0, MAX_TOOL_TEXT - tracked.output.length));
            if (boundedDelta) {
              tracked.output += boundedDelta;
              if (tracked.tool.toolName === 'exec_command') {
                emit({ type: 'tool_output_delta', id: toolCallId, delta: boundedDelta, stream: 'stdout' });
              }
            }
          }

          const status = str(update.status).toLowerCase();
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            emit({ type: 'tool_end', result: buildToolResult(tracked, update) });
            finishedTools.add(toolCallId);
            tools.delete(toolCallId);
          }
        }
      };

      signal.addEventListener('abort', onAbort, { once: true });
      try {
        client = new AcpJsonRpcClient({
          command: spawnConfig.command,
          args: spawnConfig.args,
          cwd,
          env: spawnConfig.env,
          label: config.label,
          notFoundMessage: config.notFoundMessage,
          onNotification: (method, params) => {
            if (method === 'session/update') handleSessionUpdate(params);
          },
          onRequest: (method, params) => {
            if (method === 'session/request_permission') {
              return selectAutoPermissionResponse(params);
            }
            throw new AcpRpcError(-32601, `xopc does not implement ACP client method ${method}.`);
          },
          onNonJsonLine: config.onNonJsonLine,
          onStderrLine: config.onStderrLine,
        });

        const initializeResult = await client.request(
          'initialize',
          {
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
            clientInfo: { name: 'xopc', title: 'xopc', version: '1' },
          },
          signal,
        );

        const configuredAuthMethod = config.authMethodId?.();
        if (config.authenticateEagerly && configuredAuthMethod) {
          await client.request('authenticate', { methodId: configuredAuthMethod }, signal);
        }

        const sessionMeta = config.buildSessionMeta?.(initializeResult, instructions);
        const openSession = async (): Promise<{ id: string; result: AcpRecord }> => {
          const agentCapabilities = asRecord(initializeResult.agentCapabilities);
          const sessionCapabilities = asRecord(agentCapabilities?.sessionCapabilities);
          const metaField = sessionMeta ? { _meta: sessionMeta } : {};

          if (existingBinding?.nativeSessionId) {
            const nativeId = existingBinding.nativeSessionId;
            if (sessionCapabilities?.resume != null) {
              const resumed = await client!.request(
                'session/resume',
                { sessionId: nativeId, cwd, mcpServers: [], ...metaField },
                signal,
              );
              return { id: str(resumed.sessionId) || nativeId, result: resumed };
            }
            if (agentCapabilities?.loadSession === true) {
              // Suppress historical replay notifications while session/load runs.
              const loaded = await client!.request(
                'session/load',
                { sessionId: nativeId, cwd, mcpServers: [], ...metaField },
                signal,
              );
              return { id: str(loaded.sessionId) || nativeId, result: loaded };
            }
            throw new Error(`${config.label} ACP server does not advertise session/resume or session/load support.`);
          }

          const created = await client!.request(
            'session/new',
            { cwd, mcpServers: [], ...metaField },
            signal,
          );
          const createdId = str(created.sessionId).trim();
          if (!createdId) throw new Error(`${config.label} did not return a session ID.`);
          return { id: createdId, result: created };
        };

        let opened: { id: string; result: AcpRecord };
        try {
          opened = await openSession();
        } catch (error) {
          if (!isAuthRequiredRpcError(error)) throw error;
          const authMethodId = selectAuthMethodId(initializeResult, configuredAuthMethod);
          if (!authMethodId) throw new Error(config.signInRequiredMessage, { cause: error });
          await client.request('authenticate', { methodId: authMethodId }, signal);
          opened = await openSession();
        }

        sessionId = opened.id;
        const resolvedModel = extractCurrentModel(opened.result);
        emit({
          type: 'session_bound',
          nativeSessionId: sessionId,
          ...(resolvedModel ? { model: resolvedModel } : {}),
        });
        signal.throwIfAborted();

        const promptText =
          !existingBinding && instructions && !sessionMeta
            ? `${instructions}\n\n${content}`
            : content;

        acceptingPromptUpdates = true;
        const promptResult = await client.request(
          'session/prompt',
          { sessionId, prompt: [{ type: 'text', text: promptText }] },
          promptAbort.signal,
          null,
        );

        flushActiveMessage();
        const promptUsage = asRecord(promptResult.usage);
        if (promptUsage) {
          const input = typeof promptUsage.inputTokens === 'number' ? promptUsage.inputTokens : 0;
          const output = typeof promptUsage.outputTokens === 'number' ? promptUsage.outputTokens : 0;
          const totalTokens = typeof promptUsage.totalTokens === 'number' ? promptUsage.totalTokens : input + output;
          if (input || output || totalTokens) {
            emit({ type: 'usage', usage: { input, output, totalTokens } });
          }
        }

        const stopReason = str(promptResult.stopReason).toLowerCase();
        if (stopReason === 'cancelled' || signal.aborted) {
          emit({ type: 'turn_done', status: 'interrupted' });
        } else if (stopReason === 'refusal' || stopReason === 'error') {
          failed = true;
          emit({
            type: 'turn_done',
            status: 'failed',
            errorMessage:
              stopReason === 'refusal'
                ? `${config.label} refused this request.`
                : `${config.label} did not complete the turn.`,
          });
        } else {
          emit({ type: 'turn_done', status: 'completed' });
        }
      } catch (error) {
        failed = true;
        if (config.isSignInRequiredError?.(error) || isAuthRequiredRpcError(error)) {
          throw new Error(config.signInRequiredMessage, { cause: error });
        }
        throw error;
      } finally {
        acceptingPromptUpdates = false;
        signal.removeEventListener('abort', onAbort);
        clearTimeout(stopTimer);
        await client?.close(Boolean(failed || signal.aborted));
      }
    },
  };
}
