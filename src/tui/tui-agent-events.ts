import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TUI } from '@earendil-works/pi-tui';

import { formatAgentRunErrorForDisplay } from '../agent/client-error-format.js';
import type { ChatLog } from './components/chat-log.js';
import { createAssistantMessageFromText } from './components/assistant-message.js';
import { markRunEvent, markRunIdleAfterCompletion } from './tui-run-state.js';
import type { TuiEventSource, TuiState } from './tui-types.js';

const seenStreamEventKeys = new Set<string>();

export function clearSeenStreamEvents(): void {
  seenStreamEventKeys.clear();
}

export function clearSeenStreamEventsForRun(runId: string): void {
  const prefix = `${runId}:`;
  for (const key of Array.from(seenStreamEventKeys)) {
    if (key.startsWith(prefix)) seenStreamEventKeys.delete(key);
  }
}

const STREAM_TOUCH_EVENTS = new Set([
  'agent_start',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'progress',
]);

const DIRECT_RESPONSE_OWNED_EVENTS = new Set([
  ...STREAM_TOUCH_EVENTS,
  'agent_end',
  'error',
]);

function resolveEventRunId(data: Record<string, unknown>, state: TuiState): string | null {
  if (typeof data.runId === 'string' && data.runId) return data.runId;
  return state.activeRunId ?? state.runStatus.runId ?? state.runStatus.lastCompletedRunId;
}

export function shouldSkipDuplicateBroadcastEvent(
  event: string,
  data: Record<string, unknown>,
  state: TuiState,
  source: TuiEventSource,
): boolean {
  if (source !== 'broadcast') return false;
  if (!DIRECT_RESPONSE_OWNED_EVENTS.has(event)) return false;
  const directRunId = state.runStatus.directStreamRunId;
  if (!directRunId) return false;
  return resolveEventRunId(data, state) === directRunId;
}

function streamEventKey(data: Record<string, unknown>, state: TuiState): string | null {
  const runId = resolveEventRunId(data, state);
  const seq = data.seq;
  if (!runId || typeof seq !== 'number' || !Number.isFinite(seq)) return null;
  return `${runId}:${seq}`;
}

function shouldSkipSeenStreamEvent(
  data: Record<string, unknown>,
  state: TuiState,
  source: TuiEventSource,
): boolean {
  if (source !== 'agent-response' && source !== 'agent-resume' && source !== 'broadcast') return false;
  const key = streamEventKey(data, state);
  if (!key) return false;
  if (seenStreamEventKeys.has(key)) return true;
  seenStreamEventKeys.add(key);
  return false;
}

function isAgentMessage(value: unknown): value is AgentMessage {
  return !!value && typeof value === 'object' && typeof (value as { role?: unknown }).role === 'string';
}

function assistantToolCalls(message: AgentMessage): Array<{ id: string; name: string; arguments: unknown }> {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const calls: Array<{ id: string; name: string; arguments: unknown }> = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const rec = block as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown; input?: unknown };
    if (rec.type !== 'toolCall' && rec.type !== 'tool_use') continue;
    if (typeof rec.id !== 'string' || !rec.id || typeof rec.name !== 'string' || !rec.name) continue;
    calls.push({ id: rec.id, name: rec.name, arguments: rec.arguments ?? rec.input ?? {} });
  }
  return calls;
}

function errorAssistantMessage(errorContent: string): AgentMessage {
  return {
    ...createAssistantMessageFromText(''),
    stopReason: 'error',
    errorMessage: errorContent,
  } as AgentMessage;
}

export function dispatchAgentEvent(
  event: string,
  data: Record<string, unknown>,
  state: TuiState,
  chatLog: ChatLog,
  tui: TUI,
  setActivityStatus: (status: string) => void,
  touchStreamingActivity?: () => void,
  onRunEnded?: () => void,
  onAssistantFinalized?: (message: AgentMessage, options?: { errorMessage?: string }) => void,
  source: TuiEventSource = 'unknown',
): void {
  if (shouldSkipSeenStreamEvent(data, state, source)) return;
  if (shouldSkipDuplicateBroadcastEvent(event, data, state, source)) return;

  if (STREAM_TOUCH_EVENTS.has(event)) touchStreamingActivity?.();

  const runId = resolveEventRunId(data, state) ?? state.activeRunId ?? 'default';

  switch (event) {
    case 'agent_start': {
      state.activeRunId = runId;
      markRunEvent(state, 'waiting', runId, event, source);
      setActivityStatus('waiting');
      break;
    }
    case 'message_start': {
      if (!isAgentMessage(data.message)) break;
      const message = data.message;
      if (message.role === 'assistant') {
        chatLog.startAssistant(message, runId);
      } else if (message.role === 'user') {
        chatLog.addUser((message as { content?: unknown }).content as string | unknown[]);
      }
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'message_update': {
      if (!isAgentMessage(data.message)) break;
      const message = data.message;
      if (message.role === 'assistant') {
        chatLog.updateAssistant(message, runId);
        for (const call of assistantToolCalls(message)) {
          chatLog.startTool(call.id, call.name, call.arguments, runId);
        }
      }
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'message_end': {
      if (!isAgentMessage(data.message)) break;
      const message = data.message;
      if (message.role === 'assistant') {
        chatLog.finalizeAssistant(message, runId);
        for (const call of assistantToolCalls(message)) {
          chatLog.markToolArgsComplete(call.id);
        }
        onAssistantFinalized?.(message);
      }
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'tool_execution_start': {
      const toolName = String(data.toolName ?? 'unknown');
      const toolCallId = String(data.toolCallId || '');
      if (!toolCallId) break;
      chatLog.startTool(toolCallId, toolName, data.args ?? {}, runId);
      chatLog.markToolExecutionStarted(toolCallId);
      markRunEvent(state, 'tool', runId, event, source);
      setActivityStatus('running');
      tui.requestRender();
      break;
    }
    case 'tool_execution_update': {
      const toolName = String(data.toolName ?? 'unknown');
      const toolCallId = String(data.toolCallId || '');
      if (!toolCallId) break;
      chatLog.startTool(toolCallId, toolName, data.args ?? {}, runId);
      chatLog.updateToolResult(toolCallId, data.partialResult, false, true);
      markRunEvent(state, 'tool', runId, event, source);
      setActivityStatus('running');
      tui.requestRender();
      break;
    }
    case 'tool_execution_end': {
      const toolCallId = String(data.toolCallId || '');
      if (!toolCallId) break;
      chatLog.updateToolResult(toolCallId, data.result, Boolean(data.isError), false);
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'error': {
      const errorContent = formatAgentRunErrorForDisplay(String(data.content ?? 'Unknown error'));
      const message = errorAssistantMessage(errorContent);
      chatLog.finalizeAssistant(message, runId);
      onAssistantFinalized?.(message, { errorMessage: errorContent });
      state.activeRunId = null;
      markRunIdleAfterCompletion(state, runId, event, source);
      setActivityStatus('idle');
      onRunEnded?.();
      tui.requestRender();
      break;
    }
    case 'agent_end': {
      state.activeRunId = null;
      markRunIdleAfterCompletion(state, runId, event, source);
      setActivityStatus('idle');
      onRunEnded?.();
      tui.requestRender();
      break;
    }
    case 'progress': {
      const stage = typeof data.stage === 'string' ? data.stage : '';
      const message = typeof data.message === 'string' ? data.message : stage;
      state.progressMessage = message || null;
      markRunEvent(state, 'progress', runId, event, source);
      setActivityStatus(message ? `progress: ${message}` : 'running');
      tui.requestRender();
      break;
    }
    default:
      break;
  }
}

export const DEFAULT_STREAMING_WATCHDOG_MS = 30_000;
