import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { messages } from '@/i18n/messages';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { importRequest, type ImportInventory, type InventoryItem } from './import-api';
import { selectable, toggleItem } from './selection';

export function ImportSelectionDialog({ open, sourceName, inventory, selected, onSelected, busy, locked, error, onClose, onRefresh, onSubmit }: {
  open: boolean; sourceName: string; inventory?: ImportInventory; selected: Set<string>; onSelected: (ids: Set<string>) => void;
  busy: boolean; locked: boolean; error: string; onClose: () => void; onRefresh: () => void; onSubmit: () => void;
}) {
  const t = messages(useLocaleStore(s => s.language)).imports;
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [inventory?.id]);
  const matches = (item: InventoryItem) => `${item.name} ${item.description} ${item.displayPath}`.toLowerCase().includes(query.toLowerCase().trim());
  const chosen = inventory?.candidates.filter(c => selected.has(c.id)) ?? [];
  const summary = t.selected.replace('{skills}', String(chosen.filter(c => c.kind === 'skill').length))
    .replace('{context}', String(chosen.filter(c => c.kind === 'context').length)).replace('{projects}', String(chosen.filter(c => c.kind === 'project').length));
  const toggle = (item: InventoryItem, checked: boolean) => { if (inventory) onSelected(toggleItem(inventory, selected, item, checked)); };
  const category = (kind: 'skill' | 'context') => {
    const all = inventory!.candidates.filter(i => i.kind === kind && !i.parentId);
    if (!all.length) return null;
    const visible = all.filter(matches);
    return <section className="space-y-2" aria-label={t.kinds[kind]}>
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium text-fg">{t.kinds[kind]} · {all.filter(i => selected.has(i.id)).length}/{all.length}</h3>
        <div className="flex gap-2"><Button variant="ghost" disabled={locked || !visible.some(selectable)} onClick={() => { const next = new Set(selected); visible.filter(selectable).forEach(i => next.add(i.id)); onSelected(next); }}>{t.selectVisible}</Button>
          <Button variant="ghost" disabled={locked} onClick={() => { const next = new Set(selected); visible.forEach(i => next.delete(i.id)); onSelected(next); }}>{t.clearVisible}</Button></div></div>
      {visible.map(item => <ImportItemRow key={item.id} inventoryId={inventory!.id} item={item} checked={selected.has(item.id)} disabled={locked} onChange={checked => toggle(item, checked)} />)}
    </section>;
  };
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className={`fixed inset-0 bg-scrim ${SETTINGS_SHELL_OVERLAY_Z}`} />
    <Dialog.Content className={`fixed left-1/2 top-1/2 flex h-[min(calc(100dvh-2rem),760px)] w-[min(calc(100%-2rem),760px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel outline-none ${SETTINGS_SHELL_CONTENT_Z}`}>
      <header className="shrink-0 space-y-2 border-b border-edge p-4 sm:p-5"><div className="flex items-center justify-between gap-2">
        <Dialog.Title className="text-lg font-semibold text-fg">{t.chooseTitle.replace('{source}', sourceName)}</Dialog.Title>
        <Dialog.Close asChild><Button variant="ghost" aria-label={t.close} className="h-8 w-8 shrink-0 p-0"><X className="h-4 w-4" /></Button></Dialog.Close>
      </div><Dialog.Description className="text-sm text-fg-muted">{t.chooseHint}</Dialog.Description>
        <input aria-label={t.search} placeholder={t.search} value={query} onChange={e => setQuery(e.target.value)} className="w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg" />
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
        {error && <div role="alert" className="space-y-2 rounded-lg border border-edge p-3 text-sm text-fg"><p>{error}</p><Button variant="secondary" disabled={locked} onClick={onRefresh}>{t.refresh}</Button></div>}
        {!inventory && !error && <SettingsPageSkeleton sections={2} />}
        {inventory && <>
          {!inventory.complete && <p className="text-sm text-fg-muted">{t.incomplete}</p>}
          {category('skill')}{category('context')}
          <section aria-label={t.kinds.project} className="space-y-2"><h3 className="text-sm font-medium text-fg">{t.kinds.project} · {chosen.filter(c => c.kind === 'project').length}/{inventory.candidates.filter(c => c.kind === 'project').length}</h3>
            <p className="text-xs text-fg-muted">{t.projectHint}</p>
            {inventory.candidates.filter(i => i.kind === 'project').map(project => {
              const children = inventory.candidates.filter(i => i.parentId === project.id);
              if (!matches(project) && !children.some(matches)) return null;
              return <div key={project.id} className="rounded-xl border border-edge p-3">
                <ImportItemRow inventoryId={inventory.id} item={project} checked={selected.has(project.id)} disabled={locked} onChange={checked => toggle(project, checked)} />
                {children.length ? <details open={query.trim() ? true : undefined} className="mt-2 text-sm text-fg-muted"><summary className="cursor-pointer">{t.projectContents.replace('{skills}', String(children.filter(i => i.kind === 'skill').length)).replace('{context}', String(children.filter(i => i.kind === 'context').length))} · {t.chosenCount.replace('{count}', String(children.filter(i => selected.has(i.id)).length))}</summary>
                  <div className="mt-2 space-y-2 border-l border-edge pl-3">{children.filter(i => matches(project) || matches(i)).map(item => <ImportItemRow key={item.id} inventoryId={inventory.id} item={item} checked={selected.has(item.id)} disabled={locked} onChange={checked => toggle(item, checked)} />)}</div>
                </details> : <p className="pl-7 text-xs text-fg-muted">{t.directoryOnly}</p>}
              </div>;
            })}
          </section>
          {!inventory.candidates.length && <p className="text-sm text-fg-muted">{t.noContent}</p>}
          {!!inventory.notices.length && <details className="text-sm text-fg-muted"><summary className="cursor-pointer">{t.scanNotices} ({inventory.notices.length})</summary><ul className="mt-2 space-y-2">{inventory.notices.map((notice, index) => <li key={index} className="break-words">{notice}</li>)}</ul></details>}
        </>}
      </div>
      <footer className="shrink-0 space-y-3 border-t border-edge p-4 sm:p-5"><p aria-live="polite" className="text-sm text-fg-muted">{summary}</p>
        {busy && <p className="text-xs text-fg-muted">{t.runningHint}</p>}
        {locked && !busy && <p className="text-xs text-fg-muted">{t.retryHint}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{busy ? t.close : t.cancel}</Button><Button disabled={!inventory || !selected.size || busy} onClick={onSubmit}>{busy ? t.importing : locked ? t.retry : t.importSelected}</Button></div>
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function ImportItemRow({ inventoryId, item, checked, disabled, onChange }: { inventoryId: string; item: InventoryItem; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  const t = messages(useLocaleStore(s => s.language)).imports;
  const [preview, setPreview] = useState<{ text: string; truncated: boolean }>();
  const [previewError, setPreviewError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  async function view() {
    setShowPreview(v => !v);
    if (preview) return;
    try { setPreview(await importRequest(`/inventories/${inventoryId}/items/${item.id}/preview`)); }
    catch (e) { setPreviewError(e instanceof Error ? e.message : String(e)); }
  }
  return <div className="min-w-0 space-y-1 rounded-lg p-1">
    <div className="flex items-start gap-2"><label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-accent" checked={checked} disabled={disabled || !selectable(item)} onChange={e => onChange(e.target.checked)} />
      <span className="min-w-0"><span className="block break-words text-sm font-medium text-fg">{item.name}</span><span className="block break-all text-xs text-fg-muted">{item.displayPath}</span></span>
    </label>{item.kind !== 'project' && item.status !== 'blocked' && <Button variant="ghost" aria-label={`${t.preview}: ${item.name}`} onClick={() => void view()}>{t.preview}</Button>}</div>
    {item.description && <p className="pl-7 text-xs text-fg-muted">{item.description}</p>}
    {item.status !== 'ready' && <p className="pl-7 text-xs text-fg-muted">{item.kind === 'project' && item.status === 'existing' ? t.existingProject : t.statuses[item.status]}{item.status === 'conflict' ? ` → ${item.targetName}` : ''}</p>}
    {item.reason && <p className="break-words pl-7 text-xs text-fg-muted">{item.reason}</p>}
    {showPreview && <div className="ml-7 rounded-lg border border-edge p-3">{previewError ? <p role="alert" className="text-sm text-fg-muted">{previewError}</p> : preview ? <><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-fg">{preview.text}</pre>{preview.truncated && <p className="mt-2 text-xs text-fg-muted">{t.previewTruncated}</p>}</> : <SettingsPageSkeleton sections={1} />}</div>}
  </div>;
}
