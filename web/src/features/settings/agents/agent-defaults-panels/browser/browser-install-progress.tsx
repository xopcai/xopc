import type { BrowserInstallStreamState } from './use-browser-install-stream';
import type { BrowserMessages } from './types';

function phaseLabel(m: BrowserMessages, progress: BrowserInstallStreamState): string {
  const phase = progress.phase;
  if (!phase) return m.browserInstallPhaseStarting;

  if (phase === 'downloading') {
    if (progress.percent != null) {
      return m.browserInstallPhaseDownloadingPercent.replace('{{percent}}', String(progress.percent));
    }
    return m.browserInstallPhaseDownloading;
  }

  switch (phase) {
    case 'starting':
      return m.browserInstallPhaseStarting;
    case 'verifying':
      return m.browserInstallPhaseVerifying;
    case 'extracting':
      return m.browserInstallPhaseExtracting;
    case 'running':
      return progress.message ?? m.browserInstallPhaseRunning;
    case 'ready':
      return m.browserInstallPhaseReady;
    default:
      return progress.message ?? m.browserInstallPhaseRunning;
  }
}

export function BrowserInstallProgressPanel({
  m,
  progress,
  showLogs = false,
  onCancel,
  cancelling = false,
}: {
  m: BrowserMessages;
  progress: BrowserInstallStreamState;
  showLogs?: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  if (!progress.phase) return null;

  const label = phaseLabel(m, progress);
  const percent =
    progress.percent != null
      ? Math.min(100, Math.max(0, progress.percent))
      : progress.phase === 'extracting' || progress.phase === 'verifying'
        ? null
        : progress.phase === 'running' || progress.phase === 'starting'
          ? null
          : null;

  return (
    <div className="space-y-2 rounded-lg border border-edge bg-surface-base px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span className="text-fg">{label}</span>
        <div className="flex items-center gap-2">
          {percent != null ? <span className="tabular-nums">{percent}%</span> : null}
          {onCancel ? (
            <button
              type="button"
              className="rounded-md border border-edge px-2 py-0.5 text-[11px] font-medium text-fg-muted hover:bg-surface-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
              disabled={cancelling}
              onClick={() => void onCancel()}
            >
              {cancelling ? m.browserInstallCancelling : m.browserInstallCancel}
            </button>
          ) : null}
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
        {percent != null ? (
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/70" />
        )}
      </div>

      {showLogs && progress.lines.length > 0 ? (
        <div className="max-h-28 overflow-y-auto rounded-md border border-edge bg-surface-panel px-2 py-1.5 font-mono text-[10px] leading-relaxed text-fg-muted">
          {progress.lines.map((line, i) => (
            <div key={`${i}-${line.slice(0, 24)}`} className="truncate">
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {!showLogs && progress.phase === 'downloading' && progress.message && progress.percent == null ? (
        <p className="text-[11px] text-fg-subtle">{progress.message}</p>
      ) : null}
    </div>
  );
}
