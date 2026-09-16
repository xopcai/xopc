import type { ProactiveCard, ProactiveCardAction } from '@xopcai/gateway-contract';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { newChatAutoSendHref } from '@/features/chat/session/composer-handoff-params';

import { proactiveWrite } from './api';
import { cardStatusLabel, type ProactiveCopy } from './copy';

export function ProactiveCardView({ card, copy, refresh, detail = false }: { card: ProactiveCard; copy: ProactiveCopy; refresh: () => void; detail?: boolean }) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!detail || !element.current || typeof IntersectionObserver === 'undefined') return;
    const clientId = crypto.randomUUID();
    let visible = false;
    const report = () => { void proactiveWrite('/api/proactive/presence', 'POST', { clientId, surface: 'web', active: visible && document.visibilityState === 'visible' && document.hasFocus(), inboxItemId: card.id, notificationRevision: card.notificationRevision }).catch(() => {}); };
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); report(); });
    observer.observe(element.current);
    const timer = window.setInterval(report, 25000);
    document.addEventListener('visibilitychange', report);
    window.addEventListener('focus', report); window.addEventListener('blur', report);
    return () => { observer.disconnect(); window.clearInterval(timer); document.removeEventListener('visibilitychange', report); window.removeEventListener('focus', report); window.removeEventListener('blur', report); visible = false; report(); };
  }, [detail, card.id, card.notificationRevision]);
  const zh = copy.locale === 'zh';
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [refinement, setRefinement] = useState('');
  const [content, setContent] = useState(card.artifact?.content ?? '');
  const [taskDraft, setTaskDraft] = useState(card.taskDraft);
  const [draftCardId, setDraftCardId] = useState(card.id);
  const [draftRevision, setDraftRevision] = useState(card.revision);
  const staleDraft = draftCardId !== card.id || draftRevision !== card.revision;
  const actionable = submitted !== `${card.id}:${card.revision}` && !['withdrawn', 'expired', 'resolved'].includes(card.status);
  const handoff = `${card.communication
    ? (zh ? '继续办理这件事。请读取最新卡片、成果和邮件往来，展示完整草稿与收件人让我确认后再发送：' : 'Read the latest card, artifact and email thread. Show the full draft and recipients for my approval before sending: ')
    : (zh ? '继续讨论这件事，请先读取最新卡片和成果：' : 'Continue this work. First read the latest card and artifact: ')}xopc_use mode=proactive command=${card.communication ? 'continue_card' : 'get_card'} args={"id":"${card.id}"}`;
  const handoffHref = card.communication?.conversationId
    ? `/chat/${encodeURIComponent(card.communication.conversationId)}?${new URLSearchParams({ draft: handoff, autoSend: '1' })}`
    : newChatAutoSendHref(handoff, undefined, { projectScope: 'none' })!;
  const field = 'mt-2 w-full rounded-lg border border-edge bg-surface-base p-3 text-sm text-fg';
  async function act(actionId: ProactiveCardAction['actionId'], extra: Partial<ProactiveCardAction> = {}) {
    if (busy || staleDraft) return;
    const signature = JSON.stringify([card.id, card.revision, actionId, extra]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const updated = await proactiveWrite<{ card: ProactiveCard }>(`/api/inbox/judgments/${encodeURIComponent(card.id)}/actions`, 'POST', { ...extra, actionId, expectedRevision: card.revision, idempotencyKey: attempt.current.key });
      if (updated.card) { setDraftCardId(updated.card.id); setDraftRevision(updated.card.revision); setTaskDraft(updated.card.taskDraft); setContent(updated.card.artifact?.content ?? ''); }
      attempt.current = null;
      if (actionId === 'decide') setSubmitted(`${card.id}:${card.revision}`);
      if (actionId === 'useful' || actionId === 'not_useful') setFeedback(actionId);
      if (actionId === 'refine') { setFeedback('refined'); setRefinement(''); }
      setEditing(false); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return <article ref={element} className="rounded-2xl border border-edge bg-surface-panel p-5">
    <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-fg-muted"><span>{card.artifact ? (zh ? '已为你准备' : 'Prepared for you') : copy.kinds[card.kind]}</span><time dateTime={card.updatedAt}>{new Date(card.updatedAt).toLocaleString()}</time></div>
    <h2 className="text-base font-semibold text-fg">{card.title}</h2>
    <p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">{card.summary}</p>
    {!detail && <Link className="mt-4 inline-block text-sm font-medium text-accent" to={`/assistant-work?item=${encodeURIComponent(card.id)}`}>{card.decision ? (zh ? '查看并决定' : 'Review decision') : card.artifact ? (zh ? '打开准备好的成果' : 'Open prepared work') : (zh ? '查看变化' : 'View update')}</Link>}
    {detail && card.status === 'unread' && <Button variant="ghost" disabled={busy} onClick={() => void act('read')}>{zh ? '标为已读' : 'Mark as read'}</Button>}
    {detail && card.artifact && <section className="mt-5 border-t border-edge pt-5">
      <h3 className="mb-3 font-medium text-fg">{card.artifact.title}</h3>
      {editing ? <label className="text-sm">{zh ? '编辑成果' : 'Edit prepared work'}<textarea rows={12} maxLength={12000} className={field} value={content} onChange={e => setContent(e.target.value)} /></label> : <MarkdownView content={card.artifact.content} />}
      {actionable && !editing && <Button className="mt-3" variant="ghost" onClick={() => { void navigator.clipboard.writeText(card.artifact!.content).catch(cause => setError(String(cause))); }}>{zh ? '复制成果' : 'Copy'}</Button>}
      {actionable && <div className="mt-3 flex gap-2">{editing ? <><Button disabled={busy || staleDraft || !content.trim()} onClick={() => void act('edit_artifact', { artifact: { ...card.artifact!, content } })}>{copy.save}</Button><Button variant="ghost" onClick={() => { setEditing(false); setContent(card.artifact!.content); }}>{zh ? '取消' : 'Cancel'}</Button></> : <Button variant="ghost" onClick={() => setEditing(true)}>{zh ? '修改成果' : 'Edit'}</Button>}</div>}
    </section>}
    {card.decision && actionable && <section className="mt-5 rounded-xl border border-edge p-4">
      <h3 className="text-sm font-medium">{card.decision.question}</h3>
      {taskDraft && <><p className="mt-2 text-xs text-fg-muted">{zh ? '确认后创建项目待办，不会自动启动执行。' : 'Creates a project task without starting execution.'}</p><label className="mt-3 block text-sm">{zh ? '待办标题' : 'Task title'}<input className={field} maxLength={160} value={taskDraft.title} onChange={e => setTaskDraft({ ...taskDraft, title: e.target.value })} /></label><label className="mt-3 block text-sm">{zh ? '具体内容' : 'Task objective'}<textarea className={field} maxLength={1200} rows={4} value={taskDraft.objective} onChange={e => setTaskDraft({ ...taskDraft, objective: e.target.value })} /></label></>}
      <div className="mt-3 flex flex-wrap gap-2">{card.decision.options.map((option, i) => <Button key={option.id} variant={i === 0 ? 'primary' : 'ghost'} disabled={busy || staleDraft || (option.id === 'approve' && taskDraft !== undefined && (!taskDraft.title.trim() || !taskDraft.objective.trim()))} onClick={() => void act('decide', { choice: option.id, ...(option.id === 'approve' && taskDraft ? { taskDraft } : {}) })}>{option.label}</Button>)}</div>
    </section>}
    {card.followUp && <div className="mt-4 rounded-lg border border-edge p-3 text-sm"><Link className="text-accent" to={`/tasks/${encodeURIComponent(card.followUp.taskId)}`}>{card.followUp.title}</Link><p className="mt-1 text-fg-muted">{card.followUp.phase === 'closed' ? (zh ? `任务已结束：${card.followUp.resolution ?? '—'}` : `Task closed: ${card.followUp.resolution ?? '—'}`) : (zh ? '待办已创建，仍在跟进实际进展。' : 'Task created; following its progress.')}</p></div>}
    {card.actionStatus === 'failed' && !['expired', 'withdrawn'].includes(card.status) && <div className="mt-3 text-sm text-danger">{card.actionError}<Button disabled={busy || staleDraft} onClick={() => void act('retry')}>{copy.retry}</Button></div>}
    {detail && <details className="mt-4 text-sm text-fg-muted"><summary className="cursor-pointer">{copy.whyNow} · {copy.evidence}</summary><p className="mt-2">{card.whyNow}</p><ul className="mt-2 space-y-2">{card.evidence.map(item => <li key={item.id}>{item.route ? <Link className="text-accent" to={item.route}>{item.label}</Link> : item.label}{item.excerpt && <p className="whitespace-pre-wrap">{item.excerpt}</p>}</li>)}</ul></details>}
    {detail && actionable && <Link className="mt-4 inline-block text-sm text-accent" to={handoffHref}>{card.communication ? (zh ? '审阅草稿并继续办理' : 'Review draft and continue') : (zh ? '接着聊这件事' : 'Continue in chat')}</Link>}
    {detail && !['withdrawn', 'expired'].includes(card.status) && <section className="mt-5 border-t border-edge pt-4"><p className="text-sm font-medium text-fg">{zh ? '这次帮助合适吗？' : 'Was this help right for you?'}</p><div className="mt-2 flex flex-wrap gap-2"><Button variant="ghost" disabled={busy || Boolean(feedback)} onClick={() => void act('useful')}>{zh ? '有帮助' : 'Helpful'}</Button><Button variant="ghost" disabled={busy || Boolean(feedback)} onClick={() => void act('not_useful')}>{zh ? '不适合这个场景' : 'Not right for this scene'}</Button></div>{feedback && <p role="status" className="mt-2 text-xs text-fg-muted">{feedback === 'refined' ? (zh ? '助理会把这条要求用于当前跟进。' : 'The assistant will use this instruction for this follow-up.') : (zh ? '已记录反馈。' : 'Feedback recorded.')}</p>}{!feedback && <div className="mt-2 flex flex-wrap gap-1">{([['irrelevant', '不相关', 'Irrelevant'], ['bad_timing', '时机不对', 'Bad timing'], ['outdated', '信息已过时', 'Outdated'], ['too_frequent', '提醒太多', 'Too frequent']] as const).map(([reason, cn, en]) => <Button key={reason} variant="ghost" disabled={busy} onClick={() => void act('not_useful', { feedbackReason: reason })}>{zh ? cn : en}</Button>)}</div>}<details className="mt-3"><summary className="cursor-pointer text-sm text-fg-muted">{zh ? '告诉助理下次怎么做' : 'Tell the assistant what to do next time'}</summary><label className="mt-3 block text-sm"><textarea rows={3} maxLength={2000} className={field} value={refinement} onChange={event => setRefinement(event.target.value)} placeholder={zh ? '例如：下次先给结论，技术细节放到最后。' : 'For example: lead with the conclusion and put technical detail last.'} /></label><Button className="mt-2" disabled={busy || !refinement.trim()} onClick={() => void act('refine', { instruction: refinement })}>{zh ? '用于这个场景' : 'Use for this scene'}</Button></details></section>}
    {detail && actionable && <details className="mt-4 text-sm"><summary className="cursor-pointer text-fg-muted">{zh ? '调整或收起' : 'Adjust or dismiss'}</summary><div className="mt-3 flex flex-wrap gap-2"><Button disabled={busy || staleDraft} onClick={() => void act('handled')}>{zh ? '我已处理' : 'Already handled'}</Button><Button disabled={busy || staleDraft} onClick={() => void act('resolve')}>{zh ? '这条不用' : 'Dismiss'}</Button><Button disabled={busy || staleDraft} onClick={() => void act('snooze')}>{copy.snooze}</Button><Link className="p-2 text-accent" to={card.communication ? `/assistant-work?follow-up=${encodeURIComponent(card.communication.id)}` : `/assistant-work?delegation=${encodeURIComponent(card.subscriptionId)}`}>{zh ? '修改关注要求' : 'Adjust instructions'}</Link></div></details>}
    {!actionable && <p className="mt-3 text-xs text-fg-muted">{card.status === 'resolved' ? (zh ? '已收起；事项进度以实际结果为准。' : 'Dismissed; work progress is tracked separately.') : card.status === 'expired' ? (zh ? '资料已变化或有效期已过，旧成果仅供参考。' : 'Sources changed or this work expired. Review current context before acting.') : cardStatusLabel(card.status, copy.locale)}</p>}
    {submitted === `${card.id}:${card.revision}` && <p role="status" className="mt-3 text-sm text-fg-muted">{zh ? '决定已提交，正在同步处理结果。' : 'Decision submitted. Updating the result.'}</p>}
    {staleDraft && submitted !== `${card.id}:${card.revision}` && <p role="alert" className="mt-3 text-sm text-warning">{zh ? '卡片已更新。请载入最新版本再决定；重新载入会替换未提交的编辑。' : 'This card changed. Load the latest version before deciding; this replaces unsaved edits.'}<Button variant="ghost" disabled={busy} onClick={() => { setDraftCardId(card.id); setDraftRevision(card.revision); setTaskDraft(card.taskDraft); setContent(card.artifact?.content ?? ''); setSubmitted(null); setError(''); }}>{zh ? '载入最新版本' : 'Load latest version'}</Button></p>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}<Button variant="ghost" onClick={refresh}>{zh ? '刷新最新内容' : 'Refresh latest version'}</Button></p>}
  </article>;
}
