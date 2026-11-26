import { tmpdir } from 'node:os';

import type { ToolCall } from '@earendil-works/pi-ai';
import type { ModelThinkingCapabilities, ModelThinkingValue } from '@xopcai/gateway-contract';

import type {
  ExternalAgentExecution,
  ExternalAgentKind,
  ExternalPermissionMode,
} from '../../../agent-config/schema.js';
import { PLAN_MODE_INSTRUCTIONS, type SessionInteractionPolicy } from '../../session/interaction-policy-state.js';
import { normalizeThinkLevel } from '../../transcript/thinking-types.js';
import { formatFileAttachmentsContext } from '../attachments.js';
import {
  buildNormalizedApplyPatchResult,
  buildNormalizedExecCommandResult,
  MAX_EXTERNAL_TOOL_TEXT,
  toWorkspaceRelativePath,
  unwrapShellCommand,
} from '../presentation.js';
import { projectMcpServersForAcp } from '../mcp-bridge.js';
import {
  checkinPooledExternalSession,
  checkoutPooledExternalSession,
  disposePooledExternalSession,
} from '../session-pool.js';
import type {
  ExternalAgentDriver,
  ExternalDriverTurnContext,
  ExternalRuntimeCapabilities,
  ExternalRuntimeCommand,
  ExternalRuntimeModelOption,
  ExternalRuntimeProbeResult,
  ExternalRuntimeToolCall,
  ExternalRuntimeToolResult,
  ExternalSessionControlContext,
} from '../types.js';
import { AcpJsonRpcClient, AcpRpcError, asRecord, type AcpRecord } from './json-rpc-client.js';

const STOP_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;

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
  resolveSpawn: (cwd: string, execution?: ExternalAgentExecution) => AcpSpawnConfig;
  /** Resolve an installed executable path for probe checks; returns undefined if not installed. */
  findExecutable?: (execution?: ExternalAgentExecution) => string | undefined;
  notFoundMessage: string;
  signInRequiredMessage: string;
  installHintCommand?: string;
  loginHintCommand?: string;
  /** Optional auth method id passed to `authenticate` (either eagerly or on -32000). */
  authMethodId?: (execution?: ExternalAgentExecution) => string | undefined;
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
  startedAtMs: number;
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

function firstNonEmptyRaw(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
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

function extractFirstLocationPath(locations: unknown): string {
  if (!Array.isArray(locations)) return '';
  for (const loc of locations) {
    const rec = asRecord(loc);
    if (rec && typeof rec.path === 'string' && rec.path.trim()) return rec.path.trim();
  }
  return '';
}

function isWebSearchCall(name: string, title: string, rawInput: AcpRecord | undefined): boolean {
  const combined = `${name} ${title}`.toLowerCase();
  if (/\b(?:web|internet|online|google|bing|duckduckgo)\b/.test(combined)) return true;
  if (rawInput && (typeof rawInput.url === 'string' || typeof rawInput.Url === 'string' || typeof rawInput.domain === 'string')) {
    return true;
  }
  return false;
}

function normalizeToolCall(
  id: string,
  update: AcpRecord,
  cwd: string,
): { tool: ExternalRuntimeToolCall; kind: string } {
  const kind = str(update.kind).toLowerCase() || 'other';
  const title = str(update.title).trim();
  const rawName = str(update.name).trim();
  const rawInput = asRecord(update.rawInput);
  const locPath = extractFirstLocationPath(update.locations);

  if (kind === 'execute') {
    const rawCmd = firstNonEmpty(
      rawInput?.CommandLine,
      rawInput?.command_line,
      rawInput?.commandLine,
      rawInput?.command,
      title,
    );
    const { displayCommand, rawCommand } = unwrapShellCommand(rawCmd);
    const execCwd = firstNonEmpty(
      rawInput?.Cwd,
      rawInput?.WorkingDirectory,
      rawInput?.working_dir,
      rawInput?.workingDir,
      rawInput?.cwd,
    );
    const relCwd = execCwd ? toWorkspaceRelativePath(execCwd, cwd) : '';
    return {
      kind,
      tool: {
        id,
        toolName: 'exec_command',
        args: {
          cmd: displayCommand || rawCmd,
          ...(rawCommand ? { rawCommand } : {}),
          ...(relCwd ? { cwd: relCwd } : {}),
        },
      },
    };
  }

  if (kind === 'edit' || kind === 'delete' || kind === 'move') {
    const rawPath = firstNonEmpty(
      rawInput?.TargetFile,
      rawInput?.AbsolutePath,
      rawInput?.Path,
      rawInput?.path,
      rawInput?.file_path,
      rawInput?.filePath,
      locPath,
    );
    const relPath = rawPath ? toWorkspaceRelativePath(rawPath, cwd) : '';
    return { kind, tool: { id, toolName: 'apply_patch', args: relPath ? { path: relPath } : {} } };
  }

  if (kind === 'read') {
    const rawPath = firstNonEmpty(
      rawInput?.AbsolutePath,
      rawInput?.Path,
      rawInput?.TargetFile,
      rawInput?.path,
      rawInput?.file_path,
      rawInput?.filePath,
      locPath,
    );
    const relPath = rawPath ? toWorkspaceRelativePath(rawPath, cwd) : '';
    const isList = /\b(?:list|ls|dir|directory)\b/i.test(`${rawName} ${title}`);
    return {
      kind,
      tool: {
        id,
        toolName: isList ? 'list_directory' : 'read_file',
        args: relPath ? { path: relPath } : title ? { path: title } : {},
      },
    };
  }

  if (kind === 'fetch') {
    const url = firstNonEmpty(rawInput?.url, rawInput?.Url, rawInput?.uri, rawInput?.href, title);
    return { kind, tool: { id, toolName: 'web_fetch', args: url ? { url } : {} } };
  }

  if (kind === 'search') {
    const query = firstNonEmpty(
      rawInput?.query,
      rawInput?.Query,
      rawInput?.pattern,
      rawInput?.Pattern,
      rawInput?.name_pattern,
      rawInput?.search_term,
      title,
    );
    if (isWebSearchCall(rawName, title, rawInput)) {
      return { kind, tool: { id, toolName: 'web_search', args: query ? { query } : {} } };
    }
    const rawSearchPath = firstNonEmpty(
      rawInput?.SearchPath,
      rawInput?.SearchDirectory,
      rawInput?.path,
      rawInput?.directory,
      locPath,
    );
    const relSearchPath = rawSearchPath ? toWorkspaceRelativePath(rawSearchPath, cwd) : '';
    return {
      kind,
      tool: {
        id,
        toolName: 'grep',
        args: {
          ...(query ? { query } : {}),
          ...(relSearchPath ? { path: relSearchPath } : {}),
        },
      },
    };
  }

  const toolName = firstNonEmpty(rawName, title, 'acp_tool').slice(0, 128);
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

function buildToolResult(tracked: TrackedTool, update: AcpRecord, cwd: string): ExternalRuntimeToolResult {
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
    const durationMs = typeof rawOutput?.durationMs === 'number'
      ? rawOutput.durationMs
      : Math.max(0, Date.now() - tracked.startedAtMs);
    return buildNormalizedExecCommandResult({
      id: tracked.tool.id,
      isError,
      cwd,
      command: str(tracked.tool.args.cmd),
      rawCommand: str(tracked.tool.args.rawCommand) || undefined,
      execCwd: str(tracked.tool.args.cwd),
      exitCode,
      durationMs,
      output,
    });
  }
  if (tracked.tool.toolName === 'apply_patch') {
    const latestChanges = extractDiffChanges(update.content, update.locations, tracked.kind);
    const changes = latestChanges.length > 0 ? latestChanges : tracked.diffChanges;
    return buildNormalizedApplyPatchResult({
      id: tracked.tool.id,
      isError,
      cwd,
      rawChanges: changes,
      fallbackOutput: output,
    });
  }
  return {
    id: tracked.tool.id,
    isError,
    content: output ? [{ type: 'text', text: output.slice(0, MAX_EXTERNAL_TOOL_TEXT) }] : [],
    details: {},
  };
}

function selectAutoOption(options: ReadonlyArray<AcpRecord>, allow: boolean): AcpRecord {
  if (allow) {
    const preferred =
      options.find(opt => opt.kind === 'allow_always' && str(opt.optionId).trim())
      ?? options.find(opt => opt.kind === 'allow_once' && str(opt.optionId).trim())
      ?? options.find(opt => str(opt.optionId).trim());
    if (preferred) return { outcome: { outcome: 'selected', optionId: str(preferred.optionId) } };
  } else {
    const reject =
      options.find(opt => opt.kind === 'reject_once' && str(opt.optionId).trim())
      ?? options.find(opt => opt.kind === 'reject_always' && str(opt.optionId).trim());
    if (reject) return { outcome: { outcome: 'selected', optionId: str(reject.optionId) } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

async function handleAcpPermissionRequest(input: {
  params: AcpRecord;
  permissionMode: ExternalPermissionMode;
  sessionPolicy: SessionInteractionPolicy;
  requestInteraction: ExternalDriverTurnContext['requestInteraction'];
}): Promise<AcpRecord> {
  const { params, permissionMode, sessionPolicy, requestInteraction } = input;
  const toolCall = asRecord(params.toolCall);
  const toolCallId = str(toolCall?.toolCallId);
  const kind = str(toolCall?.kind).toLowerCase();
  const title = str(toolCall?.title).trim();
  const options = Array.isArray(params.options)
    ? params.options.map(asRecord).filter((opt): opt is AcpRecord => Boolean(opt))
    : [];

  // Antigravity encodes native user-input questions as permission requests with `interaction_*` IDs.
  if (toolCallId.startsWith('interaction_')) {
    const choices = options
      .map((opt) => ({
        id: str(opt.optionId).trim(),
        label: firstNonEmpty(opt.name, opt.label, opt.optionId),
      }))
      .filter((choice) => choice.id && choice.label);
    const response = await requestInteraction({
      kind: 'question',
      title: title || 'Question from agent',
      question: title || 'Choose an option to continue:',
      ...(choices.length > 0 ? { choices } : {}),
      allowFreeText: choices.length === 0,
    });
    if (response.kind === 'question' && !response.cancelled) {
      const matched = choices.find(c => c.id === response.choiceId)
        ?? choices.find(c => c.label === response.text?.trim());
      if (matched) return { outcome: { outcome: 'selected', optionId: matched.id } };
    }
    return { outcome: { outcome: 'cancelled' } };
  }

  const readOnly = sessionPolicy.mode === 'plan' || sessionPolicy.access === 'read-only';
  const isReadTool = kind === 'read' || kind === 'search' || kind === 'fetch';
  const isEditTool = kind === 'edit' || kind === 'delete' || kind === 'move';

  if (isReadTool) return selectAutoOption(options, true);
  if (!readOnly && permissionMode === 'full_access') return selectAutoOption(options, true);
  if (!readOnly && permissionMode === 'auto_edit' && isEditTool) return selectAutoOption(options, true);

  const rawInput = asRecord(toolCall?.rawInput);
  const detail = firstNonEmpty(
    rawInput?.CommandLine,
    rawInput?.command,
    rawInput?.TargetFile,
    rawInput?.path,
  );
  const response = await requestInteraction({
    kind: 'approval',
    title: kind === 'execute' ? 'Approve command' : isEditTool ? 'Approve file change' : 'Approve action',
    question: title || detail || 'Allow the agent to run this action?',
    ...(detail && detail !== title ? { detail } : {}),
    actionKind: kind === 'execute' ? 'command' : isEditTool ? 'file_change' : 'other',
  });
  return selectAutoOption(options, response.kind === 'approval' && response.decision === 'approve');
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

const ACP_THINKING_ORDER: ReadonlyArray<ModelThinkingValue> = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

function mapAcpEffortValueToThinking(raw: string): ModelThinkingValue | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === 'none' || trimmed === 'off' || trimmed === 'disabled') return 'off';
  const normalized = normalizeThinkLevel(trimmed);
  if (normalized && ACP_THINKING_ORDER.includes(normalized as ModelThinkingValue)) {
    return normalized as ModelThinkingValue;
  }
  return undefined;
}

function collectSelectOptionValues(opt: AcpRecord): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  if (!Array.isArray(opt.options)) return out;
  for (const entry of opt.options) {
    const rec = asRecord(entry);
    if (!rec) continue;
    if ('value' in rec) {
      const val = str(rec.value).trim();
      if (val) out.push({ value: val, label: firstNonEmpty(rec.name, rec.label, val) });
    } else if (Array.isArray(rec.options)) {
      for (const nested of rec.options) {
        const nestedRec = asRecord(nested);
        const val = str(nestedRec?.value).trim();
        if (val) out.push({ value: val, label: firstNonEmpty(nestedRec?.name, nestedRec?.label, val) });
      }
    }
  }
  return out;
}

function findAcpThinkingConfigOption(sessionResult: AcpRecord): {
  configId: string;
  currentValue?: string;
  rawValues: string[];
  thinking: ModelThinkingCapabilities;
} | undefined {
  if (!Array.isArray(sessionResult.configOptions)) return undefined;
  const candidate = sessionResult.configOptions
    .map(asRecord)
    .find((opt): opt is AcpRecord => {
      if (!opt || opt.type !== 'select') return false;
      const category = str(opt.category).toLowerCase();
      const id = str(opt.id).toLowerCase();
      if (category === 'thought_level' || category === 'thinking' || category === 'reasoning' || category === 'effort') {
        return true;
      }
      return /^(?:thought|thinking|reasoning|effort)(?:[_-].*)?$/.test(id);
    });
  if (!candidate) return undefined;
  const configId = str(candidate.id).trim();
  if (!configId) return undefined;
  const entries = collectSelectOptionValues(candidate);
  const rawValues = entries.map((e) => e.value);
  const mapped: ModelThinkingValue[] = [];
  for (const raw of rawValues) {
    const value = mapAcpEffortValueToThinking(raw);
    if (value && !mapped.includes(value)) mapped.push(value);
  }
  if (mapped.length === 0) return undefined;
  mapped.sort((a, b) => ACP_THINKING_ORDER.indexOf(a) - ACP_THINKING_ORDER.indexOf(b));
  const currentValue = str(candidate.currentValue).trim() || undefined;
  const currentMapped = currentValue ? mapAcpEffortValueToThinking(currentValue) : undefined;
  const initialValue = (currentMapped && mapped.includes(currentMapped))
    ? currentMapped
    : mapped.includes('medium')
      ? 'medium'
      : mapped[0]!;
  const thinking: ModelThinkingCapabilities = mapped.length === 1
    ? { mode: mapped[0] === 'off' ? 'none' : 'fixed', options: mapped, initialValue, supportsAdaptive: false }
    : { mode: 'levels', options: mapped, initialValue, supportsAdaptive: false };
  return { configId, currentValue, rawValues, thinking };
}

function matchAcpThinkingRawValue(requestedLevel: string, rawValues: ReadonlyArray<string>): string | undefined {
  const trimmed = requestedLevel.trim();
  if (!trimmed) return undefined;
  const exact = rawValues.find((v) => v === trimmed || v.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  const normalizedTarget = mapAcpEffortValueToThinking(trimmed);
  if (!normalizedTarget) return undefined;
  const byNormalized = rawValues.find((v) => mapAcpEffortValueToThinking(v) === normalizedTarget);
  if (byNormalized) return byNormalized;
  if (normalizedTarget === 'max') {
    return rawValues.find((v) => mapAcpEffortValueToThinking(v) === 'xhigh')
      ?? rawValues.find((v) => mapAcpEffortValueToThinking(v) === 'high');
  }
  return undefined;
}

function extractAvailableModels(sessionResult: AcpRecord): ExternalRuntimeModelOption[] {
  const current = extractCurrentModel(sessionResult);
  const thinkingConfig = findAcpThinkingConfigOption(sessionResult);
  const options: ExternalRuntimeModelOption[] = [];
  const seen = new Set<string>();
  const pushOption = (idRaw: unknown, labelRaw?: unknown) => {
    const id = str(idRaw).trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    const label = str(labelRaw).trim() || id;
    options.push({
      id,
      label,
      ...(current === id ? { isDefault: true } : {}),
      ...(thinkingConfig ? { thinking: thinkingConfig.thinking, thinkingConfigId: thinkingConfig.configId } : {}),
    });
  };

  if (Array.isArray(sessionResult.configOptions)) {
    for (const raw of sessionResult.configOptions) {
      const opt = asRecord(raw);
      if (!opt || opt.type !== 'select' || !Array.isArray(opt.options)) continue;
      if (opt.id !== 'model' && str(opt.category).toLowerCase() !== 'model') continue;
      for (const entry of opt.options) {
        const rec = asRecord(entry);
        if (!rec) continue;
        if ('value' in rec) {
          pushOption(rec.value, rec.name ?? rec.label);
        } else if (Array.isArray(rec.options)) {
          for (const nested of rec.options) {
            const nestedRec = asRecord(nested);
            if (nestedRec) pushOption(nestedRec.value, nestedRec.name ?? nestedRec.label);
          }
        }
      }
    }
  }

  const models = asRecord(sessionResult.models);
  if (options.length === 0 && Array.isArray(models?.availableModels)) {
    for (const entry of models.availableModels) {
      const rec = asRecord(entry);
      if (rec) pushOption(rec.modelId ?? rec.id, rec.name ?? rec.label);
    }
  }

  return options;
}

function findAcpAvailableModes(sessionResult: AcpRecord): {
  modeConfigId?: string;
  currentModeId?: string;
  availableModeIds: string[];
} {
  if (Array.isArray(sessionResult.configOptions)) {
    const modeOpt = sessionResult.configOptions
      .map(asRecord)
      .find((opt) => opt?.type === 'select' && (str(opt.category).toLowerCase() === 'mode' || opt.id === 'mode'));
    if (modeOpt) {
      const entries = collectSelectOptionValues(modeOpt);
      return {
        modeConfigId: str(modeOpt.id).trim() || 'mode',
        currentModeId: str(modeOpt.currentValue).trim() || undefined,
        availableModeIds: entries.map((e) => e.value),
      };
    }
  }
  const modes = asRecord(sessionResult.modes);
  if (modes && Array.isArray(modes.availableModes)) {
    const availableModeIds = modes.availableModes
      .map(asRecord)
      .map((m) => str(m?.id).trim())
      .filter(Boolean);
    return {
      currentModeId: str(modes.currentModeId).trim() || undefined,
      availableModeIds,
    };
  }
  return { availableModeIds: [] };
}

function selectTargetAcpMode(
  availableModeIds: ReadonlyArray<string>,
  sessionPolicy: SessionInteractionPolicy,
  permissionMode: ExternalPermissionMode,
): string | undefined {
  if (availableModeIds.length === 0) return undefined;
  const pick = (candidates: ReadonlyArray<string>) =>
    candidates.find((c) => availableModeIds.some((id) => id.toLowerCase() === c))
      ? availableModeIds.find((id) => candidates.includes(id.toLowerCase()))
      : undefined;
  if (sessionPolicy.mode === 'plan' || sessionPolicy.access === 'read-only') {
    return pick(['plan', 'read-only', 'readonly']);
  }
  if (permissionMode === 'ask') {
    return pick(['ask', 'approval-required', 'supervised', 'default', 'code']);
  }
  if (permissionMode === 'full_access') {
    return pick(['full-access', 'full_access', 'auto', 'code', 'default']);
  }
  return pick(['auto', 'code', 'default', 'ask']);
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

function buildAcpPromptBlocks(input: {
  promptText: string;
  attachments: ExternalDriverTurnContext['attachments'];
  supportsImageBlocks: boolean;
}): Array<Record<string, unknown>> {
  const fileContext = formatFileAttachmentsContext(input.attachments);
  const fallbackImageNotes: string[] = [];
  const imageBlocks: Array<Record<string, unknown>> = [];

  for (const att of input.attachments) {
    if (att.type !== 'image') continue;
    if (input.supportsImageBlocks && att.base64) {
      imageBlocks.push({
        type: 'image',
        data: att.base64,
        mimeType: att.mimeType ?? 'image/png',
      });
    } else if (att.localPath) {
      fallbackImageNotes.push(`- ${att.localPath}${att.name ? ` (${att.name})` : ''}`);
    }
  }

  const imageFallbackPrefix = fallbackImageNotes.length > 0
    ? `Attached images:\n${fallbackImageNotes.join('\n')}\n\n`
    : '';
  const combinedText = `${fileContext}${imageFallbackPrefix}${input.promptText}`.trim();
  const blocks: Array<Record<string, unknown>> = [];
  if (combinedText) blocks.push({ type: 'text', text: combinedText });
  blocks.push(...imageBlocks);
  if (blocks.length === 0) blocks.push({ type: 'text', text: 'Inspect the attached content.' });
  return blocks;
}

export function createAcpExternalDriver(config: AcpDriverConfig): ExternalAgentDriver {
  const capabilities: ExternalRuntimeCapabilities = {
    supportsAttachments: true,
    managesOwnModel: true,
    requiresWorkspace: true,
    requiresWorkspaceWrite: true,
    steeringMode: 'interrupt_restart',
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
      const {
        cwd,
        content,
        attachments,
        instructions,
        existingBinding,
        execution,
        permissionMode,
        sessionPolicy,
        signal,
        emit,
        requestInteraction,
      } = context;
      const spawnConfig = config.resolveSpawn(cwd, execution);
      const tools = new Map<string, TrackedTool>();
      const finishedTools = new Set<string>();
      const ignoredTools = new Set<string>();

      let client: AcpJsonRpcClient | undefined;
      let sessionId: string | undefined;
      let acceptingPromptUpdates = false;
      let activeMessageId: string | undefined;
      let activeThoughtId: string | undefined;
      let messageSeq = 0;
      let thoughtSeq = 0;
      let cancelSent = false;
      let stopTimer: NodeJS.Timeout | undefined;
      let failed = false;
      const promptAbort = new AbortController();

      const flushActiveMessage = () => {
        if (!activeMessageId) return;
        emit({ type: 'text_done', itemId: activeMessageId });
        activeMessageId = undefined;
      };

      const flushActiveThought = () => {
        if (!activeThoughtId) return;
        emit({ type: 'thinking_done', itemId: activeThoughtId });
        activeThoughtId = undefined;
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

        if (kind === 'config_option_update' && Array.isArray(update.configOptions)) {
          if (activeSessionResult) {
            activeSessionResult = { ...activeSessionResult, configOptions: update.configOptions };
          }
          return;
        }

        if (kind === 'agent_message_chunk') {
          const text = contentBlockText(update.content);
          if (!text) return;
          flushActiveThought();
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
          if (!text) return;
          activeThoughtId ??= `thought-${++thoughtSeq}`;
          emit({ type: 'thinking_delta', itemId: activeThoughtId, delta: text });
          return;
        }

        if (kind === 'plan') {
          const entries = Array.isArray(update.entries) ? update.entries : [];
          const steps = entries
            .map(asRecord)
            .filter((entry): entry is AcpRecord => Boolean(entry))
            .map((entry) => ({
              step: firstNonEmpty(entry.content, entry.title, entry.step),
              status: str(entry.status) as 'pending' | 'in_progress' | 'completed',
            }))
            .filter((entry) => entry.step.length > 0);
          if (steps.length > 0) {
            emit({ type: 'plan_updated', steps });
          }
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

          flushActiveThought();
          flushActiveMessage();
          let tracked = tools.get(toolCallId);
          if (!tracked) {
            const normalized = normalizeToolCall(toolCallId, update, cwd);
            tracked = {
              tool: normalized.tool,
              kind: normalized.kind,
              output: '',
              startedAtMs: Date.now(),
              diffChanges: extractDiffChanges(update.content, update.locations, normalized.kind),
            };
            tools.set(toolCallId, tracked);
            emit({ type: 'tool_start', tool: tracked.tool });
          } else {
            const diffChanges = extractDiffChanges(update.content, update.locations, tracked.kind);
            if (diffChanges.length > 0) tracked.diffChanges = diffChanges;
            // Enrich args when ACP sends fuller rawInput/locations on subsequent tool_call_update frames.
            const enriched = normalizeToolCall(toolCallId, { ...update, kind: update.kind ?? tracked.kind }, cwd);
            const hasNewArgs = Object.entries(enriched.tool.args).some(
              ([key, val]) => val !== undefined && val !== '' && tracked!.tool.args[key] !== val,
            );
            if (hasNewArgs) {
              tracked.tool = {
                ...tracked.tool,
                args: { ...tracked.tool.args, ...enriched.tool.args },
              };
              emit({ type: 'tool_update', tool: tracked.tool });
            }
          }

          const nextText = extractToolTextFromContent(update.content) || extractRawOutputText(update.rawOutput);
          if (nextText && nextText !== tracked.output) {
            const delta = nextText.startsWith(tracked.output)
              ? nextText.slice(tracked.output.length)
              : nextText;
            const boundedDelta = delta.slice(0, Math.max(0, MAX_EXTERNAL_TOOL_TEXT - tracked.output.length));
            if (boundedDelta) {
              tracked.output += boundedDelta;
              if (tracked.tool.toolName === 'exec_command') {
                emit({ type: 'tool_output_delta', id: toolCallId, delta: boundedDelta, stream: 'stdout' });
              }
            }
          }

          const status = str(update.status).toLowerCase();
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            emit({ type: 'tool_end', result: buildToolResult(tracked, update, cwd) });
            finishedTools.add(toolCallId);
            tools.delete(toolCallId);
          }
        }
      };

      let activeSessionResult: AcpRecord | undefined;
      type PooledAcpSession = {
        client: AcpJsonRpcClient;
        sessionId: string;
        initializeResult: AcpRecord;
        sessionResult: AcpRecord;
        resolvedModel?: string;
        resolvedThinking?: string;
        resolvedMode?: string;
        sessionMetaApplied: boolean;
      };
      const buildFingerprint = (boundSessionId: string) => JSON.stringify([
        config.kind,
        cwd,
        spawnConfig.command,
        spawnConfig.args,
        instructions?.trim() ?? '',
        context.mcpServers ?? [],
        boundSessionId,
      ]);

      const onNotification = (method: string, params: AcpRecord) => {
        if (method === 'session/update') handleSessionUpdate(params);
      };
      const onRequest = (method: string, params: AcpRecord) => {
        if (method === 'session/request_permission') {
          if (!acceptingPromptUpdates || !sessionId || params.sessionId !== sessionId || signal.aborted) {
            return { outcome: { outcome: 'cancelled' } };
          }
          return handleAcpPermissionRequest({
            params,
            permissionMode,
            sessionPolicy,
            requestInteraction,
          });
        }
        throw new AcpRpcError(-32601, `xopc does not implement ACP client method ${method}.`);
      };

      let initializeResult: AcpRecord = {};
      let resolvedModel: string | undefined;
      let resolvedThinking: string | undefined;
      let resolvedMode: string | undefined;
      let sessionMetaApplied = false;

      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const warm = existingBinding?.nativeSessionId
          ? await checkoutPooledExternalSession<PooledAcpSession>(
              context.conversationId,
              buildFingerprint(existingBinding.nativeSessionId),
            )
          : undefined;

        if (warm) {
          client = warm.client;
          sessionId = warm.sessionId;
          initializeResult = warm.initializeResult;
          activeSessionResult = warm.sessionResult;
          resolvedModel = warm.resolvedModel;
          resolvedThinking = warm.resolvedThinking;
          resolvedMode = warm.resolvedMode;
          sessionMetaApplied = warm.sessionMetaApplied;
          client.setHandlers({ onNotification, onRequest });
        } else {
          client = new AcpJsonRpcClient({
            command: spawnConfig.command,
            args: spawnConfig.args,
            cwd,
            env: spawnConfig.env,
            label: config.label,
            notFoundMessage: config.notFoundMessage,
            onNotification,
            onRequest,
            onNonJsonLine: config.onNonJsonLine,
            onStderrLine: config.onStderrLine,
          });

          initializeResult = await client.request(
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

          const configuredAuthMethod = config.authMethodId?.(execution);
          if (config.authenticateEagerly && configuredAuthMethod) {
            await client.request('authenticate', { methodId: configuredAuthMethod }, signal);
          }

          const sessionMeta = config.buildSessionMeta?.(initializeResult, instructions);
          sessionMetaApplied = Boolean(sessionMeta);
          const openSession = async (): Promise<{ id: string; result: AcpRecord }> => {
            const agentCapabilities = asRecord(initializeResult.agentCapabilities);
            const sessionCapabilities = asRecord(agentCapabilities?.sessionCapabilities);
            const metaField = sessionMeta ? { _meta: sessionMeta } : {};

            const acpMcpServers = context.mcpServers?.length
              ? projectMcpServersForAcp(context.mcpServers)
              : [];

            if (existingBinding?.nativeSessionId) {
              const nativeId = existingBinding.nativeSessionId;
              if (sessionCapabilities?.resume != null) {
                const resumed = await client!.request(
                  'session/resume',
                  { sessionId: nativeId, cwd, mcpServers: acpMcpServers, ...metaField },
                  signal,
                );
                return { id: str(resumed.sessionId) || nativeId, result: resumed };
              }
              if (agentCapabilities?.loadSession === true) {
                const loaded = await client!.request(
                  'session/load',
                  { sessionId: nativeId, cwd, mcpServers: acpMcpServers, ...metaField },
                  signal,
                );
                return { id: str(loaded.sessionId) || nativeId, result: loaded };
              }
              throw new Error(`${config.label} ACP server does not advertise session/resume or session/load support.`);
            }

            const created = await client!.request(
              'session/new',
              { cwd, mcpServers: acpMcpServers, ...metaField },
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
          activeSessionResult = opened.result;
          resolvedModel = extractCurrentModel(opened.result);
          resolvedThinking = findAcpThinkingConfigOption(opened.result)?.currentValue;
          resolvedMode = findAcpAvailableModes(opened.result).currentModeId;
        }

        const currentSessionResult = activeSessionResult ?? {};
        const requestedModel = context.modelOverride?.trim() || execution.model?.trim();
        if (requestedModel && requestedModel !== resolvedModel) {
          const modelConfigOpt = Array.isArray(currentSessionResult.configOptions)
            ? currentSessionResult.configOptions
                .map(asRecord)
                .find((opt) => opt?.type === 'select' && (opt.id === 'model' || str(opt.category).toLowerCase() === 'model'))
            : undefined;
          const modelConfigId = str(modelConfigOpt?.id).trim() || 'model';
          try {
            const setRes = await client.request(
              'session/set_config_option',
              { sessionId, configId: modelConfigId, value: requestedModel },
              signal,
            );
            resolvedModel = requestedModel;
            if (Array.isArray(setRes.configOptions)) {
              activeSessionResult = { ...currentSessionResult, configOptions: setRes.configOptions };
            }
          } catch {
            // Fall back to the agent's negotiated model if set_config_option is unsupported.
          }
        }

        const requestedThinking = context.thinkingLevel?.trim();
        if (requestedThinking) {
          const thinkingOpt = findAcpThinkingConfigOption(activeSessionResult ?? currentSessionResult);
          if (thinkingOpt) {
            const matchedValue = matchAcpThinkingRawValue(requestedThinking, thinkingOpt.rawValues);
            if (matchedValue && matchedValue !== (resolvedThinking ?? thinkingOpt.currentValue)) {
              try {
                await client.request(
                  'session/set_config_option',
                  { sessionId, configId: thinkingOpt.configId, value: matchedValue },
                  signal,
                );
                resolvedThinking = matchedValue;
              } catch {
                // Ignore if the runtime rejects a thinking effort override on this model.
              }
            }
          }
        }

        // Synchronize native ACP session mode when advertised (e.g. Plan vs Auto/Ask).
        let nativePlanModeApplied = false;
        const modeInfo = findAcpAvailableModes(activeSessionResult ?? currentSessionResult);
        const targetMode = selectTargetAcpMode(modeInfo.availableModeIds, sessionPolicy, permissionMode);
        if (targetMode) {
          if (targetMode !== (resolvedMode ?? modeInfo.currentModeId)) {
            try {
              if (modeInfo.modeConfigId) {
                await client.request(
                  'session/set_config_option',
                  { sessionId, configId: modeInfo.modeConfigId, value: targetMode },
                  signal,
                );
              } else {
                await client.request('session/set_mode', { sessionId, modeId: targetMode }, signal);
              }
              resolvedMode = targetMode;
            } catch {
              // Best-effort mode sync; permission callbacks still enforce sessionPolicy.
            }
          }
          if ((resolvedMode ?? modeInfo.currentModeId)?.toLowerCase() === 'plan') {
            nativePlanModeApplied = true;
          }
        }

        emit({
          type: 'session_bound',
          nativeSessionId: sessionId,
          ...(resolvedModel ? { model: resolvedModel } : {}),
        });
        signal.throwIfAborted();

        const basePrompt =
          !existingBinding && instructions && !sessionMetaApplied
            ? `${instructions}\n\n${content}`
            : content;
        const promptText =
          sessionPolicy.mode === 'plan' && !nativePlanModeApplied
            ? `<plan_mode>\n${PLAN_MODE_INSTRUCTIONS}\n</plan_mode>\n\n${basePrompt}`
            : basePrompt;
        const promptCaps = asRecord(asRecord(initializeResult.agentCapabilities)?.promptCapabilities);
        const supportsImageBlocks = promptCaps?.image === true;
        const promptBlocks = buildAcpPromptBlocks({
          promptText,
          attachments,
          supportsImageBlocks,
        });

        acceptingPromptUpdates = true;
        const promptResult = await client.request(
          'session/prompt',
          { sessionId, prompt: promptBlocks },
          promptAbort.signal,
          null,
        );

        flushActiveThought();
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
        const reusable =
          !failed
          && !signal.aborted
          && Boolean(client && sessionId)
          && client!.isAlive();
        if (reusable && client && sessionId) {
          const pooledClient = client;
          pooledClient.setHandlers({});
          checkinPooledExternalSession<PooledAcpSession>(context.conversationId, {
            fingerprint: buildFingerprint(sessionId),
            resource: {
              client: pooledClient,
              sessionId,
              initializeResult,
              sessionResult: activeSessionResult ?? {},
              resolvedModel,
              resolvedThinking,
              resolvedMode,
              sessionMetaApplied,
            },
            isAlive: () => pooledClient.isAlive(),
            dispose: (force) => pooledClient.close(force),
          });
        } else {
          await disposePooledExternalSession(context.conversationId, true);
          await client?.close(Boolean(failed || signal.aborted));
        }
      }
    },

    detectInstalled(execution?: ExternalAgentExecution) {
      const executablePath = config.findExecutable?.(execution);
      return {
        kind: config.kind,
        label: config.label,
        installed: config.findExecutable ? Boolean(executablePath) : true,
        ...(executablePath ? { executablePath } : {}),
        checkedAt: Date.now(),
      };
    },

    async probe(execution?: ExternalAgentExecution): Promise<ExternalRuntimeProbeResult> {
      const checkedAt = Date.now();
      const cwd = tmpdir();
      const executablePath = config.findExecutable?.(execution);
      if (config.findExecutable && !executablePath) {
        return {
          kind: config.kind,
          label: config.label,
          installed: false,
          status: 'not_installed',
          message: execution?.binaryPath
            ? `${config.label} binary was not found at "${execution.binaryPath}".`
            : config.notFoundMessage,
          ...(config.installHintCommand ? { hintCommand: config.installHintCommand } : {}),
          models: [],
          checkedAt,
        };
      }

      const spawnConfig = config.resolveSpawn(cwd, execution);
      const abortController = new AbortController();
      const timer = setTimeout(
        () => abortController.abort(new Error(`${config.label} health check timed out.`)),
        PROBE_TIMEOUT_MS,
      );
      let client: AcpJsonRpcClient | undefined;
      let version: string | undefined;
      const discoveredCommands: ExternalRuntimeCommand[] = [];
      const seenCommandNames = new Set<string>();
      try {
        client = new AcpJsonRpcClient({
          command: spawnConfig.command,
          args: spawnConfig.args,
          cwd,
          env: spawnConfig.env,
          label: config.label,
          notFoundMessage: config.notFoundMessage,
          onNotification: (method, params) => {
            if (method !== 'session/update') return;
            const update = asRecord(params.update);
            if (str(update?.sessionUpdate) !== 'available_commands_update') return;
            const available = Array.isArray(update?.availableCommands) ? update.availableCommands : [];
            for (const entry of available) {
              const rec = asRecord(entry);
              const name = str(rec?.name).trim().replace(/^\/+/, '');
              if (!name || seenCommandNames.has(name)) continue;
              seenCommandNames.add(name);
              const description = str(rec?.description).trim() || undefined;
              discoveredCommands.push({ name, ...(description ? { description } : {}), source: 'command' });
            }
          },
          onRequest: (method) => {
            if (method === 'session/request_permission') return { outcome: { outcome: 'cancelled' } };
            throw new AcpRpcError(-32601, `xopc does not implement ACP client method ${method}.`);
          },
          onNonJsonLine: config.onNonJsonLine,
          onStderrLine: config.onStderrLine,
        });

        const initializeResult = await client.request(
          'initialize',
          {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            clientInfo: { name: 'xopc', title: 'xopc', version: '1' },
          },
          abortController.signal,
          PROBE_TIMEOUT_MS,
        );
        const agentInfo = asRecord(initializeResult.agentInfo);
        if (typeof agentInfo?.version === 'string' && agentInfo.version.trim()) {
          version = agentInfo.version.trim();
        }

        const configuredAuthMethod = config.authMethodId?.(execution);
        if (config.authenticateEagerly && configuredAuthMethod) {
          await client.request('authenticate', { methodId: configuredAuthMethod }, abortController.signal, PROBE_TIMEOUT_MS);
        }

        let created: AcpRecord;
        try {
          created = await client.request('session/new', { cwd, mcpServers: [] }, abortController.signal, PROBE_TIMEOUT_MS);
        } catch (error) {
          if (!isAuthRequiredRpcError(error)) throw error;
          const authMethodId = selectAuthMethodId(initializeResult, configuredAuthMethod);
          if (!authMethodId) throw error;
          await client.request('authenticate', { methodId: authMethodId }, abortController.signal, PROBE_TIMEOUT_MS);
          created = await client.request('session/new', { cwd, mcpServers: [] }, abortController.signal, PROBE_TIMEOUT_MS);
        }

        const models = extractAvailableModels(created);
        return {
          kind: config.kind,
          label: config.label,
          installed: true,
          status: 'ready',
          ...(executablePath ? { executablePath } : {}),
          ...(version ? { version } : {}),
          ...(discoveredCommands.length > 0 ? { commands: discoveredCommands } : {}),
          models,
          checkedAt: Date.now(),
        };
      } catch (error) {
        const signInRequired = config.isSignInRequiredError?.(error) || isAuthRequiredRpcError(error);
        const message = signInRequired
          ? config.signInRequiredMessage
          : error instanceof Error ? error.message : String(error);
        return {
          kind: config.kind,
          label: config.label,
          installed: true,
          status: signInRequired ? 'unauthenticated' : 'warning',
          ...(executablePath ? { executablePath } : {}),
          ...(version ? { version } : {}),
          message,
          ...(signInRequired && config.loginHintCommand ? { hintCommand: config.loginHintCommand } : {}),
          models: [],
          checkedAt: Date.now(),
        };
      } finally {
        clearTimeout(timer);
        await client?.close(true);
      }
    },

    async forkSession(
      context: ExternalSessionControlContext,
    ): Promise<{ nativeSessionId: string; resumeCursor?: string } | null> {
      const spawnConfig = config.resolveSpawn(context.cwd, context.execution);
      const abortController = new AbortController();
      const signal = context.signal ? AbortSignal.any([context.signal, abortController.signal]) : abortController.signal;
      const timer = setTimeout(() => abortController.abort(new Error(`${config.label} fork timed out.`)), 20_000);
      let client: AcpJsonRpcClient | undefined;
      try {
        client = new AcpJsonRpcClient({
          command: spawnConfig.command,
          args: spawnConfig.args,
          cwd: context.cwd,
          env: spawnConfig.env,
          label: config.label,
          notFoundMessage: config.notFoundMessage,
          onNotification: () => {},
          onRequest: (method) => {
            if (method === 'session/request_permission') return { outcome: { outcome: 'cancelled' } };
            throw new AcpRpcError(-32601, `xopc does not implement ACP client method ${method}.`);
          },
          onNonJsonLine: config.onNonJsonLine,
          onStderrLine: config.onStderrLine,
        });
        const initializeResult = await client.request(
          'initialize',
          {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            clientInfo: { name: 'xopc', title: 'xopc', version: '1' },
          },
          signal,
        );
        const sessionCaps = asRecord(asRecord(initializeResult.agentCapabilities)?.sessionCapabilities);
        if (sessionCaps?.fork == null) return null;

        const configuredAuthMethod = config.authMethodId?.(context.execution);
        if (config.authenticateEagerly && configuredAuthMethod) {
          await client.request('authenticate', { methodId: configuredAuthMethod }, signal);
        }
        const sessionMeta = config.buildSessionMeta?.(initializeResult, context.instructions);
        const metaField = sessionMeta ? { _meta: sessionMeta } : {};
        const forked = await client.request(
          'session/fork',
          { sessionId: context.nativeSessionId, cwd: context.cwd, mcpServers: [], ...metaField },
          signal,
        );
        const newSessionId = str(forked.sessionId).trim();
        if (!newSessionId) return null;
        return { nativeSessionId: newSessionId };
      } finally {
        clearTimeout(timer);
        await client?.close(false);
      }
    },
  };
}
