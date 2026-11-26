import { realpath } from 'node:fs/promises';

import {
  parseUserTurnDocument,
  renderUserTurnDocument,
  type UserTurnDocument,
} from '@xopcai/gateway-contract';
import type { AssistantMessage } from '@earendil-works/pi-ai';

import { getExecutionEnvironmentForSession } from '../../execution-environments/subject.js';
import type { UserTurnAttachment } from '../../gateway/user-turn-input.js';
import { getProjectForSession } from '../../projects/workspace.js';
import { projectWorkspacePath } from '../../session/session-workspace.js';
import type { TranscriptStoredRow } from '../../session/session-context-for-llm.js';
import { getSessionInteractionPolicy } from '../session/interaction-policy.js';
import { AsyncQueue } from '../service/async-queue.js';
import { prepareExternalAttachments } from './attachments.js';
import {
  cancelExternalInteractionsForConversation,
  waitForExternalInteraction,
} from './interaction.js';
import {
  ExternalTurnOutcomeAggregator,
  normalizeExternalPlanSteps,
} from './presentation.js';
import { getExternalAgentDriver } from './registry.js';
import {
  appendExternalTranscriptEntry,
  bindExternalSession,
  readExternalSessionBinding,
  updateExternalTranscriptEntry,
} from './session-binding.js';
import type {
  ExternalRuntimeEvent,
  ExternalRuntimeToolCall,
  ExternalRuntimeToolResult,
  ExternalRuntimeUsage,
  ExternalTurnEvent,
  ExternalTurnSteerHandler,
  RunExternalProjectTurnInput,
} from './types.js';

export type SteerExternalTurnOptions = {
  attachments?: UserTurnAttachment[];
  clientMessageId?: string;
  userTurnDocument?: UserTurnDocument;
  onHandled?: () => void;
};

type ActiveExternalRun = {
  runId: string;
  stop: AbortController;
  finished: Promise<void>;
  steer: (content: string, options?: SteerExternalTurnOptions) => Promise<boolean>;
};

const activeRuns = new Map<string, ActiveExternalRun>();

export function hasActiveExternalTurn(conversationId: string): boolean {
  return activeRuns.has(conversationId);
}

export async function steerExternalTurn(
  conversationId: string,
  content: string,
  expectedRunId?: string,
  options?: SteerExternalTurnOptions,
): Promise<boolean> {
  const run = activeRuns.get(conversationId);
  if (!run) return false;
  if (expectedRunId !== undefined && run.runId !== expectedRunId) return false;
  return run.steer(content, options);
}

export async function abortExternalTurn(conversationId: string): Promise<void> {
  const run = activeRuns.get(conversationId);
  if (!run) return;
  run.stop.abort();
  await run.finished.catch(() => {});
}

export async function abortAllExternalTurns(): Promise<void> {
  await Promise.all(Array.from(activeRuns.keys(), abortExternalTurn));
}

const NATIVE_STEER_READY_TIMEOUT_MS = 5_000;

export async function* runExternalProjectTurn(
  input: RunExternalProjectTurnInput,
): AsyncGenerator<ExternalTurnEvent> {
  const { conversationId, transcriptId, runId, agentId, execution } = input;
  const runtimeKind = execution.kind;
  const driver = getExternalAgentDriver(runtimeKind);
  const stop = new AbortController();
  const signal = AbortSignal.any([input.signal, stop.signal]);

  const project = getProjectForSession(conversationId);
  const workspace = project && (getExecutionEnvironmentForSession(conversationId)?.rootPath ?? projectWorkspacePath(project));
  if (driver.capabilities.requiresWorkspace && !workspace) {
    throw new Error(`Start a Project session with a workspace to use this ${driver.label} Agent.`);
  }
  const hasAttachments = Boolean(input.attachments?.length);
  if (!driver.capabilities.supportsAttachments && (input.hasAttachmentsOrContext || hasAttachments)) {
    throw new Error(`${driver.label} Project sessions currently accept text messages only.`);
  }
  const document = parseUserTurnDocument(input.content);
  const content = document ? renderUserTurnDocument(document, () => null) : input.content;
  if (!content.trim() && !hasAttachments) throw new Error(`Enter a task for ${driver.label}.`);
  const cwd = await realpath(workspace!);
  signal.throwIfAborted();
  if (activeRuns.has(conversationId)) throw new Error(`${driver.label} is already running in this session.`);

  const sessionPolicy = getSessionInteractionPolicy(conversationId);
  const permissionMode =
    sessionPolicy.mode === 'plan' || sessionPolicy.access === 'read-only'
      ? 'ask'
      : (execution.permissionMode ?? 'full_access');

  const identity = { conversationId, transcriptId, runtimeKind, agentId, cwd };
  let attemptSeq = 0;
  let steerSeq = 0;
  const entry = (suffix: string) =>
    `${runtimeKind}:${runId}:${attemptSeq > 0 ? `r${attemptSeq}:` : ''}${suffix}`;
  const runEntry = (suffix: string) => `${runtimeKind}:${runId}:${suffix}`;
  const queue = new AsyncQueue<ExternalTurnEvent>({ maxBuffered: 4_096 });
  const outcomeAggregator = new ExternalTurnOutcomeAggregator();

  let userPersisted = false;
  let transcriptStale = false;
  const persistWithId = (entryId: string, row: TranscriptStoredRow & { turnId?: string }) => {
    if (transcriptStale || !appendExternalTranscriptEntry(identity, entryId, row)) {
      transcriptStale = true;
      throw new Error(`The session changed while ${driver.label} was running.`);
    }
  };
  const persist = (suffix: string, row: TranscriptStoredRow & { turnId?: string }) => {
    persistWithId(entry(suffix), row);
  };
  const tryPersist = (suffix: string, row: TranscriptStoredRow & { turnId?: string }) => {
    if (!userPersisted || transcriptStale) return;
    if (!appendExternalTranscriptEntry(identity, entry(suffix), row)) transcriptStale = true;
  };
  const tryUpdatePersisted = (suffix: string, row: TranscriptStoredRow & { turnId?: string }) => {
    if (!userPersisted || transcriptStale) return;
    updateExternalTranscriptEntry(identity, entry(suffix), row);
  };
  const emit = (type: string, payload: Record<string, unknown> = {}) => queue.push({ type, runId, ...payload });

  const messages = new Map<string, string>();
  const thoughts = new Map<string, string>();
  const tools = new Map<string, { toolCallId: string; tool: ExternalRuntimeToolCall }>();
  const finishedTools = new Set<string>();
  const finishedMessages = new Set<string>();
  const finishedThoughts = new Set<string>();
  let planUpdateSeq = 0;

  let model = input.modelOverride?.trim() || execution.model?.trim() || driver.defaultModelName;
  let usage: ExternalRuntimeUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const assistant = (
    messageContent: AssistantMessage['content'],
    stopReason: AssistantMessage['stopReason'] = 'stop',
  ): AssistantMessage & { turnId: string } => ({
    role: 'assistant',
    content: messageContent,
    api: driver.transcriptApi,
    provider: driver.transcriptProvider,
    model,
    stopReason,
    timestamp: Date.now(),
    turnId: runId,
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      totalTokens: usage.totalTokens ?? (usage.input + usage.output),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });

  let fullText = '';
  let lastTextId: string | undefined;
  let bubbleStarted = false;
  let failure: string | undefined;
  let interrupted = false;

  const startBubble = () => {
    if (bubbleStarted) return;
    bubbleStarted = true;
    emit('message_start', { message: assistant([]) });
  };

  const closeActiveBubble = (stopReason: AssistantMessage['stopReason'] = 'stop') => {
    if (!bubbleStarted) return;
    emit('message_end', { message: assistant(fullText ? [{ type: 'text', text: fullText }] : [], stopReason) });
    bubbleStarted = false;
    fullText = '';
    lastTextId = undefined;
  };

  const finishThinking = (id: string, final?: string, safePersist = false) => {
    if (finishedThoughts.has(id)) return;
    const partial = thoughts.get(id) ?? '';
    const value = (final ?? partial).trim();
    if (value) {
      const write = safePersist ? tryPersist : persist;
      write(`thinking:${id}`, assistant([{ type: 'thinking', thinking: value }], 'stop'));
    }
    finishedThoughts.add(id);
    thoughts.delete(id);
  };

  const flushAllThinking = (safePersist = false) => {
    for (const id of [...thoughts.keys()]) {
      finishThinking(id, undefined, safePersist);
    }
  };

  const appendThinking = (id: string, delta: string) => {
    if (!delta || finishedThoughts.has(id)) return;
    startBubble();
    thoughts.set(id, (thoughts.get(id) ?? '') + delta);
    emit('message_update', { message: assistant([]), assistantMessageEvent: { type: 'thinking_delta', delta } });
  };

  const appendText = (id: string, delta: string) => {
    if (!delta || finishedMessages.has(id)) return;
    flushAllThinking();
    startBubble();
    const appended = fullText && lastTextId !== id ? `\n\n${delta}` : delta;
    lastTextId = id;
    fullText += appended;
    messages.set(id, (messages.get(id) ?? '') + delta);
    emit('message_update', { message: assistant([]), assistantMessageEvent: { type: 'text_delta', delta: appended } });
  };

  const finishMessage = (
    id: string,
    final?: string,
    stopReason?: AssistantMessage['stopReason'],
    safePersist = false,
  ) => {
    if (finishedMessages.has(id)) return;
    const partial = messages.get(id) ?? '';
    if (final?.startsWith(partial)) appendText(id, final.slice(partial.length));
    const value = final || partial;
    if (value) {
      const write = safePersist ? tryPersist : persist;
      write(`message:${id}`, assistant([{ type: 'text', text: value }], stopReason));
    }
    finishedMessages.add(id);
    messages.delete(id);
  };

  const startTool = (tool: ExternalRuntimeToolCall) => {
    if (finishedTools.has(tool.id) || tools.has(tool.id)) return;
    flushAllThinking();
    const toolCallId = entry(`tool:${tool.id}`);
    tools.set(tool.id, { toolCallId, tool });
    persist(
      `call:${tool.id}`,
      assistant([{ type: 'toolCall', id: toolCallId, name: tool.toolName, arguments: tool.args }], 'toolUse'),
    );
    startBubble();
    emit('tool_execution_start', { toolCallId, toolName: tool.toolName, args: tool.args });
  };

  const updateTool = (tool: ExternalRuntimeToolCall) => {
    const tracked = tools.get(tool.id);
    if (!tracked || finishedTools.has(tool.id)) return;
    const mergedArgs = { ...tracked.tool.args, ...tool.args };
    tracked.tool = { ...tracked.tool, toolName: tool.toolName || tracked.tool.toolName, args: mergedArgs };
    tryUpdatePersisted(
      `call:${tool.id}`,
      assistant([{ type: 'toolCall', id: tracked.toolCallId, name: tracked.tool.toolName, arguments: mergedArgs }], 'toolUse'),
    );
  };

  const finishTool = (id: string, result?: ExternalRuntimeToolResult, safePersist = false) => {
    const tracked = tools.get(id);
    if (!tracked || finishedTools.has(id)) return;
    const isError = result ? result.isError : true;
    const normalized = result
      ? { content: result.content, details: result.details }
      : { content: [], details: {} };

    // Enrich persisted toolCall args with primary path when patch targets only became known on completion.
    if (tracked.tool.toolName === 'apply_patch' && !tracked.tool.args.path) {
      const files = Array.isArray(normalized.details.files)
        ? normalized.details.files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        : [];
      if (files.length > 0) {
        const primaryPath = files.length === 1 ? files[0] : `${files[0]} (+${files.length - 1})`;
        tracked.tool = { ...tracked.tool, args: { ...tracked.tool.args, path: primaryPath } };
        tryUpdatePersisted(
          `call:${id}`,
          assistant([{ type: 'toolCall', id: tracked.toolCallId, name: tracked.tool.toolName, arguments: tracked.tool.args }], 'toolUse'),
        );
      }
    }

    if (result) {
      outcomeAggregator.recordToolResult(tracked.tool.toolName, result);
    }

    const write = safePersist ? tryPersist : persist;
    write(`result:${id}`, {
      role: 'toolResult',
      toolCallId: tracked.toolCallId,
      toolName: tracked.tool.toolName,
      content: normalized.content,
      details: normalized.details,
      isError,
      timestamp: Date.now(),
      turnId: runId,
    } as TranscriptStoredRow);
    emit('tool_execution_end', {
      toolCallId: tracked.toolCallId,
      toolName: tracked.tool.toolName,
      isError,
      result: normalized,
    });
    finishedTools.add(id);
    tools.delete(id);
  };

  const recordPlanUpdate = (explanation: string | undefined, rawSteps: Array<{ id?: string; step: string; status: string }>) => {
    const plan = normalizeExternalPlanSteps(rawSteps);
    if (plan.length === 0) return;
    const seq = ++planUpdateSeq;
    const syntheticId = `plan-${seq}`;
    const toolCallId = entry(`tool:${syntheticId}`);
    const text = [explanation?.trim(), ...plan.map((item) => `- [${item.status}] ${item.step}`)].filter(Boolean).join('\n');
    const args = {
      ...(explanation?.trim() ? { explanation: explanation.trim() } : {}),
      plan: plan.map((item) => ({ ...(item.id ? { id: item.id } : {}), step: item.step, status: item.status })),
    };

    persist(`call:${syntheticId}`, assistant([{ type: 'toolCall', id: toolCallId, name: 'update_plan', arguments: args }], 'toolUse'));
    startBubble();
    emit('tool_execution_start', { toolCallId, toolName: 'update_plan', args });

    const normalized = { content: [{ type: 'text' as const, text }], details: args };
    persist(`result:${syntheticId}`, {
      role: 'toolResult',
      toolCallId,
      toolName: 'update_plan',
      content: normalized.content,
      details: normalized.details,
      isError: false,
      timestamp: Date.now(),
      turnId: runId,
    } as TranscriptStoredRow);
    emit('tool_execution_end', {
      toolCallId,
      toolName: 'update_plan',
      isError: false,
      result: normalized,
    });
  };

  const handleEvent = (event: ExternalRuntimeEvent) => {
    switch (event.type) {
      case 'session_bound':
        if (event.model) model = event.model;
        bindExternalSession(identity, {
          nativeSessionId: event.nativeSessionId,
          inputEntryId: runEntry('user'),
          resumeCursor: event.resumeCursor,
          metadata: event.metadata,
          allowSessionRotation: event.rotated,
        });
        return;
      case 'text_delta':
        appendText(event.itemId, event.delta);
        return;
      case 'text_done':
        finishMessage(event.itemId, event.text);
        return;
      case 'thinking_delta':
        appendThinking(event.itemId, event.delta);
        return;
      case 'thinking_done':
        finishThinking(event.itemId, event.text);
        return;
      case 'tool_start':
        startTool(event.tool);
        return;
      case 'tool_update':
        updateTool(event.tool);
        return;
      case 'tool_output_delta': {
        const tracked = tools.get(event.id);
        if (!tracked || !event.delta) return;
        emit('tool_execution_update', {
          toolCallId: tracked.toolCallId,
          toolName: tracked.tool.toolName,
          partialResult: {
            details: { kind: 'command_output_delta', stream: event.stream ?? 'stdout', delta: event.delta },
          },
        });
        return;
      }
      case 'tool_end':
        finishTool(event.result.id, event.result);
        return;
      case 'plan_updated':
        recordPlanUpdate(event.explanation, event.steps);
        return;
      case 'title_updated':
        if (event.title.trim()) input.onTitleUpdated?.(event.title.trim());
        return;
      case 'usage':
        usage = event.usage;
        return;
      case 'turn_done':
        if (event.status === 'interrupted') {
          interrupted = true;
        } else if (event.status === 'failed') {
          failure = event.errorMessage || `${driver.label} did not complete the turn.`;
        }
        return;
    }
  };

  const steeringMode = driver.capabilities.steeringMode ?? 'interrupt_restart';
  const attachmentCleanups: Array<() => void> = [];
  const cleanupAttachments = () => {
    while (attachmentCleanups.length > 0) {
      const fn = attachmentCleanups.pop();
      try {
        fn?.();
      } catch {
        // Best-effort temp cleanup.
      }
    }
  };

  type QueuedRestartSteer = {
    content: string;
    attachments: UserTurnAttachment[] | undefined;
    clientMessageId?: string;
    userTurnDocument?: UserTurnDocument;
    onHandled?: () => void;
  };

  let acceptingSteers = true;
  let nativeSteerHandler: ExternalTurnSteerHandler | null = null;
  let nativeSteerWaiters: Array<() => void> = [];
  const notifyNativeSteerState = () => {
    const waiters = nativeSteerWaiters;
    nativeSteerWaiters = [];
    for (const wake of waiters) wake();
  };

  let currentAttemptAbort: AbortController | null = null;
  const pendingRestartSteers: QueuedRestartSteer[] = [];

  const emitAndPersistSteeredUser = (steer: {
    content: string;
    clientMessageId?: string;
    userTurnDocument?: UserTurnDocument;
  }) => {
    flushAllThinking(true);
    for (const id of [...messages.keys()]) finishMessage(id, undefined, 'stop', true);
    closeActiveBubble('stop');
    const seq = ++steerSeq;
    const steeredUser = {
      role: 'user' as const,
      content: steer.content,
      timestamp: Date.now(),
      turnId: runId,
      metadata: {
        ...(steer.clientMessageId ? { clientMessageId: steer.clientMessageId, steered: true } : { steered: true }),
        ...(steer.userTurnDocument ? { userTurnDocument: steer.userTurnDocument } : {}),
      },
    };
    if (userPersisted && !transcriptStale) {
      if (!appendExternalTranscriptEntry(identity, runEntry(`steer:${seq}`), steeredUser)) {
        transcriptStale = true;
      }
    }
    emit('user_message', steeredUser);
  };

  const handleSteerRequest = async (
    rawContent: string,
    options?: SteerExternalTurnOptions,
  ): Promise<boolean> => {
    if (!acceptingSteers || signal.aborted) return false;
    const steerDoc = options?.userTurnDocument ?? parseUserTurnDocument(rawContent);
    const steerText = steerDoc ? renderUserTurnDocument(steerDoc, () => null) : rawContent;
    const hasSteerAttachments = Boolean(options?.attachments?.length);
    if (!steerText.trim() && !hasSteerAttachments) return false;

    if (steeringMode === 'native') {
      // Wait briefly if the driver is still completing initialize / thread/start / turn/start.
      if (!nativeSteerHandler && acceptingSteers && !signal.aborted) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            nativeSteerWaiters = nativeSteerWaiters.filter((fn) => fn !== wake);
            resolve();
          }, NATIVE_STEER_READY_TIMEOUT_MS);
          const wake = () => {
            clearTimeout(timer);
            resolve();
          };
          nativeSteerWaiters.push(wake);
        });
      }
      if (!nativeSteerHandler || !acceptingSteers || signal.aborted) return false;

      const preparedSteerAttachments = prepareExternalAttachments({
        attachments: options?.attachments,
        cwd,
        runId: `${runId}-steer-${steerSeq + 1}`,
      });
      attachmentCleanups.push(preparedSteerAttachments.cleanup);

      try {
        await nativeSteerHandler({
          content: steerText,
          attachments: preparedSteerAttachments.attachments,
          clientMessageId: options?.clientMessageId,
        });
      } catch {
        return false;
      }

      emitAndPersistSteeredUser({
        content: steerText,
        clientMessageId: options?.clientMessageId,
        userTurnDocument: steerDoc ?? undefined,
      });
      options?.onHandled?.();
      return true;
    }

    // `interrupt_restart` steering (ACP/AGY & runtimes without a native mid-turn steer RPC):
    // cancel the active sub-turn and immediately resume the same native session with the steered prompt.
    pendingRestartSteers.push({
      content: steerText,
      attachments: options?.attachments,
      clientMessageId: options?.clientMessageId,
      userTurnDocument: steerDoc ?? undefined,
      onHandled: options?.onHandled,
    });
    currentAttemptAbort?.abort();
    return true;
  };

  const preparedAttachments = prepareExternalAttachments({
    attachments: input.attachments,
    cwd,
    runId,
  });
  attachmentCleanups.push(preparedAttachments.cleanup);

  const execute = async () => {
    try {
      let existingBinding = readExternalSessionBinding(identity);
      const user = {
        role: 'user' as const,
        content,
        timestamp: Date.now(),
        turnId: runId,
        ...(document ? { metadata: { userTurnDocument: document } } : {}),
      };
      persistWithId(runEntry('user'), user);
      userPersisted = true;
      emit('user_message', user);

      let activeContent = content;
      let activeAttachments = preparedAttachments.attachments;
      let activeClientMessageId = input.clientMessageId;

      while (!signal.aborted) {
        if (attemptSeq > 0) existingBinding = readExternalSessionBinding(identity);
        const attemptAbort = new AbortController();
        currentAttemptAbort = attemptAbort;
        const attemptSignal = AbortSignal.any([signal, attemptAbort.signal]);
        let attemptFailure: string | undefined;

        try {
          await driver.runTurn({
            conversationId,
            transcriptId,
            agentId,
            execution,
            permissionMode,
            sessionPolicy,
            modelOverride: input.modelOverride,
            thinkingLevel: input.thinkingLevel,
            runId,
            clientMessageId: activeClientMessageId,
            cwd,
            content: activeContent,
            attachments: activeAttachments,
            instructions: input.instructions,
            existingBinding,
            signal: attemptSignal,
            emit: handleEvent,
            requestInteraction: (request) =>
              waitForExternalInteraction({
                conversationId,
                transcriptId,
                runId,
                request,
                signal: attemptSignal,
                emitClarifyEvent: (clarifyEvent) => {
                  queue.push({ ...clarifyEvent, runId });
                },
              }),
            registerSteerHandler: (handler) => {
              nativeSteerHandler = handler;
              notifyNativeSteerState();
            },
          });
        } catch (error) {
          if (!attemptSignal.aborted) {
            attemptFailure = error instanceof Error ? error.message : String(error);
          }
        } finally {
          nativeSteerHandler = null;
          currentAttemptAbort = null;
          cancelExternalInteractionsForConversation(conversationId);
        }

        // If an interrupt_restart steer arrived while this attempt was running, flush the cancelled
        // attempt and immediately continue on the same native session with the steered prompt.
        if (!signal.aborted && pendingRestartSteers.length > 0) {
          const nextSteer = pendingRestartSteers.shift()!;
          flushAllThinking(true);
          for (const id of [...messages.keys()]) finishMessage(id, undefined, 'aborted', true);
          for (const id of [...tools.keys()]) finishTool(id, undefined, true);
          closeActiveBubble('aborted');

          messages.clear();
          thoughts.clear();
          tools.clear();
          finishedTools.clear();
          finishedMessages.clear();
          finishedThoughts.clear();
          interrupted = false;
          failure = undefined;
          attemptSeq += 1;

          emitAndPersistSteeredUser(nextSteer);
          nextSteer.onHandled?.();

          const preparedNext = prepareExternalAttachments({
            attachments: nextSteer.attachments,
            cwd,
            runId: `${runId}-steer-${attemptSeq}`,
          });
          attachmentCleanups.push(preparedNext.cleanup);
          activeContent = nextSteer.content;
          activeAttachments = preparedNext.attachments;
          activeClientMessageId = nextSteer.clientMessageId;
          continue;
        }

        if (attemptFailure) failure = attemptFailure;
        break;
      }
    } catch (error) {
      if (!signal.aborted) failure = error instanceof Error ? error.message : String(error);
    } finally {
      acceptingSteers = false;
      nativeSteerHandler = null;
      notifyNativeSteerState();
      cancelExternalInteractionsForConversation(conversationId);
      cleanupAttachments();
    }

    interrupted ||= signal.aborted;
    const stopReason = interrupted ? 'aborted' : failure ? 'error' : 'stop';
    flushAllThinking(true);
    for (const id of messages.keys()) finishMessage(id, undefined, stopReason, true);
    for (const id of tools.keys()) finishTool(id, undefined, true);
    closeActiveBubble(stopReason);
    const outcome = outcomeAggregator.buildOutcome({
      outcomeId: runEntry('outcome'),
      runId,
      status: interrupted ? 'partial' : failure ? 'failed' : 'succeeded',
      summary: interrupted ? 'aborted' : failure,
    });
    tryPersist('outcome', { type: 'custom', customType: 'turn_outcome', data: outcome, timestamp: outcome.createdAt });
    emit('turn_outcome', { outcome });
    if (failure) emit('error', { content: failure });
  };

  const runPromise = execute().finally(() => queue.close());
  activeRuns.set(conversationId, { runId, stop, finished: runPromise, steer: handleSteerRequest });
  void runPromise.catch(() => {});
  try {
    yield* queue;
    await runPromise;
  } finally {
    stop.abort();
    await runPromise.catch(() => {});
    activeRuns.delete(conversationId);
  }
}
