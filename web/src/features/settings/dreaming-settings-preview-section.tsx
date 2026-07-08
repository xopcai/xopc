import { Loader2, ScanLine } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DreamingPreviewItem } from '@/features/settings/dreaming-api';
import {
  type DreamingSettingsI18n,
} from '@/features/settings/dreaming-settings-shared';
import {
  sectionHeaderTightClass,
  sectionTightClass,
} from '@/features/settings/dreaming-settings-shared.styles';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

type Props = {
  t: DreamingSettingsI18n;
  hasToken: boolean;
  previewLoading: boolean;
  previewItems: DreamingPreviewItem[] | null;
  loadPreview: () => void | Promise<void>;
};

export function DreamingPreviewSection({ t, hasToken, previewLoading, previewItems, loadPreview }: Props) {
  return (
    <SettingsFormSection className={sectionTightClass}>
      <SettingsFormSectionHeader
        className={sectionHeaderTightClass}
        icon={ScanLine}
        title={t.previewTitle}
        subtitle={t.previewHint}
        trailing={
          <Button
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={!hasToken || previewLoading}
            onClick={() => void loadPreview()}
          >
            {previewLoading ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
            {t.previewLoad}
          </Button>
        }
      />
      {previewItems ? (
        previewItems.length > 0 ? (
          <div className="space-y-2">
            {previewItems.map((it) => {
              const src = `${it.path}:${it.startLine}-${it.endLine}`;
              const skipped = it.skippedReason;
              return (
                <div
                  key={`${it.key}:${it.hash}:${src}`}
                  className="rounded-lg bg-surface-panel/70 px-2.5 py-2 shadow-surface"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                    <span className="font-medium text-fg">{src}</span>
                    <span>score={it.score.toFixed(3)}</span>
                    <span>recalls={it.recallCount}</span>
                    <span>avg={it.avgScore.toFixed(3)}</span>
                    <span>decay={it.recencyDecay?.toFixed(3) ?? '—'}</span>
                    {skipped ? (
                      <span className="text-amber-600 dark:text-amber-400">{skipped}</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">{t.previewEligible}</span>
                    )}
                  </div>
                  {it.snippet ? <div className="mt-2 text-sm text-fg">{it.snippet}</div> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t.previewEmpty}</p>
        )
      ) : (
        <p className="text-sm text-fg-muted">{t.previewNotLoaded}</p>
      )}
    </SettingsFormSection>
  );
}
