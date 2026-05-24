import type { AgentMessage } from '@earendil-works/pi-agent-core';

function isUserRole(role: string): boolean {
  return role === 'user';
}

/**
 * LLM transcript range for one user turn: the user row plus every following
 * assistant / tool / toolResult row until the next user (or EOF).
 */
export function computeUserRoundDeleteRange(
  messages: readonly AgentMessage[],
  userRoundIndex: number,
): { startIndex: number; count: number } | null {
  if (userRoundIndex < 0 || messages.length === 0) {
    return null;
  }

  let userCount = 0;
  let startIndex = -1;
  for (let i = 0; i < messages.length; i++) {
    const role = String(messages[i]?.role ?? '');
    if (!isUserRole(role)) {
      continue;
    }
    if (userCount === userRoundIndex) {
      startIndex = i;
      break;
    }
    userCount += 1;
  }

  if (startIndex < 0) {
    return null;
  }

  let end = startIndex + 1;
  while (end < messages.length) {
    const role = String(messages[end]?.role ?? '');
    if (isUserRole(role)) {
      break;
    }
    end += 1;
  }

  return { startIndex, count: end - startIndex };
}
