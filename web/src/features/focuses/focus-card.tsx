import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CheckCircle2, MoreHorizontal, Pause, Play, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { formatMediumDateTime } from '@/lib/date-formatters';

import { focusCopy } from './copy';
import type { Focus, FocusMonitorKind, FocusStatus } from './types';

type Props = {
  focus: Focus;
  language: 'en' | 'zh';
  busy?: boolean;
  onMonitor: (kind: FocusMonitorKind, enabled: boolean) => void;
  onStatus: (status: FocusStatus) => void;
  onDelete: () => void;
};

function MonitorRow({ focus, kind, language, busy, onMonitor }: Pick<Props, 'focus' | 'language' | 'busy' | 'onMonitor'> & { kind: FocusMonitorKind }) {
  const copy = focusCopy(language);
  const monitor = focus.monitors.find((item) => item.kind === kind);
  const enabled = monitor?.enabled === true;
  const title = kind === 'progress' ? copy.progress : copy.external;
  const action = kind === 'progress' ? copy.enableProgress : copy.enableExternal;
  const state = monitor?.runState === 'running' ? copy.running
    : monitor?.runState === 'queued' ? copy.queued
      : monitor?.runState === 'failed' ? copy.failed
        : enabled ? copy.enabled : copy.disabled;

  return (
    <div className="rounded-lg border border-edge-subtle bg-surface-base/70 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-fg">
          <span className={`size-1.5 shrink-0 rounded-full ${enabled ? 'bg-success' : 'bg-fg-subtle/40'}`} aria-hidden />
          {title}
        </span>
        <span className="shrink-0 text-[11px] text-fg-subtle">{state}</span>
      </div>
      {enabled ? (
        <p className="mt-1.5 text-[11px] text-fg-subtle">
          {monitor?.lastRunAt ? `${copy.lastRun} ${formatMediumDateTime(new Date(monitor.lastRunAt))}` : copy.neverRun}
          {monitor?.nextRunAt ? ` · ${copy.nextRun} ${formatMediumDateTime(new Date(monitor.nextRunAt))}` : ''}
        </p>
      ) : (
        <Button type="button" variant="ghost" className="mt-1 h-7 px-0 text-xs text-accent" disabled={busy || focus.status !== 'active'} onClick={() => onMonitor(kind, true)}>
          {action}
        </Button>
      )}
    </div>
  );
}

export function FocusCard({ focus, language, busy, onMonitor, onStatus, onDelete }: Props) {
  const copy = focusCopy(language);
  const navigate = useNavigate();
  return (
    <article className="group rounded-xl border border-edge-subtle bg-surface-panel p-4 transition-colors hover:border-edge-strong">
      <div className="flex items-start gap-3">
        <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => navigate(`/work/focuses/${encodeURIComponent(focus.id)}`)}>
          <h3 className="truncate text-sm font-semibold text-fg">{focus.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{focus.summary}</p>
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="rounded-md p-1 text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Actions" disabled={busy}>
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-xl border border-edge bg-surface-panel p-1 shadow-lg">
              <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover" onSelect={() => onStatus(focus.status === 'paused' ? 'active' : 'paused')}>
                {focus.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}{focus.status === 'paused' ? copy.resume : copy.pause}
              </DropdownMenu.Item>
              <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover" onSelect={() => onStatus('completed')}>
                <CheckCircle2 className="size-4" />{copy.complete}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
              <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger outline-none focus:bg-surface-hover" onSelect={onDelete}>
                <Trash2 className="size-4" />{copy.remove}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <MonitorRow focus={focus} kind="progress" language={language} busy={busy} onMonitor={onMonitor} />
        <MonitorRow focus={focus} kind="external_changes" language={language} busy={busy} onMonitor={onMonitor} />
      </div>
      <button type="button" className="mt-3 text-xs font-medium text-accent hover:underline" onClick={() => navigate(`/work/focuses/${encodeURIComponent(focus.id)}`)}>{copy.details} →</button>
    </article>
  );
}
