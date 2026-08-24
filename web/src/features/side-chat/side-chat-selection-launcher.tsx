import { MessageSquarePlus, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { useLocaleStore } from '@/stores/locale-store';
import { useSideChatStore } from '@/stores/side-chat-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { disposeSideChatClient } from './side-chat-api';

const MAX_SELECTION_CHARS = 32_000;
const POPOVER_WIDTH = 264;
const VIEWPORT_GUTTER = 10;

type SelectionPopup = {
  text: string;
  left: number;
  top: number;
};

/** Contextual launcher shown only for text selected inside the primary Chat content. */
export function SideChatSelectionLauncher() {
  const { pathname } = useLocation();
  const sessionKey = pathname.startsWith('/chat/') ? pathname.slice('/chat/'.length) : '';
  const language = useLocaleStore((state) => state.language);
  const requestCreate = useSideChatStore((state) => state.requestCreate);
  const pendingCreate = useSideChatStore((state) => state.pendingCreate);
  const setWorkspaceOpen = useWorkspacePanelStore((state) => state.setOpen);
  const [popup, setPopup] = useState<SelectionPopup | null>(null);

  useEffect(() => {
    const dispose = () => disposeSideChatClient();
    window.addEventListener('pagehide', dispose);
    return () => window.removeEventListener('pagehide', dispose);
  }, []);

  const inspectSelection = useCallback(() => {
    if (!sessionKey || sessionKey === 'new' || pendingCreate) {
      setPopup(null);
      return;
    }
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (!selection || selection.rangeCount === 0 || !text || text.length > MAX_SELECTION_CHARS) {
      setPopup(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const anchorElement = nodeElement(selection.anchorNode);
    const focusElement = nodeElement(selection.focusNode);
    const main = document.getElementById('app-main-content');
    if (
      !anchorElement
      || !focusElement
      || !main?.contains(anchorElement)
      || !main.contains(focusElement)
      || !anchorElement.closest('[data-chat-message-index]')
      || !focusElement.closest('[data-chat-message-index]')
      || anchorElement.closest('#app-side-chat-panel')
      || focusElement.closest('#app-side-chat-panel')
    ) {
      setPopup(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setPopup(null);
      return;
    }
    const left = Math.min(
      window.innerWidth - POPOVER_WIDTH - VIEWPORT_GUTTER,
      Math.max(VIEWPORT_GUTTER, rect.left + rect.width / 2 - POPOVER_WIDTH / 2),
    );
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + 38 < window.innerHeight ? preferredTop : Math.max(VIEWPORT_GUTTER, rect.top - 42);
    setPopup({ text, left, top });
  }, [pathname, pendingCreate, sessionKey]);

  useEffect(() => {
    if (!pathname.startsWith('/chat/')) {
      setPopup(null);
      return;
    }
    const inspectAfterBrowserSelection = () => window.requestAnimationFrame(inspectSelection);
    const dismiss = () => setPopup(null);
    document.addEventListener('pointerup', inspectAfterBrowserSelection);
    document.addEventListener('keyup', inspectAfterBrowserSelection);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerup', inspectAfterBrowserSelection);
      document.removeEventListener('keyup', inspectAfterBrowserSelection);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [inspectSelection, pathname]);

  if (!popup || !sessionKey || sessionKey === 'new') return null;

  return (
    <div
      role="group"
      aria-label={language === 'zh' ? '选中文本操作' : 'Selected text actions'}
      className="fixed z-[70] flex h-9 overflow-hidden rounded-lg border border-edge bg-surface-panel text-xs font-medium text-fg shadow-popover"
      style={{ left: popup.left, top: popup.top, width: POPOVER_WIDTH }}
      onPointerDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="inline-flex flex-1 items-center justify-center gap-1.5 px-3 transition-colors hover:bg-surface-hover focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        onClick={() => {
          addSelectionToMainChat(popup.text);
          window.getSelection()?.removeAllRanges();
          setPopup(null);
        }}
      >
        <Plus className="size-3.5 shrink-0" />
        <span>{language === 'zh' ? '添加到对话' : 'Add to chat'}</span>
      </button>
      <button
        type="button"
        className="inline-flex flex-1 items-center justify-center gap-1.5 border-l border-edge px-3 transition-colors hover:bg-surface-hover focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        onClick={() => {
          const parentSessionKey = decodeURIComponent(sessionKey);
          setWorkspaceOpen(false);
          requestCreate(parentSessionKey, [{
            id: crypto.randomUUID(),
            type: 'text',
            text: popup.text,
            label: language === 'zh' ? '所选文本' : 'Selected text',
          }]);
          window.getSelection()?.removeAllRanges();
          setPopup(null);
        }}
      >
        <MessageSquarePlus className="size-3.5 shrink-0" />
        <span>{language === 'zh' ? '在侧边对话' : 'Ask in side chat'}</span>
      </button>
    </div>
  );
}

export function addSelectionToMainChat(text: string): void {
  dispatchFillChatComposer(text);
}

function nodeElement(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}
