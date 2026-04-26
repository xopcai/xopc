export type FeishuMessageBinding = {
  messageId: string;
  sessionKey: string;
  accountId: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  threadId?: string;
};

const MAX = 50_000;
const TTL_MS = 24 * 60 * 60_000;

const byMessageId = new Map<string, { binding: FeishuMessageBinding; at: number }>();

function prune(now: number) {
  for (const [k, v] of byMessageId) {
    if (now - v.at > TTL_MS) {
      byMessageId.delete(k);
    }
  }
  if (byMessageId.size <= MAX) return;
  const extra = byMessageId.size - MAX;
  let i = 0;
  for (const k of byMessageId.keys()) {
    byMessageId.delete(k);
    i++;
    if (i >= extra) break;
  }
}

export function recordFeishuMessageBinding(binding: FeishuMessageBinding): void {
  const messageId = binding.messageId.trim();
  if (!messageId) return;
  const now = Date.now();
  prune(now);
  byMessageId.set(messageId, { binding, at: now });
}

export function getFeishuBindingByMessageId(messageId: string): FeishuMessageBinding | null {
  const key = messageId.trim();
  if (!key) return null;
  const now = Date.now();
  const hit = byMessageId.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    byMessageId.delete(key);
    return null;
  }
  return hit.binding;
}

