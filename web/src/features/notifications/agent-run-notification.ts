import type { AgentRunEndedEvent } from '@xopcai/gateway-contract';

import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

export type AgentRunNotification = {
  id: string;
  title: string;
  body: string;
  route: string;
  status: 'success' | 'error';
};

export function parseAgentRunEndedEvent(value: unknown): AgentRunEndedEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<AgentRunEndedEvent>;
  if (
    event.schemaVersion !== 1
    || typeof event.runId !== 'string'
    || !event.runId
    || typeof event.sessionKey !== 'string'
    || !event.sessionKey
    || (event.status !== 'success' && event.status !== 'error' && event.status !== 'cancelled')
    || typeof event.completedAtMs !== 'number'
    || !Number.isFinite(event.completedAtMs)
    || typeof event.route !== 'string'
    || !event.route.startsWith('/chat/')
    || event.source !== 'webchat'
  ) return null;
  return event as AgentRunEndedEvent;
}

export function buildAgentRunNotification(
  event: AgentRunEndedEvent,
  language: StoredLanguage,
): AgentRunNotification | null {
  if (event.status === 'cancelled') return null;
  const copy = messages(language).chat;
  const sessionTitle = event.sessionTitle?.trim();
  return {
    id: `agent-run:${event.runId}`,
    title: event.status === 'success'
      ? copy.backgroundRunCompletedTitle
      : copy.backgroundRunFailedTitle,
    body: sessionTitle || copy.backgroundRunCompletedDescription,
    route: event.route,
    status: event.status,
  };
}
