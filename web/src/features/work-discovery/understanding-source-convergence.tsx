import {
  BookOpenText,
  CalendarDays,
  Database,
  FileClock,
  FileText,
  FolderOpen,
  GitBranch,
  ListTodo,
  Mail,
  MessagesSquare,
  PlugZap,
  type LucideIcon,
} from 'lucide-react';

import { BrandLogo } from '@/components/shell/brand-logo';

export type UnderstandingSignalKind =
  | 'folder'
  | 'file'
  | 'recent'
  | 'git'
  | 'calendar'
  | 'task'
  | 'note'
  | 'mail'
  | 'message'
  | 'service'
  | 'data';

export type UnderstandingSignal = {
  id: string;
  label: string;
  kind: UnderstandingSignalKind;
  meta?: string;
  detail?: string;
};

const ICONS: Record<UnderstandingSignalKind, LucideIcon> = {
  folder: FolderOpen,
  file: FileText,
  recent: FileClock,
  git: GitBranch,
  calendar: CalendarDays,
  task: ListTodo,
  note: BookOpenText,
  mail: Mail,
  message: MessagesSquare,
  service: PlugZap,
  data: Database,
};

export function UnderstandingSourceConvergence({
  signals,
  ariaLabel,
  centerLabel,
}: {
  signals: UnderstandingSignal[];
  ariaLabel: string;
  centerLabel: string;
}) {
  const visibleSignals = signals.slice(0, 3);
  const remainingCount = Math.max(0, signals.length - visibleSignals.length);

  return (
    <div className="xopc-source-convergence mx-auto mt-9 w-full max-w-[34rem] overflow-hidden rounded-[1.75rem] border border-edge bg-surface-panel/75 px-5 py-6 shadow-surface backdrop-blur-xl sm:px-6" role="img" aria-label={ariaLabel}>
      <div className="flex flex-col items-center text-center" aria-hidden>
        <div className="xopc-source-convergence-core relative flex size-16 items-center justify-center">
          <span className="xopc-source-convergence-core-glow absolute -inset-5 rounded-full" />
          <BrandLogo className="relative size-12" />
        </div>
        <span className="mt-3 text-[11px] font-semibold tracking-[0.16em] text-fg-muted">{centerLabel}</span>
      </div>

      <div className="mt-5 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
        <span className="xopc-source-convergence-progress block h-full w-2/5 rounded-full bg-accent" />
      </div>

      <div className="mt-5 divide-y divide-edge-subtle border-y border-edge-subtle">
        {visibleSignals.map((signal) => {
          const Icon = ICONS[signal.kind];
          return (
            <div key={signal.id} className="flex min-h-12 items-center gap-3 py-2.5 text-left" aria-hidden>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1" title={signal.detail}>
                <span className="block truncate text-sm font-medium text-fg">{signal.label}</span>
                {signal.meta ? <span className="mt-0.5 block truncate text-xs text-fg-muted">{signal.meta}</span> : null}
              </span>
              <span className="size-1.5 shrink-0 rounded-full bg-accent" />
            </div>
          );
        })}
      </div>
      {remainingCount > 0 ? (
        <p className="mt-3 text-center text-xs text-fg-muted" aria-hidden>+{remainingCount}</p>
      ) : null}
    </div>
  );
}
