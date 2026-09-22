import type { TurnOutcome } from '@xopcai/gateway-contract';
import { Check, ChevronRight, CircleAlert, CircleX, ListChecks } from 'lucide-react';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function TurnOutcomeDetails({ outcome }: { outcome: TurnOutcome }) {
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).chat.turnOutcome;
  const hasChanges = Boolean(outcome.changeSet);
  const hasEvidence = outcome.evidence.length > 0;
  if (!hasChanges && !hasEvidence) return null;

  const passed = outcome.evidence.filter((item) => item.status === 'passed').length;
  const failed = outcome.evidence.filter((item) => item.status === 'failed').length;
  const statusLabel = outcome.status === 'succeeded'
    ? t.statusSucceeded
    : outcome.status === 'failed'
      ? t.statusFailed
      : t.statusPartial;
  const StatusIcon = outcome.status === 'succeeded'
    ? Check
    : outcome.status === 'failed'
      ? CircleX
      : CircleAlert;
  const summary = [
    outcome.changeSet
      ? t.changedFileCount.replace('{{count}}', String(outcome.changeSet.files.length))
      : null,
    passed > 0 ? t.passedCount.replace('{{count}}', String(passed)) : null,
    failed > 0 ? t.failedCount.replace('{{count}}', String(failed)) : null,
    hasEvidence && passed === 0 && failed === 0 ? `${outcome.evidence.length} ${t.evidence}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <details className="group mt-2 max-w-[36rem] rounded-lg bg-surface-panel/15 text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-fg-muted transition-colors hover:bg-surface-hover/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
        <span
          className={outcome.status === 'succeeded'
            ? 'grid size-5 shrink-0 place-items-center rounded-full bg-success/10 text-success'
            : outcome.status === 'failed'
              ? 'grid size-5 shrink-0 place-items-center rounded-full bg-danger/10 text-danger'
              : 'grid size-5 shrink-0 place-items-center rounded-full bg-warning/10 text-warning'}
        >
          <StatusIcon className="size-3.5" strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-fg">{statusLabel}</span>
          <span className="block truncate text-xs text-fg-subtle">{summary}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" strokeWidth={1.75} aria-hidden />
      </summary>

      <div className="border-t border-edge-subtle px-3 py-2.5">
        {outcome.changeSet ? (
          <section aria-label={t.changes}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-fg">{t.changeSetTitle}</span>
              <span className="shrink-0 text-fg-subtle">
                {t.changeStats
                  .replace('{{files}}', String(outcome.changeSet.files.length))
                  .replace('{{added}}', String(outcome.changeSet.added))
                  .replace('{{removed}}', String(outcome.changeSet.removed))}
              </span>
            </div>
            <div className="mt-2 border-t border-edge-subtle/70 pt-2">
              {outcome.changeSet.files.slice(0, 8).map((file) => (
                <div key={file.path} className="flex min-w-0 items-center gap-2 py-1 text-xs">
                  <span className="w-14 shrink-0 text-fg-subtle">
                    {t.fileStatus[file.status ?? 'modified']}
                  </span>
                  <code className="min-w-0 truncate text-fg-muted">{file.path}</code>
                </div>
              ))}
              {outcome.changeSet.files.length > 8 ? (
                <div className="pt-1 text-xs text-fg-subtle">
                  {t.moreFiles.replace('{{count}}', String(outcome.changeSet.files.length - 8))}
                </div>
              ) : null}
            </div>
            {outcome.changeSet.diff ? (
              <details className="mt-2">
                <summary className="w-fit cursor-pointer rounded-md px-1.5 py-1 text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {t.viewDiff}
                </summary>
                {outcome.changeSet.diffTruncated ? (
                  <p className="mt-2 text-xs text-warning">{t.diffTruncated}</p>
                ) : null}
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-inset p-3 text-xs leading-5 text-fg-muted">
                  <code>{outcome.changeSet.diff}</code>
                </pre>
              </details>
            ) : null}
          </section>
        ) : null}

        {hasChanges && hasEvidence ? <div className="my-2 border-t border-edge-subtle" /> : null}

        {hasEvidence ? (
          <section aria-label={t.evidence}>
            <div className="mb-1 text-xs font-medium text-fg">{t.evidence}</div>
            {outcome.evidence.map((item) => (
              <div key={item.evidenceId} className="flex min-h-10 items-center gap-2.5 border-b border-edge-subtle/60 py-1.5 last:border-b-0">
                <ListChecks
                  className={item.status === 'passed'
                    ? 'size-4 shrink-0 text-success'
                    : item.status === 'failed'
                      ? 'size-4 shrink-0 text-danger'
                      : 'size-4 shrink-0 text-warning'}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{item.label}</span>
                <span className={item.status === 'passed'
                  ? 'text-xs font-medium text-success'
                  : item.status === 'failed'
                    ? 'text-xs font-medium text-danger'
                    : 'text-xs font-medium text-warning'}
                >
                  {item.status === 'passed' ? t.passed : item.status === 'failed' ? t.failed : t.warning}
                </span>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </details>
  );
}
