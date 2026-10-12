export type ChatScrollAnchor = { rowId: string; offset: number };

export function readChatScrollAnchor(root: HTMLElement): ChatScrollAnchor | null {
  const bounds = root.getBoundingClientRect();
  for (const row of root.querySelectorAll<HTMLElement>('[data-chat-message-row]')) {
    const rect = row.getBoundingClientRect();
    const rowId = row.dataset.messageRenderKey ?? row.dataset.clientSubmissionId;
    if (rowId && rect.bottom > bounds.top && rect.top < bounds.bottom) {
      return { rowId, offset: rect.top - bounds.top };
    }
  }
  return null;
}

export function restoreChatScrollAnchor(root: HTMLElement, anchor: ChatScrollAnchor | null): boolean {
  if (!anchor) return false;
  const row = Array.from(root.querySelectorAll<HTMLElement>('[data-chat-message-row]')).find(element => (
    element.dataset.messageRenderKey === anchor.rowId || element.dataset.clientSubmissionId === anchor.rowId
  ));
  if (!row) return false;
  const delta = row.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset;
  if (Math.abs(delta) > .5) root.scrollTop += delta;
  return true;
}
