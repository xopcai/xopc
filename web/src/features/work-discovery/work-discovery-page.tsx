import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, FileText, FolderOpen, GitBranch, Loader2, ShieldCheck, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { BrandLogo } from '@/components/shell/brand-logo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import {
  cancelWorkDiscoveryRun,
  dismissWorkDiscoveryOnboarding,
  fetchWorkDiscoveryOnboarding,
  fetchWorkDiscoveryRun,
  previewWorkDiscoveryFolder,
  retryWorkDiscoveryRun,
  selectWorkDiscoverySuggestion,
  startWorkDiscoveryRun,
  type WorkDiscoveryPreview,
  type WorkDiscoveryRun,
  type WorkDiscoveryStage,
  type WorkDiscoverySuggestion,
} from './api';

type PageState = 'loading' | 'intro' | 'consent' | 'running' | 'result' | 'error';

const STAGES: WorkDiscoveryStage[] = ['folder_structure', 'recent_progress', 'next_steps'];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WorkDiscoveryPage() {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).onboarding.workDiscovery;
  const wd = messages(language).chat.workingDirectory;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const startFresh = searchParams.get('new') === '1';
  const [pageState, setPageState] = useState<PageState>('loading');
  const [preview, setPreview] = useState<WorkDiscoveryPreview | null>(null);
  const [run, setRun] = useState<WorkDiscoveryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyRun = useCallback((next: WorkDiscoveryRun) => {
    setRun(next);
    if (next.status === 'completed') setPageState('result');
    else if (next.status === 'failed' || next.status === 'canceled') setPageState('error');
    else setPageState('running');
  }, []);

  const selectFolder = useCallback(async (rootPath: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await previewWorkDiscoveryFolder(rootPath);
      setPreview(next);
      setPageState('consent');
    } catch (cause) {
      setError(errorText(cause));
      setPageState('intro');
    } finally {
      setBusy(false);
    }
  }, []);

  const picker = useDirectoryPicker({ onPicked: selectFolder });

  useEffect(() => {
    let cancelled = false;
    void fetchWorkDiscoveryOnboarding()
      .then(async ({ enabled, state }) => {
        if (cancelled) return;
        if (!enabled) {
          navigate('/chat', { replace: true });
          return;
        }
        if (!startFresh && state.activeRunId) {
          try {
            const active = await fetchWorkDiscoveryRun(state.activeRunId);
            if (!cancelled) applyRun(active);
            return;
          } catch {
            // Fall back to the introduction if the saved run was removed.
          }
        }
        if (!cancelled) setPageState('intro');
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(errorText(cause));
          setPageState('intro');
        }
      });
    return () => { cancelled = true; };
  }, [applyRun, navigate, startFresh]);

  useEffect(() => {
    if (!run || pageState !== 'running') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await fetchWorkDiscoveryRun(run.id);
        if (!cancelled) applyRun(next);
      } catch {
        // The next poll or gateway SSE event can recover.
      }
    };
    const timer = window.setInterval(() => void refresh(), 1_200);
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string }>).detail;
      if (!detail?.runId || detail.runId === run.id) void refresh();
    };
    for (const name of ['work-discovery-progress', 'work-discovery-completed', 'work-discovery-failed', 'work-discovery-canceled']) {
      window.addEventListener(name, onEvent);
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      for (const name of ['work-discovery-progress', 'work-discovery-completed', 'work-discovery-failed', 'work-discovery-canceled']) {
        window.removeEventListener(name, onEvent);
      }
    };
  }, [applyRun, pageState, run]);

  const skip = async () => {
    setBusy(true);
    try {
      await dismissWorkDiscoveryOnboarding();
    } finally {
      navigate('/chat', { replace: true });
    }
  };

  const start = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      applyRun(await startWorkDiscoveryRun(preview.canonicalRootPath));
    } catch (cause) {
      setError(errorText(cause));
      setPageState('consent');
    } finally {
      setBusy(false);
    }
  };

  const openConversation = (sessionKey: string, draft?: string) => {
    const query = draft ? `?draft=${encodeURIComponent(draft)}` : '';
    navigate(`/chat/${encodeURIComponent(sessionKey)}${query}`);
  };

  const handleSuggestion = async (suggestion: WorkDiscoverySuggestion, discussOnly: boolean) => {
    if (!run) return;
    await selectWorkDiscoverySuggestion(run.id, suggestion.id).catch(() => {});
    const draft = discussOnly
      ? `${language === 'zh' ? '先帮我评估这个方向，不要修改文件：' : 'First assess this direction without changing files:'}\n\n${suggestion.actionPrompt}`
      : suggestion.actionPrompt;
    openConversation(run.sessionKey, draft);
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface-base">
      <main className="mx-auto flex w-full max-w-[40rem] flex-1 flex-col px-5 py-10 sm:px-8 sm:py-16">
        <div className="mb-10 flex items-center justify-center">
          <BrandLogo className="size-11" />
        </div>

        {pageState === 'loading' ? (
          <div className="space-y-5" aria-busy>
            <Skeleton className="mx-auto h-8 w-64" />
            <Skeleton className="mx-auto h-4 w-full max-w-lg" />
            <Skeleton className="mx-auto h-4 w-4/5 max-w-md" />
            <Skeleton className="mt-8 h-12 w-full rounded-xl" />
          </div>
        ) : null}

        {pageState === 'intro' ? (
          <section className="flex flex-1 flex-col text-center" aria-labelledby="work-discovery-title">
            <div className="mx-auto max-w-[36rem]">
              <h1 id="work-discovery-title" className="text-2xl font-semibold tracking-tight text-fg">
                {copy.title}
              </h1>
              <p className="mx-auto mt-3 max-w-[34rem] text-[0.95rem] leading-7 text-fg-muted">{copy.subtitle}</p>
            </div>
            <div className="mx-auto mt-9 w-full max-w-md">
              <Button
                type="button"
                className="h-12 w-full gap-2 bg-accent text-white hover:bg-accent-hover"
                onClick={picker.pick}
                disabled={busy || picker.picking}
              >
                {busy || picker.picking ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
                {copy.chooseFolder}
              </Button>
              <div className="mt-4 flex items-start justify-center gap-2 text-xs leading-5 text-fg-muted">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-fg" />
                <span>{copy.readOnlyNote}</span>
              </div>
              {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
            </div>
            <button type="button" className="mx-auto mt-auto pt-10 text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => void skip()} disabled={busy}>
              {copy.skip}
            </button>
          </section>
        ) : null}

        {pageState === 'consent' && preview ? (
          <section aria-labelledby="work-discovery-consent-title">
            <div className="text-center">
              <h1 id="work-discovery-consent-title" className="text-2xl font-semibold tracking-tight text-fg">{copy.selectedTitle}</h1>
              <p className="mt-3 text-[0.95rem] leading-7 text-fg-muted">{copy.selectedSubtitle}</p>
            </div>
            <div className="mt-8 overflow-hidden rounded-xl border border-edge bg-surface-panel">
              <div className="flex items-center gap-3 border-b border-edge-subtle px-4 py-3.5">
                <FolderOpen className="size-5 shrink-0 text-accent-fg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{preview.displayName}</p>
                  <p className="truncate font-mono text-xs text-fg-muted">{preview.canonicalRootPath}</p>
                </div>
                <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-fg">
                  {preview.projectKind === 'coding' ? copy.codingProject : preview.projectKind === 'general' ? copy.generalProject : copy.unknownProject}
                </span>
              </div>
              <div className="divide-y divide-edge-subtle px-4">
                <div className="flex gap-3 py-4">
                  <FileText className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                  <div><p className="text-sm font-medium text-fg">{copy.willRead}</p><p className="mt-1 text-sm leading-6 text-fg-muted">{copy.willReadValue}</p></div>
                </div>
                <div className="flex gap-3 py-4">
                  <X className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                  <div><p className="text-sm font-medium text-fg">{copy.willIgnore}</p><p className="mt-1 text-sm leading-6 text-fg-muted">{copy.willIgnoreValue}</p></div>
                </div>
                <div className="flex gap-3 py-4">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-fg" />
                  <p className="text-sm leading-6 text-fg-muted">
                    {preview.remoteModel ? copy.providerDisclosure.replace('{{provider}}', preview.provider) : copy.localDisclosure}
                  </p>
                </div>
              </div>
            </div>
            {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row-reverse">
              <Button type="button" className="h-11 flex-1 bg-accent text-white hover:bg-accent-hover" disabled={busy} onClick={() => void start()}>
                {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}{copy.startAnalysis}
              </Button>
              <Button type="button" variant="secondary" className="h-11 flex-1" disabled={busy} onClick={picker.pick}>{copy.changeFolder}</Button>
            </div>
            <button type="button" className="mx-auto mt-6 block text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => void skip()}>{copy.skip}</button>
          </section>
        ) : null}

        {pageState === 'running' && run ? (
          <section aria-labelledby="work-discovery-running-title" aria-live="polite">
            <div className="text-center">
              <h1 id="work-discovery-running-title" className="text-2xl font-semibold tracking-tight text-fg">{copy.analyzingTitle}</h1>
              <p className="mt-3 text-[0.95rem] leading-7 text-fg-muted">{copy.analyzingSubtitle}</p>
            </div>
            <div className="mt-9 rounded-xl border border-edge bg-surface-panel px-5 py-2">
              {STAGES.map((stage, index) => {
                const activeIndex = Math.max(0, STAGES.indexOf(run.stage ?? 'folder_structure'));
                const complete = index < activeIndex;
                const active = index === activeIndex;
                return (
                  <div key={stage} className="flex items-center gap-4 border-b border-edge-subtle py-4 last:border-b-0">
                    <span className={`flex size-7 items-center justify-center rounded-full ${complete ? 'bg-accent text-white' : active ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-subtle'}`}>
                      {complete ? <Check className="size-4" /> : active ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <span className="size-1.5 rounded-full bg-current" />}
                    </span>
                    <span className={active || complete ? 'text-sm font-medium text-fg' : 'text-sm text-fg-muted'}>{copy.stages[stage]}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 truncate text-center font-mono text-xs text-fg-muted">{run.rootPath}</p>
            <button type="button" className="mx-auto mt-7 block text-sm text-fg-muted hover:text-danger hover:underline" onClick={() => void cancelWorkDiscoveryRun(run.id).then(applyRun)}>
              {copy.cancelAnalysis}
            </button>
          </section>
        ) : null}

        {pageState === 'result' && run?.result ? (
          <section aria-labelledby="work-discovery-result-title">
            <div className="text-center">
              <h1 id="work-discovery-result-title" className="text-2xl font-semibold tracking-tight text-fg">
                {run.result.lowConfidence ? copy.lowConfidenceTitle : copy.foundTitle}
              </h1>
              <p className="mt-3 text-[0.95rem] leading-7 text-fg-muted">{run.result.projectSummary}</p>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{run.result.currentState}</p>
            </div>
            {run.result.lowConfidence ? (
              <div className="mt-8 rounded-xl border border-edge bg-surface-panel p-5 text-center">
                <p className="text-sm font-medium leading-6 text-fg">{run.result.contextQuestion}</p>
                <Button className="mt-5 bg-accent text-white hover:bg-accent-hover" onClick={() => openConversation(run.sessionKey, run.result?.contextQuestion)}>{copy.openConversation}</Button>
              </div>
            ) : (
              <div className="mt-9">
                <h2 className="text-sm font-semibold text-fg">{copy.suggestionsTitle}</h2>
                <div className="mt-3 divide-y divide-edge-subtle border-y border-edge-subtle">
                  {run.result.suggestions.map((suggestion) => (
                    <article key={suggestion.id} className="py-5">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg"><ChevronRight className="size-4" /></div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-semibold text-fg">{suggestion.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-fg-muted">{suggestion.rationale}</p>
                          <ul className="mt-3 space-y-1.5">
                            {suggestion.evidence.map((item, index) => (
                              <li key={`${suggestion.id}-${index}`} className="flex gap-2 text-xs leading-5 text-fg-muted">
                                <GitBranch className="mt-0.5 size-3.5 shrink-0" />
                                <span>{item.path ? <><code className="font-mono text-fg">{item.path}</code>: </> : null}{item.observation}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button className="h-9 bg-accent px-3 py-1.5 text-white hover:bg-accent-hover" onClick={() => void handleSuggestion(suggestion, false)}>{copy.continue}</Button>
                            <Button className="h-9 px-3 py-1.5" variant="secondary" onClick={() => void handleSuggestion(suggestion, true)}>{copy.discussFirst}</Button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
              <button type="button" className="text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => openConversation(run.sessionKey)}>{copy.openConversation}</button>
              <button type="button" className="text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => { setRun(null); setPreview(null); setPageState('intro'); }}>{copy.notAccurate}</button>
            </div>
          </section>
        ) : null}

        {pageState === 'error' && run ? (
          <section className="text-center" aria-labelledby="work-discovery-error-title">
            <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-danger-soft text-danger"><X className="size-5" /></div>
            <h1 id="work-discovery-error-title" className="mt-5 text-2xl font-semibold tracking-tight text-fg">{copy.errorTitle}</h1>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-fg-muted">{run.errorMessage}</p>
            <div className="mx-auto mt-7 flex max-w-md flex-col gap-3 sm:flex-row-reverse">
              <Button className="h-11 flex-1 bg-accent text-white hover:bg-accent-hover" onClick={() => void retryWorkDiscoveryRun(run.id).then(applyRun)}>{copy.retry}</Button>
              <Button variant="secondary" className="h-11 flex-1" onClick={() => { setRun(null); setPreview(null); setPageState('intro'); }}>{copy.chooseDifferent}</Button>
            </div>
            <button type="button" className="mt-6 text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => openConversation(run.sessionKey)}>{copy.openConversation}</button>
          </section>
        ) : null}
      </main>

      {!picker.hasNativePicker ? (
        <WorkingDirectoryPickerModal
          open={picker.modalOpen}
          onOpenChange={picker.setModalOpen}
          initialAbsolutePath={preview?.canonicalRootPath}
          onConfirm={picker.confirmPick}
          wd={wd}
        />
      ) : null}
    </div>
  );
}
