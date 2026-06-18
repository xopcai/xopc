import type { TUI } from '@earendil-works/pi-tui';

import { formatAgentRunErrorForDisplay } from '../agent/client-error-format.js';
import type { ChatLog } from './components/chat-log.js';
import type { StreamAssembler } from './stream-assembler.js';
import { markRunEvent, markRunIdleAfterCompletion } from './tui-run-state.js';
import type { TuiEventSource, TuiState } from './tui-types.js';

const pendingToolCallIds = new Map<string, string[]>();
const seenStreamEventKeys = new Set<string>();

export function clearPendingToolCallIds(): void {
  pendingToolCallIds.clear();
  seenStreamEventKeys.clear();
}

export function clearSeenStreamEventsForRun(runId: string): void {
  const prefix = `${runId}:`;
  for (const key of Array.from(seenStreamEventKeys)) {
    if (key.startsWith(prefix)) {
      seenStreamEventKeys.delete(key);
    }
  }
}

function removePendingToolCallId(toolName: string, toolCallId: string): void {
  const stack = pendingToolCallIds.get(toolName);
  if (!stack) return;
  const idx = stack.indexOf(toolCallId);
  if (idx >= 0) stack.splice(idx, 1);
  if (stack.length === 0) pendingToolCallIds.delete(toolName);
}

const STREAM_TOUCH_EVENTS = new Set([
  'status',
  'token',
  'thinking',
  'tool_start',
  'tool_update',
  'tool_end',
  'progress',
]);

const DIRECT_RESPONSE_OWNED_EVENTS = new Set([
  'token',
  'thinking',
  'tool_start',
  'tool_update',
  'tool_end',
  'progress',
  'error',
  'result',
]);

function resolveEventRunId(
  data: Record<string, unknown>,
  state: TuiState,
): string | null {
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
  if (source !== 'agent-response' && source !== 'agent-resume' && source !== 'broadcast') {
    return false;
  }
  const key = streamEventKey(data, state);
  if (!key) return false;
  if (seenStreamEventKeys.has(key)) return true;
  seenStreamEventKeys.add(key);
  return false;
}

export function dispatchAgentSSE(
  event: string,
  data: Record<string, unknown>,
  state: TuiState,
  chatLog: ChatLog,
  assembler: StreamAssembler,
  tui: TUI,
  setActivityStatus: (status: string) => void,
  touchStreamingActivity?: () => void,
  /** Called when a run ends (result/error) so the TUI can flush follow-up queue, etc. */
  onRunEnded?: () => void,
  onAssistantFinalized?: (text: string, options?: { errorMessage?: string }) => void,
  source: TuiEventSource = 'unknown',
): void {
  if (shouldSkipSeenStreamEvent(data, state, source)) {
    return;
  }
  if (shouldSkipDuplicateBroadcastEvent(event, data, state, source)) {
    return;
  }

  if (STREAM_TOUCH_EVENTS.has(event)) {
    touchStreamingActivity?.();
  }

  const runId = state.activeRunId ?? 'default';

  switch (event) {
    case 'status': {
      const newRunId = typeof data.runId === 'string' ? data.runId : runId;
      state.activeRunId = newRunId;
      markRunEvent(state, 'waiting', newRunId, event, source);
      setActivityStatus('waiting');
      break;
    }
    case 'token': {
      const content =
        typeof data.content === 'string'
          ? data.content
          : typeof data.delta === 'string'
            ? data.delta
            : typeof data.text === 'string'
              ? data.text
              : '';
      if (!content) break;
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      const display = assembler.ingestToken(runId, content, state.showThinking);
      if (display !== null) {
        chatLog.updateAssistant(display, runId);
        tui.requestRender();
      }
      break;
    }
    case 'thinking': {
      const thinkContent = String(data.content ?? '');
      const isDelta = Boolean(data.delta);
      if (data.status === 'started') break;
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      const display = assembler.ingestThinking(runId, thinkContent, isDelta, state.showThinking);
      if (display !== null) {
        chatLog.updateAssistant(display, runId);
        tui.requestRender();
      }
      break;
    }
    case 'thinking_end':
    case 'message_end':
      break;
    case 'tool_start': {
      const toolName = String(data.toolName ?? 'unknown');
      const toolCallId = String(data.toolCallId || crypto.randomUUID());
      const stack = pendingToolCallIds.get(toolName) ?? [];
      stack.push(toolCallId);
      pendingToolCallIds.set(toolName, stack);
      markRunEvent(state, 'tool', runId, event, source);
      setActivityStatus('running');
      chatLog.startTool(toolCallId, toolName, data.args, runId);
      tui.requestRender();
      break;
    }
    case 'tool_end': {
      const toolName = String(data.toolName ?? '');
      let toolCallId = typeof data.toolCallId === 'string' && data.toolCallId ? data.toolCallId : '';
      if (!toolCallId && toolName) {
        const stack = pendingToolCallIds.get(toolName);
        if (stack && stack.length > 0) {
          toolCallId = stack.shift()!;
          if (stack.length === 0) pendingToolCallIds.delete(toolName);
        }
      }
      const isError = Boolean(data.isError);
      if (toolCallId) {
        chatLog.updateToolResult(toolCallId, data.result, isError);
        if (toolName) {
          removePendingToolCallId(toolName, toolCallId);
        }
      }
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'tool_update': {
      const toolName = String(data.toolName ?? '');
      let toolCallId = typeof data.toolCallId === 'string' && data.toolCallId ? data.toolCallId : '';
      if (!toolCallId && toolName) {
        const stack = pendingToolCallIds.get(toolName);
        if (stack && stack.length > 0) {
          toolCallId = stack[0]!;
        }
      }
      if (toolCallId) {
        if ('args' in data) {
          chatLog.updateToolArgs(toolCallId, data.args);
        } else if ('arguments' in data) {
          chatLog.updateToolArgs(toolCallId, data.arguments);
        }
        chatLog.updateToolDetails(toolCallId, data.details);
      }
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'error': {
      const errorContent = formatAgentRunErrorForDisplay(String(data.content ?? 'Unknown error'));
      const finalText = assembler.finalize(runId, state.showThinking);
      chatLog.finalizeAssistant(finalText || '', runId, {
        stopReason: 'error',
        errorMessage: errorContent,
      });
      onAssistantFinalized?.(finalText || errorContent, { errorMessage: errorContent });
      const completedRunId = runId;
      state.activeRunId = null;
      markRunIdleAfterCompletion(state, completedRunId, event, source);
      setActivityStatus('idle');
      onRunEnded?.();
      tui.requestRender();
      break;
    }
    case 'result': {
      const finalText = assembler.finalize(runId, state.showThinking);
      if (finalText) {
        chatLog.finalizeAssistant(finalText, runId);
        onAssistantFinalized?.(finalText);
      }
      const completedRunId = runId;
      state.activeRunId = null;
      markRunIdleAfterCompletion(state, completedRunId, event, source);
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
