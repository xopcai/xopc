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
  useEffect,
  useLayoutEffect,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import type {
  PaletteItem,
  PaletteItemKind,
  PaletteSection,
} from '@/features/chat/palette/command-palette.types';
import {
  commandRowDisabled,
  commandRowWillQueue,
} from '@/features/chat/palette/use-command-palette';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/** Above shell `overflow-hidden`; portal + fixed avoids clipping (only shadow was visible). */
const PORTAL_Z = 100;
/** Cap width so the list stays readable; full composer width is often unnecessarily wide. */
const MAX_PALETTE_WIDTH_PX = 560;

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

const PaletteOptionRow = memo(function PaletteOptionRow({
  item,
  index,
  selectedIndex,
  showHighlight,
  filterQuery,
  currentAgentId,
  currentBadgeLabel,
  runBusy,
  pendingFollowUpsCount,
  maxPendingFollowUps,
  queueBadgeLabel,
  queueFullBadgeLabel,
  queueFullTooltip,
  skillUnavailableLabel,
  skillAgentDeniedLabel,
  skillSourceLabels,
  onSelectItem,
}: {
  item: PaletteItem;
  index: number;
  selectedIndex: number;
  showHighlight: boolean;
  filterQuery: string;
  currentAgentId?: string;
  currentBadgeLabel: string;
  runBusy: boolean;
  pendingFollowUpsCount: number;
  maxPendingFollowUps: number;
  queueBadgeLabel: string;
  queueFullBadgeLabel: string;
  queueFullTooltip: string;
  skillUnavailableLabel: string;
  skillAgentDeniedLabel: string;
  skillSourceLabels: Record<string, string>;
  onSelectItem: (item: PaletteItem) => void;
}) {
  const isSkill = item.kind === 'skill';
  const isAgent = item.kind === 'agent';
  const icon = isAgent ? (
    <AgentAvatarDisplay
      agentId={item.agentId}
      avatar={item.avatar}
      size={18}
      className="size-[18px] shrink-0"
    />
  ) : isSkill ? (
    <Sparkles className="size-4 shrink-0 text-accent-fg" aria-hidden />
  ) : (
    <Zap className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
  );
  // Agents render as names; skills/commands keep the leading slash.
  const nameLine = isAgent ? (
    showHighlight ? (
      <>{highlightFuzzyName(item.name, filterQuery)}</>
    ) : (
      <span className="text-fg">{item.name}</span>
    )
  ) : showHighlight ? (
    <>
      <span className="text-fg">/</span>
      {highlightFuzzyName(item.name, filterQuery)}
    </>
  ) : (
    <span className="text-fg">/{item.name}</span>
  );
  const isCurrentAgent =
    isAgent && currentAgentId != null && currentAgentId.length > 0 && item.agentId === currentAgentId;
  const isUnavailableSkill = isSkill && item.availability.status !== 'available';
  const streamContext = { runBusy, pendingFollowUpsCount, maxPendingFollowUps };
  const willQueue = commandRowWillQueue(item, streamContext);
  const isDisabled = commandRowDisabled(item, streamContext);

  let trailingBadge: ReactNode = null;
  if (isCurrentAgent) {
    trailingBadge = (
      <span
        className="ml-1 shrink-0 rounded bg-accent-soft px-1 py-px text-[0.6rem] font-medium leading-none text-accent-fg"
        aria-label={currentBadgeLabel}
      >
        {currentBadgeLabel}
      </span>
    );
  } else if (isUnavailableSkill) {
    trailingBadge = (
      <span
        className="ml-1 shrink-0 rounded bg-surface-hover px-1 py-px text-[0.6rem] font-medium leading-none text-fg-muted"
        aria-label={item.availability.reason ?? 'unavailable'}
      >
        {item.availability.status === 'agent-denied' ? skillAgentDeniedLabel : skillUnavailableLabel}
      </span>
    );
  } else if (isSkill && item.source) {
    trailingBadge = (
      <span className="ml-2 shrink-0 text-[11px] font-normal text-fg-muted">
        {skillSourceLabels[item.source] ?? item.source}
      </span>
    );
  } else if (isDisabled) {
    trailingBadge = (
      <span
        className="ml-1 shrink-0 rounded bg-red-100 px-1 py-px text-[0.6rem] font-medium leading-none text-red-700 dark:bg-red-900/40 dark:text-red-300"
        aria-label={queueFullBadgeLabel}
      >
        {queueFullBadgeLabel}
      </span>
    );
  } else if (willQueue) {
    trailingBadge = (
      <span
        className="ml-1 shrink-0 rounded bg-surface-hover px-1 py-px text-[0.6rem] font-medium leading-none text-fg-muted"
        aria-label={queueBadgeLabel}
      >
        {queueBadgeLabel}
      </span>
    );
  }

  return (
    <PaletteRow
      item={item}
      icon={icon}
      selected={selectedIndex === index}
      id={`palette-${index}`}
      nameLine={nameLine}
      descriptionLine={
        item.description
          ? showHighlight
            ? highlightPlainSlice(item.description, filterQuery)
            : item.description
          : null
      }
      dimCategoryBadge={showHighlight}
      trailingBadge={trailingBadge}
      disabled={isDisabled}
      disabledTooltip={isDisabled ? queueFullTooltip : undefined}
      onSelect={() => onSelectItem(item)}
    />
  );
});

export const CommandPalette = memo(function CommandPalette({
  open,
  anchorRef,
  sections,
  flatItems,
  loading,
  failedKinds,
  selectedIndex,
  noResults,
  sectionLoadFailedLabel,
  query,
  skillsLabel,
  commandsLabel,
  agentsLabel,
  currentAgentId,
  currentBadgeLabel,
  runBusy,
  pendingFollowUpsCount,
  maxPendingFollowUps,
  queueBadgeLabel,
  queueFullBadgeLabel,
  queueFullTooltip,
  skillUnavailableLabel,
  skillAgentDeniedLabel,
  skillSourceLabels,
  onSelectItem,
  panelRef,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  /** The floating listbox `div` (for outside-click to dismiss the slash token in the parent). */
  panelRef?: RefObject<HTMLDivElement | null>;
  sections: PaletteSection[];
  flatItems: PaletteItem[];
  loading: boolean;
  failedKinds: PaletteItemKind[];
  selectedIndex: number;
  noResults: string;
  sectionLoadFailedLabel: string;
  query: string;
  skillsLabel: string;
  commandsLabel: string;
  agentsLabel: string;
  /** Active session agent id; the matching agent row gets a "current" trailing badge. */
  currentAgentId?: string;
  /** Localized text for the "current" badge (e.g. "current" / "当前"). */
  currentBadgeLabel: string;
  /** Stream-state input to per-row disabled / "queue" badge calculation. */
  runBusy: boolean;
  pendingFollowUpsCount: number;
  maxPendingFollowUps: number;
  /** Localized text for the "queue" badge on args=false commands during streaming. */
  queueBadgeLabel: string;
  /** Localized text for the "queue full" badge when the follow-up queue is at capacity. */
  queueFullBadgeLabel: string;
  /** Tooltip shown when hovering a queue-full disabled row. */
  queueFullTooltip: string;
  skillUnavailableLabel: string;
  skillAgentDeniedLabel: string;
  skillSourceLabels: Record<string, string>;
  /** Same behavior as choosing the row with Enter (skill pill / slash command / agent switch). */
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

  useEffect(() => {
    if (!open || flatItems.length === 0) return;
    document.getElementById(`palette-${selectedIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [flatItems.length, open, selectedIndex]);

  if (!open || typeof document === 'undefined' || box === null) {
    return null;
  }

  const totalRows = flatItems.length;
  const selectedItem = flatItems[selectedIndex];
  const panelWidth = Math.min(box.width, MAX_PALETTE_WIDTH_PX);
  const filterQuery = query.trim();
  const showHighlight = filterQuery.length > 0;

  const sectionHeaderClass =
    'sticky top-0 z-10 flex items-center justify-between bg-surface-overlay px-2.5 py-2 text-[0.65rem] font-medium uppercase leading-none tracking-wide text-fg-muted';

  const sectionLabels: Record<PaletteItemKind, string> = {
    skill: skillsLabel,
    command: commandsLabel,
    agent: agentsLabel,
  };

  const optionRowProps = {
    selectedIndex,
    showHighlight,
    filterQuery,
    currentAgentId,
    currentBadgeLabel,
    runBusy,
    pendingFollowUpsCount,
    maxPendingFollowUps,
    queueBadgeLabel,
    queueFullBadgeLabel,
    queueFullTooltip,
    skillUnavailableLabel,
    skillAgentDeniedLabel,
    skillSourceLabels,
    onSelectItem,
  };

  const sectionByKind = new Map(sections.map((section) => [section.kind, section]));
  const renderedKinds: PaletteItemKind[] = (['skill', 'command', 'agent'] as const).filter(
    (kind) => sectionByKind.has(kind) || failedKinds.includes(kind),
  );
  let sectionStart = 0;
  const listBody = loading && totalRows === 0 ? (
    <div className="space-y-2 p-2.5" aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-2 py-1">
          <Skeleton className="size-4 shrink-0" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  ) : totalRows === 0 && failedKinds.length === 0 ? (
    <div className="p-2.5 text-xs leading-normal text-fg-muted">{noResults}</div>
  ) : (
    renderedKinds.map((kind, sectionIndex) => {
      const section = sectionByKind.get(kind);
      const sectionItems = section?.items ?? [];
      const startIndex = sectionStart;
      sectionStart += sectionItems.length;
      const headingId = `palette-section-${kind}`;
      return (
        <div
          key={kind}
          role="group"
          aria-labelledby={headingId}
          className={cn(sectionIndex > 0 && 'border-t border-edge-subtle')}
        >
          <div id={headingId} className={sectionHeaderClass}>
            <span>{sectionLabels[kind]}</span>
            <span className="tabular-nums" aria-hidden>{sectionItems.length}</span>
          </div>
          {failedKinds.includes(kind) ? (
            <div className="px-2.5 pb-2 text-[11px] leading-relaxed text-fg-muted">
              {sectionLoadFailedLabel}
            </div>
          ) : (
            sectionItems.map((item, index) => (
              <PaletteOptionRow
                key={item.id}
                item={item}
                index={startIndex + index}
                {...optionRowProps}
              />
            ))
          )}
        </div>
      );
    })
  );

  const shell = (
    <TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent={false}>
      <div
        ref={panelRef}
        className="pointer-events-auto max-h-[min(32rem,60vh)] min-h-8 overflow-y-auto rounded-md border border-edge bg-surface-overlay text-xs leading-4 shadow-lg"
        style={{
          position: 'fixed',
          left: box.left,
          top: box.top,
          width: panelWidth,
          transform: 'translateY(calc(-100% - 8px))',
          zIndex: PORTAL_Z,
        }}
        role="listbox"
        aria-label={`${skillsLabel}, ${commandsLabel}, ${agentsLabel}`}
        aria-busy={loading}
      >
        <span className="sr-only" aria-live="polite">
          {selectedItem ? `${sectionLabels[selectedItem.kind]}: ${selectedItem.name}` : ''}
        </span>
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
  trailingBadge,
  disabled,
  disabledTooltip,
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
  /** Optional flush-right badge (e.g. "current" / "queue" marker). */
  trailingBadge?: ReactNode;
  /** Render greyed out, ignore pointerdown, and surface `disabledTooltip` instead of the description. */
  disabled?: boolean;
  /** Tooltip text shown when `disabled`; takes precedence over the description tooltip. */
  disabledTooltip?: string;
  onSelect: () => void;
}) {
  const descPlain = item.description.trim();
  const showDescription = descPlain.length > 0 && descriptionLine != null;
  const showDescTooltip = descPlain.length > 0;
  const fullDescription = item.description;

  // Hide the category chip on agent rows when a trailing badge is shown (otherwise we get
  // both "agent" and "current" stacked, which looks noisy in the small palette width).
  const showCategoryBadge =
    item.category && item.kind !== 'skill' && !dimCategoryBadge && !(item.kind === 'agent' && trailingBadge);

  const textColumn = (
    <span className="flex min-w-0 flex-1 items-baseline gap-1">
      <span className="min-w-0 max-w-[min(12rem,46%)] shrink-0 truncate font-semibold text-fg">
        {nameLine}
      </span>
      {showCategoryBadge ? (
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
    'flex min-h-11 w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-sm leading-5 sm:min-h-9',
    disabled
      ? 'cursor-not-allowed opacity-50 text-fg-muted'
      : selected
        ? 'cursor-pointer bg-surface-hover text-fg'
        : 'cursor-pointer text-fg-subtle hover:bg-surface-hover/80',
  );

  const onRowPointerDown = (e: PointerEvent) => {
    if (disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    onSelect();
  };

  const rowInner = (
    <>
      <span className="shrink-0 [&_svg]:align-middle">{icon}</span>
      {textColumn}
      {trailingBadge}
    </>
  );

  // Tooltip priority: disabled tooltip > description tooltip.
  const tooltipText = disabled && disabledTooltip ? disabledTooltip : showDescTooltip ? fullDescription : null;

  const rowEl = (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      className={optionClassName}
      onPointerDown={onRowPointerDown}
    >
      {rowInner}
    </div>
  );

  if (tooltipText !== null) {
    return (
      <TooltipRoot delayDuration={0}>
        <TooltipTrigger asChild>{rowEl}</TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="!z-[10000] max-h-[min(12rem,40vh)] max-w-sm overflow-y-auto rounded-md border border-edge bg-surface-overlay px-2 py-1.5 text-left text-[11px] leading-snug text-fg shadow-lg select-text [max-width:min(20rem,90vw)]"
            data-slash-palette-tooltip=""
          >
            <span className="whitespace-pre-wrap break-words">{tooltipText}</span>
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    );
  }

  return rowEl;
});
