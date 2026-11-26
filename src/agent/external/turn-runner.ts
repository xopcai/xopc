import { realpath } from 'node:fs/promises';

import { parseUserTurnDocument, renderUserTurnDocument, type TurnOutcome } from '@xopcai/gateway-contract';
import type { AssistantMessage } from '@earendil-works/pi-ai';

import { getExecutionEnvironmentForSession } from '../../execution-environments/subject.js';
import { getProjectForSession } from '../../projects/workspace.js';
import { projectWorkspacePath } from '../../session/session-workspace.js';
import type { TranscriptStoredRow } from '../../session/session-context-for-llm.js';
import { AsyncQueue } from '../service/async-queue.js';
import { getExternalAgentDriver } from './registry.js';
import {
  appendExternalTranscriptEntry,
  bindExternalSession,
  readExternalSessionBinding,
} from './session-binding.js';
import type {
  ExternalRuntimeEvent,
  ExternalRuntimeToolCall,
  ExternalRuntimeToolResult,
  ExternalRuntimeUsage,
  ExternalTurnEvent,
  RunExternalProjectTurnInput,
} from './types.js';

const activeRuns = new Map<string, { stop: AbortController; finished: Promise<void> }>();

export async function abortExternalTurn(conversationId: string): Promise<void> {
  const run = activeRuns.get(conversationId);
  if (!run) return;
  run.stop.abort();
  await run.finished.catch(() => {});
}

export async function abortAllExternalTurns(): Promise<void> {
  await Promise.all(Array.from(activeRuns.keys(), abortExternalTurn));
}

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
  if (!driver.capabilities.supportsAttachments && input.hasAttachmentsOrContext) {
    throw new Error(`${driver.label} Project sessions currently accept text messages only.`);
  }
  const document = parseUserTurnDocument(input.content);
  const content = document ? renderUserTurnDocument(document, () => null) : input.content;
  if (!content.trim()) throw new Error(`Enter a task for ${driver.label}.`);
  const cwd = await realpath(workspace!);
  signal.throwIfAborted();
  if (activeRuns.has(conversationId)) throw new Error(`${driver.label} is already running in this session.`);

  const identity = { conversationId, transcriptId, runtimeKind, agentId, cwd };
  const entry = (suffix: string) => `${runtimeKind}:${runId}:${suffix}`;
  const queue = new AsyncQueue<ExternalTurnEvent>({ maxBuffered: 4_096 });

  let userPersisted = false;
  let transcriptStale = false;
  const persist = (suffix: string, row: TranscriptStoredRow & { turnId?: string }) => {
    if (transcriptStale || !appendExternalTranscriptEntry(identity, entry(suffix), row)) {
      transcriptStale = true;
      throw new Error(`The session changed while ${driver.label} was running.`);
    }
  };
  const tryPersist = (suffix: string, row: TranscriptStoredRow & { turnId?: string }) => {
    if (!userPersisted || transcriptStale) return;
    if (!appendExternalTranscriptEntry(identity, entry(suffix), row)) transcriptStale = true;
  };
  const emit = (type: string, payload: Record<string, unknown> = {}) => queue.push({ type, runId, ...payload });

  const messages = new Map<string, string>();
  const tools = new Map<string, { toolCallId: string; tool: ExternalRuntimeToolCall }>();
  const finishedTools = new Set<string>();
  const finishedMessages = new Set<string>();

  let model = driver.defaultModelName;
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

  const appendText = (id: string, delta: string) => {
    if (!delta || finishedMessages.has(id)) return;
    startBubble();
    const appended = fullText && lastTextId !== id ? `\n\n${delta}` : delta;
    lastTextId = id;
    fullText += appended;
    messages.set(id, (messages.get(id) ?? '') + delta);
    emit('message_update', { message: assistant([]), assistantMessageEvent: { type: 'text_delta', delta: appended } });
  };

  const appendThinking = (delta: string) => {
    if (!delta) return;
    startBubble();
    emit('message_update', { message: assistant([]), assistantMessageEvent: { type: 'thinking_delta', delta } });
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
    const toolCallId = entry(`tool:${tool.id}`);
    tools.set(tool.id, { toolCallId, tool });
    persist(
      `call:${tool.id}`,
      assistant([{ type: 'toolCall', id: toolCallId, name: tool.toolName, arguments: tool.args }], 'toolUse'),
    );
    startBubble();
    emit('tool_execution_start', { toolCallId, toolName: tool.toolName, args: tool.args });
  };

  const finishTool = (id: string, result?: ExternalRuntimeToolResult, safePersist = false) => {
    const tracked = tools.get(id);
    if (!tracked || finishedTools.has(id)) return;
    const isError = result ? result.isError : true;
    const normalized = result
      ? { content: result.content, details: result.details }
      : { content: [], details: {} };
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

  const handleEvent = (event: ExternalRuntimeEvent) => {
    switch (event.type) {
      case 'session_bound':
        if (event.model) model = event.model;
        bindExternalSession(identity, {
          nativeSessionId: event.nativeSessionId,
          inputEntryId: entry('user'),
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
        appendThinking(event.delta);
        return;
      case 'tool_start':
        startTool(event.tool);
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

  const execute = async () => {
    try {
      const existingBinding = readExternalSessionBinding(identity);
      const user = {
        role: 'user' as const,
        content,
        timestamp: Date.now(),
        turnId: runId,
        ...(document ? { metadata: { userTurnDocument: document } } : {}),
      };
      persist('user', user);
      userPersisted = true;
      emit('user_message', user);

      await driver.runTurn({
        conversationId,
        transcriptId,
        agentId,
        execution,
        runId,
        clientMessageId: input.clientMessageId,
        cwd,
        content,
        instructions: input.instructions,
        existingBinding,
        signal,
        emit: handleEvent,
      });
    } catch (error) {
      if (!signal.aborted) failure = error instanceof Error ? error.message : String(error);
    }

    interrupted ||= signal.aborted;
    const stopReason = interrupted ? 'aborted' : failure ? 'error' : 'stop';
    for (const id of messages.keys()) finishMessage(id, undefined, stopReason, true);
    for (const id of tools.keys()) finishTool(id, undefined, true);
    if (bubbleStarted) {
      emit('message_end', { message: assistant(fullText ? [{ type: 'text', text: fullText }] : [], stopReason) });
    }
    const outcome: TurnOutcome = {
      version: 1,
      outcomeId: entry('outcome'),
      runId,
      turnId: runId,
      status: interrupted ? 'partial' : failure ? 'failed' : 'succeeded',
      summary: interrupted ? 'aborted' : failure,
      deliverables: [],
      evidence: [],
      createdAt: new Date().toISOString(),
    };
    tryPersist('outcome', { type: 'custom', customType: 'turn_outcome', data: outcome, timestamp: outcome.createdAt });
    emit('turn_outcome', { outcome });
    if (failure) emit('error', { content: failure });
  };

  const runPromise = execute().finally(() => queue.close());
  activeRuns.set(conversationId, { stop, finished: runPromise });
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
