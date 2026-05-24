import type { Message } from '@/features/chat/messages.types';

export function isUiUserMessage(role: Message['role']): boolean {
  return role === 'user' || role === 'user-with-attachments';
}

/** 0-based index among user messages only (matches server `userRoundIndex`). */
export function userRoundIndexFromUiMessageIndex(
  messages: readonly Message[],
  uiMessageIndex: number,
): number | null {
  if (uiMessageIndex < 0 || uiMessageIndex >= messages.length) {
    return null;
  }
  const target = messages[uiMessageIndex];
  if (!target || !isUiUserMessage(target.role)) {
    return null;
  }
  let count = 0;
  for (let i = 0; i <= uiMessageIndex; i++) {
    const msg = messages[i];
    if (msg && isUiUserMessage(msg.role)) {
      count += 1;
    }
  }
  return count - 1;
}

/** UI rows to remove for one user turn (user + merged assistant bubble). */
export function uiDeleteCountForUserRound(
  messages: readonly Message[],
  uiMessageIndex: number,
): number {
  let deleteCount = 1;
  for (let j = uiMessageIndex + 1; j < messages.length; j++) {
    const msg = messages[j];
    if (msg && isUiUserMessage(msg.role)) {
      break;
    }
    deleteCount += 1;
  }
  return deleteCount;
}
