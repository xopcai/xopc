import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { AlignLeft, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

type Heading = { element: HTMLElement; label: string; level: number };

const HEADING_OFFSET = 24;
const WIDE_DOCUMENT_WIDTH = 864;

export function useNoteOutline(root: HTMLElement | null) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [current, setCurrent] = useState<HTMLElement | null>(null);
  const [wide, setWide] = useState(false);
  const jump = useRef<{ element: HTMLElement; scrollTop: number } | null>(null);

  useLayoutEffect(() => {
    if (!root) {
      setHeadings([]);
      setCurrent(null);
      setWide(false);
      return;
    }

    let frame = 0;
    let refreshHeadings = true;
    let entries: Heading[] = [];
    let firstMeasure = true;
    let scrollArea: HTMLElement | null = null;
    let content: HTMLElement | null = null;

    const measure = () => {
      frame = 0;
      if (refreshHeadings) {
        refreshHeadings = false;
        scrollArea = root.querySelector<HTMLElement>('[data-note-outline-scroll]');
        const nextContent = scrollArea?.querySelector<HTMLElement>('[data-note-outline-content], .ProseMirror') ?? null;
        if (nextContent !== content) {
          if (content) resize?.unobserve(content);
          if (nextContent) resize?.observe(nextContent);
          content = nextContent;
        }
        const next = Array.from(content?.querySelectorAll<HTMLElement>('h1, h2, h3') ?? [], element => ({
          element,
          label: element.textContent?.trim() ?? '',
          level: Number(element.tagName.slice(1)),
        })).filter(heading => heading.label);
        if (firstMeasure || next.length !== entries.length || next.some(({ element, label }, i) =>
          element !== entries[i]?.element || label !== entries[i]?.label)) {
          entries = next;
          setHeadings(next);
          firstMeasure = false;
        }
      }

      setWide(root.clientWidth >= WIDE_DOCUMENT_WIDTH);
      if (!scrollArea?.clientHeight || entries.length < 2) return;
      const target = jump.current;
      if (target && Math.abs(target.scrollTop - scrollArea.scrollTop) < 1 &&
          entries.some(({ element }) => element === target.element)) {
        setCurrent(target.element);
        return;
      }

      jump.current = null;
      const threshold = scrollArea.getBoundingClientRect().top + HEADING_OFFSET + 1;
      let active = entries[0].element;
      for (const { element } of entries) {
        if (element.getBoundingClientRect().top > threshold) break;
        active = element;
      }
      const atEnd = scrollArea.scrollTop > 0 &&
        scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop <= 1;
      setCurrent(atEnd ? entries[entries.length - 1].element : active);
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const mutations = new MutationObserver(() => {
      refreshHeadings = true;
      schedule();
    });
    resize?.observe(root);
    mutations.observe(root, { childList: true, characterData: true, subtree: true });
    root.addEventListener('scroll', schedule, { capture: true, passive: true });
    measure();
    return () => {
      mutations.disconnect();
      resize?.disconnect();
      root.removeEventListener('scroll', schedule, true);
      window.cancelAnimationFrame(frame);
      jump.current = null;
    };
  }, [root]);

  const goTo = (element: HTMLElement) => {
    const scrollArea = element.closest<HTMLElement>('[data-note-outline-scroll]');
    if (!scrollArea || !root?.contains(scrollArea)) return;
    const offset = element.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top;
    scrollArea.scrollTop += offset - HEADING_OFFSET;
    jump.current = { element, scrollTop: scrollArea.scrollTop };
    setCurrent(element);
  };

  return { headings, current, wide, goTo };
}

type OutlineProps = {
  label: string;
  headings: Heading[];
  current: HTMLElement | null;
  onSelect: (element: HTMLElement) => void;
};

function HeadingList({ label, headings, current, onSelect }: OutlineProps) {
  const baseLevel = Math.min(...headings.map(({ level }) => level));
  return (
    <nav aria-label={label} className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
      <ul>
        {headings.map(({ element, label, level }, index) => (
          <li key={index}>
            <button
              type="button"
              aria-current={element === current ? 'location' : undefined}
              onClick={() => onSelect(element)}
              style={{ paddingInlineStart: `${0.625 + (level - baseLevel) * 0.75}rem` }}
              className={cn(
                'min-h-9 w-full rounded-md py-1.5 pr-2 text-start text-sm break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                element === current ? 'bg-accent-soft font-medium text-accent-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function NoteOutlinePopover(props: OutlineProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="absolute top-5 right-4 z-10 inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={props.label}
          title={props.label}
        >
          <AlignLeft className="size-4" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={props.label}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-[70] flex max-h-[min(25rem,var(--radix-popover-content-available-height))] w-64 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay text-fg shadow-popover"
        >
          <div className="shrink-0 px-4 pt-3 pb-1 text-xs font-medium text-fg-muted">{props.label}</div>
          <HeadingList {...props} onSelect={element => { props.onSelect(element); setOpen(false); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function NoteOutlineDialog({ closeLabel, open, onOpenChange, returnFocus, ...props }: OutlineProps & {
  closeLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[150] bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={event => { event.preventDefault(); returnFocus(); }}
          className="fixed top-1/2 left-1/2 z-[151] flex h-[min(24rem,calc(100dvh-2rem))] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay text-fg shadow-popover"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-4 py-2">
            <Dialog.Title className="text-sm font-semibold">{props.label}</Dialog.Title>
            <Dialog.Close className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={closeLabel}>
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </header>
          <HeadingList {...props} onSelect={element => { onOpenChange(false); props.onSelect(element); }} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
