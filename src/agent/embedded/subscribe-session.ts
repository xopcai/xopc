import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '@earendil-works/pi-agent-core';

import { extractTextContent } from '../context/workspace.js';
import { mapEmbeddedToolEndResult } from './map-stream-events.js';
import type { EmbeddedStreamEvent } from './types.js';

export function subscribeEmbeddedSessionEvents(
  session: AgentSession,
  onEvent: (event: EmbeddedStreamEvent) => void,
): () => void {
  return session.subscribe((event: AgentSessionEvent) => {
    const base = event as AgentEvent;
    switch (base.type) {
      case 'message_update': {
        const u = base as Extract<AgentEvent, { type: 'message_update' }>;
        const delta = u.assistantMessageEvent;
        if (delta?.type === 'text_delta' && typeof delta.delta === 'string' && delta.delta) {
          onEvent({ type: 'token', content: delta.delta });
        }
        if (delta?.type === 'thinking_delta' && typeof delta.delta === 'string' && delta.delta) {
          onEvent({ type: 'thinking', content: delta.delta });
        }
        break;
      }
      case 'message_start': {
        const m = (base as Extract<AgentEvent, { type: 'message_start' }>).message;
        if (m?.role === 'assistant') {
          onEvent({ type: 'thinking', status: 'started' });
        }
        break;
      }
      case 'message_end':
        onEvent({ type: 'message_end' });
        break;
      case 'tool_execution_start': {
        const t = base as Extract<AgentEvent, { type: 'tool_execution_start' }>;
        onEvent({
          type: 'tool_start',
          toolName: t.toolName,
          toolCallId: t.toolCallId,
          args: (t.args as Record<string, unknown>) ?? {},
        });
        break;
      }
      case 'tool_execution_end': {
        const t = base as Extract<AgentEvent, { type: 'tool_execution_end' }>;
        onEvent({
          type: 'tool_end',
          toolName: t.toolName,
          toolCallId: t.toolCallId,
          isError: t.isError,
          result: mapEmbeddedToolEndResult(t.result),
        });
        break;
      }
      case 'agent_start':
        onEvent({ type: 'progress', stage: 'thinking', message: 'Thinking...' });
        break;
      case 'agent_end':
        onEvent({ type: 'progress', stage: 'idle', message: 'Done' });
        break;
      default:
        break;
    }
  });
}

export function lastAssistantPlainText(session: AgentSession): string | undefined {
  const messages = session.agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') {
      continue;
    }
    const content = msg.content;
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return extractTextContent(content as Array<{ type: string; text?: string }>);
    }
  }
  return undefined;
}
