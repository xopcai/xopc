import {
  Content as TooltipContent,
  Portal as TooltipPortal,
  Provider as TooltipProvider,
  Root as TooltipRoot,
  Trigger as TooltipTrigger,
} from '@radix-ui/react-tooltip';
import { Sparkles, Zap } from 'lucide-react';
import {
  Fragment,
  memo,
  useLayoutEffect,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import type { PaletteItem } from '@/features/chat/palette/command-palette.types';
import { cn } from '@/lib/cn';

/** Above shell `overflow-hidden`; portal + fixed avoids clipping (only shadow was visible). */
const PORTAL_Z = 100;
/** Cap width so the list stays readable; full composer width is often unnecessarily wide. */
const MAX_PALETTE_WIDTH_PX = 280;

function highlightFuzzyName(name: string, q: string): ReactNode {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return name;
  }
  const nLower = name.toLowerCase();
  const idx = nLower.indexOf(needle);
  if (idx >= 0) {
    return (
      <>
        {name.slice(0, idx)}
        <span className="text-accent-fg">{name.slice(idx, idx + needle.length)}</span>
        {name.slice(idx + needle.length)}
      </>
    );
  }
  // Subsequence: greedily mark chars that match query in order.
  const out: ReactNode[] = [];
  let qi = 0;
  let pos = 0;
  for (const ch of name) {
    const nq = needle[qi];
    const charKey = `${String(pos)}-${ch}`;
    if (nq !== undefined && ch.toLowerCase() === nq) {
      out.push(
        <span key={charKey} className="text-accent-fg">
          {ch}
        </span>,
      );
      qi += 1;
    } else {
      out.push(<Fragment key={charKey}>{ch}</Fragment>);
    }
    pos += 1;
  }
  return <>{out}</>;
}

function highlightPlainSlice(text: string, q: string): ReactNode {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return text;
  }
  const t = text.toLowerCase();
  const idx = t.indexOf(needle);
  if (idx < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-accent-fg">{text.slice(idx, idx + needle.length)}</span>
      {text.slice(idx + needle.length)}
    </>
  );
}

export const CommandPalette = memo(function CommandPalette({
  open,
  anchorRef,
  items,
  selectedIndex,
  noResults,
  grouped,
  skillRowCount,
  query,
  skillsLabel,
  commandsLabel,
  groupedHasSkills,
  groupedHasCommands,
  groupedSkillsShowMoreLabel,
  groupedCommandsShowMoreLabel,
  onExpandSkills,
  onExpandCommands,
  onSelectItem,
  panelRef,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  /** The floating listbox `div` (for outside-click to dismiss the slash token in the parent). */
  panelRef?: RefObject<HTMLDivElement | null>;
  items: PaletteItem[];
  selectedIndex: number;
  noResults: string;
  /** When true, show Skills / Commands section labels (query empty). */
  grouped: boolean;
  /** Leading rows in `items` that are skills; rest are commands. */
  skillRowCount: number;
  query: string;
  skillsLabel: string;
  commandsLabel: string;
  groupedHasSkills: boolean;
  groupedHasCommands: boolean;
  groupedSkillsShowMoreLabel: string | null;
  groupedCommandsShowMoreLabel: string | null;
  onExpandSkills: () => void;
  onExpandCommands: () => void;
  /** Same behavior as choosing the row with Enter (skill pill / slash command). */
  onSelectItem: (item: PaletteItem) => void;
}) {
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ left: r.left, top: r.top, width: r.width });
    };

    update();

    const el = anchorRef.current;
    const ro =
      el && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            update();
          })
        : null;
    if (el && ro) ro.observe(el);

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      if (el && ro) ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef]);

  if (!open || typeof document === 'undefined' || box === null) {
    return null;
  }

  const totalRows = items.length;
  const panelWidth = Math.min(box.width, MAX_PALETTE_WIDTH_PX);
  const filterQuery = query.trim();
  const showHighlight = !grouped && filterQuery.length > 0;

  const showMoreClass =
    'w-full px-2.5 py-1 text-left text-[11px] leading-tight text-fg-muted transition hover:bg-surface-hover/80 hover:text-fg';

  const sectionHeaderClass =
    'mb-1.5 px-2.5 pt-2.5 text-[0.6rem] font-medium uppercase leading-none tracking-wide text-fg-muted';

  const renderOptionRow = (item: PaletteItem, i: number) => {
    const isSkill = item.kind === 'skill';
    return (
      <PaletteRow
        item={item}
        icon={
          isSkill ? (
            <Sparkles className="size-3 shrink-0 text-accent-fg" aria-hidden />
          ) : (
            <Zap className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          )
        }
        selected={selectedIndex === i}
        id={`palette-${i}`}
        nameLine={
          showHighlight ? (
            <>
              <span className="text-fg">/</span>
              {highlightFuzzyName(item.name, filterQuery)}
            </>
          ) : (
            <span className="text-fg">/{item.name}</span>
          )
        }
        descriptionLine={
          item.description
            ? showHighlight
              ? highlightPlainSlice(item.description, filterQuery)
              : item.description
            : null
        }
        dimCategoryBadge={showHighlight}
        onSelect={() => onSelectItem(item)}
      />
    );
  };

  const listBody =
    totalRows === 0 ? (
      <div className="p-2.5 text-xs leading-normal text-fg-muted">{noResults}</div>
    ) : grouped ? (
      <>
        {groupedHasSkills ? (
          <>
            <div className={sectionHeaderClass} aria-hidden>
              {skillsLabel}
            </div>
            {items.slice(0, skillRowCount).map((item, j) => (
              <Fragment key={item.id}>{renderOptionRow(item, j)}</Fragment>
            ))}
            {groupedSkillsShowMoreLabel ? (
              <button
                type="button"
                className={showMoreClass}
                onClick={(e) => {
                  e.preventDefault();
                  onExpandSkills();
                }}
              >
                {groupedSkillsShowMoreLabel}
              </button>
            ) : null}
          </>
        ) : null}
        {groupedHasCommands ? (
          <div
            className={cn(
              groupedHasSkills && 'mt-1 border-t border-edge-subtle',
            )}
          >
            <div className={sectionHeaderClass} aria-hidden>
              {commandsLabel}
            </div>
            {items.slice(skillRowCount).map((item, j) => (
              <Fragment key={item.id}>{renderOptionRow(item, skillRowCount + j)}</Fragment>
            ))}
            {groupedCommandsShowMoreLabel ? (
              <button
                type="button"
                className={showMoreClass}
                onClick={(e) => {
                  e.preventDefault();
                  onExpandCommands();
                }}
              >
                {groupedCommandsShowMoreLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </>
    ) : (
      items.map((item, i) => <Fragment key={item.id}>{renderOptionRow(item, i)}</Fragment>)
    );

  const shell = (
    <TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent={false}>
      <div
        ref={panelRef}
        className="pointer-events-auto max-h-[min(24rem,55vh)] min-h-8 overflow-y-auto rounded-md border border-edge bg-surface-panel text-xs leading-4 shadow-lg dark:bg-surface-panel/95"
        style={{
          position: 'fixed',
          left: box.left,
          top: box.top,
          width: panelWidth,
          transform: 'translateY(calc(-100% - 8px))',
          zIndex: PORTAL_Z,
        }}
        role="listbox"
        aria-label="Commands"
        aria-activedescendant={selectedIndex >= 0 && selectedIndex < totalRows ? `palette-${selectedIndex}` : undefined}
      >
        {listBody}
      </div>
    </TooltipProvider>
  );

  return createPortal(shell, document.body);
});

const PaletteRow = memo(function PaletteRow({
  item,
  icon,
  selected,
  id,
  nameLine,
  descriptionLine,
  dimCategoryBadge,
  onSelect,
}: {
  item: PaletteItem;
  icon: ReactNode;
  selected: boolean;
  id: string;
  nameLine: ReactNode;
  descriptionLine: ReactNode | null;
  /** Hide category chip when the row uses match highlighting (grouped by section instead). */
  dimCategoryBadge: boolean;
  onSelect: () => void;
}) {
  const descPlain = (item.description ?? '').trim();
  const showDescription = descPlain.length > 0 && descriptionLine != null;
  const showDescTooltip = descPlain.length > 0;
  const fullDescription = item.description ?? '';

  const textColumn = (
    <span className="flex min-w-0 flex-1 items-baseline gap-1">
      <span className="min-w-0 max-w-[min(12rem,46%)] shrink-0 truncate font-semibold text-fg">
        {nameLine}
      </span>
      {item.category && item.kind !== 'skill' && !dimCategoryBadge ? (
        <span className="shrink-0 rounded bg-surface-hover px-1 py-px text-[0.6rem] font-normal leading-none text-fg-muted">
          {item.category}
        </span>
      ) : null}
      {showDescription ? (
        <span className="min-w-0 flex-1 truncate text-[11px] font-normal leading-tight text-fg-muted">
          {descriptionLine}
        </span>
      ) : null}
    </span>
  );

  const optionClassName = cn(
    'flex w-full min-w-0 cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left text-xs leading-4',
    selected ? 'bg-surface-hover text-fg' : 'text-fg-subtle hover:bg-surface-hover/80',
  );

  const onRowPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    onSelect();
  };

  const rowInner = (
    <>
      <span className="shrink-0 [&_svg]:align-middle">{icon}</span>
      {textColumn}
    </>
  );

  if (showDescTooltip) {
    return (
      <TooltipRoot delayDuration={0}>
        <TooltipTrigger asChild>
          <div
            id={id}
            role="option"
            aria-selected={selected}
            tabIndex={-1}
            className={optionClassName}
            onPointerDown={onRowPointerDown}
          >
            {rowInner}
          </div>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="!z-[10000] max-h-[min(12rem,40vh)] max-w-sm overflow-y-auto rounded-md border border-edge bg-surface-panel px-2 py-1.5 text-left text-[11px] leading-snug text-fg shadow-lg select-text [max-width:min(20rem,90vw)]"
            data-slash-palette-tooltip=""
          >
            <span className="whitespace-pre-wrap break-words">{fullDescription}</span>
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    );
  }

  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className={optionClassName}
      onPointerDown={onRowPointerDown}
    >
      {rowInner}
    </div>
  );
});
