import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import type { ToolCall } from '@earendil-works/pi-ai';
import type { ModelThinkingCapabilities } from '@xopcai/gateway-contract';

import type {
  ClaudeExecution,
  ExternalAgentExecution,
  ExternalPermissionMode,
} from '../../../../agent-config/schema.js';
import { PLAN_MODE_INSTRUCTIONS } from '../../../session/interaction-policy-state.js';
import {
  buildNormalizedApplyPatchResult,
  buildNormalizedExecCommandResult,
  toWorkspaceRelativePath,
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
  ExternalSessionControlContext,
  ExternalTurnAttachment,
} from '../../types.js';
import { buildClaudeEnv, findClaudeExecutable } from './executable.js';
import { ClaudeStreamClient, claudeRecord, type ClaudeRecord } from './stream-client.js';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;

const DEFAULT_CLAUDE_THINKING: ModelThinkingCapabilities = {
  mode: 'levels',
  options: ['low', 'medium', 'high', 'max'],
  initialValue: 'medium',
  supportsAdaptive: false,
};

const FALLBACK_CLAUDE_MODELS: ReadonlyArray<ExternalRuntimeModelOption> = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', isDefault: true, thinking: DEFAULT_CLAUDE_THINKING },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', thinking: DEFAULT_CLAUDE_THINKING },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', thinking: { mode: 'levels', options: ['low', 'medium', 'high'], initialValue: 'low', supportsAdaptive: false } },
];

type PooledClaudeSession = {
  client: ClaudeStreamClient;
  sessionId: string;
  model?: string;
  permissionMode: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function claudeOptionsFromExecution(execution?: ExternalAgentExecution): ClaudeExecution | undefined {
  return execution?.kind === 'claude' ? execution : undefined;
}

function resolveClaudePermissionMode(
  permissionMode: ExternalPermissionMode,
  isPlanOrReadOnly: boolean,
): 'plan' | 'bypassPermissions' | 'acceptEdits' | 'default' {
  if (isPlanOrReadOnly) return 'plan';
  if (permissionMode === 'full_access') return 'bypassPermissions';
  if (permissionMode === 'auto_edit') return 'acceptEdits';
  return 'default';
}

function parseClaudeModels(initResponse: ClaudeRecord): ExternalRuntimeModelOption[] {
  const rawModels = Array.isArray(initResponse.models) ? initResponse.models : [];
  const options: ExternalRuntimeModelOption[] = [];
  const seen = new Set<string>();
  for (const raw of rawModels) {
    const item = claudeRecord(raw);
    if (!item) continue;
    const id = text(item.value).trim() || text(item.id).trim() || text(item.model).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = text(item.displayName).trim() || text(item.label).trim() || id;
    const effortLevels = Array.isArray(item.supportedEffortLevels)
      ? item.supportedEffortLevels.map((v) => text(v).trim().toLowerCase()).filter(Boolean)
      : [];
    const allowed = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    const normalizedEfforts = effortLevels.filter((v) => allowed.has(v)) as ModelThinkingCapabilities['options'];
    const thinking: ModelThinkingCapabilities = normalizedEfforts.length > 0
      ? {
          mode: 'levels',
          options: normalizedEfforts,
          initialValue: normalizedEfforts.includes('medium') ? 'medium' : normalizedEfforts[0]!,
          supportsAdaptive: false,
        }
      : DEFAULT_CLAUDE_THINKING;
    options.push({
      id,
      label,
      ...(item.isDefault === true ? { isDefault: true } : {}),
      thinking,
    });
  }
  return options.length > 0 ? options : [...FALLBACK_CLAUDE_MODELS];
}

function parseClaudeCommands(initResponse: ClaudeRecord): ExternalRuntimeCommand[] {
  const rawCommands = Array.isArray(initResponse.commands) ? initResponse.commands : [];
  const seen = new Set<string>();
  const out: ExternalRuntimeCommand[] = [];
  for (const raw of rawCommands) {
    const rec = claudeRecord(raw);
    const rawName = typeof raw === 'string' ? raw : text(rec?.name);
    const name = rawName.trim().replace(/^\/+/, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const rawDesc = text(rec?.description).trim();
    const description = rawDesc
      ? (rawDesc.length > 160 ? `${rawDesc.slice(0, 159).trimEnd()}…` : rawDesc)
      : undefined;
    out.push({ name, ...(description ? { description } : {}), source: 'command' });
  }
  return out;
}

function parseClaudeRateLimits(usageResponse: ClaudeRecord): ExternalRuntimeRateLimits | undefined {
  if (usageResponse.rate_limits_available === false) return undefined;
  const rawLimits = Array.isArray(usageResponse.rate_limits) ? usageResponse.rate_limits : [];
  const windows: ExternalRuntimeRateLimitWindow[] = [];
  for (const raw of rawLimits) {
    const item = claudeRecord(raw);
    if (!item) continue;
    const rawPct = typeof item.utilization === 'number'
      ? item.utilization
      : typeof item.usedPercent === 'number'
        ? item.usedPercent
        : undefined;
    if (rawPct === undefined || !Number.isFinite(rawPct)) continue;
    const usedPercent = rawPct <= 1 && rawPct > 0 ? Math.round(rawPct * 100) : Math.round(rawPct);
    const resetsRaw = item.resets_at ?? item.resetsAt;
    let resetsAt: number | undefined;
    if (typeof resetsRaw === 'number' && Number.isFinite(resetsRaw)) {
      resetsAt = resetsRaw > 1e12 ? resetsRaw : resetsRaw * 1000;
    } else if (typeof resetsRaw === 'string') {
      const parsed = Date.parse(resetsRaw);
      if (Number.isFinite(parsed)) resetsAt = parsed;
    }
    const windowDurationMins = typeof item.window_minutes === 'number'
      ? item.window_minutes
      : typeof item.windowDurationMins === 'number'
        ? item.windowDurationMins
        : undefined;
    windows.push({
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
      ...(windowDurationMins ? { windowDurationMins } : {}),
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  if (windows.length === 0) return undefined;
  return {
    primary: windows[0],
    ...(windows[1] ? { secondary: windows[1] } : {}),
  };
}

function normalizeClaudeToolName(name: string): string {
  switch (name) {
    case 'Bash':
      return 'exec_command';
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'apply_patch';
    case 'Read':
      return 'read_file';
    case 'Glob':
    case 'LS':
      return 'list_dir';
    case 'Grep':
      return 'search_files';
    case 'WebSearch':
      return 'web_search';
    case 'WebFetch':
      return 'web_fetch';
    default:
      return name;
  }
}

function normalizeClaudeToolArgs(
  rawName: string,
  input: ClaudeRecord,
  cwd: string,
): ToolCall['arguments'] {
  if (rawName === 'Bash') {
    const command = text(input.command).trim();
    return {
      command,
      ...(text(input.description).trim() ? { description: text(input.description).trim() } : {}),
    };
  }
  if (rawName === 'Edit' || rawName === 'MultiEdit' || rawName === 'Write' || rawName === 'NotebookEdit') {
    const filePath = text(input.file_path) || text(input.path) || text(input.notebook_path);
    const rel = filePath ? toWorkspaceRelativePath(filePath, cwd) : '';
    return {
      ...(rel ? { path: rel, files: [rel] } : {}),
      kind: rawName === 'Write' ? 'create' : 'update',
    };
  }
  if (rawName === 'Read') {
    const filePath = text(input.file_path) || text(input.path);
    return {
      path: filePath ? toWorkspaceRelativePath(filePath, cwd) : filePath,
      ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
      ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    };
  }
  if (rawName === 'Grep' || rawName === 'Glob') {
    const path = text(input.path);
    return {
      ...(input as ToolCall['arguments']),
      ...(path ? { path: toWorkspaceRelativePath(path, cwd) } : {}),
    };
  }
  return { ...(input as ToolCall['arguments']) };
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const rec = claudeRecord(block);
      if (!rec) return '';
      if (rec.type === 'text') return text(rec.text);
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

async function buildClaudeUserContent(
  prompt: string,
  attachments: ExternalTurnAttachment[],
): Promise<string | Array<ClaudeRecord>> {
  const imageBlocks: ClaudeRecord[] = [];
  const fileNotes: string[] = [];

  for (const att of attachments) {
    if (att.type === 'image') {
      let base64 = att.base64;
      if (!base64 && att.localPath) {
        try {
          const buf = await readFile(att.localPath);
          base64 = buf.toString('base64');
        } catch {
          // Fall back to path reference below.
        }
      }
      if (base64) {
        imageBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: att.mimeType || 'image/png',
            data: base64,
          },
        });
        continue;
      }
    }
    const label = att.workspaceRelativePath || att.localPath || att.name;
    if (label) fileNotes.push(`- ${label}`);
  }

  const fullText = fileNotes.length > 0
    ? `${prompt}\n\n[Attached files]\n${fileNotes.join('\n')}`.trim()
    : prompt;

  if (imageBlocks.length === 0) return fullText;
  return [
    ...imageBlocks,
    ...(fullText ? [{ type: 'text', text: fullText }] : []),
  ];
}

export const claudeExternalDriver: ExternalAgentDriver = {
  kind: 'claude',
  label: 'Claude Code',
  transcriptProvider: 'claude-code',
  transcriptApi: 'claude-stream-json',
  defaultModelName: 'claude-sonnet-4-6',
  capabilities: {
    supportsAttachments: true,
    managesOwnModel: true,
    requiresWorkspace: true,
    requiresWorkspaceWrite: true,
    steeringMode: 'interrupt_restart',
  },

  async runTurn(context: ExternalDriverTurnContext): Promise<void> {
    const {
      execution,
      permissionMode,
      sessionPolicy,
      modelOverride,
      thinkingLevel,
      cwd,
      content,
      attachments,
      instructions,
      existingBinding,
      signal,
      emit,
      requestInteraction,
    } = context;
    const claudeConfig = claudeOptionsFromExecution(execution);
    const isPlanOrReadOnly = sessionPolicy.mode === 'plan' || sessionPolicy.access === 'read-only';
    const effectivePermissionMode = resolveClaudePermissionMode(permissionMode, isPlanOrReadOnly);
    const requestedModel = modelOverride?.trim() || execution.model?.trim() || undefined;
    const requestedEffort = thinkingLevel?.trim().toLowerCase() || undefined;
    const forkSourceSessionId = existingBinding?.resumeCursor?.startsWith('fork:')
      ? existingBinding.resumeCursor.slice('fork:'.length).trim()
      : undefined;
    const shouldForkFirstTurn = Boolean(forkSourceSessionId);
    const binaryPath = claudeConfig?.binaryPath?.trim() ?? '';
    const configDir = claudeConfig?.configDir?.trim() ?? '';

    const buildFingerprint = (sid: string) =>
      JSON.stringify([
        'claude',
        cwd,
        binaryPath,
        configDir,
        instructions ?? '',
        requestedEffort ?? '',
        sid,
      ]);

    let client: ClaudeStreamClient | undefined;
    let sessionId = shouldForkFirstTurn ? undefined : existingBinding?.nativeSessionId;
    let currentModel = requestedModel;
    let currentPermMode: string = effectivePermissionMode;
    let stopTimer: NodeJS.Timeout | undefined;
    let failed = false;
    let interruptSent = false;

    const terminal = deferred<ClaudeRecord>();
    void terminal.promise.catch(() => {});

    // Track tool metadata so `tool_result` frames produce rich normalized xopc results.
    const activeTools = new Map<string, { rawName: string; input: ClaudeRecord; normalizedName: string }>();
    const streamedBlockKinds = new Map<number, 'text' | 'thinking'>();
    let streamedTextSinceLastAssistant = false;
    let streamedThinkingSinceLastAssistant = false;
    let blockCounter = 0;

    const handleControlRequest = async (subtype: string, req: ClaudeRecord): Promise<ClaudeRecord> => {
      if (subtype !== 'can_use_tool') {
        return { behavior: 'deny', message: `Unsupported Claude control request: ${subtype}` };
      }
      const toolName = text(req.tool_name).trim() || 'Tool';
      const toolInput = claudeRecord(req.input) ?? {};

      // Interactive AskUserQuestion tool maps cleanly to xopc's question card.
      if (toolName === 'AskUserQuestion') {
        const questions = Array.isArray(toolInput.questions)
          ? toolInput.questions.map(claudeRecord).filter((q): q is ClaudeRecord => Boolean(q))
          : [];
        const answers: Record<string, string> = {};
        for (const q of questions) {
          const prompt = text(q.question).trim();
          if (!prompt) continue;
          const rawOptions = Array.isArray(q.options)
            ? q.options.map(claudeRecord).filter((o): o is ClaudeRecord => Boolean(o))
            : [];
          const choices = rawOptions
            .map((opt, idx) => ({
              id: text(opt.label).trim() || `opt-${idx + 1}`,
              label: text(opt.label).trim(),
              description: text(opt.description).trim() || undefined,
            }))
            .filter((c) => c.label);
          const res = await requestInteraction({
            kind: 'question',
            title: text(q.header).trim() || 'Claude Code',
            question: prompt,
            ...(choices.length > 0 ? { choices } : {}),
            allowFreeText: true,
          });
          if (res.kind === 'question' && !res.cancelled) {
            const answer = (
              choices.length > 0 && res.choiceId
                ? res.choiceId
                : (res.text ?? res.choiceId ?? '')
            ).trim();
            if (answer) answers[prompt] = answer;
          }
        }
        return {
          behavior: 'allow',
          updatedInput: { ...toolInput, answers },
        };
      }

      if (effectivePermissionMode === 'bypassPermissions') {
        return { behavior: 'allow', updatedInput: toolInput };
      }

      const isCommand = toolName === 'Bash';
      const isFileEdit = toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit' || toolName === 'NotebookEdit';
      if (effectivePermissionMode === 'acceptEdits' && isFileEdit) {
        return { behavior: 'allow', updatedInput: toolInput };
      }

      const question = isCommand
        ? (text(toolInput.command).trim() || `Allow Claude Code to run ${toolName}?`)
        : isFileEdit
          ? `Allow Claude Code to modify ${toWorkspaceRelativePath(text(toolInput.file_path) || text(toolInput.path), cwd) || 'workspace files'}?`
          : `Allow Claude Code to use ${toolName}?`;
      const detail = text(toolInput.description).trim() || undefined;
      const res = await requestInteraction({
        kind: 'approval',
        title: isCommand ? 'Approve command' : isFileEdit ? 'Approve file changes' : `Approve ${toolName}`,
        question,
        ...(detail ? { detail } : {}),
        actionKind: isCommand ? 'command' : isFileEdit ? 'file_change' : 'other',
      });
      if (res.kind === 'approval' && res.decision === 'approve') {
        return { behavior: 'allow', updatedInput: toolInput };
      }
      return { behavior: 'deny', message: 'User declined permission.' };
    };

    const handleFrame = (frame: ClaudeRecord) => {
      const type = text(frame.type);
      const frameSessionId = text(frame.session_id).trim();
      if (frameSessionId && frameSessionId !== sessionId) {
        const rotated = Boolean(shouldForkFirstTurn || (sessionId && frameSessionId !== sessionId));
        sessionId = frameSessionId;
        emit({
          type: 'session_bound',
          nativeSessionId: frameSessionId,
          model: currentModel,
          ...(shouldForkFirstTurn ? { resumeCursor: '' } : {}),
          ...(rotated ? { rotated: true } : {}),
        });
      }

      if (type === 'system' && frame.subtype === 'init') {
        const modelFromInit = text(frame.model).trim();
        if (modelFromInit) currentModel = modelFromInit;
        if (sessionId) {
          emit({
            type: 'session_bound',
            nativeSessionId: sessionId,
            model: currentModel,
            ...(shouldForkFirstTurn ? { resumeCursor: '', rotated: true } : {}),
          });
        }
        return;
      }

      if (type === 'stream_event') {
        const event = claudeRecord(frame.event);
        if (!event) return;
        const evType = text(event.type);
        const index = typeof event.index === 'number' ? event.index : 0;

        if (evType === 'content_block_start') {
          const block = claudeRecord(event.content_block);
          const blockType = text(block?.type);
          if (blockType === 'text' || blockType === 'thinking') {
            blockCounter += 1;
            streamedBlockKinds.set(index, blockType);
          }
          return;
        }

        if (evType === 'content_block_delta') {
          const delta = claudeRecord(event.delta);
          const deltaType = text(delta?.type);
          const itemId = `claude-blk-${blockCounter || index}`;
          if (deltaType === 'text_delta') {
            const chunk = text(delta?.text);
            if (chunk) {
              streamedTextSinceLastAssistant = true;
              emit({ type: 'text_delta', itemId, delta: chunk });
            }
          } else if (deltaType === 'thinking_delta') {
            const chunk = text(delta?.thinking);
            if (chunk) {
              streamedThinkingSinceLastAssistant = true;
              emit({ type: 'thinking_delta', itemId, delta: chunk });
            }
          }
          return;
        }

        if (evType === 'content_block_stop') {
          const kind = streamedBlockKinds.get(index);
          const itemId = `claude-blk-${blockCounter || index}`;
          if (kind === 'text') emit({ type: 'text_done', itemId });
          else if (kind === 'thinking') emit({ type: 'thinking_done', itemId });
          streamedBlockKinds.delete(index);
        }
        return;
      }

      if (type === 'assistant') {
        const message = claudeRecord(frame.message);
        const blocks = Array.isArray(message?.content) ? message.content : [];
        for (const rawBlock of blocks) {
          const block = claudeRecord(rawBlock);
          if (!block) continue;
          const bType = text(block.type);
          if (bType === 'thinking') {
            const thinkingText = text(block.thinking);
            if (thinkingText && !streamedThinkingSinceLastAssistant) {
              blockCounter += 1;
              emit({ type: 'thinking_done', itemId: `claude-blk-${blockCounter}`, text: thinkingText });
            }
            streamedThinkingSinceLastAssistant = false;
          } else if (bType === 'text') {
            const replyText = text(block.text);
            if (replyText && !streamedTextSinceLastAssistant) {
              blockCounter += 1;
              emit({ type: 'text_done', itemId: `claude-blk-${blockCounter}`, text: replyText });
            }
            streamedTextSinceLastAssistant = false;
          } else if (bType === 'tool_use') {
            const id = text(block.id).trim();
            const rawName = text(block.name).trim();
            const input = claudeRecord(block.input) ?? {};
            if (!id || !rawName) continue;

            // Map Claude's TodoWrite into xopc's live plan progress dock.
            if (rawName === 'TodoWrite' && Array.isArray(input.todos)) {
              const steps = input.todos
                .map(claudeRecord)
                .filter((t): t is ClaudeRecord => Boolean(t))
                .map((t) => ({
                  step: text(t.content).trim() || text(t.activeForm).trim(),
                  status: (text(t.status) === 'completed'
                    ? 'completed'
                    : text(t.status) === 'in_progress'
                      ? 'in_progress'
                      : 'pending') as 'pending' | 'in_progress' | 'completed',
                }))
                .filter((s) => s.step.length > 0);
              if (steps.length > 0) emit({ type: 'plan_updated', steps });
              continue;
            }

            const normalizedName = normalizeClaudeToolName(rawName);
            activeTools.set(id, { rawName, input, normalizedName });
            emit({
              type: 'tool_start',
              tool: {
                id,
                toolName: normalizedName,
                args: normalizeClaudeToolArgs(rawName, input, cwd),
              },
            });
          }
        }
        return;
      }

      if (type === 'user') {
        const message = claudeRecord(frame.message);
        const blocks = Array.isArray(message?.content) ? message.content : [];
        const extraResult = claudeRecord(frame.tool_use_result);
        for (const rawBlock of blocks) {
          const block = claudeRecord(rawBlock);
          if (!block || block.type !== 'tool_result') continue;
          const toolUseId = text(block.tool_use_id).trim();
          if (!toolUseId) continue;
          const tracked = activeTools.get(toolUseId);
          activeTools.delete(toolUseId);
          if (!tracked) continue;

          const isError = block.is_error === true;
          const outputText = extractToolResultText(block.content);
          if (tracked.rawName === 'Bash') {
            const stdout = text(extraResult?.stdout) || outputText;
            const stderr = text(extraResult?.stderr);
            const combined = [stdout, stderr].filter(Boolean).join('\n');
            const normalized = buildNormalizedExecCommandResult({
              id: toolUseId,
              command: text(tracked.input.command),
              cwd,
              output: combined,
              exitCode: isError ? 1 : 0,
              isError,
            });
            emit({
              type: 'tool_end',
              result: normalized,
            });
          } else if (
            tracked.rawName === 'Edit'
            || tracked.rawName === 'MultiEdit'
            || tracked.rawName === 'Write'
            || tracked.rawName === 'NotebookEdit'
          ) {
            const filePath = text(tracked.input.file_path) || text(tracked.input.path) || text(tracked.input.notebook_path);
            const rel = filePath ? toWorkspaceRelativePath(filePath, cwd) : '';
            const normalized = buildNormalizedApplyPatchResult({
              id: toolUseId,
              rawChanges: rel
                ? [{ path: rel, kind: tracked.rawName === 'Write' ? 'create' : 'update' }]
                : [],
              cwd,
              isError,
              fallbackOutput: outputText,
            });
            emit({
              type: 'tool_end',
              result: normalized,
            });
          } else {
            emit({
              type: 'tool_end',
              result: {
                id: toolUseId,
                isError,
                content: [{ type: 'text', text: outputText || (isError ? 'Tool failed.' : 'Done.') }],
                details: { tool: tracked.rawName },
              },
            });
          }
        }
        return;
      }

      if (type === 'result') {
        const usageRec = claudeRecord(frame.usage);
        if (usageRec) {
          const input = typeof usageRec.input_tokens === 'number' ? usageRec.input_tokens : 0;
          const output = typeof usageRec.output_tokens === 'number' ? usageRec.output_tokens : 0;
          const cacheRead = typeof usageRec.cache_read_input_tokens === 'number' ? usageRec.cache_read_input_tokens : 0;
          const cacheWrite = typeof usageRec.cache_creation_input_tokens === 'number' ? usageRec.cache_creation_input_tokens : 0;
          emit({
            type: 'usage',
            usage: {
              input,
              output,
              cacheRead,
              cacheWrite,
              totalTokens: input + output + cacheRead + cacheWrite,
            },
          });
        }
        terminal.resolve(frame);
      }
    };

    const interrupt = () => {
      if (!client || interruptSent) return;
      interruptSent = true;
      void client.requestControl('interrupt', {}, AbortSignal.timeout(3_000)).catch(() => {});
    };

    const onAbort = () => {
      stopTimer = setTimeout(() => {
        terminal.reject(signal.reason ?? new Error('Claude Code turn interrupted.'));
      }, STOP_TIMEOUT_MS);
      interrupt();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const pooled = existingBinding?.nativeSessionId && !shouldForkFirstTurn
        ? await checkoutPooledExternalSession<PooledClaudeSession>(
            context.conversationId,
            buildFingerprint(existingBinding.nativeSessionId),
          )
        : undefined;

      if (pooled) {
        client = pooled.client;
        sessionId = pooled.sessionId;
        currentModel = pooled.model;
        currentPermMode = pooled.permissionMode;
        client.setHandlers({
          onEvent: handleFrame,
          onFailure: terminal.reject,
          onControlRequest: handleControlRequest,
        });
        if (requestedModel && requestedModel !== currentModel) {
          await client.requestControl('set_model', { model: requestedModel }, signal);
          currentModel = requestedModel;
        }
        if (effectivePermissionMode !== currentPermMode) {
          await client.requestControl('set_permission_mode', { mode: effectivePermissionMode }, signal);
          currentPermMode = effectivePermissionMode;
        }
      } else {
        const cliArgs: string[] = [
          '--permission-mode',
          effectivePermissionMode,
        ];
        if (requestedModel) cliArgs.push('--model', requestedModel);
        if (requestedEffort && requestedEffort !== 'off') cliArgs.push('--effort', requestedEffort);
        if (instructions?.trim()) cliArgs.push('--append-system-prompt', instructions.trim());
        if (forkSourceSessionId) {
          cliArgs.push('--resume', forkSourceSessionId, '--fork-session');
        } else if (existingBinding?.nativeSessionId) {
          cliArgs.push('--resume', existingBinding.nativeSessionId);
        }

        client = new ClaudeStreamClient(cwd, {
          binaryPath: claudeConfig?.binaryPath,
          configDir: claudeConfig?.configDir,
          args: cliArgs,
          onEvent: handleFrame,
          onFailure: terminal.reject,
          onControlRequest: handleControlRequest,
        });

        await client.requestControl('initialize', {}, signal);
        if (signal.aborted) {
          emit({ type: 'turn_done', status: 'interrupted' });
          return;
        }
      }

      const effectivePrompt = sessionPolicy.mode === 'plan'
        ? `<plan_mode>\n${PLAN_MODE_INSTRUCTIONS}\n</plan_mode>\n\n${content}`
        : content;
      const userContent = await buildClaudeUserContent(effectivePrompt, attachments);
      client.sendUserMessage(userContent, sessionId);

      const result = await terminal.promise;
      const isError = result.is_error === true;
      const subtype = text(result.subtype);
      if (signal.aborted || subtype === 'interrupted') {
        emit({ type: 'turn_done', status: 'interrupted' });
      } else if (isError) {
        failed = true;
        emit({
          type: 'turn_done',
          status: 'failed',
          errorMessage: text(result.result).trim() || 'Claude Code did not complete the turn.',
        });
      } else {
        emit({ type: 'turn_done', status: 'completed' });
      }
    } catch (error) {
      failed = true;
      if (signal.aborted) {
        emit({ type: 'turn_done', status: 'interrupted' });
        return;
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      clearTimeout(stopTimer);
      const reusable =
        !failed
        && !signal.aborted
        && Boolean(client && sessionId)
        && client!.isAlive();
      if (reusable && client && sessionId) {
        const pooledClient = client;
        const boundId = sessionId;
        pooledClient.setHandlers({});
        checkinPooledExternalSession<PooledClaudeSession>(context.conversationId, {
          fingerprint: buildFingerprint(boundId),
          resource: {
            client: pooledClient,
            sessionId: boundId,
            model: currentModel,
            permissionMode: effectivePermissionMode,
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

  async probe(execution?: ExternalAgentExecution): Promise<ExternalRuntimeProbeResult> {
    const checkedAt = Date.now();
    const claudeConfig = claudeOptionsFromExecution(execution);
    const executablePath = findClaudeExecutable(claudeConfig?.binaryPath);
    if (!executablePath) {
      return {
        kind: 'claude',
        label: 'Claude Code',
        installed: false,
        status: 'not_installed',
        message: claudeConfig?.binaryPath
          ? `Claude Code binary was not found at "${claudeConfig.binaryPath}".`
          : 'Claude Code CLI (`claude`) was not found in PATH on the Gateway host.',
        hintCommand: 'npm i -g @anthropic-ai/claude-code && claude auth login',
        models: [],
        checkedAt,
      };
    }

    let version: string | undefined;
    try {
      const { stdout } = await execFileAsync(executablePath, ['--version'], {
        timeout: 3_000,
        env: buildClaudeEnv(claudeConfig?.configDir),
      });
      const parsed = stdout.trim().match(/\d+\.\d+\.\d+[\w.-]*/)?.[0] || stdout.trim().split('\n')[0]?.trim();
      if (parsed) version = parsed;
    } catch {
      // Version detection is best-effort.
    }

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(new Error('Claude Code health check timed out.')), PROBE_TIMEOUT_MS);
    let client: ClaudeStreamClient | undefined;
    try {
      client = new ClaudeStreamClient(tmpdir(), {
        binaryPath: executablePath,
        configDir: claudeConfig?.configDir,
        onEvent: () => {},
      });
      const initRes = await client.requestControl('initialize', {}, abortController.signal);
      const accountRec = claudeRecord(initRes.account);
      const email = text(accountRec?.email).trim();
      const subType = text(accountRec?.subscriptionType).trim();
      const tokenSource = text(accountRec?.tokenSource).trim();
      const hasApiKeyEnv = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
      const signedIn = Boolean(email || subType || (tokenSource && tokenSource !== 'none') || hasApiKeyEnv);

      if (!signedIn) {
        return {
          kind: 'claude',
          label: 'Claude Code',
          installed: true,
          status: 'unauthenticated',
          executablePath,
          ...(version ? { version } : {}),
          message: 'Claude Code is not signed in. Run `claude auth login` or set `ANTHROPIC_API_KEY` on the host.',
          hintCommand: 'claude auth login',
          models: [],
          checkedAt: Date.now(),
        };
      }

      const models = parseClaudeModels(initRes);
      const commands = parseClaudeCommands(initRes);
      let rateLimits: ExternalRuntimeRateLimits | undefined;
      try {
        const usageRes = await client.requestControl(
          'get_usage',
          {},
          AbortSignal.any([abortController.signal, AbortSignal.timeout(2_500)]),
        );
        rateLimits = parseClaudeRateLimits(usageRes);
      } catch {
        // Usage limits are optional across Claude Code CLI versions.
      }

      return {
        kind: 'claude',
        label: 'Claude Code',
        installed: true,
        status: 'ready',
        executablePath,
        ...(version ? { version } : {}),
        account: {
          label: email || (hasApiKeyEnv ? 'Anthropic API key' : 'Signed in'),
          ...(subType ? { authMode: subType } : tokenSource ? { authMode: tokenSource } : {}),
        },
        ...(rateLimits ? { rateLimits } : {}),
        ...(commands.length > 0 ? { commands } : {}),
        models,
        checkedAt: Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unauthenticated = /auth|login|sign.?in|unauthorized|401|api.?key|credentials/i.test(message);
      return {
        kind: 'claude',
        label: 'Claude Code',
        installed: true,
        status: unauthenticated ? 'unauthenticated' : 'warning',
        executablePath,
        ...(version ? { version } : {}),
        message,
        ...(unauthenticated ? { hintCommand: 'claude auth login' } : {}),
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
    // Claude Code natively forks when resuming with `--resume <sourceId> --fork-session` on the next turn.
    // Use a unique pending session id to satisfy UNIQUE(runtime_kind, native_session_id) until the first turn rotates it.
    return {
      nativeSessionId: `pending-fork:${randomUUID()}`,
      resumeCursor: `fork:${context.nativeSessionId}`,
    };
  },
};
