import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { proactiveWrite, type MailFollowUp } from './api';
import { formatAssistantDate, mailFollowUpState } from './presentation';

const field = 'mt-2 w-full rounded-lg border border-edge bg-surface-base p-3 text-sm text-fg';
const localDate = (iso: string) => {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function MailFollowUpListItem({ follow, zh }: { follow: MailFollowUp; zh: boolean }) {
  return <article className="rounded-2xl border border-edge bg-surface-panel p-5">
    <div className="flex items-start justify-between gap-4"><div className="min-w-0 flex-1"><h2 className="font-semibold text-fg">{follow.subject ?? (zh ? '邮件跟进' : 'Email follow-up')}</h2><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-fg-muted">{follow.instructions}</p></div><Link className="shrink-0 text-sm font-medium text-accent" to={`/assistant-work?follow-up=${encodeURIComponent(follow.id)}`}>{zh ? '调整' : 'Adjust'}</Link></div>
    <div className="mt-4 rounded-xl bg-surface-hover px-4 py-3 text-sm"><p className="font-medium text-fg">{mailFollowUpState(follow, zh)}</p><p className="mt-1 text-fg-muted">{follow.status === 'completed' ? (zh ? '这项安排已经结束' : 'This arrangement has ended') : `${zh ? '约定时间' : 'Follow up by'} ${formatAssistantDate(follow.dueAt, zh)}`}</p></div>
  </article>;
}

export function MailFollowUpView({ follow, zh, refresh }: { follow: MailFollowUp; zh: boolean; refresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [instructions, setInstructions] = useState(follow.instructions);
  const [dueAt, setDueAt] = useState(localDate(follow.dueAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function update(patch: Record<string, unknown>) {
    setBusy(true); setError('');
    try { await proactiveWrite(`/api/proactive/follow-ups/${encodeURIComponent(follow.id)}`, 'PATCH', { expectedRevision: follow.revision, ...patch }); setEditing(false); refresh(); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <article className="rounded-2xl border border-edge bg-surface-panel p-5">
    <h2 className="font-medium">{follow.subject ?? (zh ? '邮件跟进' : 'Email follow-up')}</h2><p className="mt-2 text-sm text-fg-muted">{mailFollowUpState(follow, zh)}</p>
    <dl className="mt-4 space-y-4 text-sm"><div><dt className="text-xs text-fg-subtle">{zh ? '助理在等什么' : 'What the assistant is waiting for'}</dt><dd className="mt-1 whitespace-pre-wrap text-fg">{follow.instructions}</dd></div><div><dt className="text-xs text-fg-subtle">{zh ? '什么时候回来找你' : 'When to come back'}</dt><dd className="mt-1 text-fg">{formatAssistantDate(follow.dueAt, zh)}</dd></div></dl>
    {follow.syncFailed && <p className="mt-3 text-sm text-danger">{zh ? '助理暂时看不到最新回复，请检查邮箱连接。' : 'The assistant cannot see the latest replies right now. Check the email connection.'}</p>}
    {!follow.sourceAvailable && <Link className="mt-3 block text-sm text-accent" to="/connectors">{zh ? '检查邮箱连接' : 'Check email connection'}</Link>}
    {follow.sessionKey && <Link className="mt-3 block text-sm text-accent" to={`/chat/${encodeURIComponent(follow.sessionKey)}`}>{zh ? '继续原来的对话' : 'Continue the conversation'}</Link>}
    {editing && <div className="mt-4 space-y-3"><textarea aria-label={zh ? '跟进要求' : 'Instructions'} className={field} rows={3} maxLength={12000} value={instructions} onChange={event => setInstructions(event.target.value)} /><input aria-label={zh ? '跟进时间' : 'Follow-up time'} type="datetime-local" className={field} value={dueAt} onChange={event => setDueAt(event.target.value)} /><Button disabled={busy || !instructions.trim() || !dueAt} onClick={() => void update({ instructions, ...(localDate(follow.dueAt) !== dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}) })}>{zh ? '保存安排' : 'Save arrangement'}</Button></div>}
    <div className="mt-4 flex flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? (zh ? '取消修改' : 'Cancel edit') : (zh ? '调整安排' : 'Adjust arrangement')}</Button><Button variant="ghost" disabled={busy} onClick={() => void update({ status: follow.status === 'watching' ? 'paused' : 'watching' })}>{follow.status === 'watching' ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}</Button>{follow.status !== 'completed' && <Button variant="ghost" disabled={busy} onClick={() => void update({ status: 'completed' })}>{zh ? '结束安排' : 'End arrangement'}</Button>}</div>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </article>;
}
