import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { proactiveGet, proactiveWrite } from './api';
import { runLabel } from './copy';

export function WorkflowChoice({ value, onChange, zh }: { value: string; onChange: (value: string) => void; zh: boolean }) {
  const { data, isLoading, error } = useSWR<{ definitions: Array<{ id: string; title: string; name: string }> }>('/api/workflows/definitions', proactiveGet);
  return <label className="block text-sm">{zh ? '准备材料工作流（点击卡片后才运行）' : 'Preparation workflow (runs only when clicked)'}{isLoading ? <Skeleton className="mt-2 h-9" /> : <Select value={value} onChange={(event) => onChange(event.target.value)}><SelectOption value="">{zh ? '不关联工作流' : 'No workflow'}</SelectOption>{data?.definitions.map((workflow) => <SelectOption key={workflow.id} value={workflow.id}>{workflow.title || workflow.name}</SelectOption>)}</Select>}{error && <span className="text-danger">{String(error)}</span>}</label>;
}
export function SubscriptionPreview({ subscriptionId, zh }: { subscriptionId: string; zh: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ result: { result: string; reason?: string; candidate?: { title: string; summary: string; whyNow: string } }; sourceCount: number }>();
  const [error, setError] = useState('');
  async function preview() {
    setBusy(true); setError('');
    try { setResult(await proactiveWrite(`/api/proactive/subscriptions/${encodeURIComponent(subscriptionId)}/preview`, 'POST', {})); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2"><Button disabled={busy} onClick={() => void preview()}>{zh ? '只读预览已保存配置' : 'Preview saved settings'}</Button><p className="text-xs text-fg-muted">{zh ? '预览可能调用模型；不生成正式卡片或执行动作。每 5 分钟一次，每日最多 5 次。' : 'May call the model. Does not create live cards or run actions. Limited to once per five minutes, five times daily.'}</p>{busy && <Skeleton className="h-24" />}{error && <p role="alert" className="text-sm text-danger">{error}</p>}{result && <div className="rounded-lg border border-edge p-3 text-sm"><p className="mb-2 text-xs text-fg-muted">{zh ? '预览结果' : 'Preview result'} · {result.sourceCount} {zh ? '项依据' : 'evidence items'}</p>{result.result.candidate ? <><strong>{result.result.candidate.title}</strong><p>{result.result.candidate.summary}</p><p className="mt-2 text-fg-muted">{result.result.candidate.whyNow}</p></> : <p>{runLabel(result.result.reason ?? 'no_insight', zh ? 'zh' : 'en')}</p>}</div>}</div>;
}
