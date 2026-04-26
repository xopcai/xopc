import { bindFeishuConversation, unbindBySessionKey } from './state/thread-bindings.js';

function normLower(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function stripProviderPrefix(raw: string): string {
  return raw.replace(/^(feishu|lark):/i, '').trim();
}

export async function handleFeishuSubagentSpawning(event: any, ctx: { requesterSessionKey?: string } = {}) {
  if (!event?.threadRequested) return undefined;
  const requesterChannel = normLower(event?.requester?.channel);
  if (requesterChannel !== 'feishu') return undefined;

  const accountId = String(event?.requester?.accountId ?? '').trim() || 'default';
  const to = String(event?.requester?.to ?? '').trim();
  const threadId =
    event?.requester?.threadId != null && event.requester.threadId !== ''
      ? String(event.requester.threadId).trim()
      : '';

  const withoutProvider = to ? stripProviderPrefix(to) : '';
  const isChatTarget = /^(chat|group|channel):/i.test(withoutProvider);

  // Minimal parity: only bind DM targets or topic thread targets.
  if (!to) return { status: 'error' as const, error: 'Missing requester delivery target (to)' };
  if (isChatTarget && !threadId) {
    return { status: 'error' as const, error: 'Thread binding requires a topic threadId for chat targets' };
  }

  const conversationId = isChatTarget ? `${withoutProvider}|topic:${threadId}` : withoutProvider;
  bindFeishuConversation({
    accountId,
    conversationId,
    parentConversationId: isChatTarget ? withoutProvider : undefined,
    targetSessionKey: String(event.childSessionKey),
    metadata: {
      requesterSessionKey: ctx.requesterSessionKey,
      deliveryTo: to,
      deliveryThreadId: threadId || undefined,
      agentId: event?.agentId,
      label: event?.label,
    },
  });

  return { status: 'ok' as const, threadBindingReady: true };
}

export function handleFeishuSubagentEnded(event: any) {
  const accountId = String(event?.accountId ?? '').trim() || 'default';
  const sk = String(event?.targetSessionKey ?? '').trim();
  if (!sk) return;
  unbindBySessionKey(accountId, sk);
}

import { bindFeishuConversation, unbindBySessionKey } from './state/thread-bindings.js';

function normLower(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function stripProviderPrefix(raw: string): string {
  return raw.replace(/^(feishu|lark):/i, '').trim();
}

export async function handleFeishuSubagentSpawning(event: any, ctx: { requesterSessionKey?: string } = {}) {
  if (!event?.threadRequested) return undefined;
  const requesterChannel = normLower(event?.requester?.channel);
  if (requesterChannel !== 'feishu') return undefined;

  const accountId = String(event?.requester?.accountId ?? '').trim() || 'default';
  const to = String(event?.requester?.to ?? '').trim();
  const threadId = event?.requester?.threadId != null && event.requester.threadId !== '' ? String(event.requester.threadId).trim() : '';

  const withoutProvider = to ? stripProviderPrefix(to) : '';
  const isChatTarget = /^(chat|group|channel):/i.test(withoutProvider);

  // Minimal parity: only bind DM targets or topic thread targets.
  if (!to) return { status: 'error' as const, error: 'Missing requester delivery target (to)' };
  if (isChatTarget && !threadId) {
    return { status: 'error' as const, error: 'Thread binding requires a topic threadId for chat targets' };
  }

  const conversationId = isChatTarget ? `${withoutProvider}|topic:${threadId}` : withoutProvider;
  bindFeishuConversation({
    accountId,
    conversationId,
    parentConversationId: isChatTarget ? withoutProvider : undefined,
    targetSessionKey: String(event.childSessionKey),
    metadata: {
      requesterSessionKey: ctx.requesterSessionKey,
      deliveryTo: to,
      deliveryThreadId: threadId || undefined,
      agentId: event?.agentId,
      label: event?.label,
    },
  });

  return { status: 'ok' as const, threadBindingReady: true };
}

export function handleFeishuSubagentEnded(event: any) {
  const accountId = String(event?.accountId ?? '').trim() || 'default';
  const sk = String(event?.targetSessionKey ?? '').trim();
  if (!sk) return;
  unbindBySessionKey(accountId, sk);
}

