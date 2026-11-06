import { Check } from 'lucide-react';
import { useId } from 'react';

import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';

import { TaskDetailDisclosure } from './task-detail-disclosure';
import type { CriterionSummary } from './task-detail-summary';
import { TaskExpandableContent } from './task-expandable-content';
import { TaskResultEvidence } from './task-result-evidence';

type ReviewStatus = 'passed' | 'unverified';

const BROAD_CRITERIA_NOTE = 'Default criteria were not expanded into concrete acceptance items; broad completion cannot certify item coverage.';

function CriterionRow({ criterion, index, language, closed, pending, onReview, projectId, conversationId }: {
  criterion: CriterionSummary;
  index: number;
  language: 'zh' | 'en';
  closed: boolean;
  pending: boolean;
  onReview: (index: number, status: ReviewStatus) => Promise<boolean>;
  projectId?: string;
  conversationId?: string;
}) {
  const zh = language === 'zh';
  const titleId = useId();
  const checked = criterion.status === 'passed';
  const hasEvidence = criterion.evidence.length > 0 || criterion.method || criterion.review || criterion.note;
  const verificationLabel = criterion.verificationStatus === 'passed' ? (zh ? '通过' : 'Passed')
    : criterion.verificationStatus === 'failed' ? (zh ? '未通过' : 'Failed') : (zh ? '未核验' : 'Unverified');
  const reviewLabel = criterion.review?.status === 'passed' ? (zh ? '已验收' : 'Accepted')
    : criterion.review?.status === 'failed' ? (zh ? '未通过' : 'Failed') : (zh ? '已撤销验收' : 'Acceptance cleared');

  return <li className="relative flex min-w-0 items-start px-2 before:absolute before:end-0 before:start-13 before:top-0 before:border-t before:border-edge-subtle first:before:hidden sm:px-3">
    <label className={cn('relative grid size-11 shrink-0 place-items-center rounded-full', !closed && !pending && 'cursor-pointer')}>
      <input type="checkbox" aria-labelledby={titleId} className="peer sr-only" checked={checked} disabled={closed}
        aria-disabled={pending || undefined} onChange={(event) => {
          if (!pending) void onReview(index, event.target.checked ? 'passed' : 'unverified');
        }} />
      <span aria-hidden className={cn(
        'grid size-5 place-items-center rounded-full border motion-safe:transition-colors motion-safe:duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-panel',
        checked ? 'border-edge bg-surface-inset text-fg' : 'border-fg-subtle/70',
        !closed && !pending && 'hover:bg-surface-hover',
      )}>{checked ? <Check className="size-3.5" strokeWidth={2.8} /> : null}</span>
    </label>
    <TaskDetailDisclosure panelId={`criterion:${index}:evidence`} chevron className="min-w-0 flex-1"
      summaryClassName="-ms-1 min-h-11 cursor-pointer rounded-lg py-3 pe-2 ps-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      title={<span id={titleId} className="block whitespace-pre-wrap break-words text-sm leading-5 text-fg [overflow-wrap:anywhere]">{criterion.text}</span>}>
      <div className="mb-3 space-y-2 rounded-lg bg-surface-inset px-3 py-2.5 text-xs leading-5 text-fg-muted">
        <p className="font-medium text-fg">{zh ? '验收依据' : 'Acceptance evidence'}</p>
        {criterion.method ? <p>{zh ? '自动核验' : 'Automatic verification'} · {verificationLabel}{criterion.method === 'model_reviewed' ? (zh ? ' · 模型审阅' : ' · Model review') : ''}</p> : null}
        {criterion.review ? <p>{zh ? '人工验收' : 'User review'} · {reviewLabel} · {formatMediumDateTime(criterion.review.reviewedAt, language)}</p> : null}
        {criterion.note && criterion.note !== BROAD_CRITERIA_NOTE ? <TaskExpandableContent content={criterion.note} contentKey={`criterion:${index}:note`} language={language} markdown={false} /> : null}
        <TaskResultEvidence evidence={criterion.evidence} projectId={projectId} conversationId={conversationId} language={language} />
        {!hasEvidence ? <p>{zh ? '暂无验收依据' : 'No evidence yet'}</p> : null}
      </div>
    </TaskDetailDisclosure>
  </li>;
}

export function TaskAcceptancePanel({ criteria, language, closed, pending, blockedReason, error, onReview, projectId, conversationId }: {
  criteria: CriterionSummary[];
  language: 'zh' | 'en';
  closed: boolean;
  pending: boolean;
  blockedReason?: string;
  error?: string | null;
  onReview: (index: number, status: ReviewStatus) => Promise<boolean>;
  projectId?: string;
  conversationId?: string;
}) {
  const zh = language === 'zh';
  const broadNote = criteria.some((criterion) => criterion.note === BROAD_CRITERIA_NOTE);
  return <>
    {broadNote ? <TaskDetailDisclosure panelId="acceptance:diagnostic" title={zh ? '自动核验未完成：验收标准过于宽泛' : 'Automatic verification incomplete: criteria are too broad'} className="mx-4 mb-2 text-xs leading-5 text-fg-muted"><p className="mt-2 break-words">{BROAD_CRITERIA_NOTE}</p></TaskDetailDisclosure> : null}
    <ul aria-busy={pending || undefined} className="border-t border-edge-subtle">{criteria.map((criterion, index) => <CriterionRow key={`${index}:${criterion.text}`} criterion={criterion} index={index} language={language} closed={closed} pending={pending} onReview={onReview} projectId={projectId} conversationId={conversationId} />)}</ul>
    {criteria.length === 0 ? <p className="px-4 py-4 text-sm text-fg-muted">{zh ? '尚未定义验收标准' : 'No acceptance criteria defined'}</p> : null}
    {error ? <p role="alert" className="mx-4 my-2 text-sm text-danger">{error}</p> : null}
    {!closed && criteria.length > 0 && (blockedReason || criteria.some(criterion => criterion.status !== 'passed')) ? <p className="border-t border-edge-subtle px-4 py-2.5 text-xs text-fg-muted">
      {blockedReason ?? (zh ? '勾选全部验收项后，任务自动完成。' : 'Checking all criteria completes the task.')}
    </p> : null}
  </>;
}
