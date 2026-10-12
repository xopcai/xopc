import type { MessageContent } from '@/features/chat/messages/messages.types';

const identities = new WeakMap<MessageContent, string>();
let sequence = 0;

export function knownPartRenderKey(part: MessageContent): string | undefined {
  return identities.get(part);
}

/** Client identities live outside transcript content and survive copy-on-write updates. */
export function partRenderKey(part: MessageContent): string {
  const known = identities.get(part);
  if (known) return known;
  const key = `chat-part:${++sequence}`;
  identities.set(part, key);
  return key;
}

export function inheritPartIdentity(previous: MessageContent, next: MessageContent): void {
  identities.set(next, partRenderKey(previous));
}
