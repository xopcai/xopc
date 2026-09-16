import { validateConversationId } from '@xopcai/gateway-contract';

import { requireConversation, resolveRoutedConversation } from '../storage/sqlite/conversation-repository.js';
import type { ConversationRouteInput } from './conversation-route.js';

export * from './agent-session-key.js';
export { getConversationRouting } from '../storage/sqlite/conversation-repository.js';

const VALID_SEGMENT_RE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

export function sanitizeSegment(
  value: string | undefined | null,
  options?: { allowLeadingDash?: boolean },
): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }

  let cleaned = trimmed.toLowerCase().replace(INVALID_CHARS_RE, '-');

  if (!options?.allowLeadingDash) {
    cleaned = cleaned.replace(LEADING_DASH_RE, '').replace(TRAILING_DASH_RE, '');
  } else {
    cleaned = cleaned.replace(TRAILING_DASH_RE, '');
  }

  if (!cleaned) {
    return '';
  }

  return cleaned.slice(0, 64);
}

export function isValidSegment(value: string | undefined | null): boolean {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed.length > 64) {
    return false;
  }
  return VALID_SEGMENT_RE.test(trimmed);
}


export type BuildConversationIdParams = ConversationRouteInput;

export function resolveConversationId(params: ConversationRouteInput): string {
  return resolveRoutedConversation(params);
}

export function getParentConversationId(conversationId: string | undefined | null): string | null {
  return conversationId ? requireConversation(conversationId).parentConversationId ?? null : null;
}

export function normalizeConversationId(conversationId: string): string {
  return validateConversationId(conversationId);
}
