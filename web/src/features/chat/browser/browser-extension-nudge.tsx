import { Loader2, Puzzle, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { useBrowserExtensionSetup } from './use-browser-extension-setup';

const DISMISS_KEY = 'xopc:browser-extension-nudge:v1';
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;

function isDismissed(now = Date.now()): boolean {
  try {
    const dismissedAt = Number(globalThis.localStorage?.getItem(DISMISS_KEY));
    return Number.isFinite(dismissedAt) && dismissedAt > 0 && now - dismissedAt < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}

export function BrowserExtensionNudge({ enabled }: { enabled: boolean }) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).chat;
  const [dismissed, setDismissed] = useState(() => isDismissed());
  const setup = useBrowserExtensionSetup(enabled && !dismissed);
  const status = setup.status;

  const visible = enabled
    && !dismissed
    && status?.enabled === true
    && status.driverKind === 'extension'
    && status.localManagementAvailable === true
    && setup.setupState !== 'loading'
    && setup.setupState !== 'connected';

  if (!visible) return null;

  const dismiss = () => {
    try {
      globalThis.localStorage?.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // The in-memory state still dismisses the card when storage is unavailable.
    }
    setDismissed(true);
  };

  return (
    <section
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-base px-4 py-3 transition-opacity duration-200 motion-reduce:transition-none sm:flex-row sm:items-center sm:px-5"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-inset text-fg" aria-hidden>
          <Puzzle className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">
            {setup.installed ? copy.browserExtensionReconnectTitle : copy.browserExtensionNudgeTitle}
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-fg-muted">
            {setup.installed ? copy.browserExtensionReconnectBody : copy.browserExtensionNudgeBody}
          </p>
          {setup.error ? <p className="mt-1 text-xs text-danger" role="alert">{setup.error}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1">
        <Button
          type="button"
          variant="primary"
          className="h-9 shrink-0 px-4"
          disabled={setup.busy}
          onClick={() => void setup.prepareAndOpen()}
        >
          {setup.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {setup.installed ? copy.browserExtensionNudgeReconnect : copy.browserExtensionNudgeInstall}
        </Button>
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
          aria-label={copy.browserExtensionNudgeDismiss}
          onClick={dismiss}
        >
          <X className="size-4" />
        </button>
      </div>
    </section>
  );
}
