import * as Dialog from '@radix-ui/react-dialog';
import {
  Braces,
  ChevronDown,
  FolderKanban,
  Package,
  Plug,
  Search,
  Settings2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { useLocaleStore } from '@/stores/locale-store';

import { importRequest, type ImportInventory, type InventoryItem } from './import-api';
import { selectable, selectionState, toggleItem, toggleItems } from './selection';

export function ImportSelectionDialog({ open, sourceName, inventory, selected, onSelected, busy, locked, error, onClose, onRefresh, onSubmit }: {
  open: boolean; sourceName: string; inventory?: ImportInventory; selected: Set<string>; onSelected: (ids: Set<string>) => void;
  busy: boolean; locked: boolean; error: string; onClose: () => void; onRefresh: () => void; onSubmit: () => void;
}) {
  const t = messages(useLocaleStore(state => state.language)).imports;
  const [personalOpen, setPersonalOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(false);
  useEffect(() => {
    setPersonalOpen(true);
    setProjectsOpen(false);
  }, [inventory?.id]);

  const personal = inventory?.candidates.filter(item => !item.parentId && (item.kind === 'skill' || item.kind === 'context')) ?? [];
  const projects = inventory?.candidates.filter(item => item.kind === 'project') ?? [];
  const connections = inventory?.candidates.filter(item => item.kind === 'connection') ?? [];
  const projectChildren = useMemo(() => {
    const grouped = new Map<string, InventoryItem[]>();
    for (const item of inventory?.candidates ?? []) {
      if (!item.parentId) continue;
      const children = grouped.get(item.parentId) ?? [];
      children.push(item);
      grouped.set(item.parentId, children);
    }
    return grouped;
  }, [inventory]);
  const chosen = inventory?.candidates.filter(item => selected.has(item.id)) ?? [];
  const summary = t.selected
    .replace('{skills}', String(chosen.filter(item => item.kind === 'skill').length))
    .replace('{context}', String(chosen.filter(item => item.kind === 'context').length))
    .replace('{projects}', String(chosen.filter(item => item.kind === 'project').length));
  const toggle = (item: InventoryItem, checked: boolean) => {
    if (inventory) onSelected(toggleItem(inventory, selected, item, checked));
  };
  const toggleGroup = (items: InventoryItem[], checked: boolean) => {
    if (inventory) onSelected(toggleItems(inventory, selected, items, checked));
  };

  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className={`xopc-dialog-overlay fixed inset-0 bg-scrim ${SETTINGS_SHELL_OVERLAY_Z}`} />
    <Dialog.Content className={cn(
      'xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(calc(100dvh-2rem),760px)] w-[min(calc(100%-2rem),720px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay outline-none',
      'max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:h-[min(92dvh,760px)] max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none',
      SETTINGS_SHELL_CONTENT_Z,
    )}>
      <header className="shrink-0 space-y-2 border-b border-edge p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Dialog.Title className="text-xl font-semibold text-fg">{t.chooseTitle.replace('{source}', sourceName)}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">{t.chooseHint}</Dialog.Description>
          </div>
          <Dialog.Close asChild><Button variant="ghost" aria-label={t.close} className="h-10 w-10 shrink-0 p-0"><X aria-hidden="true" className="h-4 w-4" /></Button></Dialog.Close>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {error && <div role="alert" className="space-y-3 rounded-xl border border-edge bg-surface-inset p-4 text-sm text-fg">
          <p>{error}</p><Button variant="secondary" disabled={locked} onClick={onRefresh}>{t.refresh}</Button>
        </div>}
        {!inventory && !error && <SettingsPageSkeleton sections={2} />}
        {inventory && <>
          {!inventory.complete && <p className="rounded-lg bg-surface-inset p-3 text-sm text-fg-muted">{t.incomplete}</p>}

          {personal.length > 0 && <ImportGroupCard
            icon={Settings2}
            title={t.personalSetup}
            description={t.personalSetupHint}
            items={personal}
            selected={selected}
            open={personalOpen}
            disabled={locked}
            onOpenChange={setPersonalOpen}
            onCheckedChange={checked => toggleGroup(personal, checked)}
          >
            <CategorySection icon={Package} title={t.kinds.skill} items={personal.filter(item => item.kind === 'skill')}
              inventoryId={inventory.id} selected={selected} disabled={locked} onToggle={toggle} onToggleAll={checked => toggleGroup(personal.filter(item => item.kind === 'skill'), checked)} />
            <CategorySection icon={Braces} title={t.kinds.context} items={personal.filter(item => item.kind === 'context')}
              inventoryId={inventory.id} selected={selected} disabled={locked} onToggle={toggle} onToggleAll={checked => toggleGroup(personal.filter(item => item.kind === 'context'), checked)} />
          </ImportGroupCard>}

          {projects.length > 0 && <ImportGroupCard
            icon={FolderKanban}
            title={t.kinds.project}
            description={t.projectsHint.replace('{count}', String(projects.length))}
            items={projects}
            selected={selected}
            open={projectsOpen}
            disabled={locked}
            onOpenChange={setProjectsOpen}
            onCheckedChange={checked => toggleGroup(projects, checked)}
          >
            <ProjectList inventoryId={inventory.id} projects={projects} projectChildren={projectChildren} selected={selected} disabled={locked} onToggle={toggle} />
          </ImportGroupCard>}

          {connections.length > 0 && <ConnectionGroup inventoryId={inventory.id} items={connections} />}

          {!inventory.candidates.length && <p className="rounded-xl bg-surface-inset p-5 text-sm text-fg-muted">{t.noContent}</p>}
          {!!inventory.notices.length && <details className="rounded-xl border border-edge bg-surface-inset p-4 text-sm text-fg-muted">
            <summary className="cursor-pointer font-medium text-fg">{t.scanNotices} ({inventory.notices.length})</summary>
            <ul className="mt-3 space-y-2">{inventory.notices.map((notice, index) => <li key={index} className="break-words">{notice}</li>)}</ul>
          </details>}
        </>}
      </div>

      <footer className="shrink-0 border-t border-edge bg-surface-overlay p-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className="min-w-0">
            <p className="text-sm text-fg-muted">{summary}</p>
            {busy && <p className="mt-1 text-xs text-fg-muted">{t.runningHint}</p>}
            {locked && !busy && <p className="mt-1 text-xs text-fg-muted">{t.retryHint}</p>}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>{busy ? t.close : t.cancel}</Button>
            <Button variant="primary" disabled={!inventory || !selected.size || busy} onClick={onSubmit}>
              {busy ? t.importing : locked ? t.retry : t.importCount.replace('{count}', String(selected.size))}
            </Button>
          </div>
        </div>
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function ConnectionGroup({ inventoryId, items }: { inventoryId: string; items: InventoryItem[] }) {
  const t = messages(useLocaleStore(state => state.language)).imports;
  const [open, setOpen] = useState(false);
  return <section className="overflow-hidden rounded-xl border border-edge bg-surface-inset">
    <div className="flex min-h-16 items-center gap-3 px-3 py-2 sm:px-4">
      <Button variant="ghost" className="min-w-0 flex-1 justify-start gap-3 px-1 text-left" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-panel text-fg"><Plug aria-hidden="true" className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{t.kinds.connection}</span>
          <span className="mt-0.5 block truncate text-xs font-normal text-fg-muted">{t.connectionsHint.replace('{count}', String(items.length))}</span>
        </span>
        <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-fg-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
      </Button>
    </div>
    {open && <div className="space-y-2 border-t border-edge bg-surface-overlay p-3 sm:p-4">
      {items.map(item => <ConnectionRow key={item.id} inventoryId={inventoryId} item={item} />)}
      <Button asChild variant="secondary"><Link to="/capabilities/connectors">{t.connectionsAction}</Link></Button>
    </div>}
  </section>;
}

function ConnectionRow({ inventoryId, item }: { inventoryId: string; item: InventoryItem }) {
  const t = messages(useLocaleStore(state => state.language)).imports;
  const [preview, setPreview] = useState<{ text: string; truncated: boolean }>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  async function togglePreview() {
    setOpen(value => !value);
    if (preview) return;
    try { setPreview(await importRequest(`/inventories/${inventoryId}/items/${item.id}/preview`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }
  return <div className="rounded-xl border border-edge p-3">
    <div className="flex items-start gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{item.name}</span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted" title={item.displayPath}>{item.displayPath}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t.statuses[item.status]}</span>
      </span>
      <Button variant="ghost" className="h-9 shrink-0 px-2" onClick={() => void togglePreview()}>{t.preview}</Button>
    </div>
    {item.reason && <p className="mt-2 text-xs text-fg-muted">{item.reason}</p>}
    {open && <div className="mt-3 rounded-lg bg-surface-inset p-3">
      {error ? <p role="alert" className="text-xs text-fg-muted">{error}</p> : preview ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-fg">{preview.text}</pre> : <SettingsPageSkeleton sections={1} />}
    </div>}
  </div>;
}

function ImportGroupCard({ icon: Icon, title, description, items, selected, open, disabled, onOpenChange, onCheckedChange, children }: {
  icon: LucideIcon; title: string; description: string; items: InventoryItem[]; selected: Set<string>; open: boolean; disabled: boolean;
  onOpenChange: (open: boolean) => void; onCheckedChange: (checked: boolean) => void; children: ReactNode;
}) {
  const state = selectionState(items, selected);
  return <section className="overflow-hidden rounded-xl border border-edge bg-surface-inset">
    <div className="flex min-h-16 items-center gap-3 px-3 py-2 sm:px-4">
      <Button variant="ghost" className="min-w-0 flex-1 justify-start gap-3 px-1 text-left" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-panel text-fg"><Icon aria-hidden="true" className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{title}</span>
          <span className="mt-0.5 block truncate text-xs font-normal text-fg-muted">{description}</span>
        </span>
        <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-fg-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
      </Button>
      <TriStateCheckbox label={title} checked={state.checked} indeterminate={state.indeterminate} disabled={disabled || !state.availableCount} onChange={onCheckedChange} />
    </div>
    {open && <div className="space-y-2 border-t border-edge bg-surface-overlay p-3 sm:p-4">{children}</div>}
  </section>;
}

function CategorySection({ icon: Icon, title, items, inventoryId, selected, disabled, onToggle, onToggleAll }: {
  icon: LucideIcon; title: string; items: InventoryItem[]; inventoryId: string; selected: Set<string>; disabled: boolean;
  onToggle: (item: InventoryItem, checked: boolean) => void; onToggleAll: (checked: boolean) => void;
}) {
  const t = messages(useLocaleStore(state => state.language)).imports;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(60);
  if (!items.length) return null;
  const state = selectionState(items, selected);
  const matches = filteredItems(items, query);
  const visible = matches.slice(0, limit);
  return <div className="rounded-xl border border-edge">
    <div className="flex min-h-14 items-center gap-2 px-3 py-2">
      <Button variant="ghost" className="min-w-0 flex-1 justify-start px-1 text-left" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{title} ({items.length})</span>
        <span className="text-xs font-normal text-fg-muted">{state.selectedCount}/{state.availableCount}</span>
        <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-fg-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
      </Button>
      <TriStateCheckbox label={title} checked={state.checked} indeterminate={state.indeterminate} disabled={disabled || !state.availableCount} onChange={onToggleAll} />
    </div>
    {open && <div className="space-y-2 border-t border-edge p-2">
      {items.length > 8 && <SearchField value={query} label={t.searchWithin.replace('{group}', title)} onChange={value => { setQuery(value); setLimit(60); }} />}
      <div className="space-y-1">{visible.map(item => <ImportItemRow key={item.id} inventoryId={inventoryId} item={item} checked={selected.has(item.id)} disabled={disabled} onChange={checked => onToggle(item, checked)} />)}</div>
      {!matches.length && <p className="p-3 text-sm text-fg-muted">{t.noMatches}</p>}
      {visible.length < matches.length && <Button variant="ghost" className="w-full" onClick={() => setLimit(value => value + 60)}>{t.showMore.replace('{count}', String(matches.length - visible.length))}</Button>}
    </div>}
  </div>;
}

function ProjectList({ inventoryId, projects, projectChildren, selected, disabled, onToggle }: {
  inventoryId: string; projects: InventoryItem[]; projectChildren: Map<string, InventoryItem[]>; selected: Set<string>; disabled: boolean;
  onToggle: (item: InventoryItem, checked: boolean) => void;
}) {
  const t = messages(useLocaleStore(state => state.language)).imports;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(60);
  const matches = filteredItems(projects, query, project => projectChildren.get(project.id) ?? []);
  const visible = matches.slice(0, limit);
  return <div className="space-y-2">
    {projects.length > 8 && <SearchField value={query} label={t.searchWithin.replace('{group}', t.kinds.project)} onChange={value => { setQuery(value); setLimit(60); }} />}
    <div className="space-y-2">{visible.map(project => <ProjectRow key={project.id} inventoryId={inventoryId} project={project} children={projectChildren.get(project.id) ?? []} selected={selected} disabled={disabled} onToggle={onToggle} />)}</div>
    {!matches.length && <p className="p-3 text-sm text-fg-muted">{t.noMatches}</p>}
    {visible.length < matches.length && <Button variant="ghost" className="w-full" onClick={() => setLimit(value => value + 60)}>{t.showMore.replace('{count}', String(matches.length - visible.length))}</Button>}
  </div>;
}

function ProjectRow({ inventoryId, project, children, selected, disabled, onToggle }: {
  inventoryId: string; project: InventoryItem; children: InventoryItem[]; selected: Set<string>; disabled: boolean; onToggle: (item: InventoryItem, checked: boolean) => void;
}) {
  const t = messages(useLocaleStore(state => state.language)).imports;
  const [open, setOpen] = useState(false);
  const selectedChildren = children.filter(item => selected.has(item.id)).length;
  return <div className="rounded-xl border border-edge">
    <div className="flex items-center gap-2 p-2">
      <Button variant="ghost" className="min-w-0 flex-1 justify-start px-2 text-left" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{project.name}</span>
          <span className="mt-0.5 block truncate text-xs font-normal text-fg-muted">{project.displayPath}</span>
        </span>
        {children.length > 0 && <span className="text-xs font-normal text-fg-muted">{t.projectContents.replace('{skills}', String(children.filter(item => item.kind === 'skill').length)).replace('{context}', String(children.filter(item => item.kind === 'context').length))} · {t.chosenCount.replace('{count}', String(selectedChildren))}</span>}
        <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-fg-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
      </Button>
      <input type="checkbox" aria-label={project.name} checked={selected.has(project.id)} disabled={disabled || !selectable(project)} onChange={event => onToggle(project, event.target.checked)} />
    </div>
    {open && <div className="border-t border-edge p-2">
      {children.length ? <div className="space-y-1">{children.map(item => <ImportItemRow key={item.id} inventoryId={inventoryId} item={item} checked={selected.has(item.id)} disabled={disabled} onChange={checked => onToggle(item, checked)} />)}</div>
        : <p className="p-2 text-xs text-fg-muted">{t.directoryOnly}</p>}
    </div>}
  </div>;
}

function SearchField({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  return <label className="flex items-center gap-2 rounded-lg border border-edge bg-surface-panel px-3 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
    <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-muted" />
    <span className="sr-only">{label}</span>
    <input type="search" autoComplete="off" value={value} placeholder={`${label}…`} aria-label={label} onChange={event => onChange(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent px-0 py-2 text-sm text-fg placeholder:text-fg-subtle" />
  </label>;
}

function filteredItems(items: InventoryItem[], query: string, related: (item: InventoryItem) => InventoryItem[] = () => []) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  const contains = (item: InventoryItem) => `${item.name} ${item.description} ${item.displayPath}`.toLocaleLowerCase().includes(normalized);
  return items.filter(item => contains(item) || related(item).some(contains));
}

function TriStateCheckbox({ label, checked, indeterminate, disabled, onChange }: {
  label: string; checked: boolean; indeterminate: boolean; disabled: boolean; onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />;
}

function ImportItemRow({ inventoryId, item, checked, disabled, onChange }: {
  inventoryId: string; item: InventoryItem; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void;
}) {
  const t = messages(useLocaleStore(state => state.language)).imports;
  const [preview, setPreview] = useState<{ text: string; truncated: boolean }>();
  const [previewError, setPreviewError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  async function view() {
    setShowPreview(value => !value);
    if (preview) return;
    try { setPreview(await importRequest(`/inventories/${inventoryId}/items/${item.id}/preview`)); }
    catch (caught) { setPreviewError(caught instanceof Error ? caught.message : String(caught)); }
  }
  return <div className="min-w-0 rounded-lg px-2 py-1.5 hover:bg-surface-hover/60">
    <div className="flex items-start gap-2">
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-1">
        <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled || !selectable(item)} onChange={event => onChange(event.target.checked)} />
        <span className="min-w-0">
          <span className="block break-words text-sm font-medium text-fg">{item.name}</span>
          <span className="block truncate text-xs text-fg-muted" title={item.displayPath}>{item.displayPath}</span>
        </span>
      </label>
      {item.status !== 'blocked' && <Button variant="ghost" aria-label={`${t.preview}: ${item.name}`} className="h-9 shrink-0 px-2" onClick={() => void view()}>{t.preview}</Button>}
    </div>
    {item.description && <p className="pl-7 text-xs text-fg-muted">{item.description}</p>}
    {item.status !== 'ready' && <p className="pl-7 text-xs text-fg-muted">{t.statuses[item.status]}{item.status === 'conflict' ? ` → ${item.targetName}` : ''}</p>}
    {item.reason && <p className="break-words pl-7 text-xs text-fg-muted">{item.reason}</p>}
    {showPreview && <div className="ml-7 mt-2 rounded-lg border border-edge bg-surface-inset p-3">
      {previewError ? <p role="alert" className="text-sm text-fg-muted">{previewError}</p> : preview ? <>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-fg">{preview.text}</pre>
        {preview.truncated && <p className="mt-2 text-xs text-fg-muted">{t.previewTruncated}</p>}
      </> : <SettingsPageSkeleton sections={1} />}
    </div>}
  </div>;
}
