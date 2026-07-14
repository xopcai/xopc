export function shouldShowHomeAttention(inboxCount: number, attentionItemCount: number): boolean {
  return inboxCount > 0 || attentionItemCount > 0;
}
