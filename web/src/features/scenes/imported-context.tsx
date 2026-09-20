import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { sceneErrorText, sceneGet, type SceneImportedContext } from './api';

export function ImportedSceneContext({ activationId, zh }: { activationId: string; zh: boolean }) {
  const [beforeRevision, setBeforeRevision] = useState<number | null>(null);
  const context = useSWR<SceneImportedContext>(`/activations/${encodeURIComponent(activationId)}/imported-context?limit=10${beforeRevision === null ? '' : `&beforeRevision=${beforeRevision}`}`, sceneGet);
  if (context.error) return <div role="alert" className="space-y-2"><p className="text-sm text-fg-muted">{sceneErrorText(context.error, zh)}</p>
    <Button onClick={() => void context.mutate()}>{zh ? '重新加载历史资料' : 'Reload historical context'}</Button></div>;
  if (!context.data) return <div aria-busy="true" aria-label={zh ? '历史资料' : 'Historical context'} className="space-y-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-24 w-full" /></div>;
  const { checklist, instructions, nextRevision } = context.data;
  return <section className="space-y-4 rounded-xl border border-edge p-4 sm:p-6">
    <h2 className="text-base font-semibold text-fg">{zh ? '保留的私人说明' : 'Preserved private instructions'}</h2>
    <p className="text-sm text-fg-muted">{zh ? '这些是之前提供的资料，供你查看和重新设置时参考。它们不会触发检查或发送消息。' : 'Review your previous context when setting up a new scene. These records do not trigger checks or send messages.'}</p>
    {checklist?.prompt && <div className="space-y-2"><h3 className="text-sm font-medium text-fg">{zh ? '原巡查要求' : 'Previous check instructions'}</h3>
      <p className="whitespace-pre-wrap break-words text-sm text-fg-muted">{checklist.prompt}</p></div>}
    {checklist?.content !== null && checklist?.content !== undefined && <div className="space-y-2"><h3 className="text-sm font-medium text-fg">{zh ? '原巡查清单' : 'Previous checklist'}</h3>
      <p className="whitespace-pre-wrap break-words text-sm text-fg-muted">{checklist.content || (zh ? '原清单为空。' : 'The checklist was empty.')}</p></div>}
    {instructions.map((instruction) => <details key={instruction.id} className="rounded-lg border border-edge p-3" open={instruction.wasActive}>
      <summary className="cursor-pointer text-sm font-medium text-fg">{zh ? `第 ${instruction.revision} 版说明` : `Instructions, revision ${instruction.revision}`}
        {instruction.wasActive ? (zh ? ' · 当时使用' : ' · Previously in use') : instruction.status === 'draft' ? (zh ? ' · 草稿' : ' · Draft') : ''}</summary>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-fg-muted">{instruction.content}</p>
    </details>)}
    {!checklist && !instructions.length && <p className="text-sm text-fg-muted">{zh ? '没有保留的私人说明。仍可查看下方的成果和检查记录。' : 'No private instructions were saved. Results and check history are available below.'}</p>}
    <div className="flex flex-wrap gap-3">{beforeRevision !== null && <Button onClick={() => setBeforeRevision(null)}>{zh ? '最近说明' : 'Latest instructions'}</Button>}
      {nextRevision !== null && <Button onClick={() => setBeforeRevision(nextRevision)}>{zh ? '更早说明' : 'Earlier instructions'}</Button>}</div>
  </section>;
}
