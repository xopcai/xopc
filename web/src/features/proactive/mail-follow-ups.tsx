import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';

import { proactiveGet, proactiveWrite, type MailFollowUp } from './api';
import { formatAssistantDate, mailFollowUpState } from './presentation';

const field = 'mt-2 w-full rounded-lg border border-edge bg-surface-base p-3 text-sm text-fg';
const localDate = (iso: string) => {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function MailFollowUpService({ zh, onStarted, open, onOpen }: { zh: boolean; onStarted: () => void; open: boolean; onOpen: () => void }) {
  const sources = useSWR<{ sources: Array<{ id: string; subject: string; sender: string; accountLabel: string }> }>(open ? '/api/proactive/follow-ups/sources' : null, proactiveGet);
  const [sourceId, setSourceId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueAt, setDueAt] = useState(() => localDate(new Date(Date.now() + 86400000).toISOString()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true); setError('');
    try {
      await proactiveWrite('/api/proactive/follow-ups', 'POST', { sourceItemId: sourceId, instructions, dueAt: new Date(dueAt).toISOString() });
      onStarted();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <article className="rounded-2xl border border-edge bg-surface-panel p-5"><h2 className="font-medium">{zh ? '替我跟进这封邮件' : 'Follow this email for me'}</h2><p className="mt-2 text-sm text-fg-muted">{zh ? '记住等谁回复，收到变化时整理重点，到时间后准备跟进草稿。' : 'Watch replies, explain changes and prepare a follow-up draft when it is time.'}</p>
    {!open ? <Button className="mt-3" onClick={onOpen}>{zh ? '选择一封邮件' : 'Choose an email'}</Button> : sources.isLoading ? <Skeleton className="mt-4 h-40" /> : sources.data?.sources.length ? <div className="mt-4 space-y-3">
      <label className="block text-sm">{zh ? '最近授权同步的邮件' : 'Recently synchronized email'}<Select value={sourceId} onChange={e => setSourceId(e.target.value)}><SelectOption value="">{zh ? '选择邮件' : 'Choose email'}</SelectOption>{sources.data.sources.map(source => <SelectOption key={source.id} value={source.id}>{source.subject} · {source.sender} · {source.accountLabel}</SelectOption>)}</Select></label>
      <label className="block text-sm">{zh ? '希望跟进到什么结果？' : 'What outcome are you waiting for?'}<textarea className={field} rows={3} maxLength={12000} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder={zh ? '例如：等客户确认评审时间，没回复就帮我准备一封简短的跟进邮件。' : 'For example: wait for a review date and prepare a short follow-up if there is no reply.'} /></label>
      <label className="block text-sm">{zh ? '最晚什么时候再跟进？（本地时间）' : 'When should I follow up? (Local time)'}<input type="datetime-local" className={field} value={dueAt} onChange={e => setDueAt(e.target.value)} /></label>
      <p className="text-xs text-fg-muted">{zh ? '只跟进这段邮件往来。草稿由你审阅后在对话中办理，发出后继续等待实际回复。' : 'Follows this thread only. Review drafts and continue sending in chat; follow-up continues after sending.'}</p>
      <Button variant="primary" disabled={busy || !sourceId || !instructions.trim() || !dueAt} onClick={() => void start()}>{zh ? '交给你跟进' : 'Start following'}</Button>
    </div> : !sources.error && <p className="mt-4 text-sm text-fg-muted">{zh ? '还没有可跟进的邮件。' : 'No email is available to follow yet.'} <Link to="/connectors" className="text-accent">{zh ? '连接邮箱并选择可用范围' : 'Connect an email account and choose what is available'}</Link></p>}
    {(error || sources.error) && <p role="alert" className="mt-3 text-sm text-danger">{error || String(sources.error)}</p>}
  </article>;
}

export function MailFollowUpListItem({ follow, zh }: { follow: MailFollowUp; zh: boolean }) {
  return <article className="rounded-2xl border border-edge bg-surface-panel p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0 flex-1"><h2 className="font-semibold text-fg">{follow.subject ?? (zh ? '邮件跟进' : 'Email follow-up')}</h2><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-fg-muted">{follow.instructions}</p></div><Link className="shrink-0 text-sm font-medium text-accent" to={`/assistant-work?follow-up=${encodeURIComponent(follow.id)}`}>{zh ? '查看' : 'View'}</Link></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-fg-subtle">{zh ? '当前状态' : 'Current state'}</dt><dd className="mt-1 text-fg">{mailFollowUpState(follow, zh)}</dd></div><div><dt className="text-xs text-fg-subtle">{zh ? '接下来' : 'Next'}</dt><dd className="mt-1 text-fg">{follow.status === 'completed' ? (zh ? '不会再跟进' : 'No more follow-up') : `${zh ? '约定时间' : 'Follow up by'} ${formatAssistantDate(follow.dueAt, zh)}`}</dd></div><div><dt className="text-xs text-fg-subtle">{zh ? '最新成果或决定' : 'Latest result or decision'}</dt><dd className="mt-1 text-fg">{follow.latestDirection === 'received' ? (zh ? '发现新的回复，等待整理' : 'A new reply is ready to review') : (zh ? '还没有需要交付的新成果' : 'No new result needs delivery yet')}</dd></div><div><dt className="text-xs text-fg-subtle">{zh ? '最近核对' : 'Last checked'}</dt><dd className="mt-1 text-fg">{follow.lastCheckedAt ? formatAssistantDate(follow.lastCheckedAt, zh) : (zh ? '尚未完成首次核对' : 'First check has not completed')}</dd></div></dl></article>;
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
  const state = mailFollowUpState(follow, zh);
  return <article className="rounded-2xl border border-edge bg-surface-panel p-5"><h2 className="font-medium">{follow.subject ?? (zh ? '邮件跟进' : 'Email follow-up')}</h2><p className="mt-2 text-sm text-fg-muted">{state}</p><p className="mt-3 whitespace-pre-wrap text-sm">{follow.instructions}</p><p className="mt-2 text-xs text-fg-muted">{zh ? '约定跟进时间：' : 'Follow up by: '}{formatAssistantDate(follow.dueAt, zh)}</p>
    {follow.lastCheckedAt && <p className="mt-1 text-xs text-fg-muted">{zh ? '最近核对邮件：' : 'Last email check: '}{formatAssistantDate(follow.lastCheckedAt, zh)}</p>}
    {follow.lastSyncedAt && <p className="mt-1 text-xs text-fg-muted">{zh ? '邮箱最近同步：' : 'Email last synchronized: '}{formatAssistantDate(follow.lastSyncedAt, zh)}</p>}
    {follow.syncFailed && <p className="mt-2 text-sm text-danger">{zh ? '最近一次邮箱同步失败，当前结果可能尚未包含新回复。请检查邮箱连接。' : 'The latest email sync failed. Current work may not include new replies. Check your email connection.'}</p>}
    {!follow.sourceAvailable && <Link className="mt-3 block text-sm text-accent" to="/connectors">{zh ? '检查邮箱连接' : 'Check email connection'}</Link>}
    {follow.sessionKey && <Link className="mt-3 block text-sm text-accent" to={`/chat/${encodeURIComponent(follow.sessionKey)}`}>{zh ? '继续原来的对话' : 'Continue the conversation'}</Link>}
    {editing && <div className="mt-4 space-y-3"><textarea aria-label={zh ? '跟进要求' : 'Instructions'} className={field} rows={3} maxLength={12000} value={instructions} onChange={e => setInstructions(e.target.value)} /><input aria-label={zh ? '跟进时间' : 'Follow-up time'} type="datetime-local" className={field} value={dueAt} onChange={e => setDueAt(e.target.value)} /><Button disabled={busy || !instructions.trim() || !dueAt} onClick={() => void update({ instructions, ...(localDate(follow.dueAt) !== dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}) })}>{zh ? '保存要求' : 'Save instructions'}</Button></div>}
    <div className="mt-4 flex flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? (zh ? '取消修改' : 'Cancel edit') : (zh ? '调整跟进要求' : 'Adjust follow-up')}</Button><Button variant="ghost" disabled={busy} onClick={() => void update({ status: follow.status === 'watching' ? 'paused' : 'watching' })}>{follow.status === 'watching' ? (zh ? '暂停' : 'Pause') : (zh ? '重新跟进' : 'Resume')}</Button>{follow.status !== 'completed' && <Button variant="ghost" disabled={busy} onClick={() => void update({ status: 'completed' })}>{zh ? '结束这件事的跟进' : 'End this follow-up'}</Button>}</div>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </article>;
}
