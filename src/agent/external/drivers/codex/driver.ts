import type {
  ExternalAgentDriver,
  ExternalDriverTurnContext,
  ExternalRuntimeToolCall,
  ExternalRuntimeToolResult,
} from '../../types.js';
import { CodexAppServer, deferred, record, type CodexRecord } from './app-server.js';

const fullAccess = { approvalPolicy: 'never', sandbox: 'danger-full-access' };
const MAX_TOOL_TEXT = 32_000;
const STOP_TIMEOUT_MS = 5_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapToolCall(item: CodexRecord, id: string): ExternalRuntimeToolCall | undefined {
  switch (item.type) {
    case 'commandExecution':
      return { id, toolName: 'exec_command', args: { cmd: text(item.command), cwd: text(item.cwd) } };
    case 'fileChange':
      return { id, toolName: 'apply_patch', args: {} };
    case 'webSearch':
      return { id, toolName: 'web_search', args: { query: text(item.query) } };
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return { id, toolName: text(item.tool) || 'codex_tool', args: { server: text(item.server) } };
    default:
      return undefined;
  }
}

function mapToolResult(
  tool: ExternalRuntimeToolCall,
  outputBuffer: string,
  item?: CodexRecord,
): ExternalRuntimeToolResult {
  const isError = !item || ['failed', 'declined', 'interrupted', 'inProgress'].includes(text(item.status))
    || item.success === false || (typeof item.exitCode === 'number' && item.exitCode !== 0);
  const output = text(item?.aggregatedOutput) || outputBuffer;
  if (tool.toolName === 'exec_command') {
    return {
      id: tool.id,
      isError,
      content: output ? [{ type: 'text', text: output.slice(0, MAX_TOOL_TEXT) }] : [],
      details: {
        command: text(tool.args.cmd),
        cwd: text(tool.args.cwd),
        exitCode: item?.exitCode ?? null,
        durationMs: item?.durationMs,
        truncated: output.length > MAX_TOOL_TEXT,
      },
    };
  }
  if (tool.toolName === 'apply_patch') {
    const changes = (Array.isArray(item?.changes) ? item.changes : []).slice(0, 100).flatMap((value: unknown) => {
      const change = record(value);
      return change && typeof change.path === 'string'
        ? [{ path: change.path, kind: text(record(change.kind)?.type), diff: text(change.diff).slice(0, 4_000) }]
        : [];
    });
    const diff = changes.map(change => change.diff).join('\n').slice(0, MAX_TOOL_TEXT);
    const lines = diff.split('\n');
    return {
      id: tool.id,
      isError,
      content: changes.length ? [{ type: 'text', text: changes.map(change => change.path).join('\n') }] : [],
      details: {
        changes: changes.map(({ path, kind }) => ({ path, kind })),
        diff,
        added: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
        removed: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length,
      },
    };
  }
  const error = text(record(item?.error)?.message);
  return {
    id: tool.id,
    isError,
    content: error ? [{ type: 'text', text: error.slice(0, MAX_TOOL_TEXT) }] : [],
    details: {},
  };
}

export const codexExternalDriver: ExternalAgentDriver = {
  kind: 'codex',
  label: 'Codex',
  transcriptProvider: 'openai-codex',
  transcriptApi: 'codex-app-server',
  defaultModelName: 'codex',
  capabilities: {
    supportsAttachments: false,
    managesOwnModel: true,
    requiresWorkspace: true,
    requiresWorkspaceWrite: true,
  },

  async runTurn(context: ExternalDriverTurnContext): Promise<void> {
    const { cwd, content, instructions, existingBinding, runId, clientMessageId, signal, emit } = context;
    const nativeThread = existingBinding?.nativeSessionId;
    const tools = new Map<string, { tool: ExternalRuntimeToolCall; output: string }>();
    const finishedTools = new Set<string>();
    const earlyEvents: Array<{ method: string; params: CodexRecord }> = [];

    let server: CodexAppServer | undefined;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let startingTurn = false;
    let interruptSent = false;
    let stopTimer: NodeJS.Timeout | undefined;
    let failed = false;

    const terminal = deferred<CodexRecord>();
    void terminal.promise.catch(() => {});
    const stopping = new AbortController();

    const interrupt = () => {
      if (!server || !threadId || !turnId || !signal.aborted || interruptSent) return;
      interruptSent = true;
      void server.request('turn/interrupt', { threadId, turnId }, stopping.signal).catch(terminal.reject);
    };

    const onAbort = () => {
      stopTimer = setTimeout(() => {
        stopping.abort(signal.reason);
        terminal.reject(signal.reason);
      }, STOP_TIMEOUT_MS);
      interrupt();
    };

    const applyNotification = (method: string, params: CodexRecord) => {
      const turn = record(params.turn);
      const eventTurn = text(turn?.id) || text(params.turnId);
      if (!eventTurn || eventTurn !== turnId) return;
      if (method === 'turn/completed' && turn) {
        terminal.resolve(turn);
        return;
      }
      const item = record(params.item);
      const id = text(item?.id) || text(params.itemId);
      if (!id) return;
      if (method === 'item/agentMessage/delta') {
        const delta = text(params.delta);
        if (delta) emit({ type: 'text_delta', itemId: id, delta });
      } else if (method === 'item/commandExecution/outputDelta') {
        const tracked = tools.get(id);
        if (!tracked) return;
        const delta = text(params.delta).slice(0, MAX_TOOL_TEXT - tracked.output.length);
        tracked.output += delta;
        if (delta) emit({ type: 'tool_output_delta', id, delta, stream: 'stdout' });
      } else if (item && (method === 'item/started' || method === 'item/completed')) {
        if (item.type === 'agentMessage' && method === 'item/completed') {
          emit({ type: 'text_done', itemId: id, text: text(item.text) });
        } else if (!finishedTools.has(id)) {
          let tracked = tools.get(id);
          if (!tracked) {
            const tool = mapToolCall(item, id);
            if (!tool) return;
            tracked = { tool, output: '' };
            tools.set(id, tracked);
            emit({ type: 'tool_start', tool });
          }
          if (method === 'item/completed') {
            emit({ type: 'tool_end', result: mapToolResult(tracked.tool, tracked.output, item) });
            finishedTools.add(id);
            tools.delete(id);
          }
        }
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });
    try {
      server = new CodexAppServer(cwd, (method, params) => {
        if (!startingTurn || params.threadId !== threadId) return;
        if (turnId) {
          applyNotification(method, params);
        } else {
          // Resuming can deliver notifications for previous turns ahead of turn/start's reply.
          if (earlyEvents.length >= 4_096) throw new Error('Codex sent too many events before acknowledging the turn.');
          earlyEvents.push({ method, params });
        }
      }, terminal.reject);

      await server.request('initialize', { clientInfo: { name: 'xopc', title: 'xopc', version: '1' } }, signal);
      server.notify('initialized');
      const catalog = await server.request('model/list', {}, signal);
      const models = Array.isArray(catalog.data) ? catalog.data.map(record) : [];
      const defaultModel = text((models.find(candidate => candidate?.isDefault === true) ?? models[0])?.model);
      const opened = await server.request(nativeThread ? 'thread/resume' : 'thread/start', {
        ...fullAccess,
        cwd,
        ...(nativeThread ? { threadId: nativeThread } : { ephemeral: false }),
        ...(defaultModel ? { model: defaultModel } : {}),
        ...(instructions ? { developerInstructions: instructions } : {}),
      }, signal);
      threadId = text(record(opened.thread)?.id);
      if (!threadId || (nativeThread && nativeThread !== threadId)) {
        throw new Error('Codex did not return the requested thread.');
      }
      const model = text(opened.model) || defaultModel || undefined;
      emit({ type: 'session_bound', nativeSessionId: threadId, ...(model ? { model } : {}) });
      signal.throwIfAborted();

      startingTurn = true;
      const started = await server.request('turn/start', {
        threadId,
        cwd,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' },
        clientUserMessageId: clientMessageId ?? runId,
        input: [{ type: 'text', text: content, text_elements: [] }],
      }, stopping.signal);
      turnId = text(record(started.turn)?.id);
      if (!turnId) throw new Error('Codex did not return a turn ID.');
      interrupt();
      for (const event of earlyEvents.splice(0)) applyNotification(event.method, event.params);

      const result = await terminal.promise;
      if (result.status === 'interrupted') {
        emit({ type: 'turn_done', status: 'interrupted' });
      } else if (result.status === 'completed') {
        emit({ type: 'turn_done', status: 'completed' });
      } else {
        failed = true;
        emit({
          type: 'turn_done',
          status: 'failed',
          errorMessage: text(record(result.error)?.message) || 'Codex did not complete the turn.',
        });
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      startingTurn = false;
      signal.removeEventListener('abort', onAbort);
      clearTimeout(stopTimer);
      await server?.close(Boolean(failed || signal.aborted));
    }
  },
};
