import type { ProactiveCard, ProactiveCardAction } from '@xopcai/gateway-contract';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { CardWorkflow } from './card-workflow';
import { proactiveWrite } from './api';
import { runLabel, type ProactiveCopy } from './copy';

export function ProactiveCardView({ card, copy, refresh, detail = false }: { card: ProactiveCard; copy: ProactiveCopy; refresh: () => void; detail?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actionable = card.status !== 'withdrawn' && card.status !== 'expired' && card.status !== 'resolved';
  async function act(actionId: ProactiveCardAction['actionId'], choice?: string) {
    setBusy(true); setError('');
    try {
      await proactiveWrite(`/api/inbox/judgments/${encodeURIComponent(card.id)}/actions`, 'POST', { actionId, choice, expectedRevision: card.revision, idempotencyKey: crypto.randomUUID() });
      refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); refresh(); }
    finally { setBusy(false); }
  }
  return <article className="rounded-2xl border border-edge bg-surface-panel p-5">
    <div className="mb-3 flex items-center justify-between gap-3 text-xs text-fg-muted"><span>{copy.kinds[card.kind] ?? card.kind}</span><time dateTime={card.updatedAt}>{new Date(card.updatedAt).toLocaleString()}</time></div>
    <h2 className="text-base font-semibold text-fg"><Link to={`/proactive?item=${encodeURIComponent(card.id)}`}>{card.title}</Link></h2>
    <p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">{card.summary}</p>
    <div className="mt-4 border-l-2 border-edge pl-3 text-sm"><span className="font-medium text-fg">{copy.whyNow}</span><p className="mt-1 text-fg-muted">{card.whyNow}</p></div>
    {detail && <><p className="mt-4 text-sm font-medium">{copy.recommendation}</p><p className="mt-1 text-sm text-fg-muted">{card.recommendation}</p><p className="mt-4 text-sm font-medium">{copy.investigated}</p><p className="mt-1 text-sm text-fg-muted">{card.workDone}</p></>}
    {card.decision && actionable && <div className="mt-4"><p className="text-sm font-medium">{card.decision.question}</p><div className="mt-2 flex flex-wrap gap-2">{card.decision.options.map((option) => <Button key={option.id} disabled={busy || !actionable} title={option.consequence} onClick={() => void act('decide', option.id)}>{option.label}</Button>)}</div></div>}
    {card.actionStatus && <p className="mt-3 text-sm text-fg-muted">{copy.result}: {runLabel(card.actionStatus, copy.locale)}</p>}
    {typeof card.actionResult?.taskId === 'string' && <Link className="mt-2 block text-sm text-accent" to={`/tasks/${encodeURIComponent(card.actionResult.taskId)}`}>{copy.result}</Link>}
    {card.status === 'withdrawn' && <p className="mt-3 text-sm text-fg-muted">{copy.locale === 'zh' ? '来源已撤回，此卡片不再展示内容或允许操作。' : 'The source was withdrawn. Content and actions are no longer available.'}</p>}
    {card.actionStatus === 'failed' && card.status !== 'withdrawn' && card.status !== 'expired' && <Button disabled={busy} onClick={() => void act('retry')}>{copy.retry}</Button>}
    {card.actionError && <p className="mt-2 text-sm text-danger">{card.actionError}</p>}
    <details className="mt-4 text-xs text-fg-muted"><summary className="cursor-pointer">{copy.evidence} · {card.evidence.length}</summary><ul className="mt-2 space-y-1">{card.evidence.map((item) => <li key={item.id}>{item.route ? <Link className="text-accent" to={item.route}>{item.label}</Link> : item.label}{item.excerpt && <p className="mt-1 whitespace-pre-wrap">{item.excerpt}</p>}</li>)}</ul></details>
    {card.status === 'withdrawn' ? null : card.status === 'expired' ? <p className="mt-4 text-sm text-fg-muted">{copy.expired}</p> : card.status === 'resolved' ? <p className="mt-4 text-sm text-fg-muted">{copy.resolved}</p> : <div className="mt-4 flex flex-wrap gap-2">
      {card.status === 'unread' && <Button disabled={busy} onClick={() => void act('read')}>{copy.read}</Button>}
      <Button disabled={busy} onClick={() => void act('resolve')}>{copy.resolve}</Button><Button disabled={busy} onClick={() => void act('snooze')}>{copy.snooze}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => void act('less')}>{copy.less}</Button><Button variant="ghost" disabled={busy} onClick={() => void act('pause')}>{copy.pauseTemplate}</Button>
    </div>}
    {card.status !== 'withdrawn' && card.status !== 'expired' && <div className="mt-3 flex gap-2"><Button variant="ghost" disabled={busy} onClick={() => void act('useful')}>{copy.locale === 'zh' ? '有帮助' : 'Useful'}</Button><Button variant="ghost" disabled={busy} onClick={() => void act('not_useful')}>{copy.locale === 'zh' ? '不相关' : 'Not useful'}</Button></div>}
    {Boolean(card.relatedCardIds?.length) && <details className="mt-3 text-xs text-fg-muted"><summary>{copy.locale === 'zh' ? '相关发现' : 'Related findings'} · {card.relatedCardIds!.length}</summary>{card.relatedCardIds!.map((id) => <Link key={id} className="mt-2 block text-accent" to={`/proactive?item=${encodeURIComponent(id)}`}>{copy.locale === 'zh' ? '查看相关卡片' : 'View related card'}</Link>)}</details>}
    {detail && card.preparationAvailable && card.status !== 'withdrawn' && card.status !== 'expired' && <CardWorkflow card={card} zh={copy.locale === 'zh'} />}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </article>;
}
