import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { chatScrollBehavior } from '@/features/chat/scroll/chat-scroll-geometry';
import { pauseChatTailFollowing, registerChatVirtualScroll } from '@/features/chat/scroll/chat-virtual-scroll';

export interface MessageRowDescriptor { key: string; index: number; aliases: number[] }

function MessageFooter({ context }: { context?: { footer: ReactNode } }) {
  return context?.footer;
}
const virtualComponents = { Footer: MessageFooter };
const HISTORY_OVERSCAN = { top: 800, bottom: 800 };

/** Keep selected history mounted as the user scrolls through the virtual window. */
export function VirtualMessageRows({ rows, scrollRef, renderRow, footer }: {
  rows: MessageRowDescriptor[];
  scrollRef: RefObject<HTMLDivElement | null>;
  footer: ReactNode;
  renderRow: (index: number) => ReactNode;
}) {
  const handle = useRef<VirtuosoHandle>(null);
  const [parent, setParent] = useState<HTMLElement | undefined>();
  const [selectionViewport, setSelectionViewport] = useState(HISTORY_OVERSCAN);
  const [position, setPosition] = useState({ rows, first: 1_000_000_000 });
  if (position.rows !== rows) {
    const previousFirst = position.rows[0]?.key;
    const prepended = previousFirst ? rows.findIndex(row => row.key === previousFirst) : 0;
    setPosition({ rows, first: position.first - Math.max(0, prepended) });
  }

  useEffect(() => { setParent(scrollRef.current ?? undefined); }, [scrollRef]);
  useLayoutEffect(() => {
    if (!parent) return;
    return registerChatVirtualScroll(parent, {
      reveal: index => {
        const offset = rows.findIndex(row => row.index === index || row.aliases.includes(index));
        if (offset < 0) return false;
        pauseChatTailFollowing(parent);
        handle.current?.scrollToIndex({ index: offset, align: 'start', offset: -16, behavior: 'auto' });
        return true;
      },
      end: smooth => handle.current?.scrollToIndex({ index: 'LAST', align: 'end',
        // Virtuoso includes its Footer, but the outer list and scroll container own extra padding.
        offset: (parseFloat(getComputedStyle(parent).paddingBottom) || 0)
          + (parseFloat(getComputedStyle(parent.querySelector('[data-chat-virtualized]') ?? parent).paddingBottom) || 0),
        behavior: smooth && chatScrollBehavior() === 'smooth' ? 'smooth' : 'auto' }),
    });
  }, [parent, rows, position.first]);
  useLayoutEffect(() => {
    if (!parent) return;
    let selectionWindow: { start: number; end: number } | null = null;
    const update = () => {
      const selection = window.getSelection();
      const selected = Boolean(selection && !selection.isCollapsed && parent.contains(selection.anchorNode));
      if (!selected) selectionWindow = null;
      else {
        selectionWindow ??= { start: parent.scrollTop, end: parent.scrollTop };
        selectionWindow.start = Math.min(selectionWindow.start, parent.scrollTop);
        selectionWindow.end = Math.max(selectionWindow.end, parent.scrollTop);
      }
      // Retain the traversed window instead of mounting all unmeasured history.
      // Measuring the entire transcript on selection changes shifts disclosure controls.
      const top = HISTORY_OVERSCAN.top + (selectionWindow ? parent.scrollTop - selectionWindow.start : 0);
      const bottom = HISTORY_OVERSCAN.bottom + (selectionWindow ? selectionWindow.end - parent.scrollTop : 0);
      setSelectionViewport(previous => previous.top === top && previous.bottom === bottom
        ? previous : { top, bottom });
    };
    const onScroll = () => { if (selectionWindow !== null) update(); };
    document.addEventListener('selectionchange', update);
    parent.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('selectionchange', update);
      parent.removeEventListener('scroll', onScroll);
    };
  }, [parent]);

  if (!parent) return null;
  return <Virtuoso ref={handle} customScrollParent={parent} data={rows}
    skipAnimationFrameInResizeObserver components={virtualComponents} context={{ footer }}
    firstItemIndex={position.first} initialTopMostItemIndex={{ index: rows.length - 1, align: 'end' }}
    defaultItemHeight={160} increaseViewportBy={selectionViewport}
    computeItemKey={(_index, row) => row.key}
    itemContent={(_index, row) => <div className={row === rows[0] ? undefined : 'pt-8'}>{renderRow(row.index)}</div>}
  />;
}
