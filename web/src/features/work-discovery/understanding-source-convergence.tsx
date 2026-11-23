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
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { Loopi } from '@/components/brand/loopi';

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

function SignalNode({
  signal,
  delayMs,
  align,
}: {
  signal: UnderstandingSignal;
  delayMs: number;
  align: 'left' | 'right';
}) {
  const Icon = ICONS[signal.kind];
  return (
    <div
      className="xopc-convergence-node flex min-w-0 items-center gap-2 rounded-xl border border-edge bg-surface-base/90 px-2.5 py-2 shadow-surface"
      style={{ animationDelay: `${delayMs}ms` }}
      title={signal.detail ?? signal.label}
      aria-hidden
    >
      {align === 'right' ? (
        <span className="size-1.5 shrink-0 rounded-full bg-accent/80" />
      ) : null}
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft/75 text-accent-fg">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-xs font-medium text-fg">{signal.label}</span>
        {signal.meta ? (
          <span className="block truncate text-[10px] leading-3.5 text-fg-muted">{signal.meta}</span>
        ) : null}
      </span>
      {align === 'left' ? (
        <span className="size-1.5 shrink-0 rounded-full bg-accent/80" />
      ) : null}
    </div>
  );
}

export function UnderstandingSourceConvergence({
  signals,
  ariaLabel,
  centerLabel,
  emergingLabels = [],
}: {
  signals: UnderstandingSignal[];
  ariaLabel: string;
  centerLabel: string;
  emergingLabels?: string[];
}) {
  const visibleSignals = signals.slice(0, 4);
  const leftSignals = visibleSignals.filter((_, idx) => idx % 2 === 0);
  const rightSignals = visibleSignals.filter((_, idx) => idx % 2 === 1);
  const remainingCount = Math.max(0, signals.length - visibleSignals.length);

  return (
    <div
      className="xopc-source-convergence relative mx-auto mt-6 w-full max-w-[38rem] overflow-hidden rounded-2xl border border-edge bg-surface-panel px-5 py-6 shadow-surface sm:px-6"
      role="img"
      aria-label={ariaLabel}
    >
      {/* Animated signal convergence topology */}
      <div className="relative grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4" aria-hidden>
        {/* Left column signals */}
        <div className="flex flex-col gap-2.5">
          {leftSignals.map((signal, idx) => (
            <SignalNode key={signal.id} signal={signal} delayMs={idx * 420} align="left" />
          ))}
        </div>

        {/* Center Loopi hub with curved flow lines on desktop */}
        <div className="relative mx-auto flex flex-col items-center justify-center py-2">
          <svg
            className="pointer-events-none absolute -inset-x-10 top-1/2 hidden h-28 w-[calc(100%+5rem)] -translate-y-1/2 sm:block"
            viewBox="0 0 220 112"
            fill="none"
          >
            <path
              d="M 4 24 C 48 24, 62 56, 92 56"
              className="xopc-stream-path"
              stroke="var(--color-accent)"
              strokeOpacity="0.45"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M 4 88 C 48 88, 62 56, 92 56"
              className="xopc-stream-path"
              stroke="var(--color-accent)"
              strokeOpacity="0.35"
              strokeWidth="1.5"
              strokeLinecap="round"
              style={{ animationDelay: '350ms' }}
            />
            <path
              d="M 216 24 C 172 24, 158 56, 128 56"
              className="xopc-stream-path"
              stroke="var(--color-accent)"
              strokeOpacity="0.45"
              strokeWidth="1.5"
              strokeLinecap="round"
              style={{ animationDelay: '200ms' }}
            />
            <path
              d="M 216 88 C 172 88, 158 56, 128 56"
              className="xopc-stream-path"
              stroke="var(--color-accent)"
              strokeOpacity="0.35"
              strokeWidth="1.5"
              strokeLinecap="round"
              style={{ animationDelay: '550ms' }}
            />
          </svg>

          <div className="relative flex size-24 items-center justify-center">
            <span className="xopc-convergence-ring xopc-source-convergence-core-glow absolute inset-0 rounded-full" />
            <span className="xopc-convergence-ring absolute inset-2 rounded-full border border-accent/25" />
            <Loopi className="xopc-source-convergence-core relative size-20" mood="work" />
          </div>
          <span className="mt-2 text-[11px] font-semibold tracking-[0.14em] text-fg-muted">{centerLabel}</span>
        </div>

        {/* Right column signals */}
        <div className="flex flex-col gap-2.5">
          {rightSignals.map((signal, idx) => (
            <SignalNode key={signal.id} signal={signal} delayMs={210 + idx * 420} align="right" />
          ))}
          {remainingCount > 0 ? (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-edge-subtle px-2.5 py-1.5 text-[11px] font-medium text-fg-subtle">
              +{remainingCount}
            </div>
          ) : null}
        </div>
      </div>

      {/* Indeterminate stream bar */}
      <div className="mt-5 h-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
        <span className="xopc-source-convergence-progress block h-full w-2/5 rounded-full bg-accent" />
      </div>

      {/* Live emerging insight pills */}
      {emergingLabels.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5" aria-hidden>
          {emergingLabels.slice(0, 4).map((label, idx) => (
            <span
              key={`${label}-${idx}`}
              style={{ animationDelay: `${idx * 90}ms` }}
              className="xopc-trait-chip inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft/55 px-2.5 py-1 text-[11px] font-medium text-accent-fg"
            >
              <Sparkles className="size-3 shrink-0" />
              <span className="max-w-[14rem] truncate">{label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
