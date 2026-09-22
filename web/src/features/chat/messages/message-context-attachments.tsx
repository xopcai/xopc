import { useState } from 'react';
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Database,
  FileText,
  Folder,
  MessagesSquare,
  NotebookPen,
} from 'lucide-react';

import type { MessageContextRef } from '@/features/chat/messages/messages.types';
import { cn } from '@/lib/cn';

const COLLAPSED_CONTEXT_REF_COUNT = 3;

export function MessageContextAttachments({
  refs,
  groupLabel,
  noteLabel,
  fileLabel,
  folderLabel,
  sessionLabel,
  browserTabLabel,
  mcpResourceLabel,
  truncatedLabel,
  showMoreLabel,
  showLessLabel,
  onOpen,
}: {
  refs: MessageContextRef[];
  groupLabel: string;
  noteLabel: string;
  fileLabel: string;
  folderLabel: string;
  sessionLabel: string;
  browserTabLabel: string;
  mcpResourceLabel: string;
  truncatedLabel: string;
  showMoreLabel: string;
  showLessLabel: string;
  onOpen: (ref: MessageContextRef) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (refs.length === 0) return null;
  const canCollapse = refs.length > COLLAPSED_CONTEXT_REF_COUNT;
  const visibleRefs = expanded ? refs : refs.slice(0, COLLAPSED_CONTEXT_REF_COUNT);
  const hiddenCount = refs.length - COLLAPSED_CONTEXT_REF_COUNT;

  return (
    <div className="flex min-w-0 flex-col gap-1.5" role="group" aria-label={groupLabel}>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {visibleRefs.map((ref) => {
          const interactive = ref.kind === 'note';
          const Wrapper = interactive ? 'button' : 'div';
          const kindLabel = ref.kind === 'file'
            ? ref.fileKind === 'directory' ? folderLabel : fileLabel
            : ref.kind === 'session'
              ? sessionLabel
              : ref.kind === 'browser_tab'
                ? browserTabLabel
                : ref.kind === 'mcp_resource'
                  ? mcpResourceLabel
                  : noteLabel;
          return (
            <Wrapper
              key={`${ref.kind}:${ref.sourceId}`}
              {...(interactive ? { type: 'button' as const, onClick: () => onOpen(ref) } : {})}
              className={cn(
                'group inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-lg border border-edge-subtle bg-surface-panel/80 px-2 py-1.5 text-left',
                interactive && 'transition-colors hover:border-accent/40 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              )}
              {...(interactive ? { 'aria-label': `${groupLabel}: ${ref.title}` } : {})}
              title={ref.truncated ? truncatedLabel : ref.title}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-fg">
                {ref.kind === 'file' && ref.fileKind === 'directory' ? (
                  <Folder className="size-3.5" aria-hidden />
                ) : ref.kind === 'file' ? (
                  <FileText className="size-3.5" aria-hidden />
                ) : ref.kind === 'session' ? (
                  <MessagesSquare className="size-3.5" aria-hidden />
                ) : ref.kind === 'browser_tab' ? (
                  <AppWindow className="size-3.5" aria-hidden />
                ) : ref.kind === 'mcp_resource' ? (
                  <Database className="size-3.5" aria-hidden />
                ) : (
                  <NotebookPen className="size-3.5" aria-hidden />
                )}
              </span>
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0 text-[11px] text-fg-muted">{kindLabel}</span>
                <span className="max-w-56 truncate text-xs font-medium text-fg sm:max-w-72">{ref.title}</span>
              </span>
              {interactive ? (
                <ChevronRight className="size-3.5 shrink-0 text-fg-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted" aria-hidden />
              ) : null}
            </Wrapper>
          );
        })}
      </div>
      {canCollapse ? (
        <button
          type="button"
          className="inline-flex min-h-8 w-fit items-center gap-1 rounded-md px-2 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
          {expanded ? showLessLabel : showMoreLabel.replace('{{count}}', String(hiddenCount))}
        </button>
      ) : null}
    </div>
  );
}
