export function chatReplySpaceBudget(viewportHeight: number, bottomHeight: number): number {
  return Math.min(64, Math.max(0, viewportHeight - bottomHeight) * 0.1);
}

export function consumeChatReplySpace(budget: number, remaining: number, replyHeight: number,
  availableBudget: number, following: boolean): number {
  if (!following) return remaining;
  return Math.max(0, Math.min(remaining, Math.min(budget, availableBudget) - Math.max(0, replyHeight)));
}
