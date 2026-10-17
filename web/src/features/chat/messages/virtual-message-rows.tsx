import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { chatScrollBehavior } from '@/features/chat/scroll/chat-scroll-geometry';
import { pauseChatTailFollowing, registerChatVirtualScroll } from '@/features/chat/scroll/chat-virtual-scroll';

export interface MessageRowDescriptor { key: string; index: number; aliases: number[] }

/** Keep the mode fixed for the mounted session; selection temporarily widens its window. */
export function VirtualMessageRows({ rows, scrollRef, renderRow, footerRef }: {
  rows: MessageRowDescriptor[];
  scrollRef: RefObject<HTMLDivElement | null>;
  footerRef: RefObject<HTMLDivElement | null>;
  renderRow: (index: number) => ReactNode;
}) {
  const handle = useRef<VirtuosoHandle>(null);
  const [parent, setParent] = useState<HTMLElement | undefined>();
  const [retainRows, setRetainRows] = useState(false);
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
        offset: footerRef.current?.offsetHeight ?? 0, behavior: smooth && chatScrollBehavior() === 'smooth' ? 'smooth' : 'auto' }),
    });
  }, [parent, rows, position.first, footerRef]);
  useLayoutEffect(() => {
    if (!parent) return;
    const update = () => {
      const selection = window.getSelection();
      const selected = Boolean(selection && !selection.isCollapsed && parent.contains(selection.anchorNode));
      setRetainRows(selected);
    };
    document.addEventListener('selectionchange', update);
    return () => {
      document.removeEventListener('selectionchange', update);
    };
  }, [parent]);

  if (!parent) return null;
  return <Virtuoso ref={handle} customScrollParent={parent} data={rows}
    skipAnimationFrameInResizeObserver
    firstItemIndex={position.first} initialTopMostItemIndex={{ index: rows.length - 1, align: 'end' }}
    defaultItemHeight={160} increaseViewportBy={retainRows ? 100_000_000 : { top: 800, bottom: 800 }}
    computeItemKey={(_index, row) => row.key}
    itemContent={(_index, row) => <div className={row === rows[0] ? undefined : 'pt-8'}>{renderRow(row.index)}</div>}
  />;
}
