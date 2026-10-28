import { Circle, CircleCheck, CircleX } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';

import { TaskDetailDisclosure } from './task-detail-disclosure';
import type { CriterionSummary } from './task-detail-summary';
import { TaskExpandableContent } from './task-expandable-content';
import { TaskResultEvidence } from './task-result-evidence';

const BROAD_CRITERIA_NOTE = 'Default criteria were not expanded into concrete acceptance items; broad completion cannot certify item coverage.';

function CriterionRow({ criterion, index, language, closed, pending, onReview, projectId, conversationId }: {
  criterion: CriterionSummary;
  index: number;
  language: 'zh' | 'en';
  closed: boolean;
  pending: boolean;
  onReview: (index: number, status: 'passed' | 'failed') => Promise<boolean>;
  projectId?: string;
  conversationId?: string;
}) {
  const zh = language === 'zh';
  const [editing, setEditing] = useState(false);
  const Icon = criterion.status === 'passed' ? CircleCheck : criterion.status === 'failed' ? CircleX : Circle;
  const label = criterion.status === 'passed' ? (zh ? '已通过' : 'Passed')
    : criterion.status === 'failed' ? (zh ? '未通过' : 'Failed') : (zh ? '待验收' : 'Awaiting review');
  const source = criterion.review ? (zh ? '用户确认' : 'User reviewed')
    : criterion.status === 'passed' ? (zh ? '自动核验' : 'Automatic verification')
      : criterion.status === 'failed' ? (zh ? '自动核验' : 'Automatic verification') : undefined;
  async function review(status: 'passed' | 'failed') {
    if (await onReview(index, status)) setEditing(false);
  }
  return <li className="flex min-w-0 items-start gap-3 py-4">
    <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', criterion.status === 'passed' ? 'text-success' : criterion.status === 'failed' ? 'text-danger' : 'text-fg-subtle')} />
    <div className="min-w-0 flex-1 space-y-2">
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg [overflow-wrap:anywhere]">{criterion.text}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-fg-muted"><span>{label}</span>{source ? <span>· {source}</span> : null}
        {criterion.review && !closed && !editing ? <Button variant="ghost" className="min-h-9 px-2 text-xs" disabled={pending} onClick={() => setEditing(true)}>{zh ? '更改判定' : 'Change review'}</Button> : null}
        {!closed && (!criterion.review || editing) ? <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-9 px-3 text-xs" disabled={pending} onClick={() => void review('passed')}>{zh ? '确认通过' : 'Mark passed'}</Button>
          <Button variant="ghost" className="min-h-9 px-3 text-xs" disabled={pending} onClick={() => void review('failed')}>{zh ? '标记未通过' : 'Mark failed'}</Button>
          {editing ? <Button variant="ghost" className="min-h-9 px-2 text-xs" disabled={pending} onClick={() => setEditing(false)}>{zh ? '取消' : 'Cancel'}</Button> : null}
        </div> : null}
      </div>
      {criterion.evidence.length > 0 || criterion.method || criterion.review || criterion.note ? <TaskDetailDisclosure panelId={`criterion:${index}:evidence`} title={<>{zh ? '查看依据' : 'View evidence'}{criterion.evidence.length > 0 ? ` · ${criterion.evidence.length}` : ''}</>} summaryClassName="min-h-9 cursor-pointer py-2 text-xs text-fg-muted hover:text-fg">
        <div className="space-y-2 border-l border-edge pl-3 text-xs leading-5 text-fg-muted">
          {criterion.method ? <p>{zh ? '自动核验' : 'Automatic verification'} · {criterion.verificationStatus === 'passed' ? (zh ? '通过' : 'Passed') : criterion.verificationStatus === 'failed' ? (zh ? '未通过' : 'Failed') : (zh ? '未核验' : 'Unverified')}{criterion.method === 'model_reviewed' ? (zh ? ' · 模型审阅' : ' · Model review') : ''}</p> : null}
          {criterion.review ? <p>{zh ? '人工判定' : 'User review'} · {formatMediumDateTime(criterion.review.reviewedAt, language)}</p> : null}
          {criterion.note && criterion.note !== BROAD_CRITERIA_NOTE ? <TaskExpandableContent content={criterion.note} contentKey={`criterion:${index}:note`} language={language} markdown={false} /> : null}
          <TaskResultEvidence evidence={criterion.evidence} projectId={projectId} conversationId={conversationId} language={language} />
        </div>
      </TaskDetailDisclosure> : null}
    </div>
  </li>;
}

export function TaskAcceptancePanel({ criteria, language, closed, pending, canComplete, completionPending, blockedReason, error, onReview, onComplete, projectId, conversationId }: {
  criteria: CriterionSummary[];
  language: 'zh' | 'en';
  closed: boolean;
  pending: boolean;
  canComplete: boolean;
  completionPending: boolean;
  blockedReason?: string;
  error?: string | null;
  onReview: (index: number, status: 'passed' | 'failed') => Promise<boolean>;
  onComplete: () => void;
  projectId?: string;
  conversationId?: string;
}) {
  const zh = language === 'zh';
  const broadNote = criteria.some((criterion) => criterion.note === BROAD_CRITERIA_NOTE);
  return <>
    {broadNote ? <TaskDetailDisclosure panelId="acceptance:diagnostic" title={zh ? '自动核验未完成：验收标准过于宽泛' : 'Automatic verification incomplete: criteria are too broad'} className="mb-2 text-xs leading-5 text-fg-muted"><p className="mt-2 break-words">{BROAD_CRITERIA_NOTE}</p></TaskDetailDisclosure> : null}
    <ul className="divide-y divide-edge-subtle">{criteria.map((criterion, index) => <CriterionRow key={`${index}:${criterion.text}`} criterion={criterion} index={index} language={language} closed={closed} pending={pending} onReview={onReview} projectId={projectId} conversationId={conversationId} />)}</ul>
    {criteria.length === 0 ? <p className="py-4 text-sm text-fg-muted">{zh ? '尚未定义验收标准' : 'No acceptance criteria defined'}</p> : null}
    {error ? <p role="alert" className="my-2 text-sm text-danger">{error}</p> : null}
    {!closed ? <div className="flex flex-wrap items-center justify-end gap-3 border-t border-edge-subtle pt-4">
      {!canComplete && blockedReason ? <p className="text-xs text-fg-muted">{blockedReason}</p> : null}
      <Button variant="primary" disabled={!canComplete || pending || completionPending} onClick={onComplete}>{zh ? '验收通过，完成任务' : 'Accept and complete task'}</Button>
    </div> : null}
  </>;
}
