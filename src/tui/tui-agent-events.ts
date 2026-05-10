import type { TUI } from '@earendil-works/pi-tui';

import type { ChatLog } from './components/chat-log.js';
import type { StreamAssembler } from './stream-assembler.js';
import type { TuiState } from './tui-types.js';

const pendingToolCallIds = new Map<string, string[]>();

export function clearPendingToolCallIds(): void {
  pendingToolCallIds.clear();
}

const STREAM_TOUCH_EVENTS = new Set([
  'status',
  'token',
  'thinking',
  'tool_start',
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
      const resultText = String(data.result ?? '');
      const isError = Boolean(data.isError);
      if (toolCallId) {
        chatLog.updateToolResult(toolCallId, resultText, isError);
      }
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'error': {
      const errorContent = String(data.content ?? 'Unknown error');
      const finalText = assembler.finalize(runId, state.showThinking);
      if (finalText) {
        chatLog.finalizeAssistant(finalText, runId);
      }
      chatLog.addSystem(`❌ ${errorContent}`);
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
      }
      state.activeRunId = null;
      setActivityStatus('idle');
      onRunEnded?.();
      tui.requestRender();
      break;
    }
    case 'progress': {
      setActivityStatus('running');
      break;
    }
    default:
      break;
  }
}

export const DEFAULT_STREAMING_WATCHDOG_MS = 30_000;
