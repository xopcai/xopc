import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Clock3, FileText, FolderOpen, Loader2, ShieldCheck, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { BrandLogo } from '@/components/shell/brand-logo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import type { ElectronUnderstandingSourceDefinition } from '@/types/electron';

import {
  cancelWorkDiscoveryRun,
  dismissWorkDiscoveryOnboarding,
  discoverWorkDiscoveryCandidates,
  fetchWorkDiscoveryOnboarding,
  fetchWorkDiscoveryRun,
  grantUnderstandingWorkFolder,
  previewWorkDiscoveryFolder,
  retryWorkDiscoveryRun,
  selectWorkDiscoverySuggestion,
  startWorkDiscoveryRun,
  submitWorkDiscoveryRecognitionFeedback,
  updateWorkDiscoveryProfile,
  type WorkDiscoveryCandidate,
  type WorkDiscoveryProfileCandidate,
  type WorkDiscoveryPreview,
  type WorkDiscoveryRun,
  type WorkDiscoveryStage,
  type WorkDiscoverySuggestion,
} from './api';
import { runWorkDiscoveryBatch } from './run-work-discovery-batch';
import { UnderstandingReveal } from './understanding-reveal';
import { useUnderstandingActivityStore } from './understanding-activity-store';
import { defaultSelectedLocalSourceIds } from './work-discovery-source-defaults';

type PageState = 'loading' | 'intro' | 'candidates' | 'consent' | 'running' | 'recognition' | 'recommendation' | 'error';

const STAGES: WorkDiscoveryStage[] = ['folder_structure', 'recent_progress', 'next_steps'];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WorkDiscoveryPage({
  embedded = false,
  onRequestClose,
  onConversationOpen,
}: {
  embedded?: boolean;
  onRequestClose?: () => void;
  onConversationOpen?: () => void;
} = {}) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).onboarding.workDiscovery;
  const wd = messages(language).chat.workingDirectory;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const startFresh = embedded || searchParams.get('new') === '1';
  const [pageState, setPageState] = useState<PageState>('loading');
  const [preview, setPreview] = useState<WorkDiscoveryPreview | null>(null);
  const [run, setRun] = useState<WorkDiscoveryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [candidates, setCandidates] = useState<WorkDiscoveryCandidate[]>([]);
  const [selectedCandidatePaths, setSelectedCandidatePaths] = useState<Set<string>>(() => new Set());
  const [batchRuns, setBatchRuns] = useState<WorkDiscoveryRun[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchPosition, setBatchPosition] = useState({ current: 0, total: 0 });
  const [localSources, setLocalSources] = useState<ElectronUnderstandingSourceDefinition[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set());
  const stopBatchRef = useRef(false);
  const understandingMemories = useUnderstandingActivityStore((state) => state.memories);
  const understandingFocuses = useUnderstandingActivityStore((state) => state.focuses);
  const understandingActivityStatus = useUnderstandingActivityStore((state) => state.status);

  const toggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.understandingSources?.catalog().then((sources) => {
      if (cancelled) return;
      setLocalSources(sources);
      setSelectedSourceIds(defaultSelectedLocalSourceIds(sources));
    });
    return () => { cancelled = true; };
  }, []);

  const applyRun = useCallback((next: WorkDiscoveryRun) => {
    useUnderstandingActivityStore.getState().updateDirectoryRun(next);
    setRun(next);
    if (next.status === 'completed') {
      setPageState(next.feedback?.recognitionDecision === 'confirmed' ? 'recommendation' : 'recognition');
    }
    else if (next.status === 'failed' || next.status === 'canceled') setPageState('error');
    else setPageState('running');
  }, []);

  const quickScan = async () => {
    setBusy(true);
    setError(null);
    try {
      const discovered = await discoverWorkDiscoveryCandidates();
      if (!discovered.length) {
        setError(copy.noCandidates);
        return;
      }
      setCandidates(discovered);
      setSelectedCandidatePaths(new Set([discovered[0].rootPath]));
      setPageState('candidates');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleCandidate = (rootPath: string) => {
    setSelectedCandidatePaths((current) => {
      const next = new Set(current);
      if (next.has(rootPath)) next.delete(rootPath);
      else next.add(rootPath);
      return next;
    });
  };

  const trackBatchRun = useCallback((next: WorkDiscoveryRun, index: number, total: number) => {
    useUnderstandingActivityStore.getState().updateDirectoryRun(next);
    setRun(next);
    setBatchPosition({ current: index + 1, total });
    setBatchRuns((current) => {
      const copy = [...current];
      copy[index] = next;
      return copy;
    });
    setPageState('running');
  }, []);

  const replaceBatchRun = useCallback((next: WorkDiscoveryRun) => {
    setBatchRuns((current) => current.map((item) => item?.id === next.id ? next : item));
  }, []);

  const startSelectedCandidates = async () => {
    const selected = candidates.filter((candidate) => selectedCandidatePaths.has(candidate.rootPath));
    if (!selected.length) return;
    setBusy(true);
    setError(null);
    setBatchRuns([]);
    setBatchPosition({ current: 1, total: selected.length });
    setBatchRunning(true);
    stopBatchRef.current = false;
    let sourceCollectionStarted = false;
    try {
      const results = await runWorkDiscoveryBatch(selected, {
        grantDirectory: grantUnderstandingWorkFolder,
        startRun: startWorkDiscoveryRun,
        fetchRun: fetchWorkDiscoveryRun,
        shouldStop: () => stopBatchRef.current,
        onRun: (next, index, total) => {
          trackBatchRun(next, index, total);
          if (!sourceCollectionStarted) {
            sourceCollectionStarted = true;
            void useUnderstandingActivityStore.getState().collectSources(next.id, [...selectedSourceIds]);
          }
        },
        onError: (cause, candidate, index) => {
          setBatchPosition({ current: index + 1, total: selected.length });
          setError(copy.folderAnalysisFailed
            .replace('{{folder}}', candidate.displayName)
            .replace('{{error}}', errorText(cause)));
        },
      });
      if (stopBatchRef.current) return;
      const firstCompleted = results.find((item) => item.status === 'completed');
      const finalRun = firstCompleted ?? results.at(-1);
      if (finalRun) applyRun(finalRun);
      else setPageState('candidates');
    } catch (cause) {
      setError(errorText(cause));
      setPageState('candidates');
    } finally {
      setBatchRunning(false);
      setBusy(false);
    }
  };


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
          if (onRequestClose) onRequestClose();
          else navigate('/chat', { replace: true });
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
  }, [applyRun, navigate, onRequestClose, startFresh]);

  useEffect(() => {
    if (!run || pageState !== 'running' || batchRunning) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await fetchWorkDiscoveryRun(run.id);
        if (!cancelled) applyRun(next);
      } catch {
        // The next poll or gateway realtime event can recover.
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
  }, [applyRun, batchRunning, pageState, run]);

  const skip = async () => {
    setBusy(true);
    try {
      await dismissWorkDiscoveryOnboarding();
    } finally {
      if (onRequestClose) onRequestClose();
      else navigate('/chat', { replace: true });
    }
  };

  const start = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setBatchRuns([]);
    setBatchPosition({ current: 0, total: 0 });
    try {
      await grantUnderstandingWorkFolder(preview.canonicalRootPath);
      const next = await startWorkDiscoveryRun(preview.canonicalRootPath);
      applyRun(next);
      void useUnderstandingActivityStore.getState().collectSources(next.id, [...selectedSourceIds]);
    } catch (cause) {
      setError(errorText(cause));
      setPageState('consent');
    } finally {
      setBusy(false);
    }
  };

  const openConversation = (sessionKey: string, draft?: string, autoSend = false) => {
    const params = new URLSearchParams();
    if (draft) params.set('draft', draft);
    if (draft && autoSend) params.set('autoSend', '1');
    const query = params.toString();
    onConversationOpen?.();
    navigate(`/chat/${encodeURIComponent(sessionKey)}${query ? `?${query}` : ''}`);
  };

  const selectBatchRun = (next: WorkDiscoveryRun) => {
    setRun(next);
    setAlternativesOpen(false);
    if (next.status === 'completed') {
      setPageState(next.feedback?.recognitionDecision === 'confirmed' ? 'recommendation' : 'recognition');
    } else if (next.status === 'failed' || next.status === 'canceled') {
      setPageState('error');
    } else {
      setPageState('running');
    }
  };

  const cancelCurrentAnalysis = async () => {
    if (!run) return;
    stopBatchRef.current = true;
    const canceled = await cancelWorkDiscoveryRun(run.id);
    applyRun(canceled);
  };

  const handleSuggestion = async (suggestion: WorkDiscoverySuggestion, discussOnly: boolean) => {
    if (!run) return;
    await selectWorkDiscoverySuggestion(run.id, suggestion.id).catch(() => {});
    const draft = discussOnly
      ? `${language === 'zh' ? '先帮我评估这个方向，不要修改文件：' : 'First assess this direction without changing files:'}\n\n${suggestion.actionPrompt}`
      : suggestion.actionPrompt;
    openConversation(run.sessionKey, draft);
  };

  const reviewMemory = async (
    candidate: WorkDiscoveryProfileCandidate,
    status: 'accepted' | 'edited' | 'rejected',
    statement?: string,
  ) => {
    if (!run) return false;
    setBusy(true);
    setError(null);
    try {
      const runCandidate = run.result?.profileCandidates?.find((item) => (
        item.id === candidate.id || Boolean(item.understandingId && item.understandingId === candidate.understandingId)
      ));
      const sourceCandidate = understandingMemories.find((item) => (
        item.id === candidate.id || Boolean(item.understandingId && item.understandingId === candidate.understandingId)
      ));
      if (runCandidate) {
        const next = await updateWorkDiscoveryProfile(run.id, [{ id: runCandidate.id, status, ...(statement ? { statement } : {}) }]);
        setRun(next);
        replaceBatchRun(next);
      }
      if (sourceCandidate?.understandingId) {
        await useUnderstandingActivityStore.getState().reviewMemory(sourceCandidate.understandingId, status === 'accepted', statement);
      }
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reviewFocus = async (focusId: string, accepted: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await useUnderstandingActivityStore.getState().reviewFocus(focusId, accepted);
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const completeUnderstandingReveal = async (
    decision: 'confirmed' | 'corrected' | 'different_goal',
    correctedIntent?: string,
  ) => {
    if (!run) return false;
    setBusy(true);
    setError(null);
    try {
      const next = await submitWorkDiscoveryRecognitionFeedback(run.id, decision, correctedIntent);
      setRun(next);
      replaceBatchRun(next);
      setPageState('recommendation');
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startConversationFromUnderstanding = async (
    starter: string,
    decision: 'confirmed' | 'corrected',
  ) => {
    if (!run) return false;
    setBusy(true);
    setError(null);
    try {
      const next = await submitWorkDiscoveryRecognitionFeedback(
        run.id,
        decision,
        decision === 'corrected' ? starter : undefined,
      );
      setRun(next);
      replaceBatchRun(next);
      openConversation(run.sessionKey, starter, true);
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const primarySuggestion = run?.result?.suggestions.find(
    (suggestion) => suggestion.id === run.result?.primarySuggestionId,
  ) ?? run?.result?.suggestions[0];
  const alternativeSuggestions = run?.result?.suggestions.filter(
    (suggestion) => suggestion.id !== primarySuggestion?.id,
  ) ?? [];

  const riskLabel = (risk: WorkDiscoverySuggestion['risk']) => {
    if (risk === 'command') return copy.riskCommand;
    if (risk === 'file_write') return copy.riskFileWrite;
    return copy.riskAnalysis;
  };

  const completedBatchRuns = batchRuns.filter((item): item is WorkDiscoveryRun => item?.status === 'completed');
  const embeddedCandidates = embedded && pageState === 'candidates';
  const batchRunSwitcher = completedBatchRuns.length > 1 ? (
    <div className="mt-6 rounded-xl border border-edge bg-surface-panel p-2">
      <p className="px-2 pb-2 text-xs font-medium text-fg-muted">{copy.analysisResults}</p>
      <div className="flex flex-wrap gap-2">
        {completedBatchRuns.map((item) => {
          const label = candidates.find((candidate) => candidate.rootPath === item.rootPath)?.displayName
            ?? item.rootPath.split(/[\\/]/).filter(Boolean).at(-1)
            ?? item.rootPath;
          return (
            <button
              key={item.id}
              type="button"
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${item.id === run?.id ? 'bg-accent text-white' : 'bg-surface-muted text-fg hover:bg-surface-hover'}`}
              onClick={() => selectBatchRun(item)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div className={embedded
      ? 'xopc-work-discovery-experience relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-base'
      : 'xopc-work-discovery-experience relative flex min-h-full flex-1 flex-col bg-surface-base'}>
      <div className="xopc-onboarding-ambient pointer-events-none absolute inset-0" aria-hidden />
      <main key={pageState} className={embedded
        ? `xopc-work-discovery-stage relative z-10 mx-auto flex h-full min-h-0 w-full ${pageState === 'recognition' ? 'max-w-[58rem]' : 'max-w-[46rem]'} flex-1 flex-col px-5 py-7 sm:px-8 sm:py-9 ${embeddedCandidates ? 'overflow-hidden' : 'overflow-y-auto [scrollbar-gutter:stable]'}`
        : `mx-auto flex w-full ${pageState === 'recognition' ? 'max-w-[58rem]' : 'max-w-[40rem]'} flex-1 flex-col px-5 py-10 sm:px-8 sm:py-16`}>
        {pageState !== 'recognition' ? (
          <div className={cn('flex items-center justify-center', embedded ? 'mb-7 sm:mb-9' : 'mb-10')}>
            <div className="xopc-discovery-logo relative flex size-16 items-center justify-center rounded-[1.35rem] border border-white/75 bg-white/75 shadow-elevated backdrop-blur-xl dark:border-white/10 dark:bg-white/7">
              <span className="xopc-discovery-logo-ring absolute -inset-3 rounded-[1.8rem] border border-accent/10" aria-hidden />
              <BrandLogo className="size-10" />
            </div>
          </div>
        ) : null}

        {pageState === 'loading' ? (
          <div className="mx-auto flex min-h-[26rem] w-full max-w-md flex-col items-center" aria-busy>
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="mt-4 h-4 w-full max-w-sm" />
            <Skeleton className="mt-2 h-4 w-4/5 max-w-xs" />
            <Skeleton className="mt-10 h-12 w-full rounded-xl" />
            <Skeleton className="mt-3 h-11 w-full rounded-xl" />
            <Skeleton className="mt-5 h-4 w-3/5 max-w-56" />
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
              {localSources.length ? (
                <details className="group mb-5 rounded-2xl border border-edge/80 bg-white/55 text-left shadow-surface dark:bg-white/3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-medium text-fg marker:content-none">
                    <span>{copy.localSourcesTitle}</span>
                    <ChevronDown className="size-4 text-fg-muted transition-transform duration-200 group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="border-t border-edge-subtle px-4 pb-4 pt-3">
                    <p className="text-xs leading-5 text-fg-muted">{copy.localSourcesSubtitle}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {localSources.map((source) => {
                      const selected = selectedSourceIds.has(source.id);
                      return (
                        <button
                          key={source.id}
                          type="button"
                          className={cn(
                            'flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                            selected
                              ? 'border-accent/40 bg-accent-soft text-accent-fg'
                              : 'border-edge bg-surface-base text-fg-muted hover:bg-surface-hover hover:text-fg',
                          )}
                          aria-pressed={selected}
                          onClick={() => toggleSource(source.id)}
                        >
                          <span className={cn(
                            'flex size-4 items-center justify-center rounded-full border',
                            selected ? 'border-accent bg-accent text-white' : 'border-edge',
                          )}>
                            {selected ? <Check className="size-3" aria-hidden /> : null}
                          </span>
                          {source.displayName}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                </details>
              ) : null}
              <Button
                type="button"
                className="h-12 w-full gap-2 bg-accent text-white hover:bg-accent-hover"
                onClick={() => void quickScan()}
                disabled={busy || picker.picking}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                {copy.quickScan}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="mt-3 h-11 w-full gap-2"
                onClick={picker.pick}
                disabled={busy || picker.picking}
              >
                {picker.picking ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
                {copy.chooseFolderManually}
              </Button>
              <div className="mt-4 flex items-start justify-center gap-2 text-xs leading-5 text-fg-muted">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-fg" />
                <span>{copy.quickScanNote}</span>
              </div>
              <button
                type="button"
                className="mt-4 text-sm font-medium text-accent-fg hover:underline"
                onClick={() => navigate('/connectors?understanding=1&returnTo=%2Fonboarding%2Fworkspace')}
              >
                {copy.connectCloudSource}
              </button>
              {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
            </div>
            <button type="button" className="mx-auto mt-auto pt-10 text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => void skip()} disabled={busy}>
              {copy.skip}
            </button>
          </section>
        ) : null}

        {pageState === 'candidates' ? (
          <section
            className={embedded ? 'flex h-full min-h-0 flex-col' : undefined}
            aria-labelledby="work-discovery-candidates-title"
          >
            <div className={embedded ? 'shrink-0 text-center' : 'text-center'}>
              <h1 id="work-discovery-candidates-title" className="text-2xl font-semibold tracking-tight text-fg">
                {copy.candidatesTitle}
              </h1>
              <p className="mt-3 text-[0.95rem] leading-7 text-fg-muted">{copy.candidatesSubtitle}</p>
            </div>
            <div className={embedded
              ? 'mt-5 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]'
              : 'mt-7 space-y-2'}>
              {candidates.map((candidate, index) => {
                const selected = selectedCandidatePaths.has(candidate.rootPath);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    aria-pressed={selected}
                    className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${selected ? 'border-accent bg-accent-soft/45' : 'border-edge bg-surface-panel hover:border-edge-strong'}`}
                    onClick={() => toggleCandidate(candidate.rootPath)}
                  >
                    <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-accent bg-accent text-white' : 'border-edge bg-surface-base text-transparent'}`}>
                      <Check className="size-3.5" />
                    </span>
                    <FolderOpen className="mt-0.5 size-5 shrink-0 text-accent-fg" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">{candidate.displayName}</span>
                        {index === 0 ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.7rem] font-medium text-accent-fg">{copy.recommendedCandidate}</span> : null}
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-fg-muted">{candidate.rootPath}</span>
                      <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                        <span>{candidate.projectKind === 'coding' ? copy.codingProject : candidate.projectKind === 'general' ? copy.generalProject : copy.unknownProject}</span>
                        {candidate.branch ? <span>{copy.branchValue.replace('{{branch}}', candidate.branch)}</span> : null}
                        {candidate.changedFileCount > 0 ? <span>{copy.changedFiles.replace('{{count}}', String(candidate.changedFileCount))}</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className={embedded ? 'shrink-0 border-t border-edge-subtle pt-4' : undefined}>
              <div className={`${embedded ? '' : 'mt-5 '}flex items-start gap-2 rounded-xl border border-edge-subtle bg-surface-panel px-4 py-3 text-xs leading-5 text-fg-muted`}>
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-fg" />
                <span>{copy.multiFolderPrivacyNote}</span>
              </div>
              {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
              <div className={`${embedded ? 'mt-4' : 'mt-7'} flex flex-col gap-3 sm:flex-row-reverse`}>
                <Button
                  type="button"
                  className="h-11 flex-1 bg-accent text-white hover:bg-accent-hover"
                  disabled={busy || selectedCandidatePaths.size === 0}
                  onClick={() => void startSelectedCandidates()}
                >
                  {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  {copy.analyzeSelected.replace('{{count}}', String(selectedCandidatePaths.size))}
                </Button>
                <Button type="button" variant="secondary" className="h-11 flex-1" disabled={busy} onClick={picker.pick}>
                  {copy.chooseFolderManually}
                </Button>
              </div>
              <button type="button" className={`${embedded ? 'mt-3' : 'mt-6'} mx-auto block text-sm text-fg-muted hover:text-fg hover:underline`} onClick={() => setPageState('intro')}>
                {copy.back}
              </button>
            </div>
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
              <div className="grid gap-3 border-b border-edge-subtle bg-surface-base/60 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-fg-muted">{copy.localFingerprint}</p>
                  <p className="mt-1 text-sm text-fg">
                    {preview.fingerprint.branch
                      ? copy.branchValue.replace('{{branch}}', preview.fingerprint.branch)
                      : copy.noGitBranch}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-fg-muted">{copy.recentActivity}</p>
                  <p className="mt-1 text-sm text-fg">
                    {copy.changedFiles.replace('{{count}}', String(preview.fingerprint.changedFileCount))}
                  </p>
                </div>
                {preview.fingerprint.recentAreas.length > 0 ? (
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-fg-muted">{copy.recentAreas}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {preview.fingerprint.recentAreas.map((area) => (
                        <code key={area} className="rounded-md bg-surface-muted px-2 py-1 text-xs text-fg">{area}</code>
                      ))}
                    </div>
                  </div>
                ) : null}
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
              {batchPosition.total > 1 ? (
                <p className="mt-2 text-sm font-medium text-accent-fg">
                  {copy.analyzingFolderProgress
                    .replace('{{current}}', String(batchPosition.current))
                    .replace('{{total}}', String(batchPosition.total))}
                </p>
              ) : null}
            </div>
            <div className="xopc-understanding-progress mt-9 rounded-2xl border border-edge/80 bg-white/65 px-5 py-2 shadow-elevated backdrop-blur-xl dark:bg-white/4">
              {STAGES.map((stage, index) => {
                const activeIndex = Math.max(0, STAGES.indexOf(run.stage ?? 'folder_structure'));
                const complete = index < activeIndex;
                const active = index === activeIndex;
                return (
                  <div key={stage} className="xopc-understanding-step flex items-center gap-4 border-b border-edge-subtle py-4 last:border-b-0" data-active={active || undefined} data-complete={complete || undefined}>
                    <span className={`xopc-understanding-step-icon flex size-8 items-center justify-center rounded-full ${complete ? 'bg-accent text-white' : active ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-subtle'}`}>
                      {complete ? <Check className="size-4" /> : active ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <span className="size-1.5 rounded-full bg-current" />}
                    </span>
                    <span className={active || complete ? 'text-sm font-medium text-fg' : 'text-sm text-fg-muted'}>{copy.stages[stage]}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 truncate text-center font-mono text-xs text-fg-muted">{run.rootPath}</p>
            <div className="mx-auto mt-7 flex max-w-md flex-col gap-3">
              <Button type="button" variant="secondary" className="h-11 w-full" onClick={() => navigate('/chat')}>
                {copy.continueInBackground}
              </Button>
              <button type="button" className="mx-auto text-sm text-fg-muted hover:text-danger hover:underline" onClick={() => void cancelCurrentAnalysis()}>
                {copy.cancelAnalysis}
              </button>
            </div>
          </section>
        ) : null}

        {pageState === 'recognition' && run?.result ? (
          <UnderstandingReveal
            key={run.id}
            run={run}
            sourceMemories={understandingMemories}
            focuses={[...(run.result.focusCandidates ?? []), ...understandingFocuses]}
            activityRunning={understandingActivityStatus === 'running'}
            language={language}
            busy={busy}
            error={error}
            onReviewMemory={reviewMemory}
            onReviewFocus={(focus, accepted) => reviewFocus(focus.id, accepted)}
            onFinish={completeUnderstandingReveal}
            onStartConversation={startConversationFromUnderstanding}
          />
        ) : null}

        {pageState === 'recommendation' && run?.result && primarySuggestion ? (
          <section aria-labelledby="work-discovery-recommendation-title">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-fg">{copy.understandingConfirmed}</p>
              <h1 id="work-discovery-recommendation-title" className="mt-2 text-2xl font-semibold tracking-tight text-fg">{copy.primaryRecommendationTitle}</h1>
            </div>
            {batchRunSwitcher}
            <article className="mt-7 rounded-2xl border border-accent/30 bg-surface-panel p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg"><ChevronRight className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-fg">{primarySuggestion.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-fg-muted">{primarySuggestion.rationale}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-fg-muted"><Clock3 className="size-3.5" />{copy.estimatedMinutes.replace('{{count}}', String(primarySuggestion.estimatedMinutes))}</span>
                    <span className="rounded-full bg-surface-muted px-2.5 py-1 text-fg-muted">{riskLabel(primarySuggestion.risk)}</span>
                  </div>
                  <div className="mt-4 rounded-xl bg-surface-base px-4 py-3">
                    <p className="text-xs font-medium text-fg-muted">{copy.expectedTask}</p>
                    <p className="mt-1 text-sm leading-6 text-fg">{primarySuggestion.expectedTask}</p>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button className="h-10 bg-accent px-4 text-white hover:bg-accent-hover" onClick={() => void handleSuggestion(primarySuggestion, false)}>{copy.startRecommendedAction}</Button>
                    <Button className="h-10 px-4" variant="secondary" onClick={() => void handleSuggestion(primarySuggestion, true)}>{copy.explainFirst}</Button>
                  </div>
                </div>
              </div>
            </article>
            {alternativeSuggestions.length > 0 ? (
              <div className="mt-5 border-t border-edge-subtle pt-4">
                <button type="button" className="flex w-full items-center justify-between py-2 text-sm font-medium text-fg-muted hover:text-fg" onClick={() => setAlternativesOpen((open) => !open)}>
                  {copy.otherDirections}
                  <ChevronDown className={`size-4 transition-transform ${alternativesOpen ? 'rotate-180' : ''}`} />
                </button>
                {alternativesOpen ? (
                  <div className="mt-2 divide-y divide-edge-subtle rounded-xl border border-edge bg-surface-panel px-4">
                    {alternativeSuggestions.map((suggestion) => (
                      <button key={suggestion.id} type="button" className="flex w-full items-start gap-3 py-4 text-left" onClick={() => void handleSuggestion(suggestion, true)}>
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                        <span><span className="block text-sm font-medium text-fg">{suggestion.title}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{suggestion.expectedTask}</span></span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
              <button type="button" className="text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => openConversation(run.sessionKey)}>{copy.doSomethingElse}</button>
              <button type="button" className="text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => setPageState('recognition')}>{copy.correctUnderstanding}</button>
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
