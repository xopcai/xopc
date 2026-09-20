import { useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { sceneErrorText, sceneGet, sceneWrite, type SceneOutcome } from './api';

type Feedback = { rating: 'useful' | 'not_useful'; note: string; revision: number };

export function OutcomeCard({ item, zh, onChange }: { item: SceneOutcome; zh: boolean; onChange: () => void }) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    const clientId = crypto.randomUUID();
    let inView = false;
    const report = () => {
      void sceneWrite('/presence', 'POST', { clientId, surface: 'web', presentationId: item.id,
        visible: inView && document.visibilityState === 'visible' && document.hasFocus() }).catch(() => undefined);
    };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; report(); }, { threshold: 0.5 });
    if (card.current) observer.observe(card.current);
    const timer = setInterval(report, 20_000);
    document.addEventListener('visibilitychange', report); window.addEventListener('focus', report); window.addEventListener('blur', report);
    return () => { observer.disconnect(); clearInterval(timer); document.removeEventListener('visibilitychange', report);
      window.removeEventListener('focus', report); window.removeEventListener('blur', report); inView = false; report(); };
  }, [item.id]);
  const [copied, setCopied] = useState(false);
  const path = `/presentations/${encodeURIComponent(item.id)}`;
  const feedback = useSWR<{ feedback: Feedback | null }>(item.readOnly ? null : `${path}/feedback`, sceneGet);
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const rate = async (rating: Feedback['rating']) => {
    if (!feedback.data) return;
    setBusy(true); setError(undefined);
    try {
      const note = feedback.data.feedback?.note ?? '';
      const result = await sceneWrite<{ revision: number }>(`${path}/feedback`, 'POST', { expectedRevision: feedback.data.feedback?.revision ?? 0, rating });
      await feedback.mutate({ feedback: { rating, note, revision: result.revision } }, { revalidate: false });
      void mutate('/metrics');
    } catch (reason) { setError(reason); void feedback.mutate(); }
    finally { setBusy(false); }
  };
  const read = async () => {
    setBusy(true); setError(undefined);
    try { await sceneWrite(path, 'PATCH', { read: item.status !== 'read' }); onChange(); }
    catch (reason) { setError(reason); }
    finally { setBusy(false); }
  };
  return <article ref={card} className="space-y-3 rounded-xl border border-edge bg-surface-panel p-4 sm:p-6">
    {item.createdAt != null && <p className="text-xs text-fg-muted">{zh ? '生成于' : 'Generated'} {new Date(item.createdAt).toLocaleString(zh ? 'zh-CN' : 'en')}</p>}
    {item.sourceHealth?.reason && <p role="status" className="text-sm text-fg-muted">{zh ? '邮件来源暂不可用，这份成果尚未核实最新邮件，请检查连接器授权后重试。' : 'Mail is unavailable. This result has not been checked against the latest messages. Check connector access and retry.'}</p>}
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{item.content.summary}</p>
    <Button variant="ghost" onClick={() => { void navigator.clipboard.writeText(item.content.summary).then(() => setCopied(true)).catch(setError); }}>{copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制成果' : 'Copy result')}</Button>
    <div className="space-y-1 text-xs text-fg-muted">{item.sources?.length ? item.sources.map(source => <p key={source.href}><a className="text-accent underline" href={source.href} target={source.kind === 'mail' ? '_blank' : undefined} rel="noreferrer">{source.kind === 'notes' ? (zh ? '查看场景资料' : 'View scene notes') : source.title || (zh ? '查看原邮件' : 'View original email')}</a>{source.sender && ` · ${source.sender}`}</p>) : <p>{zh ? '来源详情暂不可用' : 'Source details unavailable'}</p>}</div>
    {item.readOnly ? <p className="text-sm text-fg-muted">{zh ? '这份成果已结束、过期或延后，仅供查阅。' : 'This result is resolved, expired or snoozed, and is available for reference.'}</p> : <>{feedback.error ? <p role="alert" className="text-sm text-danger">{sceneErrorText(feedback.error, zh)}<Button onClick={() => void feedback.mutate()}>{zh ? '重新加载' : 'Reload'}</Button></p>
      : !feedback.data ? <Skeleton className="h-11 w-48" /> : <div className="flex flex-wrap gap-2">{(['useful', 'not_useful'] as const).map((rating) => <Button key={rating} disabled={busy} aria-pressed={feedback.data?.feedback?.rating === rating} onClick={() => void rate(rating)}>{rating === 'useful' ? (zh ? '对我有帮助' : 'Helpful') : (zh ? '没有帮助' : 'Not helpful')}</Button>)}</div>}
    <Button disabled={busy} variant="ghost" onClick={() => void read()}>{item.status === 'read' ? (zh ? '标为未读' : 'Mark unread') : (zh ? '标为已读' : 'Mark read')}</Button></>}
    {Boolean(error) && <p role="alert" className="text-sm text-danger">{sceneErrorText(error, zh)}</p>}
  </article>;
}
