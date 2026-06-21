import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowStats } from './workflow-api';
import { formatDuration, interpolate } from './workflow-page.utils';

export function WorkflowStatsBar({
  stats,
  language,
}: {
  stats: WorkflowStats | undefined;
  language: StoredLanguage;
}) {
  const labels = messages(language).workflows;
  if (!stats || stats.totalRuns === 0) return null;

  const topLine = stats.topDefinitions[0]
    ? interpolate(labels.statsTopWorkflow, {
        name: stats.topDefinitions[0].definitionId,
        count: stats.topDefinitions[0].count,
      })
    : null;

  return (
    <section className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface-panel/70 px-3 py-2">
      <StatPill label={labels.statsTotalRuns} value={String(stats.totalRuns)} />
      <StatPill label={labels.statsActiveRuns} value={String(stats.activeRuns)} />
      <StatPill
        label={labels.statsSuccessRate}
        value={
          stats.totalRuns > 0
            ? `${Math.round((stats.succeededRuns / stats.totalRuns) * 100)}%`
            : '—'
        }
      />
      <StatPill
        label={labels.statsAvgDuration}
        value={stats.averageDurationMs != null ? formatDuration(stats.averageDurationMs) : '—'}
      />
      {topLine ? <span className="min-w-0 truncate text-xs text-fg-muted">{topLine}</span> : null}
    </section>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-muted px-2.5 py-1 text-xs text-fg-muted">
      <span>{label}</span>
      <span className="font-semibold tabular-nums text-fg">{value}</span>
    </span>
  );
}
