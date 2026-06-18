import type { TUI } from '@earendil-works/pi-tui';

import { formatAgentRunErrorForDisplay } from '../agent/client-error-format.js';
import type { ChatLog } from './components/chat-log.js';
import type { StreamAssembler } from './stream-assembler.js';
import type { TuiState } from './tui-types.js';

const pendingToolCallIds = new Map<string, string[]>();

export function clearPendingToolCallIds(): void {
  pendingToolCallIds.clear();
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
): void {
  if (STREAM_TOUCH_EVENTS.has(event)) {
    touchStreamingActivity?.();
  }

  const runId = state.activeRunId ?? 'default';

  switch (event) {
    case 'status': {
      const newRunId = typeof data.runId === 'string' ? data.runId : runId;
      state.activeRunId = newRunId;
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
      state.activeRunId = null;
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
      state.activeRunId = null;
      setActivityStatus('idle');
      onRunEnded?.();
      tui.requestRender();
      break;
    }
    case 'progress': {
      const stage = typeof data.stage === 'string' ? data.stage : '';
      const message = typeof data.message === 'string' ? data.message : stage;
      state.progressMessage = message || null;
      setActivityStatus(message ? `progress: ${message}` : 'running');
      tui.requestRender();
      break;
    }
    default:
      break;
  }
}

export const DEFAULT_STREAMING_WATCHDOG_MS = 30_000;
