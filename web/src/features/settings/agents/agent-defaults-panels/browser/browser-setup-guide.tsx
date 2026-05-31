import { ChevronRight, Cloud, MonitorPlay, Puzzle } from 'lucide-react';

import { cn } from '@/lib/cn';

import type { BackendMode } from './backend-mode-list';
import type { BrowserMessages } from './types';

type MethodId = Extract<BackendMode, 'extension' | 'local' | 'cloud'>;

function MethodCard({
  title,
  description,
  recommended,
  recommendedLabel,
  icon: Icon,
  onSelect,
  selectLabel,
}: {
  title: string;
  description: string;
  recommended?: boolean;
  recommendedLabel?: string;
  icon: typeof Puzzle;
  onSelect: () => void;
  selectLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${title} — ${selectLabel}`}
      className={cn(
        'group flex w-full flex-col rounded-xl border border-edge bg-surface-panel px-3 py-3 text-left transition-colors',
        'hover:border-edge-strong hover:bg-surface-hover/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted">
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            {recommended && recommendedLabel ? (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
                {recommendedLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>
        </div>
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
      <span className="mt-2 text-[11px] font-medium text-accent">{selectLabel}</span>
    </button>
  );
}

export function BrowserSetupGuide({
  m,
  onStart,
}: {
  m: BrowserMessages;
  onStart: (backend: MethodId) => void;
}) {
  const methods: Array<{
    id: MethodId;
    icon: typeof Puzzle;
    title: string;
    description: string;
    recommended?: boolean;
  }> = [
    {
      id: 'extension',
      icon: Puzzle,
      title: m.browserSetupExtTitle,
      description: m.browserSetupExtDesc,
      recommended: true,
    },
    {
      id: 'local',
      icon: MonitorPlay,
      title: m.browserSetupLocalTitle,
      description: m.browserSetupLocalDesc,
    },
    {
      id: 'cloud',
      icon: Cloud,
      title: m.browserSetupCloudTitle,
      description: m.browserSetupCloudDesc,
    },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-base px-4 py-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">{m.browserSetupTitle}</h2>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{m.browserSetupSubtitle}</p>
      </div>
      <div className="flex flex-col gap-2">
        {methods.map((method) => (
          <MethodCard
            key={method.id}
            icon={method.icon}
            title={method.title}
            description={method.description}
            recommended={method.recommended}
            recommendedLabel={m.browserSetupRecommended}
            selectLabel={m.browserSetupSelect}
            onSelect={() => onStart(method.id)}
          />
        ))}
      </div>
    </div>
  );
}
