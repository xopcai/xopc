import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { messages } from '@/i18n/messages';
import { importRequest, type DetectedImportSource, type ImportSource, type ProductImportResult, type ImportInventory, type ImportSelection } from './import-api';
import { ImportSelectionDialog } from './import-selection-dialog';

export function ImportsPage() {
  const t = messages(useLocaleStore(s => s.language)).imports;
  const [sources, setSources] = useState<DetectedImportSource[]>();
  const [source, setSource] = useState<ImportSource>();
  const [open, setOpen] = useState(false);
  const [inventory, setInventory] = useState<ImportInventory>();
  const [selected, setSelected] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ImportSelection>();
  const [retryOf, setRetryOf] = useState<string>();
  const [error, setError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [reload, setReload] = useState(0);
  const scanAbort = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    void importRequest<{ sources: DetectedImportSource[] }>('/sources', undefined, abort.signal)
      .then(data => setSources(data.sources))
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); });
    return () => { abort.abort(); scanAbort.current?.abort(); };
  }, [reload]);
  const runningIds = sources?.flatMap(s => s.lastImport?.status === 'running' ? [s.lastImport.id] : []) ?? [];
  const pollingKey = runningIds.join(',');
  useEffect(() => {
    if (!pollingKey) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      for (const id of pollingKey.split(',')) {
        try {
          const result = await importRequest<ProductImportResult>(`/runs/${id}`, undefined, abort.signal);
          if (!abort.signal.aborted) acceptResult(result);
        } catch { /* A request may still be validating before the run record exists. */ }
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 3000);
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [pollingKey]);
  function acceptResult(result: ProductImportResult) {
    setSources(items => items?.map(item => item.id === result.source ? { ...item, lastImport: result } : item));
    if (result.status !== 'running') setPending(p => p?.requestId === result.id ? undefined : p);
  }
  async function startScan(nextSource: ImportSource) {
    scanAbort.current?.abort();
    const abort = new AbortController(); scanAbort.current = abort;
    setSource(nextSource); setOpen(true); setInventory(undefined); setSelected(new Set()); setDialogError(''); setRetryOf(undefined); setPending(undefined);
    try {
      const next = await importRequest<ImportInventory>(`/sources/${nextSource}/scan`, {}, abort.signal);
      if (!abort.signal.aborted) { setInventory(next); setSelected(new Set(next.candidates.filter(i => !i.parentId && i.suggested).map(i => i.id))); }
    } catch (e) { if (!abort.signal.aborted) setDialogError(e instanceof Error ? e.message : String(e)); }
  }
  async function submit() {
    if (!inventory || !selected.size || submitting.current) return;
    submitting.current = true; setBusy(true); setDialogError(''); setError('');
    const selection = pending ?? { inventoryId: inventory.id, candidateIds: [...selected], requestId: crypto.randomUUID(), retryOf };
    setPending(selection);
    try {
      const result = await importRequest<ProductImportResult>('/runs', selection);
      acceptResult(result); setOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setDialogError(message); setError(message);
      const code = (e as { body?: { code?: string } }).body?.code;
      if (code && ['invalid_input', 'inventory_stale', 'invalid_selection', 'missing_parent', 'not_found', 'conflict'].includes(code)) setPending(undefined);
    } finally { submitting.current = false; setBusy(false); }
  }
  async function retryFailed(result: ProductImportResult) {
    setSource(result.source); setOpen(true); setInventory(undefined); setSelected(new Set()); setDialogError(''); setPending(undefined); setRetryOf(result.id);
    scanAbort.current?.abort();
    const abort = new AbortController(); scanAbort.current = abort;
    try {
      const original = await importRequest<ImportInventory>(`/inventories/${result.inventoryId}`, undefined, abort.signal);
      if (abort.signal.aborted) return;
      const ids = new Set(result.items.filter(i => i.status === 'failed').map(i => i.candidateId));
      original.candidates.forEach(i => { if (ids.has(i.id) && i.parentId) ids.add(i.parentId); });
      setInventory({ ...original, candidates: original.candidates.filter(i => ids.has(i.id)) }); setSelected(ids);
    } catch (e) { if (!abort.signal.aborted) setDialogError(e instanceof Error ? e.message : String(e)); }
  }
  const detected = sources?.filter(s => s.detected || s.lastImport);
  return <SettingsPageFrame>
    <SettingsPageHeader title={t.title} subtitle={t.subtitle} />
    {error && <div role="alert" className="rounded-xl border border-edge p-4 text-sm text-fg"><p>{error}</p>{!sources && <Button variant="ghost" onClick={() => setReload(v => v + 1)}>{t.retry}</Button>}</div>}
    {!sources && !error && <SettingsPageSkeleton sections={1} />}
    {sources && <section className="space-y-4">
      <div><h2 className="text-base font-medium text-fg">{t.apps}</h2><p className="mt-1 text-sm text-fg-muted">{t.detectedHint}</p></div>
      {detected?.length ? <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge">
        {detected.map(item => <article key={item.id} className="space-y-3 p-5 sm:p-6">
          <div className="flex items-center gap-4"><div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-fg"><Download className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><h3 className="font-medium text-fg">{item.name}</h3><p className="mt-1 text-xs text-fg-muted">{t.includes}</p></div>
            <Button variant="secondary" disabled={busy || !item.detected || (!!pending && source !== item.id) || item.lastImport?.status === 'running'} onClick={() => { setError(''); if (pending && source === item.id) setOpen(true); else void startScan(item.id); }}>{busy && source === item.id ? t.importing : pending && source === item.id ? t.retry : item.lastImport ? t.importAgain : t.import}</Button>
          </div>
          {item.lastImport && <div role="status" className="space-y-2 text-sm text-fg-muted">
            <p className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0" />{item.lastImport.status === 'running' ? t.importing : item.lastImport.issues.length ? t.finishedWithIssues : t.finished}</p>
            <p>{t.summary.replace('{skills}', String(item.lastImport.skills)).replace('{context}', String(item.lastImport.context)).replace('{projects}', String(item.lastImport.projects))}{item.lastImport.skipped > 0 && ` · ${t.skipped.replace('{count}', String(item.lastImport.skipped))}`}</p>
            {!!item.lastImport.issues.length && <details><summary className="cursor-pointer text-fg">{t.details} ({item.lastImport.issues.length})</summary><ul className="mt-2 space-y-2">{item.lastImport.issues.map((issue, index) => <li key={index} className="break-words"><span className="font-medium">{issue.name}</span> — {issue.reason}</li>)}</ul></details>}
            {item.lastImport.status === 'partial' && <Button variant="ghost" disabled={busy || !!pending} onClick={() => void retryFailed(item.lastImport!)}>{t.retryFailed}</Button>}
          </div>}
        </article>)}
      </div> : <div className="rounded-2xl border border-edge p-6 text-sm text-fg-muted"><p>{t.empty}</p><Button variant="ghost" className="mt-3" onClick={() => setReload(v => v + 1)}>{t.refresh}</Button></div>}
      <p className="text-xs leading-relaxed text-fg-muted">{t.footnote}</p>
      {detected?.some(s => s.lastImport) && <div className="flex gap-4 text-sm"><Link className="text-accent" to="/skills">{t.openSkills}</Link><Link className="text-accent" to="/projects">{t.openProjects}</Link><Link className="text-accent" to="/connectors">{t.connections}</Link></div>}
    </section>}
    <ImportSelectionDialog open={open} sourceName={sources?.find(s => s.id === source)?.name ?? ''} inventory={inventory} selected={selected} onSelected={setSelected}
      busy={busy} locked={busy || !!pending} error={dialogError} onClose={() => { scanAbort.current?.abort(); setOpen(false); }}
      onRefresh={() => { if (source) void startScan(source); }} onSubmit={() => void submit()} />
  </SettingsPageFrame>;
}
