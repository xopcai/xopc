import type { TaskEvidence } from '@xopcai/gateway-contract';
import { Link, useLocation } from 'react-router-dom';

import { FileIcon } from '@/features/file-tree/file-icon';
import { DeliverablePreview } from './deliverable-preview';
import type { TaskDetail } from './home-api';
import { currentTaskReceipt } from './task-detail-summary';
import { taskChatHref } from './task-detail-route';
import { TaskResultEvidence } from './task-result-evidence';

/** Show usable deliverable locations without promoting execution claims to acceptance. */
export function TaskDeliverySummary({ detail, language }: { detail: TaskDetail; language: 'zh' | 'en' }) {
  const zh = language === 'zh';
  const location = useLocation();
  const deliverables = detail.deliverables ?? [];
  const receipt = currentTaskReceipt(detail);
  const runIds = new Set(detail.runs.filter((run) => run.contractVersion === detail.task.latestContractVersion).map((run) => run.id));
  const evidence: TaskEvidence[] = detail.context.filter((item) => item.role === 'deliverable').map((item) => ({
    kind: ['file', 'url'].includes(item.targetKind) ? 'artifact' : 'source',
    title: item.title ?? item.targetId,
    summary: '',
    ...(['file', 'url'].includes(item.targetKind) ? { uri: item.targetId } : {}),
    provenance: 'user', strength: 'observed', observedAt: 0,
  }));
  const deliverableUris = new Set(deliverables.flatMap(item => [item.artifact?.uri, item.artifact?.shareUrl, item.artifact?.workspaceRelativePath]).filter(Boolean));
  const seen = new Set([...evidence.map((item) => item.uri), ...deliverableUris].filter(Boolean));
  for (const result of detail.receipts.filter((item) => runIds.has(item.runId))) {
    for (const item of result.evidence.filter((entry) => entry.kind === 'artifact')) {
      if (item.uri && seen.has(item.uri)) continue;
      if (item.uri) seen.add(item.uri);
      evidence.push(item);
    }
  }
  const summary = receipt?.summary.trim();
  const shortSummary = summary && summary.length <= 160 && !summary.includes('\n')
    && !/\b(?:Claim|Criterion|Research claim)\b|c-ac\d|Default criteria were not/i.test(summary) ? summary : undefined;
  const remainingEvidence = evidence.filter(item => !deliverableUris.has(item.uri));
  return <section aria-label={zh ? '交付结果' : 'Deliverables'} className="rounded-xl border border-edge-subtle bg-surface-panel p-4">
    <h2 id="task-results-heading" className="text-sm font-semibold text-fg">{zh ? '交付结果' : 'Deliverables'}</h2>
    {shortSummary ? <p className="mt-2 break-words text-sm leading-6 text-fg-muted [overflow-wrap:anywhere]">{shortSummary}</p> : null}
    {receipt && receipt.completionVerdict !== 'achieved' ? <p className="mt-2 text-xs text-fg-muted">{zh ? '本次执行尚未报告目标全部达成。' : 'This run has not reported the full goal achieved.'}</p> : null}
    {deliverables.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {deliverables.map(item => {
        const title = item.artifact?.title ?? item.reference?.title ?? item.id;
        return <li key={item.id} className="min-w-0">
          <DeliverablePreview item={item} conversationId={item.task?.conversationId ?? detail.conversation.activeConversationId}
            backgroundPath={`${location.pathname}${location.search}`} zh={zh}
            className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-edge-subtle px-3 py-2 text-left text-sm text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <FileIcon name={title} /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{title}</span>
          </DeliverablePreview>
        </li>;
      })}
    </ul> : null}
    {remainingEvidence.length ? <TaskResultEvidence evidence={remainingEvidence} language={language} projectId={detail.task.projectId} conversationId={detail.conversation.activeConversationId ?? undefined} compact /> : null}
    {!deliverables.length && !remainingEvidence.length ? <p className="mt-2 text-sm text-fg-muted">{zh ? '尚无可查看的交付物' : 'No deliverables available yet'}</p> : null}
    {!receipt ? <p className="mt-2 text-xs text-fg-subtle">{zh ? '尚无本版任务的执行结果' : 'No run result for this task version'}</p> : null}
    {receipt && (receipt.needsUser || receipt.remainingWork.length > 0 || receipt.nextAction || receipt.failure) ? <div className="mt-4 space-y-2 border-t border-edge-subtle pt-3" aria-label={zh ? '执行待办' : 'Run follow-up'}>
      <h3 className="text-xs font-medium text-fg-muted">{receipt.needsUser ? (zh ? '需要你决定' : 'Your decision needed') : (zh ? '待处理事项' : 'Remaining work')}</h3>
      {receipt.remainingWork.length > 0 ? <ul className="space-y-2 text-sm leading-6 text-fg">{[...new Set(receipt.remainingWork)].map((item) => <li key={item} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item}</li>)}</ul> : null}
      {receipt.nextAction ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg [overflow-wrap:anywhere]">{receipt.nextAction}</p> : null}
      {receipt.failure ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-danger [overflow-wrap:anywhere]">{receipt.failure.recoveryAction}</p> : null}
      {receipt.needsUser ? <Link className="inline-flex min-h-9 items-center rounded-sm text-xs font-medium text-accent-fg hover:underline focus-visible:ring-2 focus-visible:ring-accent/40" to={taskChatHref(detail.task.id)}>{zh ? '查看并决定' : 'Review and decide'}</Link> : null}
    </div> : null}
  </section>;
}
