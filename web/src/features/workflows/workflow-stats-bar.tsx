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
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label={labels.statsTotalRuns} value={String(stats.totalRuns)} />
      <StatCard label={labels.statsActiveRuns} value={String(stats.activeRuns)} />
      <StatCard
        label={labels.statsSuccessRate}
        value={
          stats.totalRuns > 0
            ? `${Math.round((stats.succeededRuns / stats.totalRuns) * 100)}%`
            : '—'
        }
      />
      <StatCard
        label={labels.statsAvgDuration}
        value={stats.averageDurationMs != null ? formatDuration(stats.averageDurationMs) : '—'}
        hint={topLine ?? undefined}
      />
    </section>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface-panel px-4 py-3">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-fg">{value}</div>
      {hint ? <div className="mt-1 truncate text-[11px] text-fg-muted">{hint}</div> : null}
    </div>
  );
}
