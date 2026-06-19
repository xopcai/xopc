import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TUI } from '@earendil-works/pi-tui';

import { formatAgentRunErrorForDisplay } from '../agent/client-error-format.js';
import type { ChatLog } from './components/chat-log.js';
import { createAssistantMessageFromText } from './components/assistant-message.js';
import { markRunEvent, markRunIdleAfterCompletion } from './tui-run-state.js';
import type { TuiEventSource, TuiState } from './tui-types.js';

const seenStreamEventKeys = new Set<string>();
const assistantByRun = new Map<string, AgentMessage>();

export function clearSeenStreamEvents(): void {
  seenStreamEventKeys.clear();
  assistantByRun.clear();
}

export function clearSeenStreamEventsForRun(runId: string): void {
  const prefix = `${runId}:`;
  for (const key of Array.from(seenStreamEventKeys)) {
    if (key.startsWith(prefix)) seenStreamEventKeys.delete(key);
  }
  assistantByRun.delete(runId);
}

const STREAM_TOUCH_EVENTS = new Set([
  'run_start',
  'assistant_message_start',
  'assistant_delta',
  'thinking_delta',
  'thinking_end',
  'tool_start',
  'tool_update',
  'tool_end',
  'assistant_message_end',
  'progress',
]);

const DIRECT_RESPONSE_OWNED_EVENTS = new Set([...STREAM_TOUCH_EVENTS, 'run_end', 'error']);

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

function payload(data: Record<string, unknown>): Record<string, unknown> {
  return data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : {};
}

function assistantForRun(runId: string): AgentMessage {
  let message = assistantByRun.get(runId);
  if (!message) {
    message = createAssistantMessageFromText('') as AgentMessage;
    assistantByRun.set(runId, message);
  }
  return message;
}

function appendAssistantText(message: AgentMessage, delta: string): void {
  const rec = message as { content?: unknown };
  if (!Array.isArray(rec.content)) rec.content = [];
  const content = rec.content as Array<Record<string, unknown>>;
  const last = content[content.length - 1];
  if (last?.type === 'text' && typeof last.text === 'string') {
    last.text += delta;
    return;
  }
  content.push({ type: 'text', text: delta });
}

function appendThinkingText(message: AgentMessage, delta: string): void {
  const rec = message as { content?: unknown };
  if (!Array.isArray(rec.content)) rec.content = [];
  const content = rec.content as Array<Record<string, unknown>>;
  const last = content[content.length - 1];
  if (last?.type === 'thinking' && typeof last.text === 'string') {
    last.text += delta;
    return;
  }
  content.push({ type: 'thinking', text: delta, streaming: true });
}

function finalizeThinking(message: AgentMessage): void {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const rec = block as { type?: unknown; streaming?: boolean };
    if (rec.type === 'thinking') rec.streaming = false;
  }
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
  const p = payload(data);

  switch (event) {
    case 'run_start': {
      state.activeRunId = runId;
      markRunEvent(state, 'waiting', runId, event, source);
      setActivityStatus('waiting');
      break;
    }
    case 'user_message': {
      const message = p.message as { content?: unknown } | undefined;
      chatLog.addUser(Array.isArray(message?.content) || typeof message?.content === 'string' ? message.content : []);
      tui.requestRender();
      break;
    }
    case 'user_transcript': {
      chatLog.addUser(String(p.text ?? ''));
      tui.requestRender();
      break;
    }
    case 'assistant_message_start': {
      const message = assistantForRun(runId);
      chatLog.startAssistant(message, runId);
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'assistant_delta': {
      const delta = typeof p.delta === 'string' ? p.delta : '';
      if (!delta) break;
      const message = assistantForRun(runId);
      appendAssistantText(message, delta);
      chatLog.updateAssistant(message, runId);
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'thinking_delta': {
      const delta = typeof p.delta === 'string' ? p.delta : '';
      if (!delta) break;
      const message = assistantForRun(runId);
      appendThinkingText(message, delta);
      chatLog.updateAssistant(message, runId);
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'thinking_end': {
      const message = assistantForRun(runId);
      finalizeThinking(message);
      chatLog.updateAssistant(message, runId);
      tui.requestRender();
      break;
    }
    case 'tool_start': {
      const toolName = String(p.toolName ?? 'unknown');
      const toolCallId = String(p.toolCallId || '');
      if (!toolCallId) break;
      chatLog.startTool(toolCallId, toolName, p.args ?? {}, runId);
      chatLog.markToolExecutionStarted(toolCallId);
      markRunEvent(state, 'tool', runId, event, source);
      setActivityStatus('running');
      tui.requestRender();
      break;
    }
    case 'tool_update': {
      const toolName = String(p.toolName ?? 'unknown');
      const toolCallId = String(p.toolCallId || '');
      if (!toolCallId) break;
      chatLog.startTool(toolCallId, toolName, {}, runId);
      if ('details' in p) chatLog.updateToolDetails(toolCallId, p.details);
      if (typeof p.textDelta === 'string') chatLog.updateToolResult(toolCallId, { text: p.textDelta }, false, true);
      markRunEvent(state, 'tool', runId, event, source);
      setActivityStatus('running');
      tui.requestRender();
      break;
    }
    case 'tool_end': {
      const toolCallId = String(p.toolCallId || '');
      if (!toolCallId) break;
      chatLog.updateToolResult(toolCallId, p.result, p.status === 'error' || p.status === 'cancelled', false);
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'assistant_message_end': {
      const message = assistantForRun(runId);
      finalizeThinking(message);
      chatLog.finalizeAssistant(message, runId);
      assistantByRun.delete(runId);
      onAssistantFinalized?.(message);
      markRunEvent(state, 'streaming', runId, event, source);
      setActivityStatus('streaming');
      tui.requestRender();
      break;
    }
    case 'error': {
      const errorContent = formatAgentRunErrorForDisplay(String(p.message ?? 'Unknown error'));
      const message = errorAssistantMessage(errorContent);
      chatLog.finalizeAssistant(message, runId);
      onAssistantFinalized?.(message, { errorMessage: errorContent });
      assistantByRun.delete(runId);
      state.activeRunId = null;
      markRunIdleAfterCompletion(state, runId, event, source);
      setActivityStatus('idle');
      onRunEnded?.();
      tui.requestRender();
      break;
    }
    case 'run_end': {
      assistantByRun.delete(runId);
      state.activeRunId = null;
      markRunIdleAfterCompletion(state, runId, event, source);
      setActivityStatus('idle');
      onRunEnded?.();
      tui.requestRender();
      break;
    }
    case 'progress': {
      const stage = typeof p.stage === 'string' ? p.stage : '';
      const message = typeof p.message === 'string' ? p.message : stage;
      state.progressMessage = message || null;
      markRunEvent(state, 'progress', runId, event, source);
      setActivityStatus(message ? `progress: ${message}` : 'running');
      tui.requestRender();
      break;
    }
  }
}

export const DEFAULT_STREAMING_WATCHDOG_MS = 30_000;
