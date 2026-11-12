import * as Popover from '@radix-ui/react-popover';
import { ArrowDownToLine, ArrowLeft, Archive, Ellipsis, File, FileImage, FileText, Film, Inbox, Music2, Presentation, Search, Sheet, Star, Trash2, X } from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { SpaceItem, SpaceList, SpaceOrigin } from '@xopcai/gateway-contract';

import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '@/features/chat/constants';
import { createComposerAttachmentHandoff } from '@/features/chat/composer/composer-attachment-handoff';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { useLocaleStore } from '@/stores/locale-store';

import { getSpaceDetail, getSpaceList, spaceContent, spaceItemPath, spacePath } from './space-api';
import { SpacePreview } from './space-preview';

const iconByKind = { document: FileText, pdf: FileText, spreadsheet: Sheet, presentation: Presentation, image: FileImage, video: Film, audio: Music2, archive: Archive };
const iconButton = 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';
const menuButton = 'block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-surface-hover';
const primaryButton = 'rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50';

function sourceHref(source?: SpaceOrigin): string | null {
  if (!source?.available) return null;
  if (source.kind === 'task' && source.taskId) return `/tasks/${encodeURIComponent(source.taskId)}`;
  if (source.kind === 'automation' && source.automationRunId) return `/automations?view=execution&run=${encodeURIComponent(source.automationRunId)}`;
  return `/chat/${encodeURIComponent(source.conversationId)}`;
}

function MarkedText({ text, query }: { text: string; query: string }) {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) return <>{text}</>;
  const end = index + query.length;
  return <>{index > 40 ? `…${text.slice(index - 40, index)}` : text.slice(0, index)}<mark className="rounded-sm bg-accent-soft text-accent-fg">{text.slice(index, end)}</mark>{text.slice(end, end + 100)}{end + 100 < text.length ? '…' : ''}</>;
}

export function SpacePage() {
  const language = useLocaleStore(state => state.language);
  const zh = language === 'zh';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedVersion = params.get('version');
  const [editing, setEditing] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [undo, setUndo] = useState<{ id: string; revision: number }>();
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const view = params.get('view') === 'favorites' ? 'favorites' : params.get('view') === 'trash' ? 'trash' : 'all';
  const q = (params.get('q') ?? '').slice(0, 160);
  const query = useDeferredValue(q);
  const selected = params.get('item');
  const kind = params.get('kind');
  const scope = params.get('taskId') ? 'taskId' : params.get('projectId') ? 'projectId' : undefined;
  const views = [
    { key: 'all', label: zh ? '全部成果' : 'All results', Icon: Inbox },
    { key: 'favorites', label: zh ? '收藏' : 'Favorites', Icon: Star },
    { key: 'trash', label: zh ? '回收站' : 'Trash', Icon: Trash2 },
  ];
  const types = [
    ['document', zh ? '文档' : 'Documents'], ['spreadsheet', zh ? '表格' : 'Spreadsheets'],
    ['presentation', zh ? '演示' : 'Slides'], ['image', zh ? '图片' : 'Images'],
    ['audio', zh ? '音频' : 'Audio'], ['video', zh ? '视频' : 'Video'],
    ['archive', zh ? '压缩包' : 'Archives'], ['file', zh ? '文件' : 'Files'],
  ];
  const title = views.find(option => option.key === view)?.label;
  const list = useSWRInfinite<SpaceList>((index, previous) => {
    if (index && !previous?.nextCursor) return null;
    const queryParams = new URLSearchParams({ view, q: query });
    if (kind) queryParams.set('kind', kind);
    if (scope) queryParams.set(scope, params.get(scope)!);
    if (index && previous?.nextCursor) queryParams.set('cursor', previous.nextCursor);
    return `${spacePath}?${queryParams}`;
  }, getSpaceList, { refreshInterval: 4_000 });
  const detail = useSWR(selected ? spaceItemPath(selected) : null, getSpaceDetail, { refreshInterval: 4_000 });
  const items = list.data?.flatMap(page => page.items) ?? [];
  const item = detail.data;
  const version = item?.versions.find(entry => entry.id === selectedVersion) ?? item?.currentVersion;
  const hit = version?.id === item?.currentVersion.id ? items.find(row => row.id === selected)?.hit : undefined;
  const origin = item?.origins.find(row => row.versionId === version?.id && row.available)
    ?? item?.origins.find(row => row.available) ?? item?.origin;
  const source = sourceHref(origin);

  function setQueryValues(values: Record<string, string | null>, replace = false) {
    setParams(current => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace });
  }

  function select(id: string | null) {
    setEditing(false);
    setConfirmPurge(false);
    setActionError('');
    setQueryValues({ item: id, version: null });
  }

  function close() {
    select(null);
    if (selected) requestAnimationFrame(() => rows.current.get(selected)?.focus());
  }

  useEffect(() => {
    if (!selected) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (editing || confirmPurge) {
        setEditing(false);
        setConfirmPurge(false);
        return;
      }
      setParams(current => {
        const next = new URLSearchParams(current);
        next.delete('item');
        next.delete('version');
        return next;
      });
      requestAnimationFrame(() => rows.current.get(selected)?.focus());
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [confirmPurge, editing, selected, setParams]);

  function onRowKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const next = items[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) rows.current.get(next.id)?.focus();
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try { await action(); }
    catch {
      setActionError(zh ? '操作未完成，请重试' : 'Could not complete the action. Try again.');
      void detail.mutate();
    } finally { setBusy(false); }
  }

  function mutateItem(action: 'patch' | 'trash' | 'restore' | 'purge', target: { id: string; revision: number }, patch?: { title?: string; favorite?: boolean }) {
    return run(async () => {
      const path = spaceItemPath(target.id);
      const suffix = action === 'restore' || action === 'purge' ? `/${action}` : '';
      await fetchJson(apiUrl(path + suffix), {
        method: action === 'patch' ? 'PATCH' : action === 'trash' ? 'DELETE' : 'POST',
        body: JSON.stringify({ revision: target.revision, ...patch }),
      });
      if (action === 'trash') setUndo({ id: target.id, revision: target.revision + 1 });
      if (action === 'restore' || action === 'purge') setUndo(undefined);
      if (action === 'patch') {
        setEditing(false);
        await detail.mutate();
      } else if (selected === target.id) {
        select(null);
      }
      await list.mutate();
    });
  }

  async function download() {
    if (!item || !version) return;
    await run(async () => {
      const blob = await spaceContent(item.id, version.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = version.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    });
  }

  function reuse() {
    if (!item || !version) return;
    void run(async () => {
      const blob = await spaceContent(item.id, version.id);
      if (blob.size > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) throw new Error('Attachment too large');
      const file = new globalThis.File([blob], version.fileName, { type: version.mimeType });
      const search = new URLSearchParams({ attachmentHandoff: createComposerAttachmentHandoff(file) });
      if (origin?.projectId && origin.available) search.set('projectId', origin.projectId);
      navigate({ pathname: '/chat/new', search: `?${search}` }, { state: { forceNewChat: true } });
    });
  }

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    const name = String(new FormData(event.currentTarget).get('title') ?? '').trim();
    if (name) void mutateItem('patch', item, { title: name });
  }

  const formatDate = (time: number) => new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' }).format(time);
  const sourceLabel = (row: SpaceItem) => row.origin?.label ?? (row.origin?.kind === 'task' ? (zh ? '任务' : 'Task')
    : row.origin?.kind === 'automation' ? (zh ? '定时任务' : 'Automation') : (zh ? '对话' : 'Chat'));

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-base">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Space" className={cn('flex shrink-0 items-center gap-1 border-b border-edge-subtle bg-surface-rail p-2 md:w-40 md:flex-col md:items-stretch md:border-b-0 md:p-3', selected && 'hidden md:flex')}>
          <span className="px-2 py-1 text-sm font-semibold md:mb-2">Space</span>
          {views.map(({ key, label, Icon }) => <button key={key} type="button" aria-pressed={view === key}
            onClick={() => { setUndo(undefined); setActionError(''); setQueryValues({ view: key === 'all' ? null : key, item: null, version: null, q: null, kind: null }); }}
            className={cn('flex items-center gap-2 rounded-lg px-2 py-2 text-start text-sm', key === 'trash' && 'md:mt-auto',
              view === key ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover')}>
            <Icon className="size-4 shrink-0" aria-hidden />{label}
          </button>)}
        </nav>
        <section className={cn('min-w-0 flex-1 flex-col overflow-y-auto px-4 py-5 md:px-5', selected ? 'hidden md:flex' : 'flex')} aria-label={title}>
          <h1 className="mb-4 text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          <div className="flex min-h-10 items-center gap-2 rounded-xl border border-edge-subtle bg-surface-inset px-3 focus-within:ring-2 focus-within:ring-accent">
            <Search className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <input value={q} maxLength={160} onChange={event => setQueryValues({ q: event.target.value }, true)}
              aria-label={zh ? '搜索成果' : 'Search results'} placeholder={zh ? '搜索成果' : 'Search results'}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-fg outline-none" />
            {q ? <button type="button" className={iconButton} onClick={() => setQueryValues({ q: null }, true)} aria-label={zh ? '清除搜索' : 'Clear search'}><X className="size-4" /></button> : null}
          </div>
          <div className="my-3 flex flex-wrap items-center gap-2">
            <Select value={kind ?? 'all'} onChange={event => setQueryValues({ kind: event.target.value === 'all' ? null : event.target.value })}>
              <SelectOption value="all">{zh ? '全部类型' : 'All types'}</SelectOption>
              {types.map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}
            </Select>
            {scope ? <button type="button" onClick={() => setQueryValues({ [scope]: null })}
              className="inline-flex items-center gap-1 rounded-lg bg-surface-inset px-2 py-1 text-sm text-fg-muted hover:bg-surface-hover">
              {scope === 'projectId' ? (zh ? '当前项目' : 'Project') : (zh ? '当前任务' : 'Task')}<X className="size-3.5" />
            </button> : null}
          </div>
          {list.isLoading ? <div className="space-y-2" aria-busy="true">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}</div> : null}
          {list.error ? <button className="rounded-lg py-3 text-sm text-accent-fg" onClick={() => void list.mutate()}>{zh ? '加载失败，重试' : 'Could not load. Retry'}</button> : null}
          {!list.isLoading && !list.error && items.length === 0 ? <p className="py-10 text-center text-sm text-fg-muted">
            {q ? (zh ? '没有匹配的成果' : 'No matching results') : view === 'favorites' ? (zh ? '暂无收藏' : 'No favorites') : view === 'trash' ? (zh ? '回收站为空' : 'Trash is empty') : (zh ? '暂无成果' : 'No results yet')}
          </p> : null}
          <ul className="space-y-0.5">
            {items.map((row, index) => {
              const Icon = iconByKind[row.kind as keyof typeof iconByKind] ?? File;
              return <li key={row.id}>
                <button type="button" ref={button => { if (button) rows.current.set(row.id, button); else rows.current.delete(row.id); }}
                  onKeyDown={event => onRowKey(event, index)} aria-pressed={selected === row.id} onClick={() => select(row.id)}
                  className={cn('flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                    selected === row.id ? 'bg-accent-soft' : 'hover:bg-surface-hover')}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-inset text-accent-fg"><Icon className="size-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg"><MarkedText text={row.title} query={query.trim()} /></span>
                    <span className="block truncate text-xs text-fg-muted">{row.currentVersion.fileName.split('.').at(-1)?.toUpperCase()} · {sourceLabel(row)}</span>
                    {row.hit ? <span className="block truncate text-xs text-fg-muted"><MarkedText text={row.hit.text} query={query.trim()} /></span> : null}
                  </span>
                  <span className="hidden shrink-0 text-xs text-fg-subtle lg:block">{formatDate(row.updatedAt)}</span>
                </button>
              </li>;
            })}
          </ul>
          {list.data?.at(-1)?.nextCursor ? <button className="mt-3 rounded-lg py-2 text-sm text-accent-fg" onClick={() => void list.setSize(list.size + 1)}>
            {zh ? '加载更多' : 'Load more'}
          </button> : null}
        </section>
        {selected ? <section aria-label={zh ? '成果预览' : 'Result preview'} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-surface-inset px-4 py-4 md:max-w-[48%] md:border-l md:border-edge-subtle">
          <header className="flex items-center gap-1">
            <button type="button" className={cn(iconButton, 'md:hidden')} onClick={close} aria-label={zh ? '返回' : 'Back'}><ArrowLeft className="size-4" /></button>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{item?.title ?? (zh ? '预览' : 'Preview')}</h2>
            {item && !item.trashedAt ? <>
              <button type="button" className={cn(iconButton, item.favorite && 'text-accent-fg')} aria-pressed={item.favorite}
                aria-label={zh ? '收藏' : 'Favorite'} disabled={busy} onClick={() => void mutateItem('patch', item, { favorite: !item.favorite })}><Star className={cn('size-4', item.favorite && 'fill-current')} /></button>
              <button type="button" className={iconButton} disabled={busy} aria-label={zh ? '下载' : 'Download'} onClick={() => void download()}><ArrowDownToLine className="size-4" /></button>
              <Popover.Root>
                <Popover.Trigger className={iconButton} aria-label={zh ? '更多操作' : 'More actions'}><Ellipsis className="size-4" /></Popover.Trigger>
                <Popover.Portal><Popover.Content align="end" sideOffset={5} className="z-50 min-w-36 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover">
                  <Popover.Close className={menuButton} onClick={() => setEditing(true)}>{zh ? '重命名' : 'Rename'}</Popover.Close>
                  <Popover.Close className={cn(menuButton, 'text-red-600 dark:text-red-400')} disabled={busy} onClick={() => void mutateItem('trash', item)}>{zh ? '移到回收站' : 'Move to Trash'}</Popover.Close>
                </Popover.Content></Popover.Portal>
              </Popover.Root>
            </> : null}
            <button type="button" className={cn(iconButton, 'hidden md:inline-flex')} onClick={close} aria-label={zh ? '关闭预览' : 'Close preview'}><X className="size-4" /></button>
          </header>
          {editing && item ? <form className="flex flex-wrap items-center gap-2" onSubmit={rename}>
            <input name="title" defaultValue={item.title} required maxLength={240} autoFocus aria-label={zh ? '成果名称' : 'Result name'}
              className="min-w-24 flex-1 rounded-lg border border-edge bg-surface-panel px-2 py-2 text-sm" />
            <button className={primaryButton} disabled={busy}>{zh ? '保存' : 'Save'}</button>
            <button type="button" className="rounded-lg p-2 text-sm hover:bg-surface-hover" onClick={() => setEditing(false)}>{zh ? '取消' : 'Cancel'}</button>
          </form> : null}
          {detail.isLoading ? <Skeleton className="min-h-64 flex-1 rounded-xl" /> : null}
          {detail.error ? <p className="py-5 text-sm text-fg-muted">{zh ? '成果暂不可用' : 'Result unavailable'}</p> : null}
          {item && version ? <>
            <SpacePreview key={version.id} itemId={item.id} version={version} hit={hit} download={download} />
            {hit ? <p className="line-clamp-2 text-xs text-fg-muted"><MarkedText text={hit.text} query={query.trim()} /></p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
              <span>{origin ? sourceLabel(item) : null}</span>
              {version.indexStatus === 'pending' ? <span>{zh ? '正在索引' : 'Indexing'}</span> : null}
              {item.versions.length > 1 ? <Select value={version.id} onChange={event => setQueryValues({ version: event.target.value })}>
                {item.versions.map((entry, index) => <SelectOption key={entry.id} value={entry.id}>
                  {entry.id === item.currentVersion.id ? (zh ? '最新版' : 'Latest') : formatDate(entry.createdAt)} · v{item.versions.length - index}
                </SelectOption>)}
              </Select> : null}
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-2">
              {item.trashedAt ? <>
                <button type="button" className={primaryButton} disabled={busy} onClick={() => void mutateItem('restore', item)}>{zh ? '恢复' : 'Restore'}</button>
                <button type="button" className="rounded-lg px-2 py-2 text-sm text-red-600 hover:bg-surface-hover dark:text-red-400" onClick={() => setConfirmPurge(true)}>
                  {zh ? '永久删除' : 'Delete permanently'}
                </button>
              </> : <>
                {source ? <Link className="rounded-lg px-2 py-2 text-sm text-fg-muted hover:bg-surface-hover" to={source}>{zh ? '查看来源' : 'Open source'}</Link> : <span />}
                <button type="button" className={primaryButton} disabled={busy || version.sizeBytes > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES} title={version.sizeBytes > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES ? (zh ? '超过对话附件大小上限' : 'Exceeds the chat attachment size limit') : undefined} onClick={reuse}>{zh ? '在对话中使用' : 'Use in chat'}</button>
              </>}
            </footer>
            {confirmPurge ? <div role="alert" className="rounded-xl border border-edge bg-surface-panel p-3 text-sm">
              <p>{zh ? `永久删除「${item.title}」？` : `Delete “${item.title}” permanently?`}</p>
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" className={menuButton} onClick={() => setConfirmPurge(false)}>{zh ? '取消' : 'Cancel'}</button>
                <button type="button" className={cn(menuButton, 'text-red-600 dark:text-red-400')} disabled={busy} onClick={() => void mutateItem('purge', item)}>{zh ? '删除' : 'Delete'}</button>
              </div>
            </div> : null}
          </> : null}
        </section> : null}
      </div>
      {actionError || undo ? <div className="flex items-center justify-between gap-2 border-t border-edge-subtle bg-surface-panel px-4 py-2 text-sm" role="status">
        <span>{actionError || (zh ? '已移到回收站' : 'Moved to Trash')}</span>
        {undo ? <button type="button" disabled={busy} className="rounded-lg p-1 text-accent-fg" onClick={() => void mutateItem('restore', undo)}>{zh ? '撤销' : 'Undo'}</button> : null}
      </div> : null}
    </div>
  );
}
