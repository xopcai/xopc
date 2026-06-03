import { Activity, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DreamingEvent } from '@/features/settings/dreaming-api';
import {
  type DreamingSettingsI18n,
} from '@/features/settings/dreaming-settings-shared';
import {
  sectionHeaderTightClass,
  sectionTightClass,
} from '@/features/settings/dreaming-settings-shared.styles';
import { formatDurationMs, isoShort } from '@/features/settings/dreaming-settings-shared.utils';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';

type Props = {
  t: DreamingSettingsI18n;
  hasToken: boolean;
  eventsLoading: boolean;
  events: DreamingEvent[] | null;
  loadEvents: () => void | Promise<void>;
};

export function DreamingEventsSection({ t, hasToken, eventsLoading, events, loadEvents }: Props) {
  return (
    <SettingsFormSection className={sectionTightClass}>
      <SettingsFormSectionHeader
        className={sectionHeaderTightClass}
        icon={Activity}
        title={t.eventsTitle}
        subtitle={t.eventsHint}
        trailing={
          <Button
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={!hasToken || eventsLoading}
            onClick={() => void loadEvents()}
          >
            {eventsLoading ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
            {t.eventsLoad}
          </Button>
        }
      />
      {events ? (
        events.length > 0 ? (
          <div className="space-y-1.5">
            {events.map((ev) => {
              const phaseIcon = ev.phase === 'light' ? '☀️' : ev.phase === 'rem' ? '✨' : '🌙';
              const metrics =
                ev.phase === 'light'
                  ? `scanned=${ev.scannedEntries ?? 0} new=${ev.newSignals ?? 0} deduped=${ev.deduped ?? 0}`
                  : ev.phase === 'rem'
                    ? `patterns=${ev.patternsDiscovered ?? 0} analyzed=${ev.entriesAnalyzed ?? 0}`
                    : `candidates=${ev.candidates ?? 0} applied=${ev.applied ?? 0}`;
              return (
                <div
                  key={`${ev.timestamp}:${ev.phase}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-edge-subtle bg-surface-panel/60 px-3 py-2 text-xs"
                >
                  <span>{phaseIcon}</span>
                  <span className="font-medium text-fg">{ev.phase}</span>
                  <span
                    className={cn(
                      'font-medium',
                      ev.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {ev.ok ? 'OK' : 'FAIL'}
                  </span>
                  <span className="text-fg-muted">{metrics}</span>
                  <span className="text-fg-muted">{formatDurationMs(ev.durationMs)}</span>
                  <span className="ml-auto text-fg-subtle">{isoShort(ev.timestamp)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t.eventsEmpty}</p>
        )
      ) : (
        <p className="text-sm text-fg-muted">{t.eventsNotLoaded}</p>
      )}
    </SettingsFormSection>
  );
}
