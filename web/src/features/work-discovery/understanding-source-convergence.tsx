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
import type { CSSProperties } from 'react';

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

const POSITIONS = [
  { x: '-13.5rem', y: '-6.8rem', delay: '-0.2s' },
  { x: '-2.5rem', y: '-9.1rem', delay: '-1.15s' },
  { x: '11.8rem', y: '-6.2rem', delay: '-2.05s' },
  { x: '13.8rem', y: '4.3rem', delay: '-3s' },
  { x: '3.5rem', y: '8.8rem', delay: '-3.95s' },
  { x: '-12.2rem', y: '6.5rem', delay: '-4.9s' },
] as const;

export function UnderstandingSourceConvergence({
  signals,
  ariaLabel,
  centerLabel,
}: {
  signals: UnderstandingSignal[];
  ariaLabel: string;
  centerLabel: string;
}) {
  const visibleSignals = signals.slice(0, POSITIONS.length);

  return (
    <div className="xopc-source-convergence relative mx-auto h-[19rem] w-full max-w-[34rem]" role="img" aria-label={ariaLabel}>
      <div className="xopc-source-convergence-field absolute inset-0" aria-hidden />
      <span className="xopc-source-convergence-orbit xopc-source-convergence-orbit--outer absolute left-1/2 top-1/2 rounded-full border border-accent/10" aria-hidden />
      <span className="xopc-source-convergence-orbit xopc-source-convergence-orbit--inner absolute left-1/2 top-1/2 rounded-full border border-accent/15" aria-hidden />

      {visibleSignals.map((signal, index) => {
        const position = POSITIONS[index] ?? POSITIONS[0];
        const Icon = ICONS[signal.kind];
        const style = {
          '--xopc-source-x': position.x,
          '--xopc-source-y': position.y,
          '--xopc-source-delay': position.delay,
        } as CSSProperties;
        return (
          <span key={signal.id} className="xopc-source-convergence-signal absolute left-1/2 top-1/2" style={style} data-position={index} aria-hidden>
            <span className="xopc-source-convergence-chip flex max-w-36 items-center gap-2 rounded-xl border border-edge bg-surface-panel/95 px-3 py-2 text-xs font-medium text-fg shadow-elevated backdrop-blur-md">
              <Icon className="size-3.5 shrink-0 text-accent-fg" />
              <span className="truncate">{signal.label}</span>
            </span>
          </span>
        );
      })}

      <div className="xopc-source-convergence-core absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" aria-hidden>
        <span className="xopc-source-convergence-core-glow absolute -inset-10 rounded-full" />
        <BrandLogo className="relative size-16" />
        <span className="relative mt-3 text-[11px] font-semibold tracking-[0.16em] text-accent-fg">{centerLabel}</span>
      </div>

      <div className="xopc-source-convergence-particles pointer-events-none absolute inset-0" aria-hidden>
        {Array.from({ length: 8 }).map((_, index) => <i key={index} />)}
      </div>
    </div>
  );
}
