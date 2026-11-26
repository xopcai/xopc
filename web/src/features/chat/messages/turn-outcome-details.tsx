import type { TurnOutcome } from '@xopcai/gateway-contract';
import { useContext, useState } from 'react';
import { Check, ChevronRight, CircleAlert, CircleX, ListChecks, Loader2, RotateCcw } from 'lucide-react';

import { AssistantCapsuleContent, assistantCapsuleClassName, assistantCapsuleDetailClassName } from './assistant-capsule';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { AgentRunErrorBanner } from './agent-run-error-banner';
import { RunFeedbackContext } from './run-feedback-context';

export function TurnOutcomeDetails({ outcome }: { outcome: TurnOutcome }) {
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const t = messages(language).chat.turnOutcome;
  const feedback = useContext(RunFeedbackContext);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const latest = Boolean(feedback.turnId && feedback.turnId === outcome.turnId);
  const canRestoreCheckpoint = Boolean(
    feedback.conversationId
    && outcome.turnId
    && outcome.changeSet?.environment === 'workspace'
    && !feedback.running,
  );

  const handleRestoreCheckpoint = async () => {
    if (!feedback.conversationId || !outcome.turnId || restoring) return;
    setRestoring(true);
    setRestoreStatus(null);
    try {
      const res = await apiFetch(
        apiUrl(`/api/sessions/${encodeURIComponent(feedback.conversationId)}/checkpoints/${encodeURIComponent(outcome.turnId)}/restore`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: 'before' }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        payload?: { filesChanged?: number };
      };
      if (!res.ok || !data.ok) {
        setRestoreStatus({
          ok: false,
          text: data.error || (zh ? '无法还原该轮文件改动' : 'Unable to restore files for this turn'),
        });
      } else {
        const count = data.payload?.filesChanged ?? 0;
        setRestoreStatus({
          ok: true,
          text: count > 0
            ? (zh ? `已还原 ${count} 个文件到本轮之前` : `Restored ${count} file(s) to before this turn`)
            : (zh ? '工作区文件已与本轮之前一致' : 'Workspace already matches before this turn'),
        });
      }
    } catch (err) {
      setRestoreStatus({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  };
  const failure = outcome.status === 'failed' && !(latest && feedback.running)
    ? <AgentRunErrorBanner errorText={(latest && feedback.error) || outcome.summary || t.statusFailed}
      onRetry={latest ? feedback.onRetry : undefined} /> : null;
  const hasChanges = Boolean(outcome.changeSet);
  const hasEvidence = outcome.evidence.length > 0;
  if (!hasChanges && !hasEvidence) return failure;

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
    hasEvidence && passed === 0 && failed === 0 ? t.evidenceCount.replace('{{count}}', String(outcome.evidence.length)) : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
    {failure}
    <details className="group mt-2 min-w-0 max-w-full text-sm">
      <summary className={`${assistantCapsuleClassName} cursor-pointer list-none`} title={`${statusLabel} · ${summary}`}>
        <AssistantCapsuleContent
          icon={<StatusIcon className={outcome.status === 'succeeded' ? 'text-success' : outcome.status === 'failed' ? 'text-danger' : 'text-warning'} aria-hidden />}
          title={statusLabel}
          meta={summary}
          trailing={<ChevronRight className="size-3.5 shrink-0 text-fg-subtle transition-transform group-open:rotate-90 motion-reduce:transition-none" strokeWidth={1.75} aria-hidden />}
        />
      </summary>

      <div className={assistantCapsuleDetailClassName}>
        {outcome.changeSet ? (
          <section aria-label={t.changes}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-fg">{t.changeSetTitle}</span>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-fg-subtle">
                  {t.changeStats
                    .replace('{{files}}', String(outcome.changeSet.files.length))
                    .replace('{{added}}', String(outcome.changeSet.added))
                    .replace('{{removed}}', String(outcome.changeSet.removed))}
                </span>
                {canRestoreCheckpoint ? (
                  confirmRestore ? (
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={() => void handleRestoreCheckpoint()}
                        className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger transition-colors hover:opacity-90 disabled:opacity-50"
                      >
                        {restoring ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RotateCcw className="size-3" aria-hidden />}
                        {zh ? '确认还原' : 'Confirm restore'}
                      </button>
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={() => setConfirmRestore(false)}
                        className="rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted hover:bg-surface-hover"
                      >
                        {zh ? '取消' : 'Cancel'}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreStatus(null);
                        setConfirmRestore(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-edge px-2 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <RotateCcw className="size-3" aria-hidden />
                      {zh ? '还原改动' : 'Restore files'}
                    </button>
                  )
                ) : null}
              </div>
            </div>
            {restoreStatus ? (
              <p className={`mt-1.5 text-[11px] ${restoreStatus.ok ? 'text-success' : 'text-danger'}`}>
                {restoreStatus.text}
              </p>
            ) : null}
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
    </>
  );
}
