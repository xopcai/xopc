import * as Dialog from '@radix-ui/react-dialog';
import { Check, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import type { SpaceItem, SpaceList, SpaceVersionLink } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

import { getSpaceList, saveSpaceVersion, spacePath } from './space-api';

export function SaveSpaceVersionDialog({ sourceVersionId, title, zh, onSaved }: {
  sourceVersionId: string;
  title: string;
  zh: boolean;
  onSaved: (result: SpaceVersionLink) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const deferred = useDeferredValue(query);
  const list = useSWRInfinite<SpaceList>((index, previous) => {
    if (!open || (index && !previous?.nextCursor)) return null;
    const params = new URLSearchParams({ versionTargetFor: sourceVersionId, q: deferred });
    if (index && previous?.nextCursor) params.set('cursor', previous.nextCursor);
    return `${spacePath}?${params}`;
  }, getSpaceList);
  const items = list.data?.flatMap(page => page.items) ?? [];
  const selected = items.find(item => item.id === selectedId);
  const label = zh ? '保存为新版本' : 'Save as new version';

  function changeOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setQuery('');
      setSelectedId(undefined);
      setError(false);
    }
  }

  async function save(item: SpaceItem) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const result = await saveSpaceVersion(item.id, sourceVersionId, item.revision);
      setOpen(false);
      onSaved(result);
    } catch {
      setError(true);
      void list.mutate();
    } finally {
      setBusy(false);
    }
  }

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
      aria-label={`${label} · ${title}`}>{label}</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[90] bg-scrim" />
      <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[91] flex h-[min(31rem,calc(100dvh-2rem))] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none">
        <header className="space-y-3 px-5 pt-5">
          <Dialog.Title className="text-base font-semibold text-fg">{label}</Dialog.Title>
          <Dialog.Description className="truncate text-sm text-fg-muted" title={title}>
            {zh ? `为「${title}」选择原资料` : `Choose the original result for “${title}”`}
          </Dialog.Description>
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-edge-subtle bg-surface-inset px-3 focus-within:ring-2 focus-within:ring-accent">
            <Search className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <input value={query} maxLength={160} onChange={event => { setQuery(event.target.value); setSelectedId(undefined); }}
              aria-label={zh ? '搜索原资料' : 'Search original results'} placeholder={zh ? '搜索原资料' : 'Search original results'}
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none" />
          </label>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {list.isLoading ? <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map(index => <Skeleton key={index} className="h-11 rounded-lg" />)}
          </div> : null}
          {list.error ? <button type="button" className="rounded-lg px-2 py-2 text-sm text-accent-fg" onClick={() => void list.mutate()}>
            {zh ? '加载失败，重试' : 'Could not load. Retry'}
          </button> : null}
          {!list.isLoading && !list.error && !items.length ? <p className="py-5 text-center text-sm text-fg-muted">
            {zh ? '没有可选的资料' : 'No matching results'}
          </p> : null}
          <ul className="space-y-1">
            {items.map(item => <li key={item.id}>
              <button type="button" onClick={() => { setSelectedId(item.id); setError(false); }} disabled={busy} aria-pressed={selectedId === item.id}
                className={cn('flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm',
                  selectedId === item.id ? 'bg-accent-soft text-accent-fg' : 'text-fg hover:bg-surface-hover')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-fg-muted">{item.origin?.label ?? item.currentVersion.fileName}</span>
                </span>
                {selectedId === item.id ? <Check className="size-4 shrink-0" aria-hidden /> : null}
              </button>
            </li>)}
          </ul>
          {list.data?.at(-1)?.nextCursor ? <button type="button" onClick={() => void list.setSize(list.size + 1)}
            className="mt-2 w-full rounded-lg py-2 text-sm text-accent-fg hover:bg-surface-hover">
            {zh ? '加载更多' : 'Load more'}
          </button> : null}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-edge-subtle px-5 py-3">
          {error ? <p role="alert" className="flex-1 text-xs text-danger">{zh ? '保存失败，请重新选择资料。' : 'Could not save. Choose the result again.'}</p> : null}
          <Dialog.Close asChild><Button variant="secondary" disabled={busy}>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
          <Button variant="primary" disabled={!selected || busy} onClick={() => { if (selected) void save(selected); }}>
            {busy ? (zh ? '正在保存' : 'Saving') : (zh ? '保存版本' : 'Save version')}
          </Button>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
