import { Download, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

import { useUpdateStatus } from './use-update-status';

/**
 * Update status detail panel — for settings or dialog usage.
 */
export function UpdateStatusPanel() {
  const { npm, electron, isElectron, checkNow, electronCheck, electronQuitAndInstall } =
    useUpdateStatus();

  const currentVersion = npm?.currentVersion ?? '—';
  const hasNpmUpdate = npm?.updateAvailable && npm.latestVersion;
  const electronState = electron?.state;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-fg-default mb-2">Current Version</h3>
        <p className="text-sm text-fg-muted">v{currentVersion}</p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-fg-default mb-2">Server Update</h3>
        {hasNpmUpdate ? (
          <div className="flex items-center gap-2 text-sm">
            <Download className="h-4 w-4 text-accent" />
            <span>
              v{npm!.latestVersion} available ({npm!.channel ?? 'latest'})
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span>Up to date</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => void checkNow()}
          className="mt-2 rounded border border-edge px-3 py-1 text-xs text-fg-muted hover:text-fg-default hover:border-fg-muted transition-colors"
        >
          Check now
        </button>
      </div>

      {isElectron && (
        <div>
          <h3 className="text-sm font-medium text-fg-default mb-2">Desktop App Update</h3>
          {electronState === 'downloaded' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Download className="h-4 w-4 text-accent" />
                <span>v{electron!.version} downloaded, ready to install</span>
              </div>
              <button
                type="button"
                onClick={electronQuitAndInstall}
                className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
              >
                <RefreshCw className="mr-1 inline h-3 w-3" />
                Restart to update
              </button>
            </div>
          )}
          {electronState === 'downloading' && (
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <Download className="h-4 w-4 animate-pulse" />
              <span>Downloading... {Math.round(electron!.percent ?? 0)}%</span>
            </div>
          )}
          {electronState === 'checking' && (
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Checking for updates...</span>
            </div>
          )}
          {electronState === 'error' && (
            <div className="flex items-center gap-2 text-sm text-red-500">
              <AlertCircle className="h-4 w-4" />
              <span>{electron!.message ?? 'Update check failed'}</span>
            </div>
          )}
          {(electronState === 'idle' || electronState === 'not-available') && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>Up to date</span>
              </div>
              <button
                type="button"
                onClick={electronCheck}
                className="rounded border border-edge px-3 py-1 text-xs text-fg-muted hover:text-fg-default hover:border-fg-muted transition-colors"
              >
                Check now
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
