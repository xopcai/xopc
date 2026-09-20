import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { sceneErrorText, sceneGet, sceneWrite, type SceneOutcome } from './api';

type Feedback = { rating: 'useful' | 'not_useful'; note: string; revision: number };

export function OutcomeCard({ item, zh, onChange }: { item: SceneOutcome; zh: boolean; onChange: () => void }) {
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
  return <article className="space-y-3 rounded-xl border border-edge bg-surface-panel p-4 sm:p-6">
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{item.content.summary}</p>
    <p className="break-all text-xs text-fg-muted">{zh ? '引用来源' : 'Evidence'}: {item.content.evidenceIds.join(', ')}</p>
    {item.readOnly ? <p className="text-sm text-fg-muted">{zh ? '这份成果已结束、过期或延后，仅供查阅。' : 'This result is resolved, expired or snoozed, and is available for reference.'}</p> : <>{feedback.error ? <p role="alert" className="text-sm text-danger">{sceneErrorText(feedback.error, zh)}<Button onClick={() => void feedback.mutate()}>{zh ? '重新加载' : 'Reload'}</Button></p>
      : !feedback.data ? <Skeleton className="h-11 w-48" /> : <div className="flex flex-wrap gap-2">{(['useful', 'not_useful'] as const).map((rating) => <Button key={rating} disabled={busy} aria-pressed={feedback.data?.feedback?.rating === rating} onClick={() => void rate(rating)}>{rating === 'useful' ? (zh ? '对我有帮助' : 'Helpful') : (zh ? '没有帮助' : 'Not helpful')}</Button>)}</div>}
    <Button disabled={busy} variant="ghost" onClick={() => void read()}>{item.status === 'read' ? (zh ? '标为未读' : 'Mark unread') : (zh ? '标为已读' : 'Mark read')}</Button></>}
    {Boolean(error) && <p role="alert" className="text-sm text-danger">{sceneErrorText(error, zh)}</p>}
  </article>;
}
