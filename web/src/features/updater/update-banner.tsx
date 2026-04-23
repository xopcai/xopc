import { Download, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import { useUpdateStatus } from './use-update-status';

/**
 * Global update notification banner.
 */
export function UpdateBanner() {
  const { npm, electron, isElectron, electronQuitAndInstall } = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (isElectron && electron?.state === 'downloaded') {
    return (
      <div className="flex items-center justify-between gap-3 bg-accent/10 border-b border-accent/20 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-accent" />
          <span>
            Update <strong>v{electron.version}</strong> is ready.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={electronQuitAndInstall}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
          >
            <RefreshCw className="mr-1 inline h-3 w-3" />
            Restart to update
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-fg-muted hover:text-fg-default transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (isElectron && electron?.state === 'downloading') {
    const percent = Math.round(electron.percent ?? 0);
    return (
      <div className="flex items-center gap-3 bg-surface-secondary border-b border-edge px-4 py-2 text-sm text-fg-muted">
        <Download className="h-4 w-4 animate-pulse" />
        <span>Downloading update... {percent}%</span>
        <div className="h-1.5 flex-1 rounded-full bg-surface-tertiary overflow-hidden max-w-48">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (npm?.updateAvailable && npm.latestVersion) {
    return (
      <div className="flex items-center justify-between gap-3 bg-accent/10 border-b border-accent/20 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-accent" />
          <span>
            A new version <strong>v{npm.latestVersion}</strong> is available
            {npm.channel && npm.channel !== 'latest' ? ` (${npm.channel})` : ''}.
          </span>
          {isElectron ? null : (
            <code className="rounded bg-surface-secondary px-1.5 py-0.5 text-xs text-fg-muted">
              xopc update
            </code>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-fg-muted hover:text-fg-default transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return null;
}
