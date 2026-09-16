import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { correctProjectUnderstanding, fetchProjectUnderstanding, isProjectUnderstandingRunning, startProjectUnderstanding } from './project-understanding-api';

function useCopy() {
  return messages(useLocaleStore((state) => state.language)).projectsPage.understanding;
}

export function ProjectUnderstandingCheckbox({ checked, onChange, disabled }: {
  checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  const copy = useCopy();
  return <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fg">
    <input type="checkbox" className="mt-1 accent-accent" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span>{copy.auto}<span className="mt-1 block text-xs leading-5 text-fg-subtle">{copy.hint}</span></span>
  </label>;
}

function useProjectUnderstanding(projectId: string) {
  const gateway = useGatewayStore((state) => state.baseUrl);
  const conversationId = useGatewayStore((state) => state.conversationId);
  const result = useSWR(conversationId ? ['project-understanding', gateway, conversationId, projectId] : null,
    () => fetchProjectUnderstanding(projectId), {
      refreshInterval: (data) => isProjectUnderstandingRunning(data?.status) ? 3000 : 0,
      revalidateOnFocus: false,
    });
  const { mutate } = result;
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{ id?: string }>).detail?.id === projectId) void mutate();
    };
    window.addEventListener('project-updated', refresh);
    return () => window.removeEventListener('project-updated', refresh);
  }, [mutate, projectId]);
  return result;
}

export function ProjectUnderstandingAction({ projectId, onStarted, className }: {
  projectId: string; onStarted?: () => void; className?: string;
}) {
  const copy = useCopy();
  const { data, mutate } = useProjectUnderstanding(projectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const running = isProjectUnderstandingRunning(data?.status);
  const start = async () => {
    setBusy(true);
    setError(false);
    try {
      await startProjectUnderstanding(projectId);
      await mutate();
      onStarted?.();
    } catch { setError(true); } finally { setBusy(false); }
  };
  return <div>
    <button type="button" className={className ?? 'text-xs text-fg-muted hover:text-fg disabled:opacity-50'} disabled={busy || running}
      onClick={() => void start()}>
      {running || busy ? copy.running : data?.status === 'failed' || data?.status === 'canceled' ? copy.retry : data?.status === 'completed' ? copy.refresh : copy.start}
    </button>
    {error ? <p role="alert" className="px-2 text-xs text-danger">{copy.failed}</p> : null}
  </div>;
}

export function ProjectUnderstandingPanel({ projectId }: { projectId: string }) {
  const copy = useCopy();
  const { data, error, isLoading, mutate } = useProjectUnderstanding(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const save = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      await correctProjectUnderstanding(projectId, draft);
      await mutate();
      setEditing(false);
    } catch { setSaveError(true); } finally { setSaving(false); }
  };
  if (isLoading) return <Skeleton className="h-12 w-full rounded-xl" />;
  return <section className="rounded-xl border border-edge bg-surface-panel px-5 py-3">
    <div className="flex items-center justify-between gap-3 text-xs text-fg-subtle">
      <span>{isProjectUnderstandingRunning(data?.status) ? copy.running : data?.status === 'failed' || data?.status === 'canceled' || error ? copy.failed : copy.title}</span>
      {!isProjectUnderstandingRunning(data?.status) ? <ProjectUnderstandingAction projectId={projectId} /> : null}
    </div>
    {data?.overview ? <details className="mt-2">
      <summary className="cursor-pointer text-sm text-fg-muted">{copy.view}</summary>
      {editing ? <div className="mt-3 space-y-2">
        <textarea aria-label={copy.title} className="min-h-48 w-full rounded-lg border border-edge bg-surface-base p-3 text-sm text-fg" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={6000} disabled={saving} />
        <div className="flex gap-2"><Button onClick={() => void save()} disabled={saving || !draft.trim()}>{copy.save}</Button><Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>{copy.cancel}</Button></div>
        {saveError ? <p role="alert" className="text-xs text-danger">{copy.saveFailed}</p> : null}
      </div> : <div className="mt-3">
        <p className="whitespace-pre-wrap text-sm leading-6 text-fg-muted">{data.overview}</p>
        <button type="button" className="mt-2 text-xs text-fg-subtle hover:text-fg" onClick={() => { setDraft(data.overview ?? ''); setEditing(true); }}>{copy.edit}</button>
      </div>}
    </details> : null}
  </section>;
}
