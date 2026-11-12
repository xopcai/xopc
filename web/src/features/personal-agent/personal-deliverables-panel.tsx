import { useCallback } from 'react';
import type { PersonalDeliverable, PersonalDeliverablesPage } from '@xopcai/gateway-contract';
import { FileText, Globe } from 'lucide-react';
import { Link } from 'react-router-dom';
import useSWRInfinite from 'swr/infinite';

import { Skeleton } from '@/components/ui/skeleton';
import { DeliverablePreview } from '@/features/tasks/deliverable-preview';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { preloadTaskDetailPage } from '@/lib/route-preload';
import { FileIcon } from '@/features/file-tree/file-icon';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { usePersonalListPagination, useRefreshPersonalWork } from './use-personal-work';

const previewClass = 'flex min-w-0 flex-1 items-start gap-3 rounded-xl p-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent';

function DeliverableRow({ item, scope, zh, sourceHref, onSource }: {
  item: PersonalDeliverable; scope: string; zh: boolean; sourceHref: string; onSource?: () => void;
}) {
  const { artifact, reference, task } = item;
  const title = artifact?.title ?? reference?.title ?? item.id;
  const site = artifact?.kind === 'site' || artifact?.mimeType === 'text/html' || reference?.kind === 'local_app' || reference?.kind === 'chat_preview';
  const kind = site ? (zh ? '网页' : 'Web page')
    : artifact?.kind === 'document' || reference?.kind === 'note' ? (zh ? '文档' : 'Document')
      : (title.match(/\.([a-z0-9]{1,8})$/i)?.[1].toUpperCase() ?? (zh ? '文件' : 'File'));
  const body = <>
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-inset text-fg-muted" aria-hidden>
      {site ? <Globe className="size-4" /> : <FileIcon name={title} />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold text-fg" title={title}>{title}</span>
      <span className="mt-1 block truncate text-xs text-fg-muted">{kind} · {task?.title ?? (zh ? '对话' : 'Conversation')}</span>
      <time className="mt-0.5 block text-xs text-fg-subtle" dateTime={new Date(item.createdAt).toISOString()}>{formatMediumDateTime(item.createdAt, zh ? 'zh' : 'en')}</time>
    </span>
  </>;
  return <li className="flex min-w-0 items-start gap-1">
    <DeliverablePreview item={item} workspaceScope={scope} conversationId={task?.conversationId ?? scope}
      backgroundPath={sourceHref} zh={zh} className={previewClass}>{body}</DeliverablePreview>
    <Link to={task ? taskDetailModalHref(sourceHref, task.id) : sourceHref}
      state={task ? { focusTaskResults: task.id, taskPreview: { id: task.id, title: task.title } } : { personalSourceTurnId: item.turnId }}
      onPointerEnter={task ? preloadTaskDetailPage : undefined} onFocus={task ? preloadTaskDetailPage : undefined} onClick={onSource}
      aria-label={zh ? `回到来源 · ${title}` : `Go to source · ${title}`}
      className="mt-1 shrink-0 rounded-lg px-2 py-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      {zh ? '回到来源' : 'Go to source'}
    </Link>
  </li>;
}

export function PersonalDeliverablesPanel({ scope, zh, enabled, active, id, labelledBy, sourceHref, onSource }: {
  scope: string; zh: boolean; enabled: boolean; active: boolean; id: string; labelledBy: string; sourceHref: string; onSource?: () => void;
}) {
  const identity = useGatewayStore(state => state.conversationId);
  const { data, error, isValidating, setSize, size, mutate } = useSWRInfinite(
    (index, previous: PersonalDeliverablesPage | null) => {
      const offset = index === 0 ? 0 : previous?.nextOffset;
      return enabled && offset != null ? [scope, identity, offset] as const : null;
    },
    async ([, , offset]) => (await fetchJson<{ payload: PersonalDeliverablesPage }>(
      apiUrl(`/api/personal-agent/activity?view=deliverables&limit=15&offset=${offset}`),
    )).payload,
    { shouldRetryOnError: false },
  );
  const loadMore = useCallback(() => { void setSize(size + 1); }, [setSize, size]);
  const hasMore = data?.at(-1)?.nextOffset != null;
  const { listRef, loadMoreRef } = usePersonalListPagination(active && hasMore && !isValidating && !error, loadMore);
  useRefreshPersonalWork(enabled ? scope : undefined, mutate);
  const seen = new Set<string>();
  const items = (data ?? []).flatMap(page => page.items).filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return <div ref={listRef} hidden={!active} role="tabpanel" id={id} aria-labelledby={labelledBy}
    className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3 [scrollbar-gutter:stable] sm:px-6">
    <ul className="space-y-2">
      {items.map(item => <DeliverableRow key={item.id}
        item={item} scope={scope} zh={zh} sourceHref={sourceHref} onSource={onSource} />)}
    </ul>
    {isValidating && (!data || size > data.length) ? <div className="space-y-2" aria-busy="true">
      {(data ? [0] : [0, 1, 2]).map(key => <Skeleton key={key} className="h-16 rounded-xl" />)}
    </div> : null}
    {error ? <button type="button" className="min-h-9 px-2 text-sm text-accent-fg underline" onClick={() => void mutate()}>
      {zh ? '加载失败，重试' : 'Loading failed. Try again'}
    </button> : null}
    {data && !items.length && !error ? <div className="px-2 py-8 text-center text-sm text-fg-muted">
      <FileText className="mx-auto mb-3 size-5" aria-hidden />
      {zh ? '对话和任务生成的文件、网页和文档会出现在这里。' : 'Files, web pages, and documents created in conversations and tasks will appear here.'}
    </div> : null}
    {hasMore ? <div ref={loadMoreRef} className="h-px" aria-hidden /> : null}
  </div>;
}
