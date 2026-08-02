/**
 * Hub-level save bar — renders nothing while every registered section is
 * clean, and a sticky "Save all / Discard all" strip whenever at least one
 * section reports dirty state.
 *
 * Each panel still owns its local Save / Discard buttons; this is an
 * additive aggregator rather than a replacement, so power users keep
 * granular control.
 */

import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { useSaveBarStore, type SaveAllFailure } from './save-bar-store';

export function SaveBarControls() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.capabilitiesSettings.saveBar;

  const anyDirty = useSaveBarStore((s) => s.anyDirty);
  const anySaving = useSaveBarStore((s) => s.anySaving);
  const dirtyCount = useSaveBarStore((s) => s.dirtyCount);
  const saveAll = useSaveBarStore((s) => s.saveAll);
  const discardAll = useSaveBarStore((s) => s.discardAll);

  const [failures, setFailures] = useState<SaveAllFailure[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);

  if (!anyDirty && failures.length === 0 && !savedFlash) {
    return null;
  }

  const onSaveAll = async () => {
    setFailures([]);
    setSavedFlash(false);
    const result = await saveAll();
    if (result.ok && result.saved > 0) {
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } else if (!result.ok) {
      setFailures(result.failures);
    }
  };

  return (
    <div
      className={cn(
        'sticky top-0 z-10 -mx-4 flex flex-col gap-2 border-b border-edge-subtle bg-surface-base/85 px-4 py-2 backdrop-blur',
        'sm:flex-row sm:items-center sm:justify-between',
      )}
      role="region"
      aria-label={t.title}
    >
      <p className="text-xs text-fg-muted">
        {anyDirty
          ? t.dirtySummary.replace('{{count}}', String(dirtyCount))
          : savedFlash
            ? t.savedSummary
            : t.cleanSummary}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {failures.length > 0 ? (
          <span className="text-xs text-red-600 dark:text-red-400" role="alert">
            {t.failuresSummary.replace('{{count}}', String(failures.length))}
          </span>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="px-2.5 py-1.5 text-xs"
          disabled={!anyDirty || anySaving}
          onClick={() => discardAll()}
        >
          {t.discardAll}
        </Button>
        <Button
          type="button"
          variant="primary"
          className="px-2.5 py-1.5 text-xs"
          disabled={!anyDirty || anySaving}
          onClick={() => void onSaveAll()}
        >
          {anySaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          <span className={anySaving ? 'ml-1.5' : undefined}>{t.saveAll}</span>
        </Button>
      </div>
    </div>
  );
}
