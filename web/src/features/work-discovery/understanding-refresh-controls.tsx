import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';
import { useUnderstandingRefreshStore } from './understanding-refresh-store';

export function UnderstandingRefreshButton({ sourceId, disabled = false }: { sourceId?: string; disabled?: boolean }) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const { sources, starting, start } = useUnderstandingRefreshStore();
  const runs = sourceId ? sources.filter((run) => run.grantId === sourceId) : sources;
  const running = runs.some((run) => run.status === 'queued' || run.status === 'running');
  const failed = sourceId && runs.some((run) => run.status === 'failed' || run.status === 'partial' || run.status === 'canceled');
  const label = running ? (zh ? '更新中' : 'Updating')
    : failed ? (zh ? '重试' : 'Retry')
      : sourceId ? (zh ? '更新理解' : 'Update understanding') : (zh ? '更新全部' : 'Update all');
  return <Button variant="ghost" className="h-8 shrink-0 gap-1.5 px-2 text-xs" disabled={disabled || starting || running}
    onClick={() => void start(sourceId)}>
    {running ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="size-3.5" />}
    {label}
  </Button>;
}

export function UnderstandingRefreshProgress({ sourceId, lastCollectedAt }: { sourceId: string; lastCollectedAt?: number }) {
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const run = useUnderstandingRefreshStore((state) => state.sources.find((item) => item.grantId === sourceId));
  if (!run) return <p className="mt-1 text-xs text-fg-subtle">{lastCollectedAt
    ? `${zh ? '上次更新：' : 'Last updated: '}${new Date(lastCollectedAt).toLocaleString(language)}`
    : zh ? '尚未分析' : 'Not analyzed yet'}</p>;
  const phases: Record<string, string> = zh
    ? { queued: '等待更新', waiting_desktop: '等待桌面端读取资料', reading: '正在读取资料', analyzing: '正在更新理解' }
    : { queued: 'Queued', waiting_desktop: 'Waiting for desktop collection', reading: 'Reading source', analyzing: 'Updating understanding' };
  const running = run.status === 'running' || run.status === 'queued';
  const failed = run.status === 'failed' || run.status === 'partial' || run.status === 'canceled';
  const added = run.metadata.added;
  const message = running ? phases[run.metadata.phase ?? 'queued'] ?? phases.queued
    : failed ? (zh ? '更新未完成，可重试' : 'Update incomplete; retry available')
      : added === 0 ? (zh ? '更新完成，暂无新增理解' : 'Updated; no new understanding')
        : added !== undefined ? (zh ? `更新完成，新增 ${added} 条` : `Updated; ${added} added`)
          : (zh ? '更新完成' : 'Updated');
  return <div className="mt-1 text-xs leading-5 text-fg-subtle" aria-live="polite">
    <p>{message}</p>
    {run.completedAt ? <p>{new Date(run.completedAt).toLocaleString(language)}</p> : null}
    {failed && run.errorMessage ? <p className="text-danger">{run.errorMessage}</p> : null}
  </div>;
}
