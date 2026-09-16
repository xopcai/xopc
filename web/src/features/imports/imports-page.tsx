import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { messages } from '@/i18n/messages';
import { importRequest, type DetectedImportSource, type ImportSource, type ProductImportResult } from './import-api';

export function ImportsPage() {
  const t = messages(useLocaleStore(s => s.language)).imports;
  const [sources, setSources] = useState<DetectedImportSource[]>();
  const [busy, setBusy] = useState<ImportSource>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let mounted = true;
    setError('');
    void importRequest<{ sources: DetectedImportSource[] }>('/sources')
      .then(data => { if (mounted) setSources(data.sources); })
      .catch(e => { if (mounted) setError(e instanceof Error ? e.message : String(e)); });
    return () => { mounted = false; };
  }, [reload]);
  async function run(source: ImportSource) {
    setBusy(source); setError('');
    try {
      const result = await importRequest<ProductImportResult>(`/sources/${source}/import`, { requestId: crypto.randomUUID() });
      setSources(items => items?.map(item => item.id === source ? { ...item, lastImport: result } : item));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(undefined); }
  }
  const detected = sources?.filter(s => s.detected || s.lastImport);
  return <SettingsPageFrame>
    <SettingsPageHeader title={t.title} subtitle={t.subtitle} />
    {error && <div role="alert" className="rounded-xl border border-edge p-4 text-sm text-fg"><p>{error}</p>{!sources && <Button variant="ghost" onClick={() => setReload(v => v + 1)}>{t.retry}</Button>}</div>}
    {!sources && !error && <SettingsPageSkeleton sections={1} />}
    {sources && <section className="space-y-4">
      <div><h2 className="text-base font-medium text-fg">{t.apps}</h2><p className="mt-1 text-sm text-fg-muted">{t.detectedHint}</p></div>
      {detected?.length ? <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge">
        {detected.map(source => <article key={source.id} className="p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-fg"><Download className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><h3 className="font-medium text-fg">{source.name}</h3><p className="mt-1 text-xs text-fg-muted">{t.includes}</p></div>
            <Button variant="secondary" disabled={!!busy || !source.detected} onClick={() => void run(source.id)}>
              {busy === source.id && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              {busy === source.id ? t.importing : source.lastImport ? t.importAgain : t.import}
            </Button>
          </div>
          {source.lastImport && <div role="status" className="mt-4 space-y-2 text-sm text-fg-muted">
            <p className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0" />{source.lastImport.issues.length ? t.finishedWithIssues : t.finished}</p>
            <p>{t.summary.replace('{skills}', String(source.lastImport.skills)).replace('{context}', String(source.lastImport.context)).replace('{projects}', String(source.lastImport.projects))}{source.lastImport.skipped > 0 && ` · ${t.skipped.replace('{count}', String(source.lastImport.skipped))}`}</p>
            {!!source.lastImport.issues.length && <details><summary className="cursor-pointer text-fg">{t.details} ({source.lastImport.issues.length})</summary><ul className="mt-2 space-y-2">{source.lastImport.issues.map((issue, index) => <li key={index} className="break-words"><span className="font-medium">{issue.name}</span> — {issue.reason}</li>)}</ul></details>}
          </div>}
        </article>)}
      </div> : <div className="rounded-2xl border border-edge p-6 text-sm text-fg-muted"><p>{t.empty}</p><Button variant="ghost" className="mt-3" onClick={() => setReload(v => v + 1)}>{t.refresh}</Button></div>}
      <p className="text-xs leading-relaxed text-fg-muted">{t.footnote}</p>
      {detected?.some(s => s.lastImport) && <div className="flex gap-4 text-sm"><Link className="text-accent" to="/skills">{t.openSkills}</Link><Link className="text-accent" to="/projects">{t.openProjects}</Link><Link className="text-accent" to="/connectors">{t.connections}</Link></div>}
    </section>}
  </SettingsPageFrame>;
}
