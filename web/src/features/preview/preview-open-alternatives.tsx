import { Download, ExternalLink } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { isElectron } from '@/lib/electron-env';

type PreviewOpenAlternativesBarProps = {
  message: string;
  downloadLabel: string;
  onDownload: () => void;
  /** Electron: open file with the OS default application (requires host absolute path). */
  openSystemLabel?: string;
  onOpenWithSystemApp?: () => void | Promise<void>;
  chooseAppLabel?: string;
  onChooseOpenWithApp?: () => void | Promise<void>;
  /** When false, hides the system-app button even if the callback is set. */
  canOpenWithSystemApp?: boolean;
  canChooseOpenWithApp?: boolean;
};

export function PreviewOpenAlternativesBar({
  message,
  downloadLabel,
  onDownload,
  openSystemLabel,
  onOpenWithSystemApp,
  chooseAppLabel,
  onChooseOpenWithApp,
  canOpenWithSystemApp = true,
  canChooseOpenWithApp = true,
}: PreviewOpenAlternativesBarProps) {
  const showSystem =
    isElectron() &&
    canOpenWithSystemApp &&
    typeof onOpenWithSystemApp === 'function' &&
    typeof openSystemLabel === 'string' &&
    openSystemLabel.length > 0;
  const showChoose =
    isElectron() &&
    canChooseOpenWithApp &&
    typeof onChooseOpenWithApp === 'function' &&
    typeof chooseAppLabel === 'string' &&
    chooseAppLabel.length > 0;

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-edge-subtle bg-surface-hover/60 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-edge',
      )}
    >
      <p className="min-w-0 text-xs leading-relaxed text-fg-muted">{message}</p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {showSystem ? (
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-panel px-3 py-1.5 text-xs font-medium text-fg shadow-sm dark:border-edge',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
            )}
            onClick={() => void onOpenWithSystemApp?.()}
          >
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            {openSystemLabel}
          </button>
        ) : null}
        {showChoose ? (
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-panel px-3 py-1.5 text-xs font-medium text-fg shadow-sm dark:border-edge',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
            )}
            onClick={() => void onChooseOpenWithApp?.()}
          >
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            {chooseAppLabel}
          </button>
        ) : null}
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm',
            interaction.transition,
            interaction.press,
            interaction.focusRingPanel,
          )}
          onClick={onDownload}
        >
          <Download className="size-3.5 shrink-0" aria-hidden />
          {downloadLabel}
        </button>
      </div>
    </div>
  );
}
