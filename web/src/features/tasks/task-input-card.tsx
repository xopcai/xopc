import { useRef, useState } from 'react';
import type { TaskWait } from '@xopcai/gateway-contract';
import { showActivity } from '@/stores/activity-store';
import { Button } from '@/components/ui/button';
import { commandTask, type TaskDetail } from './home-api';

export function TaskInputCard({ wait, detail, zh, onUpdated }: {
  wait: TaskWait; detail: TaskDetail; zh: boolean; onUpdated: (detail: TaskDetail) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const approval = wait.kind === 'approval';
  const choices = Array.isArray(wait.condition.choices) ? wait.condition.choices.filter((value): value is string => typeof value === 'string') : [];
  async function submit(decision?: 'approve' | 'deny') {
    if ((!approval && !answer.trim()) || (approval && !decision) || busy) return;
    const signature = JSON.stringify([detail.task.version, answer.trim(), decision]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const updated = await commandTask(detail.task.id, { type: 'resolve_wait', waitId: wait.id,
        resolution: approval ? { kind: 'task_approval', decision } : { kind: 'user_answer', answer: answer.trim() } }, detail.task.version, attempt.current.key);
      setSubmitted(true); onUpdated(updated);
      showActivity({ tone: 'success', title: approval ? (zh ? '决定已保存' : 'Decision saved') : (zh ? '补充信息已保存' : 'Answer saved'),
        message: updated.waits.length ? (zh ? '仍有其他等待条件，任务尚未恢复执行。' : 'Other waiting conditions remain.') : (zh ? '等待已解除，请在任务状态中查看后续执行进展。' : 'The wait is resolved. Follow progress in the task status.'), source: zh ? '任务' : 'Task' });
    } catch { setError(zh ? '提交未确认，内容已保留。可重试；若问题已变化，请刷新。' : 'Submission not confirmed. Your answer is saved here; retry or refresh if the question changed.'); }
    finally { setBusy(false); }
  }
  return <form className="mt-3 space-y-3 rounded-lg border border-edge p-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {approval ? <div className="text-sm text-fg"><p>{wait.reason}</p><p className="mt-2">{zh ? '授权范围：' : 'Permission: '}{String(wait.condition.capability)}</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="primary" disabled={busy || submitted} onClick={() => void submit('approve')}>{zh ? '批准' : 'Approve'}</Button><Button type="button" disabled={busy || submitted} onClick={() => void submit('deny')}>{zh ? '拒绝并暂停' : 'Deny and pause'}</Button></div></div> : <><label className="block text-sm text-fg">{typeof wait.condition.question === 'string' ? wait.condition.question : wait.reason}
      <textarea className="mt-2 w-full rounded-lg border border-edge bg-surface-panel p-3" rows={3} maxLength={12000} value={answer} disabled={busy || submitted} onChange={event => setAnswer(event.target.value)} /></label>
    {choices.length > 0 && <div className="flex flex-wrap gap-2">{choices.map(choice => <Button key={choice} type="button" disabled={busy || submitted} variant="secondary" aria-pressed={answer === choice} onClick={() => setAnswer(choice)}>{choice}</Button>)}</div>}
    <Button type="submit" variant="primary" disabled={busy || submitted || !answer.trim()}>{busy ? (zh ? '正在提交' : 'Submitting') : (zh ? '提交补充信息' : 'Submit answer')}</Button></>}
    <p className="text-xs text-fg-muted">{zh ? '保存到任务上下文；其他等待条件满足后继续执行。' : 'Saved to task context. Work continues once all waiting conditions are met.'}</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </form>;
}
