import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Clock3, Eye, FileText, FolderOpen, GitBranch, Loader2, ShieldCheck, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { BrandLogo } from '@/components/shell/brand-logo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { configureFocusMonitor, respondToFocusCandidate } from '@/features/focuses/api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import {
  cancelWorkDiscoveryRun,
  dismissWorkDiscoveryOnboarding,
  discoverWorkDiscoveryCandidates,
  fetchWorkDiscoveryOnboarding,
  fetchWorkDiscoveryRun,
  grantWorkDiscoveryDirectory,
  previewWorkDiscoveryFolder,
  retryWorkDiscoveryRun,
  selectWorkDiscoverySuggestion,
  startWorkDiscoveryRun,
  submitWorkDiscoveryRecognitionFeedback,
  updateWorkDiscoveryProfile,
  type WorkDiscoveryCandidate,
  type WorkDiscoveryPreview,
  type WorkDiscoveryRun,
  type WorkDiscoveryStage,
  type WorkDiscoverySuggestion,
} from './api';
import { runWorkDiscoveryBatch } from './run-work-discovery-batch';
import { useUnderstandingActivityStore } from './understanding-activity-store';

type PageState = 'loading' | 'intro' | 'candidates' | 'consent' | 'running' | 'recognition' | 'recommendation' | 'error';

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
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correction, setCorrection] = useState('');
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [profileSelection, setProfileSelection] = useState<Set<string>>(() => new Set());
  const [watchActivated, setWatchActivated] = useState(false);
  const [candidates, setCandidates] = useState<WorkDiscoveryCandidate[]>([]);
  const [selectedCandidatePaths, setSelectedCandidatePaths] = useState<Set<string>>(() => new Set());
  const [batchRuns, setBatchRuns] = useState<WorkDiscoveryRun[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchPosition, setBatchPosition] = useState({ current: 0, total: 0 });
  const stopBatchRef = useRef(false);

  const applyRun = useCallback((next: WorkDiscoveryRun) => {
    useUnderstandingActivityStore.getState().updateDirectoryRun(next);
    setRun(next);
    if (next.status === 'completed') {
      setProfileSelection(new Set(
        next.result?.profileCandidates?.filter((candidate) => candidate.status === 'pending').map((candidate) => candidate.id) ?? [],
      ));
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
    let personalContextStarted = false;
    try {
      const results = await runWorkDiscoveryBatch(selected, {
        grantDirectory: grantWorkDiscoveryDirectory,
        startRun: startWorkDiscoveryRun,
        fetchRun: fetchWorkDiscoveryRun,
        shouldStop: () => stopBatchRef.current,
        onRun: (next, index, total) => {
          trackBatchRun(next, index, total);
          if (!personalContextStarted) {
            personalContextStarted = true;
            void useUnderstandingActivityStore.getState().scanPersonalContext(next.id);
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
    if (!run || pageState !== 'running' || batchRunning) return;
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
  }, [applyRun, batchRunning, pageState, run]);

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
    setBatchRuns([]);
    setBatchPosition({ current: 0, total: 0 });
    try {
      await grantWorkDiscoveryDirectory(preview.canonicalRootPath);
      const next = await startWorkDiscoveryRun(preview.canonicalRootPath);
      applyRun(next);
      void useUnderstandingActivityStore.getState().scanPersonalContext(next.id);
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

  const selectBatchRun = (next: WorkDiscoveryRun) => {
    setRun(next);
    setWatchActivated(false);
    setCorrectionOpen(false);
    setAlternativesOpen(false);
    setProfileSelection(new Set(
      next.result?.profileCandidates?.filter((candidate) => candidate.status === 'pending').map((candidate) => candidate.id) ?? [],
    ));
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

  const confirmRecognition = async () => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const candidates = run.result?.profileCandidates ?? [];
      const withProfile = candidates.length > 0
        ? await updateWorkDiscoveryProfile(run.id, candidates.map((candidate) => ({
            id: candidate.id,
            status: profileSelection.has(candidate.id) ? 'accepted' as const : 'rejected' as const,
          })))
        : run;
      const next = await submitWorkDiscoveryRecognitionFeedback(withProfile.id, 'confirmed');
      setRun(next);
      replaceBatchRun(next);
      setPageState('recommendation');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitCorrection = async (decision: 'corrected' | 'different_goal') => {
    if (!run || !correction.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await submitWorkDiscoveryRecognitionFeedback(run.id, decision, correction.trim());
      setRun(next);
      openConversation(next.sessionKey, correction.trim());
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };

  const openWithoutConfirming = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const next = await submitWorkDiscoveryRecognitionFeedback(run.id, 'dismissed');
      openConversation(next.sessionKey);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };

  const activateTrial = async () => {
    const focus = run?.result?.workThreads?.find((thread) => thread.horizon === 'current')
      ?? run?.result?.workThreads?.[0];
    if (!focus) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await respondToFocusCandidate(focus.id, 'accept');
      if (accepted) await configureFocusMonitor(accepted.id, 'progress', true);
      setWatchActivated(true);
    } catch (cause) {
      setError(errorText(cause));
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
    <div className="flex min-h-full flex-1 flex-col bg-surface-base">
      <main className="mx-auto flex w-full max-w-[40rem] flex-1 flex-col px-5 py-10 sm:px-8 sm:py-16">
        <div className="mb-10 flex items-center justify-center">
          <BrandLogo className="size-11" />
        </div>

        {pageState === 'loading' ? (
          <div className="space-y-5" aria-busy>
            <Skeleton className="mx-auto h-8 w-64" />
            <Skeleton className="mx-auto h-4 w-full max-w-lg" />
            <Skeleton className="mx-auto size-4/5 max-w-md" />
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
              {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
            </div>
            <button type="button" className="mx-auto mt-auto pt-10 text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => void skip()} disabled={busy}>
              {copy.skip}
            </button>
          </section>
        ) : null}

        {pageState === 'candidates' ? (
          <section aria-labelledby="work-discovery-candidates-title">
            <div className="text-center">
              <h1 id="work-discovery-candidates-title" className="text-2xl font-semibold tracking-tight text-fg">
                {copy.candidatesTitle}
              </h1>
              <p className="mt-3 text-[0.95rem] leading-7 text-fg-muted">{copy.candidatesSubtitle}</p>
            </div>
            <div className="mt-7 space-y-2">
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
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-edge-subtle bg-surface-panel px-4 py-3 text-xs leading-5 text-fg-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-fg" />
              <span>{copy.multiFolderPrivacyNote}</span>
            </div>
            {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row-reverse">
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
            <button type="button" className="mx-auto mt-6 block text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => setPageState('intro')}>
              {copy.back}
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
          <section aria-labelledby="work-discovery-recognition-title">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-fg">{copy.recognitionEyebrow}</p>
              <h1 id="work-discovery-recognition-title" className="mt-2 text-2xl font-semibold tracking-tight text-fg">
                {run.result.lowConfidence ? copy.lowConfidenceTitle : copy.recognitionTitle}
              </h1>
            </div>
            {batchRunSwitcher}
            <div className="mt-7 rounded-2xl border border-accent/25 bg-gradient-to-br from-accent-soft/45 via-surface-panel to-surface-panel p-5 sm:p-6">
              <p className="text-base font-medium leading-7 text-fg">{run.result.projectSummary}</p>
              <p className="mt-3 text-sm leading-6 text-fg-muted">{run.result.currentState}</p>
              {!run.result.lowConfidence && primarySuggestion?.evidence.length ? (
                <ul className="mt-5 space-y-2 border-t border-edge-subtle pt-4">
                  {primarySuggestion.evidence.slice(0, 3).map((item, index) => (
                    <li key={`${primarySuggestion.id}-recognition-${index}`} className="flex gap-2 text-xs leading-5 text-fg-muted">
                      <GitBranch className="mt-0.5 size-3.5 shrink-0 text-accent-fg" />
                      <span>{item.path ? <><code className="font-mono text-fg">{item.path}</code>: </> : null}{item.observation}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {run.result.workThreads?.length ? (
              <div className="mt-5 rounded-xl border border-edge bg-surface-panel p-4">
                <p className="text-sm font-medium text-fg">{copy.workThreadsTitle}</p>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{copy.workThreadsSubtitle}</p>
                <div className="mt-3 divide-y divide-edge-subtle">
                  {run.result.workThreads.map((thread) => (
                    <div key={thread.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.7rem] font-medium text-accent-fg">
                          {thread.horizon === 'current'
                            ? copy.workThreadCurrent
                            : thread.horizon === 'ongoing'
                              ? copy.workThreadOngoing
                              : copy.workThreadLongTerm}
                        </span>
                        <span className="text-sm font-medium text-fg">{thread.title}</span>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-fg-muted">{thread.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {run.result.profileCandidates?.length ? (
              <div className="mt-5 rounded-xl border border-edge bg-surface-panel p-4">
                <p className="text-sm font-medium text-fg">{copy.profileCandidatesTitle}</p>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{copy.profileCandidatesSubtitle}</p>
                <div className="mt-3 space-y-2">
                  {run.result.profileCandidates.map((candidate) => (
                    <label key={candidate.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-muted">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 rounded border-edge accent-accent"
                        checked={profileSelection.has(candidate.id)}
                        onChange={() => setProfileSelection((current) => {
                          const next = new Set(current);
                          if (next.has(candidate.id)) next.delete(candidate.id);
                          else next.add(candidate.id);
                          return next;
                        })}
                      />
                      <span className="text-sm leading-5 text-fg">{candidate.statement}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {run.result.lowConfidence ? (
              <div className="mt-5">
                <p className="text-sm font-medium leading-6 text-fg">{run.result.contextQuestion}</p>
                <textarea
                  value={correction}
                  onChange={(event) => setCorrection(event.target.value)}
                  placeholder={copy.correctionPlaceholder}
                  className="mt-3 min-h-24 w-full resize-y rounded-xl border border-edge bg-surface-panel px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/15"
                />
                <Button className="mt-3 w-full bg-accent text-white hover:bg-accent-hover" disabled={busy || !correction.trim()} onClick={() => void submitCorrection('different_goal')}>
                  {copy.continueWithCorrection}
                </Button>
              </div>
            ) : (
              <>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
                  <Button className="h-11 flex-1 bg-accent text-white hover:bg-accent-hover" disabled={busy} onClick={() => void confirmRecognition()}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{copy.confirmUnderstanding}
                  </Button>
                  <Button variant="secondary" className="h-11 flex-1" disabled={busy} onClick={() => setCorrectionOpen((open) => !open)}>
                    {copy.notQuiteRight}
                  </Button>
                </div>
                {correctionOpen ? (
                  <div className="mt-4 rounded-xl border border-edge bg-surface-panel p-4">
                    <label className="text-sm font-medium text-fg" htmlFor="work-discovery-correction">{copy.correctionLabel}</label>
                    <textarea
                      id="work-discovery-correction"
                      value={correction}
                      onChange={(event) => setCorrection(event.target.value)}
                      placeholder={copy.correctionPlaceholder}
                      className="mt-2 min-h-24 w-full resize-y rounded-lg border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/15"
                    />
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button variant="ghost" disabled={busy || !correction.trim()} onClick={() => void submitCorrection('different_goal')}>{copy.differentGoal}</Button>
                      <Button variant="primary" disabled={busy || !correction.trim()} onClick={() => void submitCorrection('corrected')}>{copy.useCorrection}</Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
            {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
            <button type="button" disabled={busy} className="mx-auto mt-6 block text-sm text-fg-muted hover:text-fg hover:underline disabled:opacity-60" onClick={() => void openWithoutConfirming()}>{copy.openConversation}</button>
          </section>
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
                    <p className="text-xs font-medium text-fg-muted">{copy.expectedOutcome}</p>
                    <p className="mt-1 text-sm leading-6 text-fg">{primarySuggestion.expectedOutcome}</p>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button className="h-10 bg-accent px-4 text-white hover:bg-accent-hover" onClick={() => void handleSuggestion(primarySuggestion, false)}>{copy.startRecommendedAction}</Button>
                    <Button className="h-10 px-4" variant="secondary" onClick={() => void handleSuggestion(primarySuggestion, true)}>{copy.explainFirst}</Button>
                  </div>
                </div>
              </div>
            </article>
            {run.result.workThreads?.length ? (
              <div className="mt-5 rounded-xl border border-edge bg-surface-panel p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg">
                    {watchActivated ? <Check className="size-4" /> : <Eye className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">
                      {watchActivated ? copy.focusActive : copy.focusTitle}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-fg-muted">
                      {watchActivated ? copy.focusActiveDescription : copy.focusDescription}
                    </p>
                    {!watchActivated ? (
                      <Button className="mt-3 h-9" variant="secondary" disabled={busy} onClick={() => void activateTrial()}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                        {copy.activateFocus}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
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
                        <span><span className="block text-sm font-medium text-fg">{suggestion.title}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{suggestion.expectedOutcome}</span></span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
              <button type="button" className="text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => openConversation(run.sessionKey)}>{copy.doSomethingElse}</button>
              <button type="button" className="text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => { setCorrectionOpen(true); setPageState('recognition'); }}>{copy.correctUnderstanding}</button>
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
