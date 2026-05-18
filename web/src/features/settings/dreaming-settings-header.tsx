import { Loader2, Play, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DreamingPhaseId } from '@/features/settings/dreaming-api';
import type { DreamingConfigState } from '@/features/settings/dreaming-config-api';
import { type DreamingSettingsI18n } from '@/features/settings/dreaming-settings-shared';
import { cn } from '@/lib/cn';

type Props = {
  t: DreamingSettingsI18n;
  cfgForm: DreamingConfigState | null;
  dreamingEnabled: boolean;
  hasToken: boolean;
  cfgSaving: boolean;
  enableSaving: boolean;
  runPhase: DreamingPhaseId;
  setRunPhase: (p: DreamingPhaseId) => void;
  runBusy: boolean;
  doRunNow: (phase: DreamingPhaseId) => void | Promise<void>;
  doRefresh: () => void | Promise<void>;
  setDreamingEnabled: (enabled: boolean) => void | Promise<void>;
};

export function DreamingHeader({
  t,
  cfgForm,
  dreamingEnabled,
  hasToken,
  cfgSaving,
  enableSaving,
  runPhase,
  setRunPhase,
  runBusy,
  doRunNow,
  doRefresh,
  setDreamingEnabled,
}: Props) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {cfgForm ? (
          <label
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors',
              dreamingEnabled
                ? 'border-emerald-500/30 bg-emerald-500/5 text-fg'
                : 'border-edge-subtle bg-surface-panel/50 text-fg-muted',
            )}
          >
            <span className="text-xs font-medium">{t.configEnabled}</span>
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={cfgForm.enabled}
              disabled={!hasToken || cfgSaving || enableSaving}
              onChange={(e) => void setDreamingEnabled(e.target.checked)}
            />
            {enableSaving ? (
              <Loader2 className="size-3.5 animate-spin text-fg-muted" aria-hidden />
            ) : (
              <span
                className={cn(
                  'text-xs font-semibold',
                  dreamingEnabled ? 'text-emerald-600 dark:text-emerald-400' : '',
                )}
              >
                {cfgForm.enabled ? t.on : t.off}
              </span>
            )}
          </label>
        ) : null}
        {dreamingEnabled ? (
          <>
            <select
              className="rounded-lg border border-edge bg-surface-panel px-2 py-1.5 text-xs text-fg"
              value={runPhase}
              onChange={(e) => setRunPhase(e.target.value as DreamingPhaseId)}
              disabled={!hasToken || runBusy}
            >
              <option value="light">Light</option>
              <option value="deep">Deep</option>
              <option value="rem">REM</option>
            </select>
            <Button
              variant="secondary"
              className="px-2.5 py-1.5 text-xs"
              disabled={!hasToken || runBusy}
              onClick={() => void doRunNow(runPhase)}
              title={t.runNowHint}
            >
              {runBusy ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              ) : (
                <Play className="mr-2 size-4" aria-hidden />
              )}
              {t.runNow}
            </Button>
          </>
        ) : null}
        <Button
          variant="secondary"
          className="px-2.5 py-1.5 text-xs"
          disabled={!hasToken}
          onClick={() => void doRefresh()}
        >
          <RefreshCw className="mr-2 size-4" aria-hidden />
          {t.refresh}
        </Button>
      </div>
    </header>
  );
}
