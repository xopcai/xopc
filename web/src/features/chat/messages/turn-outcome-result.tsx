import { useMemo, useState } from 'react';
import {
  Check,
  CircleX,
  ExternalLink,
  FileText,
  GitCompareArrows,
  ListChecks,
} from 'lucide-react';
import type { TurnOutcome, TurnOutcomeDeliverable } from '@xopcai/gateway-contract';

import { AttachmentRenderer } from '@/features/chat/attachments/attachment-renderer';
import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type OutcomeSection = 'deliverables' | 'changes' | 'evidence';

function formatBytes(value: number | undefined): string | null {
  if (value === undefined) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentFromDeliverable(deliverable: TurnOutcomeDeliverable): MessageAttachment | null {
  if (!deliverable.uri) return null;
  return {
    id: deliverable.artifactId,
    name: deliverable.title,
    type: deliverable.kind,
    mimeType: deliverable.mimeType,
    size: deliverable.sizeBytes,
    uri: deliverable.uri,
    workspaceRelativePath: deliverable.workspaceRelativePath,
  };
}

export function TurnOutcomeResult({
  outcome,
  authToken,
  sessionKey,
  projectId,
}: {
  outcome: TurnOutcome;
  authToken?: string;
  sessionKey?: string | null;
  projectId?: string | null;
}) {
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).chat.turnOutcome;
  const sections = useMemo(() => {
    const value: OutcomeSection[] = [];
    if (outcome.deliverables.length > 0) value.push('deliverables');
    if (outcome.changeSet) value.push('changes');
    if (outcome.evidence.length > 0) value.push('evidence');
    return value;
  }, [outcome.changeSet, outcome.deliverables.length, outcome.evidence.length]);
  const [selected, setSelected] = useState<OutcomeSection>(sections[0] ?? 'changes');
  const active = sections.includes(selected) ? selected : sections[0];
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [showAllDeliverables, setShowAllDeliverables] = useState(false);

  if (!active) return null;

  const passed = outcome.evidence.filter((item) => item.status === 'passed').length;
  const failed = outcome.evidence.filter((item) => item.status === 'failed').length;
  const statusLabel = outcome.status === 'succeeded'
    ? t.statusSucceeded
    : outcome.status === 'failed'
      ? t.statusFailed
      : t.statusPartial;
  const StatusIcon = outcome.status === 'succeeded'
    ? Check
    : CircleX;
  const visibleDeliverables = showAllDeliverables
    ? outcome.deliverables
    : outcome.deliverables.slice(0, 3);
  const attachments = visibleDeliverables
    .map(attachmentFromDeliverable)
    .filter((item): item is MessageAttachment => item !== null);
  const linkedDeliverables = visibleDeliverables.filter((item) => item.shareUrl);
  const unlinkedDeliverables = visibleDeliverables.filter((item) => !item.uri && !item.shareUrl);

  const tabLabel = (section: OutcomeSection): string => {
    if (section === 'deliverables') return `${t.deliverables} ${outcome.deliverables.length}`;
    if (section === 'changes') return `${t.changes} ${outcome.changeSet?.files.length ?? 0}`;
    return `${t.evidence} ${outcome.evidence.length}`;
  };

  return (
    <section
      className="overflow-hidden rounded-xl border border-edge-subtle/80 bg-surface-elevated/25"
      aria-label={t.heading}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0">
          {statusLabel ? (
            <div className="flex items-center gap-2 text-sm font-medium text-fg">
              <span
                className={outcome.status === 'succeeded'
                  ? 'grid size-5 place-items-center rounded-full bg-success/10 text-success'
                  : 'grid size-5 place-items-center rounded-full bg-danger/10 text-danger'}
              >
                <StatusIcon className="size-3.5" strokeWidth={2} aria-hidden />
              </span>
              <span>{statusLabel}</span>
            </div>
          ) : null}
          <p className={`${statusLabel ? 'mt-1 ' : ''}text-xs leading-5 text-fg-muted`}>
            {[
              outcome.deliverables.length > 0
                ? t.deliverableCount.replace('{{count}}', String(outcome.deliverables.length))
                : null,
              outcome.changeSet
                ? t.changedFileCount.replace('{{count}}', String(outcome.changeSet.files.length))
                : null,
              passed > 0 ? t.passedCount.replace('{{count}}', String(passed)) : null,
              failed > 0 ? t.failedCount.replace('{{count}}', String(failed)) : null,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {sections.length > 1 ? (
        <div className="flex min-w-0 overflow-x-auto border-y border-edge-subtle/70 bg-surface-subtle/55 px-2" role="tablist">
          {sections.map((section) => (
            <button
              key={section}
              type="button"
              role="tab"
              aria-selected={active === section}
              onClick={() => setSelected(section)}
              className={active === section
                ? 'shrink-0 border-b-2 border-accent px-3 py-2 text-xs font-medium text-fg'
                : 'shrink-0 border-b-2 border-transparent px-3 py-2 text-xs text-fg-muted transition-colors hover:text-fg'}
            >
              {tabLabel(section)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="px-3 py-2.5">
        {active === 'deliverables' ? (
          <div className="flex min-w-0 flex-col gap-2">
            {attachments.length > 0 ? (
              <AttachmentRenderer
                attachments={attachments}
                authToken={authToken}
                sessionKey={sessionKey}
                projectId={projectId}
                layout="assistant"
              />
            ) : null}
            {linkedDeliverables.map((item) => (
              <a
                key={item.artifactId}
                href={item.shareUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-12 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                  <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
                  <span className="block text-xs text-fg-muted">{item.kind === 'site' ? t.site : t.sharedFile}</span>
                </span>
                <span className="text-xs font-medium text-accent">{t.open}</span>
              </a>
            ))}
            {unlinkedDeliverables.map((item) => (
              <div key={item.artifactId} className="flex min-h-12 items-center gap-2.5 px-2 py-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-hover text-fg-muted">
                  <FileText className="size-4" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
                  <span className="block text-xs text-fg-muted">
                    {[
                      item.mimeType,
                      formatBytes(item.sizeBytes),
                      t.location[item.location],
                      item.availability !== 'available' ? t.availability[item.availability] : null,
                    ].filter(Boolean).join(' · ') || item.kind}
                  </span>
                </span>
              </div>
            ))}
            {outcome.deliverables.length > 3 ? (
              <button
                type="button"
                className="w-fit rounded-md px-2 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                onClick={() => setShowAllDeliverables((value) => !value)}
                aria-expanded={showAllDeliverables}
              >
                {showAllDeliverables
                  ? t.showLess
                  : t.showAll.replace('{{count}}', String(outcome.deliverables.length))}
              </button>
            ) : null}
          </div>
        ) : null}

        {active === 'changes' && outcome.changeSet ? (
          <div>
            <div className="flex items-center gap-2.5 px-1 py-1.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                <GitCompareArrows className="size-4" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-fg">{t.changeSetTitle}</div>
                <div className="text-xs text-fg-muted">
                  {`${t.changeStats
                    .replace('{{files}}', String(outcome.changeSet.files.length))
                    .replace('{{added}}', String(outcome.changeSet.added))
                    .replace('{{removed}}', String(outcome.changeSet.removed))} · ${t.environment[outcome.changeSet.environment]}`}
                </div>
              </div>
              {outcome.changeSet.diff ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                  onClick={() => setDiffExpanded((value) => !value)}
                  aria-expanded={diffExpanded}
                >
                  {diffExpanded ? t.hideDiff : t.viewDiff}
                </button>
              ) : null}
            </div>
            <div className="mt-2 border-t border-edge-subtle/70 pt-2">
              {outcome.changeSet.files.slice(0, 8).map((file) => (
                <div key={file.path} className="flex min-w-0 items-center gap-2 px-1 py-1 text-xs">
                  <span className="w-14 shrink-0 text-fg-subtle">{file.status ? t.fileStatus[file.status] : t.fileStatus.modified}</span>
                  <code className="min-w-0 truncate text-fg-muted">{file.path}</code>
                </div>
              ))}
              {outcome.changeSet.files.length > 8 ? (
                <div className="px-1 pt-1 text-xs text-fg-subtle">
                  {t.moreFiles.replace('{{count}}', String(outcome.changeSet.files.length - 8))}
                </div>
              ) : null}
            </div>
            {diffExpanded ? (
              <div className="mt-2">
                {outcome.changeSet.diffTruncated ? (
                  <p className="mb-2 text-xs text-warning">{t.diffTruncated}</p>
                ) : null}
                <pre className="max-h-72 overflow-auto rounded-lg bg-surface-subtle p-3 text-xs leading-5 text-fg-muted">
                  <code>{outcome.changeSet.diff}</code>
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        {active === 'evidence' ? (
          <div className="flex flex-col">
            {outcome.evidence.map((item) => (
              <div key={item.evidenceId} className="flex min-h-11 items-center gap-2.5 border-b border-edge-subtle/60 px-1 py-2 last:border-b-0">
                <ListChecks className={item.status === 'passed' ? 'size-4 shrink-0 text-success' : item.status === 'failed' ? 'size-4 shrink-0 text-danger' : 'size-4 shrink-0 text-warning'} strokeWidth={1.75} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-fg">{item.label}</div>
                  {item.revision ? <div className="text-xs text-fg-subtle" title={item.revision}>{t.checkedRevision} <code>{item.revision.slice(0, 12)}</code></div> : null}
                  {item.logPath ? <details className="text-xs text-fg-subtle"><summary className="cursor-pointer">{t.commandLog}</summary><code className="break-all">{item.logPath}</code></details> : null}
                  {item.durationMs !== undefined ? (
                    <div className="text-xs text-fg-subtle">{t.duration.replace('{{ms}}', String(item.durationMs))}</div>
                  ) : null}
                </div>
                <span className={item.status === 'passed' ? 'text-xs font-medium text-success' : item.status === 'failed' ? 'text-xs font-medium text-danger' : 'text-xs font-medium text-warning'}>
                  {item.status === 'passed' ? t.passed : item.status === 'failed' ? t.failed : t.warning}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
