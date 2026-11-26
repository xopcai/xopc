import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import type { CodexExecution, ExternalAgentExecution } from '../../../../agent-config/schema.js';
import { resolveUserPath } from '../../../agent-scope.js';
import type {
  ExternalAgentDriver,
  ExternalDriverTurnContext,
  ExternalRuntimeModelOption,
  ExternalRuntimeProbeResult,
  ExternalRuntimeToolCall,
  ExternalRuntimeToolResult,
} from '../../types.js';
import { CodexAppServer, deferred, record, type CodexRecord } from './app-server.js';

const execFileAsync = promisify(execFile);
const fullAccess = { approvalPolicy: 'never', sandbox: 'danger-full-access' };
const MAX_TOOL_TEXT = 32_000;
const STOP_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 8_000;

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    if (process.platform !== 'win32') accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findCodexExecutable(configuredPath?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = configuredPath?.trim() || env.XOPC_CODEX_BIN?.trim();
  if (raw) {
    const resolved = raw.includes('/') || raw.includes('\\') || raw.startsWith('~')
      ? resolveUserPath(raw)
      : raw;
    if (isAbsolute(resolved)) return isExecutableFile(resolved) ? resolved : undefined;
    const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
    for (const dir of dirs) {
      const candidate = join(dir, resolved);
      if (isExecutableFile(candidate)) return candidate;
    }
    return undefined;
  }
  const exts = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, `codex${ext}`);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function parseCodexModels(catalog: CodexRecord): ExternalRuntimeModelOption[] {
  const rawModels = Array.isArray(catalog.data) ? catalog.data : [];
  const options: ExternalRuntimeModelOption[] = [];
  const seen = new Set<string>();
  for (const entry of rawModels) {
    const item = record(entry);
    const id = text(item?.model).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = text(item?.displayName).trim() || text(item?.title).trim() || id;
    options.push({ id, label, ...(item?.isDefault === true ? { isDefault: true } : {}) });
  }
  return options;
}

function codexOptionsFromExecution(execution?: ExternalAgentExecution): CodexExecution | undefined {
  return execution?.kind === 'codex' ? execution : undefined;
}

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
    const { cwd, content, instructions, existingBinding, execution, runId, clientMessageId, signal, emit } = context;
    const codexConfig = codexOptionsFromExecution(execution);
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
      }, terminal.reject, {
        binaryPath: codexConfig?.binaryPath,
        homePath: codexConfig?.homePath,
      });

      await server.request('initialize', { clientInfo: { name: 'xopc', title: 'xopc', version: '1' } }, signal);
      server.notify('initialized');
      let selectedModel = codexConfig?.model?.trim();
      if (!selectedModel) {
        const catalog = await server.request('model/list', {}, signal);
        const models = Array.isArray(catalog.data) ? catalog.data.map(record) : [];
        selectedModel = text((models.find(candidate => candidate?.isDefault === true) ?? models[0])?.model);
      }
      const opened = await server.request(nativeThread ? 'thread/resume' : 'thread/start', {
        ...fullAccess,
        cwd,
        ...(nativeThread ? { threadId: nativeThread } : { ephemeral: false }),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(instructions ? { developerInstructions: instructions } : {}),
      }, signal);
      threadId = text(record(opened.thread)?.id);
      if (!threadId || (nativeThread && nativeThread !== threadId)) {
        throw new Error('Codex did not return the requested thread.');
      }
      const model = text(opened.model) || selectedModel || undefined;
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

  async probe(execution?: ExternalAgentExecution): Promise<ExternalRuntimeProbeResult> {
    const checkedAt = Date.now();
    const codexConfig = codexOptionsFromExecution(execution);
    const executablePath = findCodexExecutable(codexConfig?.binaryPath);
    if (!executablePath) {
      return {
        kind: 'codex',
        label: 'Codex',
        installed: false,
        status: 'not_installed',
        message: codexConfig?.binaryPath
          ? `Codex binary was not found at "${codexConfig.binaryPath}".`
          : 'Codex CLI was not found in PATH on the Gateway host.',
        hintCommand: 'npm i -g @openai/codex && codex login',
        models: [],
        checkedAt,
      };
    }

    let version: string | undefined;
    try {
      const { stdout } = await execFileAsync(executablePath, ['--version'], { timeout: 3_000 });
      const parsed = stdout.trim().match(/\d+\.\d+\.\d+[\w.-]*/)?.[0] || stdout.trim().split('\n')[0]?.trim();
      if (parsed) version = parsed;
    } catch {
      // Version detection is best-effort.
    }

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(new Error('Codex health check timed out.')), PROBE_TIMEOUT_MS);
    let server: CodexAppServer | undefined;
    try {
      server = new CodexAppServer(tmpdir(), () => {}, () => {}, {
        binaryPath: executablePath,
        homePath: codexConfig?.homePath,
      });
      await server.request('initialize', { clientInfo: { name: 'xopc', title: 'xopc', version: '1' } }, abortController.signal);
      server.notify('initialized');

      let accountInfo: ExternalRuntimeProbeResult['account'];
      try {
        const accountRes = await server.request('account/read', { refreshToken: false }, abortController.signal);
        const account = record(accountRes.account);
        if (!account && accountRes.requiresOpenaiAuth === true) {
          return {
            kind: 'codex',
            label: 'Codex',
            installed: true,
            status: 'unauthenticated',
            executablePath,
            ...(version ? { version } : {}),
            message: 'Codex is not signed in. Sign in with ChatGPT or an OpenAI API key to continue.',
            hintCommand: 'codex login',
            models: [],
            checkedAt: Date.now(),
          };
        }
        if (account) {
          const type = text(account.type);
          const email = text(account.email).trim();
          const planType = text(account.planType).trim();
          accountInfo = {
            label: email || (type === 'apiKey' ? 'OpenAI API key' : type || 'Signed in'),
            ...(planType ? { authMode: planType } : type ? { authMode: type } : {}),
          };
        }
      } catch {
        // Older Codex builds may not implement account/read; fall back to model/list.
      }

      const catalog = await server.request('model/list', {}, abortController.signal);
      const models = parseCodexModels(catalog);
      return {
        kind: 'codex',
        label: 'Codex',
        installed: true,
        status: 'ready',
        executablePath,
        ...(version ? { version } : {}),
        ...(accountInfo ? { account: accountInfo } : {}),
        models,
        checkedAt: Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unauthenticated = /auth|login|sign.?in|unauthorized|401|token/i.test(message);
      return {
        kind: 'codex',
        label: 'Codex',
        installed: true,
        status: unauthenticated ? 'unauthenticated' : 'warning',
        executablePath,
        ...(version ? { version } : {}),
        message,
        ...(unauthenticated ? { hintCommand: 'codex login' } : {}),
        models: [],
        checkedAt: Date.now(),
      };
    } finally {
      clearTimeout(timer);
      await server?.close(true);
    }
  },
};
