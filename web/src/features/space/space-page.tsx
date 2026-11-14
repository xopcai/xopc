import * as Popover from '@radix-ui/react-popover';
import { ArrowDownToLine, ArrowLeft, Archive, Ellipsis, FileText, Inbox, Music2, Presentation, Search, Sheet, Star, Trash2, X } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useNavigationType, useOutletContext, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { SpaceItem, SpaceList, SpaceOrigin } from '@xopcai/gateway-contract';

import { PageTabs } from '@/components/ui/page-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '@/features/chat/constants';
import { createComposerAttachmentHandoff } from '@/features/chat/composer/composer-attachment-handoff';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { getSpaceDetail, getSpaceList, spaceContent, spaceContentUrl, spaceItemPath, spacePath } from './space-api';
import { SpacePreview } from './space-preview';
import { SpaceAudioButton, SpaceFileIcon, SpaceThumbnail } from './space-row-media';

const iconByKind = { document: FileText, pdf: FileText, spreadsheet: Sheet, presentation: Presentation, audio: Music2, archive: Archive };
const iconButton = 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';
const menuButton = 'block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-surface-hover';
const primaryButton = 'rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50';
const listColumns = 'grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 px-2 sm:px-3 @xl/list:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,0.55fr)_6.5rem] @xl/list:gap-4';
const defaultPreviewWidth = 38;
const minPreviewWidth = 30;
const maxPreviewWidth = 72;
const previewWidthKey = 'xopc.space.previewWidth';

function readPreviewWidth() {
  try {
    const width = Number(window.localStorage.getItem(previewWidthKey));
    if (width >= minPreviewWidth && width <= maxPreviewWidth) return width;
  } catch { /* Use the default when storage is unavailable. */ }
  return defaultPreviewWidth;
}

function savePreviewWidth(width: number) {
  try { window.localStorage.setItem(previewWidthKey, String(width)); } catch { /* Keep resizing available without storage. */ }
}

type SpaceView = 'all' | 'favorites' | 'trash';

function getSpaceView(params: URLSearchParams): SpaceView {
  const view = params.get('view');
  return view === 'favorites' || view === 'trash' ? view : 'all';
}

function SpacePreviewDivider({ zh, width, onResize }: { zh: boolean; width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ id: number; startX: number; startWidth: number; availableWidth: number; currentWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function resize(next: number) {
    const boundedWidth = Math.max(minPreviewWidth, Math.min(maxPreviewWidth, next));
    onResize(boundedWidth);
    return boundedWidth;
  }

  return (
    <div role="separator" aria-orientation="vertical" aria-label={zh ? '调整资料预览宽度' : 'Resize file preview'}
      aria-controls="space-file-preview" aria-valuemin={minPreviewWidth} aria-valuemax={maxPreviewWidth} aria-valuenow={Math.round(width)}
      tabIndex={0} title={zh ? '左右拖动调整宽度，双击恢复默认' : 'Drag to resize, double-click to reset'}
      className={cn('group absolute inset-y-0 start-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none select-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-accent @min-[58rem]/space:flex', dragging && 'bg-accent-soft/40')}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return;
        const handle = event.currentTarget;
        const host = handle.closest('[data-space-preview-host]');
        const availableWidth = host?.parentElement?.clientWidth;
        if (!availableWidth) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, startX: event.clientX, startWidth: width, availableWidth, currentWidth: width };
        setDragging(true);
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (start?.id !== event.pointerId) return;
        start.currentWidth = resize(start.startWidth + (start.startX - event.clientX) * 100 / start.availableWidth);
      }}
      onLostPointerCapture={event => {
        if (drag.current?.id !== event.pointerId) return;
        savePreviewWidth(drag.current.currentWidth);
        drag.current = null;
        setDragging(false);
      }}
      onDoubleClick={() => savePreviewWidth(resize(defaultPreviewWidth))}
      onKeyDown={event => {
        const widths: Record<string, number> = { ArrowLeft: width + 2, ArrowRight: width - 2, Home: minPreviewWidth, End: maxPreviewWidth };
        if (!Object.hasOwn(widths, event.key)) return;
        event.preventDefault();
        savePreviewWidth(resize(widths[event.key]));
      }}>
      <span aria-hidden className={cn('h-10 w-0.5 rounded-full bg-edge group-hover:bg-accent group-focus-visible:bg-accent', dragging && 'bg-accent')} />
      {dragging ? <span aria-hidden className="fixed inset-0 z-50 cursor-col-resize" /> : null}
    </div>
  );
}

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

function SpaceHeaderSearch({ zh }: { zh: boolean }) {
  const [params, setParams] = useSearchParams();
  const navigationType = useNavigationType();
  const input = useRef<HTMLInputElement>(null);
  const q = (params.get('q') ?? '').slice(0, 160);
  const label = zh ? '搜索资料' : 'Search files';

  useLayoutEffect(() => {
    const field = input.current;
    if (field && (document.activeElement !== field || navigationType === 'POP')) field.value = q;
  }, [navigationType, q]);

  function changeQuery(value: string) {
    setParams(current => {
      const next = new URLSearchParams(current);
      if (value) next.set('q', value);
      else next.delete('q');
      return next;
    }, { replace: true });
  }

  return (
    <div role="search" className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-edge-subtle bg-surface-inset px-2.5 focus-within:ring-2 focus-within:ring-accent @min-[40rem]/space-list:w-[clamp(7rem,24cqw,18rem)]">
      <Search className="size-4 shrink-0 text-fg-muted" aria-hidden />
      <input ref={input} defaultValue={q} maxLength={160} onChange={event => changeQuery(event.target.value)}
        aria-label={label} placeholder={label} className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none" />
      {q ? <button type="button" className={cn(iconButton, 'size-6')} onClick={() => {
        changeQuery('');
        if (input.current) {
          input.current.value = '';
          input.current.focus();
        }
      }}
        aria-label={zh ? '清除搜索' : 'Clear search'}><X className="size-4" /></button> : null}
    </div>
  );
}

function SpaceHeaderFilters({ zh }: { zh: boolean }) {
  const [params, setParams] = useSearchParams();
  const types = [
    ['document', zh ? '文档' : 'Documents'], ['spreadsheet', zh ? '表格' : 'Spreadsheets'],
    ['presentation', zh ? '演示' : 'Slides'], ['image', zh ? '图片' : 'Images'],
    ['audio', zh ? '音频' : 'Audio'], ['video', zh ? '视频' : 'Video'],
    ['archive', zh ? '压缩包' : 'Archives'], ['file', zh ? '文件' : 'Files'],
  ];

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <SpaceHeaderSearch zh={zh} />
      <Select value={params.get('kind') ?? 'all'} align="end" aria-label={zh ? '资料类型' : 'File type'}
        triggerClassName="h-9 shrink-0" onChange={event => setParams(current => {
          const next = new URLSearchParams(current);
          if (event.target.value === 'all') next.delete('kind');
          else next.set('kind', event.target.value);
          return next;
        })}>
        <SelectOption value="all">{zh ? '全部类型' : 'All types'}</SelectOption>
        {types.map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}
      </Select>
    </div>
  );
}

function SpaceHeaderTabs({ zh, onViewChange }: { zh: boolean; onViewChange: () => void }) {
  const [params, setParams] = useSearchParams();
  const items = [
    { id: 'all', label: zh ? '全部资料' : 'All files', icon: Inbox },
    { id: 'favorites', label: zh ? '收藏' : 'Favorites', icon: Star },
    { id: 'trash', label: zh ? '回收站' : 'Trash', icon: Trash2 },
  ] as const;

  function changeView(view: SpaceView) {
    onViewChange();
    setParams(current => {
      const next = new URLSearchParams(current);
      for (const key of ['view', 'item', 'version', 'q', 'kind']) next.delete(key);
      if (view !== 'all') next.set('view', view);
      return next;
    });
  }

  return (
    <div className="min-w-0">
      <h1 className="sr-only">{zh ? '资料库' : 'Space'}</h1>
      <PageTabs items={items} activeTab={getSpaceView(params)} onChange={changeView}
        ariaLabel={zh ? '资料范围' : 'Library views'} tabIdPrefix="space-tab" panelIdPrefix="space-list"
        className="pb-0 [scrollbar-width:none]" buttonClassName="h-9 py-1.5" scrollActiveIntoView />
    </div>
  );
}

export function SpacePage() {
  const language = useLocaleStore(state => state.language);
  const zh = language === 'zh';
  const setPageHeader = usePageHeaderStore(state => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore(state => state.clearPageHeader);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const previewHost = useOutletContext<HTMLDivElement | null>();
  const selectedVersion = params.get('version');
  const [previewWidth, setPreviewWidth] = useState(readPreviewWidth);
  const [editing, setEditing] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [undo, setUndo] = useState<{ id: string; revision: number }>();
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const listSection = useRef<HTMLElement>(null);
  const listScroll = useRef<HTMLDivElement>(null);
  const view = getSpaceView(params);
  const q = (params.get('q') ?? '').slice(0, 160);
  const query = useDeferredValue(q);
  const selected = params.get('item');
  const kind = params.get('kind');
  const scope = params.get('taskId') ? 'taskId' : params.get('projectId') ? 'projectId' : undefined;
  const onViewChange = useCallback(() => {
    setUndo(undefined);
    setActionError('');
    setEditing(false);
    setConfirmPurge(false);
  }, []);
  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <SpaceHeaderTabs zh={zh} onViewChange={onViewChange} />,
      end: <SpaceHeaderFilters zh={zh} />,
      className: '@max-[40rem]/space-list:h-auto @max-[40rem]/space-list:min-h-14 @max-[40rem]/space-list:gap-y-2 @max-[40rem]/space-list:py-2 @max-[40rem]/space-list:[&>:last-child]:col-span-full',
    });
    return clearPageHeader;
  }, [clearPageHeader, onViewChange, setPageHeader, zh]);

  useLayoutEffect(() => {
    if (listScroll.current) listScroll.current.scrollTop = 0;
  }, [view]);
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

  function setQueryValues(values: Record<string, string | null>) {
    setParams(current => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
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

  useLayoutEffect(() => {
    if (selected && listSection.current && getComputedStyle(listSection.current).visibility === 'hidden') {
      previewHeading.current?.focus({ preventScroll: true });
    }
  }, [previewHost, selected]);

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

  const dateFormat = new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' });
  const formatDate = (time: number) => dateFormat.format(time);
  const sourceLabel = (row: SpaceItem) => row.origin?.label ?? (row.origin?.kind === 'task' ? (zh ? '任务' : 'Task')
    : row.origin?.kind === 'automation' ? (zh ? '定时任务' : 'Automation') : (zh ? '对话' : 'Chat'));

  const status = actionError || undo ? (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-edge-subtle bg-surface-panel px-3 py-2 text-sm" role="status">
      <span>{actionError || (zh ? '已移到回收站' : 'Moved to Trash')}</span>
      {undo ? <button type="button" disabled={busy} className="rounded-lg p-1 text-accent-fg" onClick={() => void mutateItem('restore', undo)}>{zh ? '撤销' : 'Undo'}</button> : null}
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-[74rem] min-h-0 flex-1 px-3 pt-3 sm:px-5 sm:pt-5 @min-[58rem]/space:px-6">
        <section ref={listSection} id={`space-list-${view}`} role="tabpanel" aria-labelledby={`space-tab-${view}`}
          className="@container/list flex min-w-0 flex-1 flex-col">
          {scope ? <div className="mb-3 flex shrink-0 justify-end">
            <button type="button" onClick={() => setQueryValues({ [scope]: null })}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-surface-inset px-2 py-1 text-sm text-fg-muted hover:bg-surface-hover">
              {scope === 'projectId' ? (zh ? '当前项目' : 'Project') : (zh ? '当前任务' : 'Task')}<X className="size-3.5" />
            </button>
          </div> : null}
          <div ref={listScroll} className="min-h-0 flex-1 overflow-y-auto pb-5">
            {list.isLoading ? <div className="space-y-2" aria-busy="true">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}</div> : null}
            {list.error ? <button className="rounded-lg py-3 text-sm text-accent-fg" onClick={() => void list.mutate()}>{zh ? '加载失败，重试' : 'Could not load. Retry'}</button> : null}
            {!list.isLoading && !list.error && items.length === 0 ? <p className="py-10 text-center text-sm text-fg-muted">
              {q ? (zh ? '没有匹配的资料' : 'No matching results') : view === 'favorites' ? (zh ? '暂无收藏' : 'No favorites') : view === 'trash' ? (zh ? '回收站为空' : 'Trash is empty') : (zh ? '暂无资料' : 'No results yet')}
            </p> : null}
            {items.length > 0 ? <div className="overflow-hidden rounded-xl border border-edge-subtle">
              <div className={cn(listColumns, 'min-h-10 border-b border-edge-subtle bg-surface-inset text-xs font-medium text-fg-muted')}>
                <span>{zh ? '名称' : 'Name'}</span>
                <span className="hidden @xl/list:block">{zh ? '格式' : 'Format'}</span>
                <span className="hidden @xl/list:block">{zh ? '来源' : 'Source'}</span>
                <span className="min-w-[5rem] text-end">{zh ? '更新日期' : 'Updated'}</span>
              </div>
              <ul className="divide-y divide-edge-subtle">
                {items.map((row, index) => {
                  const Icon = iconByKind[row.kind as keyof typeof iconByKind];
                  const version = row.currentVersion;
                  const extension = /\.([a-z\d]{1,12})$/i.exec(version.fileName)?.[1]?.toUpperCase();
                  const mediaSrc = spaceContentUrl(row.id, version.id);
                  const playable = row.kind === 'audio' && view !== 'trash';
                  const rowSource = row.origin ? sourceLabel(row) : null;
                  return <li key={row.id} className="relative [contain-intrinsic-size:auto_55px] [content-visibility:auto]">
                    <button type="button" title={row.title} ref={button => { if (button) rows.current.set(row.id, button); else rows.current.delete(row.id); }}
                      onKeyDown={event => onRowKey(event, index)} aria-pressed={selected === row.id} onClick={() => select(row.id)}
                      className={cn(listColumns, 'min-h-[54px] w-full py-1.5 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                        selected === row.id ? 'bg-accent-soft' : 'hover:bg-surface-hover')}>
                      <span className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                        {playable ? <span className="w-11 shrink-0" aria-hidden /> : row.kind === 'image' || row.kind === 'video'
                          ? <SpaceThumbnail key={version.id} kind={row.kind} src={mediaSrc} />
                          : <SpaceFileIcon icon={Icon} />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg"><MarkedText text={row.title} query={query.trim()} /></span>
                          {extension || rowSource ? <span className="block truncate text-xs text-fg-muted @xl/list:hidden">
                            {extension}{extension && rowSource ? ' · ' : null}{rowSource}
                          </span> : null}
                          {row.hit ? <span className="block truncate text-xs text-fg-muted"><MarkedText text={row.hit.text} query={query.trim()} /></span> : null}
                        </span>
                      </span>
                      <span className="hidden @xl/list:block">
                        {extension ? <span className="inline-block max-w-full truncate rounded bg-surface-inset px-1.5 py-0.5 align-middle text-xs font-medium text-fg-muted">{extension}</span> : <span className="text-xs text-fg-muted">—</span>}
                      </span>
                      <span className="hidden truncate text-sm text-fg-muted @xl/list:block">{rowSource ?? '—'}</span>
                      <time className="min-w-[5rem] text-end text-xs whitespace-nowrap tabular-nums text-fg-muted">{formatDate(row.updatedAt)}</time>
                    </button>
                    {playable ? <SpaceAudioButton key={version.id} src={mediaSrc} title={row.title} zh={zh} /> : null}
                  </li>;
                })}
              </ul>
            </div> : null}
            {list.data?.at(-1)?.nextCursor ? <button className="mt-3 rounded-lg py-2 text-sm text-accent-fg" onClick={() => void list.setSize(list.size + 1)}>
              {zh ? '加载更多' : 'Load more'}
            </button> : null}
          </div>
        </section>
      </div>
      {selected && previewHost ? createPortal(
        <section id="space-file-preview" aria-label={zh ? '资料预览' : 'File preview'}
          style={{ '--space-preview-width': `${previewWidth}%` } as CSSProperties}
          className="file-preview-surface absolute inset-0 z-40 flex min-h-0 min-w-0 flex-col @min-[58rem]/space:relative @min-[58rem]/space:inset-auto @min-[58rem]/space:w-[var(--space-preview-width)] @min-[58rem]/space:shrink-0 @min-[58rem]/space:border-s @min-[58rem]/space:border-edge-subtle">
          <SpacePreviewDivider zh={zh} width={previewWidth} onResize={setPreviewWidth} />
          <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-edge-subtle px-3 py-2">
            <button type="button" className={cn(iconButton, '@min-[58rem]/space:hidden')} onClick={close} aria-label={zh ? '返回' : 'Back'}><ArrowLeft className="size-4" /></button>
            <h2 ref={previewHeading} tabIndex={-1} className="min-w-0 flex-1 py-2 text-sm leading-5 font-semibold wrap-anywhere text-fg">{item?.title ?? (zh ? '预览' : 'Preview')}</h2>
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
            <button type="button" className={cn(iconButton, 'hidden @min-[58rem]/space:inline-flex')} onClick={close} aria-label={zh ? '关闭预览' : 'Close preview'}><X className="size-4" /></button>
          </header>
          {editing && item ? <form className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2" onSubmit={rename}>
            <input name="title" defaultValue={item.title} required maxLength={240} autoFocus aria-label={zh ? '资料名称' : 'Result name'}
              className="min-w-24 flex-1 rounded-lg border border-edge bg-surface-panel px-2 py-2 text-sm" />
            <button className={primaryButton} disabled={busy}>{zh ? '保存' : 'Save'}</button>
            <button type="button" className="rounded-lg p-2 text-sm hover:bg-surface-hover" onClick={() => setEditing(false)}>{zh ? '取消' : 'Cancel'}</button>
          </form> : null}
          {detail.isLoading ? <Skeleton className="m-3 min-h-0 flex-1 rounded-xl" /> : null}
          {detail.error ? <p className="px-3 py-5 text-sm text-fg-muted">{zh ? '资料暂不可用' : 'Result unavailable'}</p> : null}
          {item && version ? <>
            <SpacePreview key={version.id} itemId={item.id} version={version} hit={hit} download={download} />
            <div className="max-h-[45%] shrink-0 space-y-2 overflow-y-auto border-t border-edge-subtle px-3 py-2">
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
            </div>
          </> : null}
          {status}
        </section>, previewHost) : null}
      {!(selected && previewHost) ? status : null}
    </div>
  );
}
