export interface ChatVirtualScroll {
  reveal: (messageIndex: number) => boolean;
  end: (smooth: boolean) => void;
}

const viewports = new WeakMap<HTMLElement, ChatVirtualScroll>();

export function registerChatVirtualScroll(root: HTMLElement, viewport: ChatVirtualScroll): () => void {
  viewports.set(root, viewport);
  return () => { if (viewports.get(root) === viewport) viewports.delete(root); };
}

export function chatVirtualScroll(root: HTMLElement): ChatVirtualScroll | undefined {
  return viewports.get(root);
}

export function pauseChatTailFollowing(root: HTMLElement): void {
  root.dispatchEvent(new Event('chat-scroll-reading'));
}
