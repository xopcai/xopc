import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { submitTaskFeedback, type TaskDetail } from './home-api';
import { taskCopy } from './task-copy';
import { currentTaskReceipt } from './task-detail-summary';
import { TaskExpandableContent } from './task-expandable-content';
import { TaskResultEvidence } from './task-result-evidence';
import { TaskResultStatus } from './task-result-status';

export function TaskExecutionReport({ detail, language }: { detail: TaskDetail; language: 'zh' | 'en' }) {
  const zh = language === 'zh';
  const copy = taskCopy(language);
  const receipt = currentTaskReceipt(detail);
  const history = detail.receipts.filter((item) => item.runId !== receipt?.runId);
  const [feedbackState, setFeedbackState] = useState<'idle' | 'pending' | 'saved' | 'failed'>('idle');
  async function feedback(value: 'helpful' | 'not_helpful') {
    if (!receipt) return;
    setFeedbackState('pending');
    try {
      await submitTaskFeedback(receipt.runId, value);
      setFeedbackState('saved');
    } catch {
      setFeedbackState('failed');
    }
  }
  return <div className="space-y-4">
    <TaskResultStatus detail={detail} language={language} />
    {receipt ? <>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium text-fg">{copy.latestResult}</h3><span className="text-xs text-fg-muted">{copy.receiptStatuses[receipt.status]} · {copy.verificationStatuses[receipt.verification.status]}</span></div>
      <TaskExpandableContent content={receipt.summary} contentKey={`${detail.task.id}:result:${receipt.runId}`} language={language} />
      {receipt.evidence.length > 0 ? <details><summary className="cursor-pointer py-2 text-xs text-fg-muted">{zh ? '验证依据与执行产物' : 'Evidence and artifacts'} · {receipt.evidence.length}</summary><TaskResultEvidence evidence={receipt.evidence} projectId={detail.task.projectId} conversationId={detail.conversation.activeConversationId ?? undefined} language={language} /></details> : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-edge-subtle pt-3">
        <Button variant="ghost" className="min-h-9 px-2 text-xs" disabled={feedbackState === 'pending'} onClick={() => void feedback('helpful')}>{copy.doneWell}</Button>
        <Button variant="ghost" className="min-h-9 px-2 text-xs" disabled={feedbackState === 'pending'} onClick={() => void feedback('not_helpful')}>{copy.needsFix}</Button>
        {feedbackState === 'saved' ? <span role="status" className="text-xs text-fg-muted">{zh ? '反馈已记录' : 'Feedback saved'}</span> : null}
        {feedbackState === 'failed' ? <span role="alert" className="text-xs text-danger">{copy.actionFailed}</span> : null}
      </div>
    </> : null}
    {history.length > 0 ? <details className="border-t border-edge-subtle pt-3"><summary className="cursor-pointer py-2 text-xs text-fg-muted">{copy.executionHistory.replace('{{count}}', String(history.length))}</summary><div className="mt-3 space-y-4">{history.map((item) => <article key={item.runId} className="space-y-2 rounded-lg bg-surface-hover p-3"><p className="text-xs text-fg-muted">{copy.receiptStatuses[item.status]}</p><TaskExpandableContent content={item.summary} contentKey={`${detail.task.id}:result:${item.runId}`} language={language} /></article>)}</div></details> : null}
  </div>;
}
