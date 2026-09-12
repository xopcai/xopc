import type { ProactiveCard } from '@xopcai/gateway-contract';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { proactiveGet, proactiveWrite } from './api';
import { runLabel } from './copy';

export function CardWorkflow({ card, zh }: { card: ProactiveCard; zh: boolean }) {
  const endpoint = `/api/inbox/judgments/${encodeURIComponent(card.id)}`;
  const state = useSWR<{ workflow: { status: string; sessionKey?: string; error?: string } | null }>(`${endpoint}/workflow`, proactiveGet, { refreshInterval: 10000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function prepare(retry = false) {
    setBusy(true); setError('');
    try { await proactiveWrite(`${endpoint}/prepare`, 'POST', { expectedRevision: card.revision, retry }); await state.mutate(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  if (state.isLoading) return <Skeleton className="mt-4 h-14" />;
  const run = state.data?.workflow;
  return <div className="mt-4 space-y-2 border-t border-edge pt-4 text-sm">{!run ? <Button disabled={busy} onClick={() => void prepare()}>{zh ? '运行准备清单工作流' : 'Run preparation workflow'}</Button> : <><p>{zh ? '准备清单' : 'Preparation'} · {runLabel(run.status, zh ? 'zh' : 'en')}</p>{run.sessionKey && <Link className="text-accent" to={`/chat/${encodeURIComponent(run.sessionKey)}`}>{zh ? '打开工作流与产物' : 'Open workflow and artifacts'}</Link>}{['failed', 'cancelled', 'interrupted'].includes(run.status) && <Button className="ml-2" disabled={busy} onClick={() => void prepare(true)}>{zh ? '重试工作流' : 'Retry workflow'}</Button>}{run.error && <p className="text-danger">{run.error}</p>}</>}{(error || state.error) && <p role="alert" className="text-danger">{error || String(state.error)}</p>}</div>;
}
