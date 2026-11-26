import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ModelThinkingCapabilities, ModelThinkingValue } from '@xopcai/gateway-contract';

import type { CodexExecution, ExternalAgentExecution, ExternalPermissionMode } from '../../../../agent-config/schema.js';
import { resolveUserPath } from '../../../agent-scope.js';
import { PLAN_MODE_INSTRUCTIONS, type SessionInteractionPolicy } from '../../../session/interaction-policy-state.js';
import { normalizeThinkLevel } from '../../../transcript/thinking-types.js';
import { formatFileAttachmentsContext } from '../../attachments.js';
import { projectMcpServersForCodex } from '../../mcp-bridge.js';
import {
  buildNormalizedApplyPatchResult,
  buildNormalizedExecCommandResult,
  MAX_EXTERNAL_TOOL_TEXT,
  summarizeFileChanges,
  toWorkspaceRelativePath,
  unwrapShellCommand,
} from '../../presentation.js';
import {
  checkinPooledExternalSession,
  checkoutPooledExternalSession,
  disposePooledExternalSession,
} from '../../session-pool.js';
import type {
  ExternalAgentDriver,
  ExternalDriverTurnContext,
  ExternalRuntimeCommand,
  ExternalRuntimeModelOption,
  ExternalRuntimeProbeResult,
  ExternalRuntimeRateLimits,
  ExternalRuntimeRateLimitWindow,
  ExternalRuntimeServiceTier,
  ExternalRuntimeToolCall,
  ExternalRuntimeToolResult,
  ExternalSessionControlContext,
} from '../../types.js';
import { CodexAppServer, deferred, record, type CodexRecord } from './app-server.js';
import { findCodexExecutable } from './executable.js';

export { findCodexExecutable };

const execFileAsync = promisify(execFile);
const STOP_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;
const CATALOG_REFRESH_WAIT_MS = 3_000;
const CATALOG_REFRESH_POLL_MS = 150;

const CODEX_THINKING_ORDER: ReadonlyArray<ModelThinkingValue> = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function mapCodexEffortToThinkingValue(raw: unknown): ModelThinkingValue | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'none' || trimmed === 'off') return 'off';
  const normalized = normalizeThinkLevel(trimmed);
  if (normalized && CODEX_THINKING_ORDER.includes(normalized as ModelThinkingValue)) {
    return normalized as ModelThinkingValue;
  }
  return undefined;
}

function mapThinkingLevelToCodexEffort(raw?: string): string | undefined {
  if (!raw) return undefined;
  const normalized = normalizeThinkLevel(raw);
  if (!normalized || normalized === 'adaptive') return undefined;
  if (normalized === 'off') return 'none';
  if (normalized === 'max') return 'xhigh';
  return normalized;
}

function parseCodexModelThinking(item: CodexRecord): ModelThinkingCapabilities | undefined {
  const rawEfforts = Array.isArray(item.supportedReasoningEfforts) ? item.supportedReasoningEfforts : [];
  const options: ModelThinkingValue[] = [];
  for (const rawEntry of rawEfforts) {
    const entry = record(rawEntry);
    const mapped = mapCodexEffortToThinkingValue(entry?.reasoningEffort ?? rawEntry);
    if (mapped && !options.includes(mapped)) options.push(mapped);
  }
  if (options.length === 0) return undefined;
  options.sort((a, b) => CODEX_THINKING_ORDER.indexOf(a) - CODEX_THINKING_ORDER.indexOf(b));
  const defaultVal = mapCodexEffortToThinkingValue(item.defaultReasoningEffort);
  const initialValue = (defaultVal && options.includes(defaultVal))
    ? defaultVal
    : options.includes('medium')
      ? 'medium'
      : options[0]!;
  if (options.length === 1) {
    return {
      mode: options[0] === 'off' ? 'none' : 'fixed',
      options,
      initialValue,
      supportsAdaptive: false,
    };
  }
  return {
    mode: 'levels',
    options,
    initialValue,
    supportsAdaptive: false,
  };
}

function parseCodexServiceTiers(item: CodexRecord): ExternalRuntimeServiceTier[] | undefined {
  const rawTiers = Array.isArray(item.serviceTiers) ? item.serviceTiers : [];
  const defaultTier = text(item.defaultServiceTier).trim();
  const tiers: ExternalRuntimeServiceTier[] = [];
  const seen = new Set<string>();
  for (const raw of rawTiers) {
    const rec = record(raw);
    const id = text(rec?.id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = text(rec?.name).trim() || id;
    const description = text(rec?.description).trim() || undefined;
    tiers.push({
      id,
      label,
      ...(description ? { description } : {}),
      ...(defaultTier === id ? { isDefault: true } : {}),
    });
  }
  return tiers.length > 0 ? tiers : undefined;
}

function parseCodexRateLimitWindow(raw: unknown): ExternalRuntimeRateLimitWindow | undefined {
  const rec = record(raw);
  if (!rec || typeof rec.usedPercent !== 'number' || !Number.isFinite(rec.usedPercent)) return undefined;
  return {
    usedPercent: Math.max(0, Math.min(100, Math.round(rec.usedPercent))),
    ...(typeof rec.windowDurationMins === 'number' && Number.isFinite(rec.windowDurationMins)
      ? { windowDurationMins: rec.windowDurationMins }
      : {}),
    ...(typeof rec.resetsAt === 'number' && Number.isFinite(rec.resetsAt)
      ? { resetsAt: rec.resetsAt > 1e12 ? rec.resetsAt : rec.resetsAt * 1000 }
      : {}),
  };
}

function parseCodexRateLimits(raw: CodexRecord): ExternalRuntimeRateLimits | undefined {
  const snapshot = record(raw.rateLimits);
  if (!snapshot) return undefined;
  const primary = parseCodexRateLimitWindow(snapshot.primary);
  const secondary = parseCodexRateLimitWindow(snapshot.secondary);
  const planLabel = text(snapshot.planType).trim() || undefined;
  if (!primary && !secondary) return undefined;
  return {
    ...(planLabel ? { planLabel } : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
  };
}

function parseCodexSkills(raw: CodexRecord): ExternalRuntimeCommand[] {
  const entries = Array.isArray(raw.data) ? raw.data : [];
  const out: ExternalRuntimeCommand[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const rec = record(entry);
    const skills = Array.isArray(rec?.skills) ? rec.skills : [];
    for (const rawSkill of skills) {
      const skill = record(rawSkill);
      if (!skill || skill.enabled === false) continue;
      const name = text(skill.name).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const iface = record(skill.interface);
      const rawDescription =
        text(iface?.shortDescription).trim()
        || text(skill.description).trim();
      const description = rawDescription
        ? (rawDescription.length > 160 ? `${rawDescription.slice(0, 159).trimEnd()}…` : rawDescription)
        : undefined;
      out.push({ name, ...(description ? { description } : {}), source: 'skill' });
    }
  }
  return out;
}

function parseCodexModels(catalog: CodexRecord): ExternalRuntimeModelOption[] {
  const rawModels = Array.isArray(catalog.data) ? catalog.data : [];
  const options: ExternalRuntimeModelOption[] = [];
  const seen = new Set<string>();
  for (const entry of rawModels) {
    const item = record(entry);
    if (!item || item.hidden === true) continue;
    const id = text(item.model).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = text(item.displayName).trim() || text(item.title).trim() || id;
    const thinking = parseCodexModelThinking(item);
    const serviceTiers = parseCodexServiceTiers(item);
    const rawCtx = typeof item.contextWindow === 'number'
      ? item.contextWindow
      : typeof item.maxContextTokens === 'number'
        ? item.maxContextTokens
        : typeof item.inputTokenLimit === 'number'
          ? item.inputTokenLimit
          : undefined;
    const contextWindow = rawCtx && Number.isFinite(rawCtx) && rawCtx > 0 ? Math.trunc(rawCtx) : 272_000;
    options.push({
      id,
      label,
      contextWindow,
      ...(item.isDefault === true ? { isDefault: true } : {}),
      ...(thinking ? { thinking } : {}),
      ...(serviceTiers ? { serviceTiers } : {}),
    });
  }
  return options;
}

async function listAllCodexModels(
  server: CodexAppServer,
  signal: AbortSignal,
): Promise<ExternalRuntimeModelOption[]> {
  const collected: ExternalRuntimeModelOption[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const catalog = await server.request('model/list', cursor ? { cursor, limit: 100 } : { limit: 100 }, signal);
    for (const model of parseCodexModels(catalog)) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      collected.push(model);
    }
    const nextCursor = text(catalog.nextCursor).trim();
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return collected;
}

async function readCodexModelsCacheFetchedAtMs(homePath?: string): Promise<number> {
  const codexHome = homePath?.trim()
    ? resolveUserPath(homePath.trim())
    : process.env.CODEX_HOME?.trim()
      ? resolveUserPath(process.env.CODEX_HOME.trim())
      : join(homedir(), '.codex');
  try {
    const raw = await readFile(join(codexHome, 'models_cache.json'), 'utf8');
    const parsed = JSON.parse(raw) as { fetched_at?: unknown };
    if (typeof parsed.fetched_at !== 'string') return Number.NaN;
    return Date.parse(parsed.fetched_at);
  } catch {
    return Number.NaN;
  }
}

async function waitForCodexCatalogRefresh(
  homePath: string | undefined,
  spawnedAtMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + CATALOG_REFRESH_WAIT_MS;
  while (Date.now() < deadline && !signal.aborted) {
    const fetchedAtMs = await readCodexModelsCacheFetchedAtMs(homePath);
    if (Number.isFinite(fetchedAtMs) && fetchedAtMs >= spawnedAtMs) return true;
    await new Promise((resolve) => setTimeout(resolve, CATALOG_REFRESH_POLL_MS));
  }
  return false;
}

function codexOptionsFromExecution(execution?: ExternalAgentExecution): CodexExecution | undefined {
  return execution?.kind === 'codex' ? execution : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function resolveCodexSandboxSettings(
  cwd: string,
  permissionMode: ExternalPermissionMode,
  sessionPolicy: SessionInteractionPolicy,
): {
  approvalPolicy: 'never' | 'on-request';
  sandbox: 'danger-full-access' | 'workspace-write' | 'read-only';
  sandboxPolicy: Record<string, unknown>;
} {
  if (sessionPolicy.mode === 'plan' || sessionPolicy.access === 'read-only') {
    return {
      approvalPolicy: 'on-request',
      sandbox: 'read-only',
      sandboxPolicy: { type: 'readOnly' },
    };
  }
  const approvalPolicy = permissionMode === 'ask' || permissionMode === 'auto_edit' ? 'on-request' : 'never';
  if (sessionPolicy.sandbox === 'unrestricted') {
    return {
      approvalPolicy,
      sandbox: 'danger-full-access',
      sandboxPolicy: { type: 'dangerFullAccess' },
    };
  }
  return {
    approvalPolicy,
    sandbox: 'workspace-write',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [cwd],
      networkAccess: sessionPolicy.network === true,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    },
  };
}

function extractRawFileChanges(item: CodexRecord): Array<{ path: string; kind?: string; diff?: string }> {
  if (!Array.isArray(item.changes)) return [];
  const out: Array<{ path: string; kind?: string; diff?: string }> = [];
  for (const value of item.changes.slice(0, 100)) {
    const change = record(value);
    if (!change || typeof change.path !== 'string') continue;
    const kindValue = typeof change.kind === 'string' ? change.kind : text(record(change.kind)?.type);
    out.push({ path: change.path, kind: kindValue || undefined, diff: text(change.diff) });
  }
  return out;
}

function mapToolCall(item: CodexRecord, id: string, cwd: string): ExternalRuntimeToolCall | undefined {
  switch (item.type) {
    case 'commandExecution': {
      const rawCmd = text(item.command);
      const { displayCommand, rawCommand } = unwrapShellCommand(rawCmd);
      const relCwd = toWorkspaceRelativePath(text(item.cwd), cwd);
      return {
        id,
        toolName: 'exec_command',
        args: {
          cmd: displayCommand || rawCmd,
          ...(rawCommand ? { rawCommand } : {}),
          ...(relCwd ? { cwd: relCwd } : {}),
        },
      };
    }
    case 'fileChange': {
      const summary = summarizeFileChanges(extractRawFileChanges(item), cwd);
      return {
        id,
        toolName: 'apply_patch',
        args: summary.primaryPath ? { path: summary.primaryPath } : {},
      };
    }
    case 'webSearch':
      return { id, toolName: 'web_search', args: { query: text(item.query) } };
    case 'mcpToolCall':
    case 'dynamicToolCall': {
      const serverName = text(item.server).trim();
      const toolName = text(item.tool).trim() || 'codex_tool';
      const args: ExternalRuntimeToolCall['args'] = {};
      if (serverName) args.server = serverName;
      const rawArgs = record(item.arguments);
      if (rawArgs) {
        for (const [key, value] of Object.entries(rawArgs).slice(0, 8)) {
          if (typeof value === 'string') args[key] = value.slice(0, 500);
          else if (typeof value === 'number' || typeof value === 'boolean') args[key] = value;
          else if (value === null) args[key] = null;
        }
      }
      return { id, toolName: serverName ? `${serverName}__${toolName}` : toolName, args };
    }
    default:
      return undefined;
  }
}

function mapToolResult(
  tool: ExternalRuntimeToolCall,
  outputBuffer: string,
  cwd: string,
  startedAtMs: number,
  item?: CodexRecord,
): ExternalRuntimeToolResult {
  const isError = !item || ['failed', 'declined', 'interrupted', 'inProgress'].includes(text(item.status))
    || item.success === false || (typeof item.exitCode === 'number' && item.exitCode !== 0);
  const output = text(item?.aggregatedOutput) || outputBuffer;
  if (tool.toolName === 'exec_command') {
    const durationMs = typeof item?.durationMs === 'number'
      ? item.durationMs
      : Math.max(0, Date.now() - startedAtMs);
    return buildNormalizedExecCommandResult({
      id: tool.id,
      isError,
      cwd,
      command: text(item?.command) || text(tool.args.cmd),
      rawCommand: text(tool.args.rawCommand) || undefined,
      execCwd: text(item?.cwd) || text(tool.args.cwd),
      exitCode: typeof item?.exitCode === 'number' ? item.exitCode : null,
      durationMs,
      output,
    });
  }
  if (tool.toolName === 'apply_patch') {
    return buildNormalizedApplyPatchResult({
      id: tool.id,
      isError,
      cwd,
      rawChanges: item ? extractRawFileChanges(item) : [],
      fallbackOutput: output,
    });
  }
  const error = text(record(item?.error)?.message);
  const resultText = error || output || (item?.result !== undefined ? JSON.stringify(item.result).slice(0, MAX_EXTERNAL_TOOL_TEXT) : '');
  return {
    id: tool.id,
    isError,
    content: resultText ? [{ type: 'text', text: resultText.slice(0, MAX_EXTERNAL_TOOL_TEXT) }] : [],
    details: {},
  };
}

function buildCodexTurnInput(
  content: string,
  attachments: ExternalDriverTurnContext['attachments'],
): Array<Record<string, unknown>> {
  const fileContext = formatFileAttachmentsContext(attachments);
  const promptText = `${fileContext}${content}`.trim();
  const items: Array<Record<string, unknown>> = [];
  if (promptText) {
    items.push({ type: 'text', text: promptText, text_elements: [] });
  }
  for (const att of attachments) {
    if (att.type !== 'image') continue;
    if (att.localPath) {
      items.push({ type: 'localImage', path: att.localPath });
    } else if (att.base64) {
      items.push({ type: 'image', url: `data:${att.mimeType ?? 'image/png'};base64,${att.base64}` });
    }
  }
  if (items.length === 0) {
    items.push({ type: 'text', text: 'Inspect the attached content.', text_elements: [] });
  }
  return items;
}

export const codexExternalDriver: ExternalAgentDriver = {
  kind: 'codex',
  label: 'Codex',
  transcriptProvider: 'openai-codex',
  transcriptApi: 'codex-app-server',
  defaultModelName: 'codex',
  capabilities: {
    supportsAttachments: true,
    managesOwnModel: true,
    requiresWorkspace: true,
    requiresWorkspaceWrite: true,
    steeringMode: 'native',
  },

  async runTurn(context: ExternalDriverTurnContext): Promise<void> {
    const {
      cwd,
      content,
      attachments,
      instructions,
      existingBinding,
      execution,
      permissionMode,
      sessionPolicy,
      runId,
      clientMessageId,
      signal,
      emit,
      requestInteraction,
    } = context;
    const codexConfig = codexOptionsFromExecution(execution);
    const sandboxSettings = resolveCodexSandboxSettings(cwd, permissionMode, sessionPolicy);
    const nativeThread = existingBinding?.nativeSessionId;
    const tools = new Map<string, { tool: ExternalRuntimeToolCall; output: string; startedAtMs: number }>();
    const finishedTools = new Set<string>();
    const seenReasoning = new Set<string>();
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

    const handleServerRequest = async (method: string, params: CodexRecord): Promise<CodexRecord> => {
      if (method === 'item/commandExecution/requestApproval') {
        if (permissionMode === 'full_access' && sessionPolicy.mode !== 'plan' && sessionPolicy.access !== 'read-only') {
          return { decision: 'accept' };
        }
        const rawCmd = text(params.command);
        const { displayCommand } = unwrapShellCommand(rawCmd);
        const reason = text(params.reason).trim();
        const relCwd = toWorkspaceRelativePath(text(params.cwd), cwd);
        const res = await requestInteraction({
          kind: 'approval',
          title: 'Approve command',
          question: displayCommand || rawCmd || 'Allow Codex to execute this command?',
          detail: [reason, relCwd ? `cwd: ${relCwd}` : ''].filter(Boolean).join('\n') || undefined,
          actionKind: 'command',
        });
        return { decision: res.kind === 'approval' && res.decision === 'approve' ? 'accept' : 'decline' };
      }

      if (method === 'item/fileChange/requestApproval') {
        if (
          (permissionMode === 'full_access' || permissionMode === 'auto_edit')
          && sessionPolicy.mode !== 'plan'
          && sessionPolicy.access !== 'read-only'
        ) {
          return { decision: 'accept' };
        }
        const reason = text(params.reason).trim();
        const res = await requestInteraction({
          kind: 'approval',
          title: 'Approve file changes',
          question: reason || 'Allow Codex to apply changes to workspace files?',
          actionKind: 'file_change',
        });
        return { decision: res.kind === 'approval' && res.decision === 'approve' ? 'accept' : 'decline' };
      }

      if (method === 'item/tool/requestUserInput') {
        const questions = Array.isArray(params.questions)
          ? params.questions.map(record).filter((q): q is CodexRecord => Boolean(q))
          : [];
        const answers: Record<string, { answers: string[] }> = {};
        for (const q of questions) {
          const qId = text(q.id).trim();
          const prompt = text(q.question).trim();
          if (!qId || !prompt) continue;
          const rawOptions = Array.isArray(q.options) ? q.options.map(record).filter((o): o is CodexRecord => Boolean(o)) : [];
          const choices = rawOptions
            .map((opt, idx) => ({
              id: text(opt.label).trim() || `opt-${idx + 1}`,
              label: text(opt.label).trim(),
              description: text(opt.description).trim() || undefined,
            }))
            .filter((choice) => choice.label);
          const res = await requestInteraction({
            kind: 'question',
            title: text(q.header).trim() || undefined,
            question: prompt,
            ...(choices.length > 0 ? { choices } : {}),
            allowFreeText: true,
          });
          if (res.kind === 'question' && !res.cancelled) {
            const answerText = (res.text ?? res.choiceId ?? '').trim();
            if (answerText) answers[qId] = { answers: [answerText] };
          }
        }
        return { answers };
      }

      if (method === 'mcpServer/elicitation/request') {
        const serverName = text(params.serverName).trim() || 'MCP server';
        const message = text(params.message).trim();
        const mode = text(params.mode).trim();
        if (mode === 'url') {
          const url = text(params.url).trim();
          const res = await requestInteraction({
            kind: 'approval',
            title: `MCP: ${serverName}`,
            question: message || `Allow ${serverName} to continue in the browser?`,
            detail: url || undefined,
            actionKind: 'other',
          });
          return {
            action: res.kind === 'approval' && res.decision === 'approve' ? 'accept' : 'decline',
            content: null,
            _meta: null,
          };
        }

        const requestedSchema = record(params.requestedSchema);
        const properties = record(requestedSchema?.properties);
        const entries = properties ? Object.entries(properties) : [];
        if (entries.length === 0) {
          const res = await requestInteraction({
            kind: 'approval',
            title: `MCP: ${serverName}`,
            question: message || `Confirm request from ${serverName}?`,
            actionKind: 'other',
          });
          const accepted = res.kind === 'approval' && res.decision === 'approve';
          return {
            action: accepted ? 'accept' : 'decline',
            content: accepted ? {} : null,
            _meta: null,
          };
        }

        const collected: Record<string, unknown> = {};
        for (const [fieldKey, rawProp] of entries) {
          const prop = record(rawProp);
          if (!prop) continue;
          const propType = text(prop.type).trim();
          const fieldTitle = text(prop.title).trim() || fieldKey;
          const fieldDesc = text(prop.description).trim();
          const prompt = [
            entries.length === 1 && message ? message : undefined,
            fieldTitle,
            fieldDesc && fieldDesc !== fieldTitle ? fieldDesc : undefined,
          ].filter(Boolean).join(' — ');

          const choices: Array<{ id: string; label: string; description?: string }> = [];
          if (propType === 'boolean') {
            choices.push({ id: 'true', label: 'Yes' }, { id: 'false', label: 'No' });
          } else if (Array.isArray(prop.oneOf)) {
            for (const opt of prop.oneOf) {
              const rec = record(opt);
              const val = rec?.const !== undefined ? String(rec.const) : '';
              if (val) choices.push({ id: val, label: text(rec?.title).trim() || val });
            }
          } else if (Array.isArray(prop.enum)) {
            const enumNames = Array.isArray(prop.enumNames) ? prop.enumNames : [];
            prop.enum.forEach((rawVal, idx) => {
              const val = String(rawVal);
              const label = typeof enumNames[idx] === 'string' && enumNames[idx].trim()
                ? enumNames[idx].trim()
                : val;
              choices.push({ id: val, label });
            });
          }

          const res = await requestInteraction({
            kind: 'question',
            title: `MCP: ${serverName}`,
            question: prompt || fieldKey,
            ...(choices.length > 0 ? { choices } : {}),
            allowFreeText: propType !== 'boolean',
          });
          if (res.kind !== 'question' || res.cancelled) {
            return { action: 'cancel', content: null, _meta: null };
          }
          const rawAnswer = (
            choices.length > 0 && res.choiceId
              ? res.choiceId
              : (res.text ?? res.choiceId ?? '')
          ).trim();
          if (propType === 'boolean') {
            collected[fieldKey] = rawAnswer.toLowerCase() === 'true' || rawAnswer.toLowerCase() === 'yes';
          } else if (propType === 'integer') {
            const num = Number.parseInt(rawAnswer, 10);
            collected[fieldKey] = Number.isFinite(num) ? num : rawAnswer;
          } else if (propType === 'number') {
            const num = Number(rawAnswer);
            collected[fieldKey] = Number.isFinite(num) ? num : rawAnswer;
          } else if (propType === 'array') {
            collected[fieldKey] = rawAnswer ? rawAnswer.split(',').map((s) => s.trim()).filter(Boolean) : [];
          } else {
            collected[fieldKey] = rawAnswer;
          }
        }
        return { action: 'accept', content: collected, _meta: null };
      }

      throw new Error(`Unsupported Codex interactive request: ${method}`);
    };

    const applyNotification = (method: string, params: CodexRecord) => {
      if (method === 'thread/name/updated') {
        const title = text(params.threadName).trim();
        if (title) emit({ type: 'title_updated', title });
        return;
      }

      if (method === 'thread/tokenUsage/updated') {
        const tokenUsage = record(params.tokenUsage);
        const total = record(tokenUsage?.total) ?? record(tokenUsage?.last);
        if (total) {
          const input = typeof total.inputTokens === 'number' ? total.inputTokens : 0;
          const output = typeof total.outputTokens === 'number' ? total.outputTokens : 0;
          const cacheRead = typeof total.cachedInputTokens === 'number' ? total.cachedInputTokens : 0;
          const totalTokens = typeof total.totalTokens === 'number' ? total.totalTokens : input + output;
          emit({ type: 'usage', usage: { input, output, cacheRead, totalTokens } });
        }
        return;
      }

      const turn = record(params.turn);
      const eventTurn = text(turn?.id) || text(params.turnId);
      if (!eventTurn || eventTurn !== turnId) return;

      if (method === 'turn/completed' && turn) {
        terminal.resolve(turn);
        return;
      }

      if (method === 'turn/plan/updated') {
        const rawPlan = Array.isArray(params.plan) ? params.plan : [];
        const steps = rawPlan
          .map(record)
          .filter((entry): entry is CodexRecord => Boolean(entry))
          .map((entry) => ({
            step: text(entry.step),
            status: text(entry.status) as 'pending' | 'in_progress' | 'completed',
          }))
          .filter((entry) => entry.step.trim().length > 0);
        if (steps.length > 0) {
          emit({
            type: 'plan_updated',
            explanation: text(params.explanation).trim() || undefined,
            steps,
          });
        }
        return;
      }

      const item = record(params.item);
      const id = text(item?.id) || text(params.itemId);
      if (!id) return;

      if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
        const delta = text(params.delta);
        if (delta) {
          seenReasoning.add(id);
          emit({ type: 'thinking_delta', itemId: id, delta });
        }
        return;
      }

      if (method === 'item/reasoning/summaryPartAdded') {
        if (seenReasoning.has(id)) {
          emit({ type: 'thinking_delta', itemId: id, delta: '\n\n' });
        }
        return;
      }

      if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') {
        const delta = text(params.delta);
        if (delta) emit({ type: 'text_delta', itemId: id, delta });
        return;
      }

      if (method === 'item/commandExecution/outputDelta') {
        const tracked = tools.get(id);
        if (!tracked) return;
        const delta = text(params.delta).slice(0, MAX_EXTERNAL_TOOL_TEXT - tracked.output.length);
        tracked.output += delta;
        if (delta) emit({ type: 'tool_output_delta', id, delta, stream: 'stdout' });
        return;
      }

      if (item && (method === 'item/started' || method === 'item/completed')) {
        if (item.type === 'reasoning' && method === 'item/completed') {
          const summaryParts = Array.isArray(item.summary)
            ? item.summary.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            : [];
          emit({
            type: 'thinking_done',
            itemId: id,
            ...(summaryParts.length > 0 ? { text: summaryParts.join('\n\n') } : {}),
          });
        } else if ((item.type === 'agentMessage' || item.type === 'plan') && method === 'item/completed') {
          emit({ type: 'text_done', itemId: id, text: text(item.text) });
        } else if (!finishedTools.has(id)) {
          let tracked = tools.get(id);
          if (!tracked) {
            const tool = mapToolCall(item, id, cwd);
            if (!tool) return;
            tracked = { tool, output: '', startedAtMs: Date.now() };
            tools.set(id, tracked);
            emit({ type: 'tool_start', tool });
          } else if (method === 'item/completed' && tracked.tool.toolName === 'apply_patch' && !tracked.tool.args.path) {
            const updated = mapToolCall(item, id, cwd);
            if (updated?.args.path) {
              tracked.tool = updated;
              emit({ type: 'tool_update', tool: updated });
            }
          }
          if (method === 'item/completed') {
            emit({ type: 'tool_end', result: mapToolResult(tracked.tool, tracked.output, cwd, tracked.startedAtMs, item) });
            finishedTools.add(id);
            tools.delete(id);
          }
        }
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });
    type PooledCodexSession = { server: CodexAppServer; threadId: string; model?: string };
    const buildFingerprint = (boundThreadId: string) => JSON.stringify([
      'codex',
      cwd,
      codexConfig?.binaryPath?.trim() ?? '',
      codexConfig?.homePath?.trim() ?? '',
      instructions?.trim() ?? '',
      boundThreadId,
    ]);
    const dispatchNotification = (method: string, params: CodexRecord) => {
      if (!startingTurn || params.threadId !== threadId) return;
      if (turnId) {
        applyNotification(method, params);
      } else {
        // Resuming can deliver notifications for previous turns ahead of turn/start's reply.
        if (earlyEvents.length >= 4_096) throw new Error('Codex sent too many events before acknowledging the turn.');
        earlyEvents.push({ method, params });
      }
    };
    let effectiveModel: string | undefined;
    try {
      const warm = nativeThread
        ? await checkoutPooledExternalSession<PooledCodexSession>(context.conversationId, buildFingerprint(nativeThread))
        : undefined;

      if (warm) {
        server = warm.server;
        threadId = warm.threadId;
        server.setHandlers({
          onNotification: dispatchNotification,
          onFailure: terminal.reject,
          onRequest: handleServerRequest,
        });
        effectiveModel = context.modelOverride?.trim() || codexConfig?.model?.trim() || warm.model;
        emit({ type: 'session_bound', nativeSessionId: threadId, ...(effectiveModel ? { model: effectiveModel } : {}) });
        signal.throwIfAborted();
      } else {
        server = new CodexAppServer(cwd, dispatchNotification, terminal.reject, {
          binaryPath: codexConfig?.binaryPath,
          homePath: codexConfig?.homePath,
          onRequest: handleServerRequest,
        });

        await server.request('initialize', {
          clientInfo: { name: 'xopc', title: 'xopc', version: '1' },
          capabilities: { experimentalApi: true },
        }, signal);
        server.notify('initialized');
        let selectedModel = context.modelOverride?.trim() || codexConfig?.model?.trim();
        if (!selectedModel) {
          const catalog = await server.request('model/list', {}, signal);
          const models = Array.isArray(catalog.data) ? catalog.data.map(record) : [];
          selectedModel = text((models.find(candidate => candidate?.isDefault === true) ?? models[0])?.model);
        }
        const codexMcpServers = context.mcpServers?.length
          ? projectMcpServersForCodex(context.mcpServers)
          : undefined;
        const opened = await server.request(nativeThread ? 'thread/resume' : 'thread/start', {
          approvalPolicy: sandboxSettings.approvalPolicy,
          sandbox: sandboxSettings.sandbox,
          cwd,
          ...(nativeThread ? { threadId: nativeThread } : { ephemeral: false }),
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(instructions ? { developerInstructions: instructions } : {}),
          ...(codexMcpServers ? { config: { mcp_servers: codexMcpServers } } : {}),
        }, signal);
        threadId = text(record(opened.thread)?.id);
        if (!threadId || (nativeThread && nativeThread !== threadId)) {
          throw new Error('Codex did not return the requested thread.');
        }
        effectiveModel = text(opened.model) || selectedModel || undefined;
        emit({ type: 'session_bound', nativeSessionId: threadId, ...(effectiveModel ? { model: effectiveModel } : {}) });
        signal.throwIfAborted();
      }

      const requestedEffort = mapThinkingLevelToCodexEffort(context.thinkingLevel);
      const rawServiceTier = context.serviceTierOverride?.trim() || codexConfig?.serviceTier?.trim();
      const requestedServiceTier = rawServiceTier && rawServiceTier !== 'default' ? rawServiceTier : undefined;
      const effectivePrompt = sessionPolicy.mode === 'plan'
        ? `<plan_mode>\n${PLAN_MODE_INSTRUCTIONS}\n</plan_mode>\n\n${content}`
        : content;
      startingTurn = true;
      const started = await server.request('turn/start', {
        threadId,
        cwd,
        approvalPolicy: sandboxSettings.approvalPolicy,
        sandboxPolicy: sandboxSettings.sandboxPolicy,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...(requestedEffort ? { effort: requestedEffort } : {}),
        ...(requestedServiceTier ? { serviceTier: requestedServiceTier } : {}),
        clientUserMessageId: clientMessageId ?? runId,
        input: buildCodexTurnInput(effectivePrompt, attachments),
      }, stopping.signal);
      turnId = text(record(started.turn)?.id);
      if (!turnId) throw new Error('Codex did not return a turn ID.');
      const activeServer = server;
      const activeThreadId = threadId;
      const activeTurnId = turnId;
      context.registerSteerHandler?.(async (steer) => {
        if (stopping.signal.aborted || signal.aborted) {
          throw new Error('Codex turn is no longer active.');
        }
        await activeServer.request('turn/steer', {
          threadId: activeThreadId,
          expectedTurnId: activeTurnId,
          ...(steer.clientMessageId ? { clientUserMessageId: steer.clientMessageId } : {}),
          input: buildCodexTurnInput(steer.content, steer.attachments),
        }, stopping.signal);
      });
      interrupt();
      for (const event of earlyEvents.splice(0)) applyNotification(event.method, event.params);

      const result = await terminal.promise;
      context.registerSteerHandler?.(null);
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
      context.registerSteerHandler?.(null);
      startingTurn = false;
      signal.removeEventListener('abort', onAbort);
      clearTimeout(stopTimer);
      const reusable =
        !failed
        && !signal.aborted
        && Boolean(server && threadId)
        && typeof server?.isAlive === 'function'
        && typeof server?.setHandlers === 'function'
        && server.isAlive();
      if (reusable && server && threadId) {
        const pooledServer = server;
        pooledServer.setHandlers({});
        checkinPooledExternalSession<PooledCodexSession>(context.conversationId, {
          fingerprint: buildFingerprint(threadId),
          executablePath: findCodexExecutable(codexConfig?.binaryPath),
          resource: { server: pooledServer, threadId, model: effectiveModel },
          isAlive: () => pooledServer.isAlive(),
          dispose: (force) => pooledServer.close(force),
        });
      } else {
        await disposePooledExternalSession(context.conversationId, true);
        await server?.close(Boolean(failed || signal.aborted));
      }
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
    const spawnedAtMs = Date.now();
    let server: CodexAppServer | undefined;
    try {
      server = new CodexAppServer(tmpdir(), () => {}, () => {}, {
        binaryPath: executablePath,
        homePath: codexConfig?.homePath,
      });
      await server.request('initialize', {
        clientInfo: { name: 'xopc', title: 'xopc', version: '1' },
        capabilities: { experimentalApi: true },
      }, abortController.signal);
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

      let models = await listAllCodexModels(server, abortController.signal);
      const refreshed = await waitForCodexCatalogRefresh(codexConfig?.homePath, spawnedAtMs, abortController.signal);
      if (refreshed) {
        models = await listAllCodexModels(server, abortController.signal);
      }

      let rateLimits: ExternalRuntimeRateLimits | undefined;
      let commands: ExternalRuntimeCommand[] | undefined;
      const optionalProbeSignal = AbortSignal.any([abortController.signal, AbortSignal.timeout(2_500)]);
      const [rateLimitsRes, skillsRes] = await Promise.allSettled([
        server.request('account/rateLimits/read', {}, optionalProbeSignal),
        server.request('skills/list', {}, optionalProbeSignal),
      ]);
      if (rateLimitsRes.status === 'fulfilled') {
        rateLimits = parseCodexRateLimits(rateLimitsRes.value);
      }
      if (skillsRes.status === 'fulfilled') {
        const parsedSkills = parseCodexSkills(skillsRes.value);
        if (parsedSkills.length > 0) commands = parsedSkills;
      }

      return {
        kind: 'codex',
        label: 'Codex',
        installed: true,
        status: 'ready',
        executablePath,
        ...(version ? { version } : {}),
        ...(accountInfo ? { account: accountInfo } : {}),
        ...(rateLimits ? { rateLimits } : {}),
        ...(commands ? { commands } : {}),
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

  async compactSession(context: ExternalSessionControlContext): Promise<{ compacted: boolean; summary?: string }> {
    const codexConfig = codexOptionsFromExecution(context.execution);
    const abortController = new AbortController();
    const signal = context.signal ? AbortSignal.any([context.signal, abortController.signal]) : abortController.signal;
    const timer = setTimeout(() => abortController.abort(new Error('Codex compaction timed out.')), 45_000);
    await disposePooledExternalSession(context.conversationId, false);
    const server = new CodexAppServer(context.cwd, () => {}, () => {}, {
      binaryPath: codexConfig?.binaryPath,
      homePath: codexConfig?.homePath,
    });
    try {
      await server.request('initialize', {
        clientInfo: { name: 'xopc', title: 'xopc', version: '1' },
        capabilities: { experimentalApi: true },
      }, signal);
      server.notify('initialized');
      await server.request('thread/resume', {
        threadId: context.nativeSessionId,
        cwd: context.cwd,
      }, signal);
      await server.request('thread/compact/start', { threadId: context.nativeSessionId }, signal);
      return { compacted: true, summary: 'Codex thread context compacted.' };
    } finally {
      clearTimeout(timer);
      await server.close(false);
    }
  },

  async forkSession(
    context: ExternalSessionControlContext,
  ): Promise<{ nativeSessionId: string; resumeCursor?: string } | null> {
    const codexConfig = codexOptionsFromExecution(context.execution);
    const abortController = new AbortController();
    const signal = context.signal ? AbortSignal.any([context.signal, abortController.signal]) : abortController.signal;
    const timer = setTimeout(() => abortController.abort(new Error('Codex fork timed out.')), 20_000);
    const server = new CodexAppServer(context.cwd, () => {}, () => {}, {
      binaryPath: codexConfig?.binaryPath,
      homePath: codexConfig?.homePath,
    });
    try {
      await server.request('initialize', {
        clientInfo: { name: 'xopc', title: 'xopc', version: '1' },
        capabilities: { experimentalApi: true },
      }, signal);
      server.notify('initialized');
      const forked = await server.request('thread/fork', {
        threadId: context.nativeSessionId,
        cwd: context.cwd,
        ...(context.instructions ? { developerInstructions: context.instructions } : {}),
      }, signal);
      const newThreadId = text(record(forked.thread)?.id).trim();
      if (!newThreadId) throw new Error('Codex did not return a forked thread ID.');
      return { nativeSessionId: newThreadId };
    } finally {
      clearTimeout(timer);
      await server.close(false);
    }
  },

  async rollbackSession(
    context: ExternalSessionControlContext & { numTurns: number },
  ): Promise<{ rolledBack: boolean }> {
    const codexConfig = codexOptionsFromExecution(context.execution);
    const abortController = new AbortController();
    const signal = context.signal ? AbortSignal.any([context.signal, abortController.signal]) : abortController.signal;
    const timer = setTimeout(() => abortController.abort(new Error('Codex rollback timed out.')), 20_000);
    await disposePooledExternalSession(context.conversationId, false);
    const server = new CodexAppServer(context.cwd, () => {}, () => {}, {
      binaryPath: codexConfig?.binaryPath,
      homePath: codexConfig?.homePath,
    });
    try {
      await server.request('initialize', {
        clientInfo: { name: 'xopc', title: 'xopc', version: '1' },
        capabilities: { experimentalApi: true },
      }, signal);
      server.notify('initialized');
      await server.request('thread/resume', {
        threadId: context.nativeSessionId,
        cwd: context.cwd,
      }, signal);
      await server.request('thread/rollback', {
        threadId: context.nativeSessionId,
        numTurns: Math.max(1, Math.trunc(context.numTurns)),
      }, signal);
      return { rolledBack: true };
    } finally {
      clearTimeout(timer);
      await server.close(false);
    }
  },
};
