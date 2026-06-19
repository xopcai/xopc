import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '@earendil-works/pi-agent-core';

import { extractTextContent } from '../context/workspace.js';
import type { EmbeddedStreamEvent } from './types.js';

export function subscribeEmbeddedSessionEvents(
  session: AgentSession,
  onEvent: (event: EmbeddedStreamEvent) => void,
): () => void {
  return session.subscribe((event: AgentSessionEvent) => {
    const base = event as AgentEvent;
    switch (base.type) {
      case 'agent_start':
        onEvent({ type: 'agent_start' });
        break;
      case 'agent_end':
        onEvent({ type: 'agent_end' });
        break;
      case 'message_start': {
        const m = (base as Extract<AgentEvent, { type: 'message_start' }>).message;
        onEvent({ type: 'message_start', message: m });
        break;
      }
      case 'message_update': {
        const u = base as Extract<AgentEvent, { type: 'message_update' }>;
        onEvent({
          type: 'message_update',
          message: u.message,
          assistantMessageEvent: u.assistantMessageEvent,
        });
        break;
      }
      case 'message_end': {
        const m = (base as Extract<AgentEvent, { type: 'message_end' }>).message;
        onEvent({ type: 'message_end', message: m });
        break;
      }
      case 'tool_execution_start': {
        const t = base as Extract<AgentEvent, { type: 'tool_execution_start' }>;
        onEvent({
          type: 'tool_execution_start',
          toolName: t.toolName,
          toolCallId: t.toolCallId,
          args: t.args,
        });
        break;
      }
      case 'tool_execution_end': {
        const t = base as Extract<AgentEvent, { type: 'tool_execution_end' }>;
        onEvent({
          type: 'tool_execution_end',
          toolName: t.toolName,
          toolCallId: t.toolCallId,
          isError: t.isError,
          result: t.result,
        });
        break;
      }
      case 'tool_execution_update': {
        const t = base as Extract<AgentEvent, { type: 'tool_execution_update' }>;
        onEvent({
          type: 'tool_execution_update',
          toolName: t.toolName,
          toolCallId: t.toolCallId,
          args: t.args,
          partialResult: t.partialResult,
        });
        break;
      }
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
