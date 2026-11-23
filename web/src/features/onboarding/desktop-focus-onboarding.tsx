import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Compass,
  CornerDownLeft,
  FileSpreadsheet,
  FileText,
  FolderGit2,
  FolderOpen,
  GitBranch,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Paperclip,
  Plus,
  Presentation,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  User,
  Wand2,
  X,
} from 'lucide-react';
import { type ClipboardEvent, type DragEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Loopi } from '@/components/brand/loopi';
import { APP_CHROME_BAR_CLASS, APP_CHROME_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { appendTranscriptToDraft } from '@/features/chat/composer/append-transcript-to-draft';
import { collectClipboardFiles } from '@/features/chat/composer/composer-clipboard';
import { createComposerPayloadHandoff } from '@/features/chat/composer/composer-payload-handoff';
import { ComposerVoiceInputBar } from '@/features/chat/composer/composer-voice-input-bar';
import { ComposerVoiceInputButton } from '@/features/chat/composer/composer-voice-input-button';
import { useComposerAttachments } from '@/features/chat/composer/use-composer-attachments';
import { newChatAutoSendHref } from '@/features/chat/session/composer-handoff-params';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import type { DetectedImportSource } from '@/features/imports/import-api';
import {
  formatContextualSourceSnippet,
  matchContextualLocalSource,
} from '@/features/onboarding/desktop-contextual-setup';
import { markDesktopHabitAnchorPending } from '@/features/onboarding/desktop-habit-toast';
import {
  importSafeAiToolConfigs,
  prefetchDesktopOnboardingContext,
  recordCurrentFocusPriority,
} from '@/features/onboarding/desktop-onboarding-bootstrap';
import {
  buildFallbackStarters,
  buildLocalSignals,
  buildThreadCardsFromFolderRun,
  buildThreadCardsFromLocalUnderstanding,
  collectRevealEvidence,
  compactPath,
  normalizeTraitChips,
  type LocalSignalItem,
  type ThreadCard,
  type TraitChip,
} from '@/features/onboarding/desktop-understanding-helpers';
import { OnboardingLanguageSwitch } from '@/features/onboarding/onboarding-language-switch';
import {
  addCollaborationPreference,
  setAssertionStatus,
} from '@/features/user-model/user-model-api';
import { useRealtimeVoice } from '@/features/voice/realtime/use-realtime-voice';
import {
  cancelWorkDiscoveryRun,
  dismissWorkDiscoveryOnboarding,
  fetchWorkDiscoveryOnboarding,
  fetchWorkDiscoveryRun,
  grantUnderstandingWorkFolder,
  importUnderstandingSources,
  retryWorkDiscoveryRun,
  selectWorkDiscoverySuggestion,
  startWorkDiscoveryRun,
  submitWorkDiscoveryRecognitionFeedback,
  type WorkDiscoveryCandidate,
  type WorkDiscoveryProcessingTarget,
  type WorkDiscoveryProfileCandidate,
  type WorkDiscoveryRecentFile,
  type WorkDiscoveryRun,
  type WorkDiscoveryStage,
  type WorkUnderstandingThread,
} from '@/features/work-discovery/api';
import { useUnderstandingActivityStore } from '@/features/work-discovery/understanding-activity-store';
import {
  UnderstandingSourceConvergence,
  type UnderstandingSignal,
} from '@/features/work-discovery/understanding-source-convergence';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectronDarwin } from '@/lib/electron-window-chrome';
import { useLocaleStore } from '@/stores/locale-store';
import type { ElectronUnderstandingSourceDefinition } from '@/types/electron';

type FocusStage = 'focus' | 'analyzing' | 'reveal' | 'error';
type AnalysisMode = 'local_files' | 'folder';

type LocalUnderstandingSnapshot = {
  profileCandidates: WorkDiscoveryProfileCandidate[];
  workThreads: WorkUnderstandingThread[];
  sampledDocs: Array<{ title: string; group?: string }>;
};

const FOLDER_STAGES: WorkDiscoveryStage[] = ['folder_structure', 'recent_progress', 'next_steps'];

function FileKindIcon({ extension, className }: { extension: string; className?: string }) {
  if (extension === '.xlsx' || extension === '.xls' || extension === '.csv' || extension === '.numbers') {
    return <FileSpreadsheet className={cn('text-emerald-600 dark:text-emerald-400', className)} aria-hidden />;
  }
  if (extension === '.ppt' || extension === '.pptx' || extension === '.key') {
    return <Presentation className={cn('text-amber-600 dark:text-amber-400', className)} aria-hidden />;
  }
  return <FileText className={cn('text-accent-fg', className)} aria-hidden />;
}

function TraitIcon({ category }: { category: TraitChip['category'] }) {
  switch (category) {
    case 'role':
    case 'responsibility':
      return <User className="size-3 shrink-0 text-accent-fg" aria-hidden />;
    case 'preference':
    case 'boundary':
      return <SlidersHorizontal className="size-3 shrink-0 text-accent-fg" aria-hidden />;
    case 'communication':
      return <MessageSquare className="size-3 shrink-0 text-accent-fg" aria-hidden />;
    default:
      return <Compass className="size-3 shrink-0 text-accent-fg" aria-hidden />;
  }
}

function StarterIcon({ icon }: { icon: 'priorities' | 'meeting' | 'research' }) {
  if (icon === 'meeting') return <CalendarDays className="size-3.5" aria-hidden />;
  if (icon === 'research') return <Search className="size-3.5" aria-hidden />;
  return <ListChecks className="size-3.5" aria-hidden />;
}

export function DesktopFocusOnboarding({
  onRequestClose,
  onNavigateAway,
}: {
  onRequestClose: () => void;
  onNavigateAway: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const zh = language === 'zh';
  const allMessages = messages(language);
  const copy = allMessages.onboarding.workDiscovery;
  const navigate = useNavigate();

  const [stage, setStage] = useState<FocusStage>('focus');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('local_files');
  const [loadingClues, setLoadingClues] = useState(true);
  const [candidates, setCandidates] = useState<WorkDiscoveryCandidate[]>([]);
  const [recentFiles, setRecentFiles] = useState<WorkDiscoveryRecentFile[]>([]);
  const [excludedProjectIds, setExcludedProjectIds] = useState<Set<string>>(() => new Set());
  const [excludedFileIds, setExcludedFileIds] = useState<Set<string>>(() => new Set());
  const [processingTarget, setProcessingTarget] = useState<WorkDiscoveryProcessingTarget | null>(null);
  const [importSources, setImportSources] = useState<DetectedImportSource[]>([]);
  const [importState, setImportState] = useState<'idle' | 'importing' | 'done'>('idle');
  const [importedCount, setImportedCount] = useState(0);

  const [goalText, setGoalText] = useState('');
  const [attachedFolder, setAttachedFolder] = useState<string | null>(null);
  const [localSources, setLocalSources] = useState<ElectronUnderstandingSourceDefinition[]>([]);
  const [attachedContext, setAttachedContext] = useState<{
    sourceId: string;
    label: string;
    count: number;
    snippet: string;
  } | null>(null);
  const [collectingContext, setCollectingContext] = useState(false);
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active analysis & reveal state
  const [run, setRun] = useState<WorkDiscoveryRun | null>(null);
  const [localSnapshot, setLocalSnapshot] = useState<LocalUnderstandingSnapshot | null>(null);
  const [localStepIndex, setLocalStepIndex] = useState<0 | 1 | 2>(0);
  const [emergingLabels, setEmergingLabels] = useState<string[]>([]);
  const [rejectedTraitIds, setRejectedTraitIds] = useState<Set<string>>(() => new Set());
  const [customTraits, setCustomTraits] = useState<TraitChip[]>([]);
  const [addingTrait, setAddingTrait] = useState(false);
  const [newTraitText, setNewTraitText] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef(0);
  const analysisAbortRef = useRef<AbortController | null>(null);

  const attachmentsApi = useComposerAttachments({
    chat: allMessages.chat,
  });

  const voice = useRealtimeVoice({
    disabled: busy,
    chat: allMessages.chat,
    onTranscript: (transcript) => {
      setGoalText((current) => appendTranscriptToDraft(current, transcript));
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    },
  });

  useEffect(() => () => {
    analysisAbortRef.current?.abort();
  }, []);

  // Zero-prompt catalog read for just-in-time contextual sources (Apple Calendar/Mail/Notes/Reminders).
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.understandingSources?.catalog()
      .then((sources) => {
        if (!cancelled) setLocalSources(sources);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const contextualOffer = useMemo(
    () => matchContextualLocalSource(goalText, localSources, language),
    [goalText, language, localSources],
  );

  const applyRun = useCallback((next: WorkDiscoveryRun) => {
    useUnderstandingActivityStore.getState().updateDirectoryRun(next);
    setRun(next);
    setAnalysisMode('folder');
    if (next.status === 'completed') setStage('reveal');
    else if (next.status === 'failed' || next.status === 'canceled') setStage('error');
    else setStage('analyzing');
  }, []);

  // Load any active run or prewarmed local metadata immediately (zero OS prompts).
  useEffect(() => {
    let cancelled = false;

    const currentRun = useUnderstandingActivityStore.getState().directoryRun;
    if (currentRun && (currentRun.status === 'queued' || currentRun.status === 'probing' || currentRun.status === 'analyzing')) {
      applyRun(currentRun);
      setLoadingClues(false);
      return;
    }

    void fetchWorkDiscoveryOnboarding()
      .then(async ({ state }) => {
        if (cancelled) return;
        if (state.activeRunId) {
          const active = await fetchWorkDiscoveryRun(state.activeRunId).catch(() => null);
          if (!cancelled && active && active.status !== 'canceled' && active.status !== 'failed') {
            applyRun(active);
            setLoadingClues(false);
            return;
          }
        }
      })
      .catch(() => {});

    void prefetchDesktopOnboardingContext()
      .then((preloaded) => {
        if (cancelled) return;
        setCandidates(preloaded.candidates);
        setRecentFiles(preloaded.recentFiles);
        setProcessingTarget(preloaded.processingTarget);
        setImportSources(preloaded.importSources);
      })
      .finally(() => {
        if (!cancelled) setLoadingClues(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyRun]);

  // Poll / listen to gateway realtime events while analyzing a folder.
  useEffect(() => {
    if (!run || stage !== 'analyzing' || analysisMode !== 'folder') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await fetchWorkDiscoveryRun(run.id);
        if (!cancelled) applyRun(next);
      } catch {
        // Recover on next poll or realtime event.
      }
    };
    const timer = window.setInterval(() => void refresh(), 1_200);
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string }>).detail;
      if (!detail?.runId || detail.runId === run.id) void refresh();
    };
    const events = ['work-discovery-progress', 'work-discovery-completed', 'work-discovery-failed', 'work-discovery-canceled'];
    for (const name of events) window.addEventListener(name, onEvent);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      for (const name of events) window.removeEventListener(name, onEvent);
    };
  }, [analysisMode, applyRun, run, stage]);

  const visibleCandidates = useMemo(
    () => candidates.filter((item) => !excludedProjectIds.has(item.id)),
    [candidates, excludedProjectIds],
  );
  const visibleRecentFiles = useMemo(
    () => recentFiles.filter((item) => !excludedFileIds.has(item.id)),
    [recentFiles, excludedFileIds],
  );
  const localSignals = useMemo(
    () => buildLocalSignals(candidates, recentFiles, excludedProjectIds, excludedFileIds, zh),
    [candidates, excludedFileIds, excludedProjectIds, recentFiles, zh],
  );
  const fallbackStarters = useMemo(() => buildFallbackStarters(zh), [zh]);

  const openConversation = useCallback((conversationId: string, draft?: string, autoSend = true) => {
    markDesktopHabitAnchorPending();
    const params = new URLSearchParams();
    if (draft) params.set('draft', draft);
    if (draft && autoSend) params.set('autoSend', '1');
    const query = params.toString();
    onNavigateAway();
    navigate(`/chat/${encodeURIComponent(conversationId)}${query ? `?${query}` : ''}`);
  }, [navigate, onNavigateAway]);

  const openNewChat = useCallback((prompt: string, handoffId?: string) => {
    markDesktopHabitAnchorPending();
    const href = newChatAutoSendHref(prompt, handoffId);
    if (href) {
      onNavigateAway();
      navigate(href);
    } else {
      onRequestClose();
    }
  }, [navigate, onNavigateAway, onRequestClose]);

  const launchFolderAnalysis = useCallback(async (rootPath: string) => {
    setBusy(true);
    setError(null);
    setLocalSnapshot(null);
    setRejectedTraitIds(new Set());
    setCustomTraits([]);
    setEmergingLabels([]);
    try {
      const policy = processingTarget?.remoteModel === false ? 'local_only' : 'remote_allowed';
      await grantUnderstandingWorkFolder(rootPath, policy);
      const started = await startWorkDiscoveryRun(rootPath);
      applyRun(started);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [applyRun, processingTarget?.remoteModel]);

  const launchQuickLocalUnderstanding = useCallback(async () => {
    if (busy) return;
    const collect = window.electronAPI?.understandingSources?.collect;
    const hasDocsToRead = visibleRecentFiles.length > 0 && Boolean(collect);

    // If there are no local documents (or running outside Electron), smoothly analyze the top project instead.
    if (!hasDocsToRead) {
      if (visibleCandidates[0]) {
        void recordCurrentFocusPriority(visibleCandidates[0].displayName);
        await launchFolderAnalysis(visibleCandidates[0].rootPath);
        return;
      }
      if (visibleRecentFiles.length > 0) {
        const list = visibleRecentFiles.slice(0, 4).map((f) => `- ${f.name}（${f.directory}）`).join('\n');
        const prompt = zh
          ? `我最近更新了这些本地文档，请只读梳理它们的核心脉络，告诉我最值得先推进的一步：\n${list}`
          : `I recently updated these local documents. Read them (read-only), synthesize what connects them, and suggest the best next step:\n${list}`;
        await dismissWorkDiscoveryOnboarding().catch(() => {});
        openNewChat(prompt);
      }
      return;
    }

    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;

    setBusy(true);
    setError(null);
    setRun(null);
    setLocalSnapshot(null);
    setRejectedTraitIds(new Set());
    setCustomTraits([]);
    setAnalysisMode('local_files');
    setLocalStepIndex(0);
    setEmergingLabels([]);
    setStage('analyzing');

    try {
      const excludeIds = [...excludedFileIds];
      const results = await collect!(['local-recent-files'], {
        mode: 'fast',
        ...(excludeIds.length ? { excludeIds } : {}),
      });
      if (controller.signal.aborted) return;

      const items = results.flatMap((result) => (result.status === 'completed' ? result.items : []));
      if (items.length === 0) {
        if (visibleCandidates[0]) {
          await launchFolderAnalysis(visibleCandidates[0].rootPath);
          return;
        }
        setError(zh ? '这些文件暂无法提取文字，你可以直接说一件事开始。' : 'Could not extract readable text from those files — just type a line to start.');
        setStage('focus');
        return;
      }

      setLocalStepIndex(1);
      setEmergingLabels([
        zh ? `${items.length} 份近期文档` : `${items.length} recent docs`,
        ...(visibleCandidates[0] ? [visibleCandidates[0].displayName] : []),
      ]);

      const policy = processingTarget?.remoteModel === false ? 'local_only' : 'remote_allowed';
      const understanding = await importUnderstandingSources(
        items,
        undefined,
        policy,
        undefined,
        zh ? 'zh-CN' : 'en-US',
      );
      if (controller.signal.aborted) return;

      setLocalStepIndex(2);
      const previewLabels = [
        ...understanding.workThreads.slice(0, 2).map((t) => t.title),
        ...understanding.profileCandidates.slice(0, 2).map((p) => p.statement),
      ].slice(0, 3);
      if (previewLabels.length) setEmergingLabels(previewLabels);

      setLocalSnapshot({
        profileCandidates: understanding.profileCandidates,
        workThreads: understanding.workThreads,
        sampledDocs: items.slice(0, 6).map((item) => ({ title: item.title, group: item.group })),
      });
      setStage('reveal');
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage('focus');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [
    busy,
    excludedFileIds,
    launchFolderAnalysis,
    openNewChat,
    processingTarget?.remoteModel,
    visibleCandidates,
    visibleRecentFiles,
    zh,
  ]);

  const picker = useDirectoryPicker({
    onPicked: (path) => {
      setAttachedFolder(path);
      textareaRef.current?.focus();
    },
  });

  const skip = useCallback(async () => {
    analysisAbortRef.current?.abort();
    setBusy(true);
    try {
      await dismissWorkDiscoveryOnboarding();
    } finally {
      setBusy(false);
      onRequestClose();
    }
  }, [onRequestClose]);

  const launchFreeform = useCallback(async (rawPrompt: string, priorityLabel?: string) => {
    const trimmed = rawPrompt.trim();
    const wireAttachments = attachmentsApi.wireAttachmentsPayload();
    if (!trimmed && !attachedFolder && wireAttachments.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const basePrompt = trimmed
        || (attachedFolder
          ? (zh
            ? `请只读了解目录 ${attachedFolder} 的现状，用 3 句话总结当前进度，并给出我现在最值得先做的 1 个具体下一步。`
            : `Inspect ${attachedFolder} (read-only), summarize where things stand in 3 crisp sentences, and recommend the single best next step to take right now.`)
          : (zh
            ? '请先阅读我附上的文件，提炼核心内容并告诉我接下来最值得推进的动作。'
            : 'Read the attached files, distill the key points, and suggest the most valuable next step.'));

      const finalPrompt = attachedContext?.snippet
        ? `${basePrompt}\n\n${attachedContext.snippet}`
        : basePrompt;

      void recordCurrentFocusPriority(priorityLabel ?? (trimmed || compactPath(attachedFolder ?? '')));

      if (attachedFolder) {
        const policy = processingTarget?.remoteModel === false ? 'local_only' : 'remote_allowed';
        await grantUnderstandingWorkFolder(attachedFolder, policy);
        const started = await startWorkDiscoveryRun(attachedFolder);
        if (!trimmed && wireAttachments.length === 0) {
          applyRun(started);
          return;
        }
        await cancelWorkDiscoveryRun(started.id).catch(() => {});
        await dismissWorkDiscoveryOnboarding().catch(() => {});
        openConversation(started.conversationId, finalPrompt, true);
        return;
      }

      await dismissWorkDiscoveryOnboarding().catch(() => {});
      const handoffId = wireAttachments.length > 0 ? createComposerPayloadHandoff(wireAttachments) : undefined;
      openNewChat(finalPrompt, handoffId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [
    applyRun,
    attachedContext?.snippet,
    attachedFolder,
    attachmentsApi,
    openConversation,
    openNewChat,
    processingTarget?.remoteModel,
    zh,
  ]);

  const handleSignalClick = useCallback((signal: LocalSignalItem) => {
    if (busy) return;
    if (signal.kind === 'project') {
      void recordCurrentFocusPriority(signal.candidate.displayName);
      void launchFolderAnalysis(signal.candidate.rootPath);
      return;
    }
    void launchQuickLocalUnderstanding();
  }, [busy, launchFolderAnalysis, launchQuickLocalUnderstanding]);

  const handleExcludeSignal = useCallback((signal: LocalSignalItem) => {
    if (signal.kind === 'project') {
      setExcludedProjectIds((prev) => new Set(prev).add(signal.id));
    } else {
      setExcludedFileIds((prev) => new Set(prev).add(signal.id));
    }
  }, []);

  const handleImportAiTools = useCallback(async () => {
    if (importState !== 'idle' || importSources.length === 0) return;
    setImportState('importing');
    const result = await importSafeAiToolConfigs(importSources.map((item) => item.id));
    setImportedCount(result.importedCount);
    setImportState('done');
  }, [importSources, importState]);

  const handleCollectContextualSource = useCallback(async () => {
    if (!contextualOffer || collectingContext) return;
    const collect = window.electronAPI?.understandingSources?.collect;
    if (!collect) return;
    setCollectingContext(true);
    setContextNotice(null);
    try {
      const results = await collect([contextualOffer.sourceId]);
      const result = results[0];
      if (!result || result.status === 'denied') {
        setContextNotice(zh ? `未授权 ${contextualOffer.label}，可直接开始。` : `${contextualOffer.label} declined — ready to start.`);
        return;
      }
      if (result.status !== 'completed' || result.items.length === 0) {
        setContextNotice(zh ? `${contextualOffer.label} 暂无近期记录。` : `No recent items in ${contextualOffer.label}.`);
        return;
      }
      const snippet = formatContextualSourceSnippet(contextualOffer.label, result.items, language);
      setAttachedContext({
        sourceId: contextualOffer.sourceId,
        label: contextualOffer.label,
        count: Math.min(result.items.length, 6),
        snippet,
      });
    } catch {
      setContextNotice(zh ? `读取 ${contextualOffer.label} 失败，不影响开始。` : `Could not read ${contextualOffer.label}.`);
    } finally {
      setCollectingContext(false);
    }
  }, [collectingContext, contextualOffer, language, zh]);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void launchFreeform(goalText);
    }
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = collectClipboardFiles(event.clipboardData);
    if (pastedFiles.length > 0) {
      event.preventDefault();
      void attachmentsApi.processFiles(pastedFiles);
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    if (event.dataTransfer.types.includes('Files')) setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);

    const items = Array.from(event.dataTransfer.items ?? []);
    const regularFiles: File[] = [];
    let droppedFolderPath: string | null = null;
    const resolvePath = window.electronAPI?.file?.getPathForFile;

    if (items.length > 0) {
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        const file = item.getAsFile();
        if (!file) continue;
        if (entry?.isDirectory && !droppedFolderPath && resolvePath) {
          try {
            const folderPath = resolvePath(file);
            if (folderPath) {
              droppedFolderPath = folderPath;
              continue;
            }
          } catch {
            // Fall through if native path lookup fails.
          }
        }
        if (!entry?.isDirectory) regularFiles.push(file);
      }
    } else {
      regularFiles.push(...Array.from(event.dataTransfer.files));
    }

    if (droppedFolderPath) setAttachedFolder(droppedFolderPath);
    if (regularFiles.length > 0) void attachmentsApi.processFiles(regularFiles);
    if (droppedFolderPath || regularFiles.length > 0) textareaRef.current?.focus();
  };

  // Convergence visual signals during Act 2
  const convergenceSignals = useMemo<UnderstandingSignal[]>(() => {
    if (analysisMode === 'folder' && run) {
      const fileSignals: UnderstandingSignal[] = (run.snapshot?.files ?? []).slice(0, 3).map((file) => ({
        id: `file:${file.relativePath}`,
        label: compactPath(file.relativePath),
        kind: file.source === 'git_change' ? 'recent' : 'file',
        meta: file.source === 'git_change'
          ? copy.sourceSignals.changedFile
          : file.source === 'document'
            ? copy.sourceSignals.contextFile
            : copy.sourceSignals.structureFile,
        detail: file.relativePath,
      }));
      const folderSignal: UnderstandingSignal = {
        id: 'folder',
        label: compactPath(run.rootPath),
        kind: 'folder',
        meta: run.snapshot?.branch ? `Git · ${run.snapshot.branch}` : copy.sourceSignals.scanningFiles,
        detail: run.rootPath,
      };
      return [folderSignal, ...fileSignals];
    }

    return localSignals.slice(0, 5).map((item): UnderstandingSignal => (
      item.kind === 'project'
        ? { id: item.id, label: item.label, kind: 'folder', meta: item.meta }
        : { id: item.id, label: item.label, kind: 'recent', meta: item.meta }
    ));
  }, [analysisMode, copy.sourceSignals, localSignals, run]);

  const folderEmergingLabels = useMemo(() => {
    if (analysisMode !== 'folder' || !run) return [];
    const labels: string[] = [];
    if (run.snapshot?.branch) labels.push(`Git · ${run.snapshot.branch}`);
    if (run.snapshot?.sampledPathCount) {
      labels.push(zh ? `${run.snapshot.sampledPathCount} 份文件` : `${run.snapshot.sampledPathCount} files`);
    }
    return labels;
  }, [analysisMode, run, zh]);

  // Unified Act 3 traits & thread cards
  const rawProfileCandidates = useMemo(
    () => (localSnapshot?.profileCandidates ?? run?.result?.profileCandidates ?? []),
    [localSnapshot?.profileCandidates, run?.result?.profileCandidates],
  );
  const traits = useMemo(
    () => [
      ...normalizeTraitChips(rawProfileCandidates, rejectedTraitIds),
      ...customTraits.filter((item) => !rejectedTraitIds.has(item.id)),
    ],
    [customTraits, rawProfileCandidates, rejectedTraitIds],
  );
  const threadCards = useMemo<ThreadCard[]>(() => {
    if (localSnapshot) {
      return buildThreadCardsFromLocalUnderstanding(
        localSnapshot.workThreads,
        visibleCandidates,
        localSnapshot.sampledDocs.length,
        zh,
      );
    }
    if (run) {
      return buildThreadCardsFromFolderRun(run, copy.estimatedMinutes, zh);
    }
    return [];
  }, [copy.estimatedMinutes, localSnapshot, run, visibleCandidates, zh]);

  const revealEvidence = useMemo(
    () => collectRevealEvidence(run, localSnapshot?.sampledDocs ?? []),
    [localSnapshot?.sampledDocs, run],
  );

  const handleRemoveTrait = useCallback((chip: TraitChip) => {
    setRejectedTraitIds((prev) => new Set(prev).add(chip.id));
    if (chip.assertionId) {
      void setAssertionStatus(chip.assertionId, 'rejected').catch(() => {});
    }
  }, []);

  const handleAddCustomTrait = useCallback(async () => {
    const trimmed = newTraitText.trim();
    if (!trimmed) {
      setAddingTrait(false);
      return;
    }
    const id = `custom:${Date.now()}`;
    setCustomTraits((prev) => [...prev, { id, category: 'custom', label: trimmed }]);
    setNewTraitText('');
    setAddingTrait(false);
    void addCollaborationPreference(trimmed).catch(() => {});
  }, [newTraitText]);

  const handleStartThreadCard = useCallback(async (card: ThreadCard, discussOnly = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const prompt = discussOnly
        ? `${zh ? '先帮我评估这个方向，不要修改文件：' : 'First assess this direction without changing files:'}\n\n${card.actionPrompt}`
        : card.actionPrompt;

      if (card.suggestion && run) {
        await Promise.allSettled([
          submitWorkDiscoveryRecognitionFeedback(run.id, 'confirmed'),
          selectWorkDiscoverySuggestion(run.id, card.suggestion.id),
          recordCurrentFocusPriority(card.priorityTitle),
        ]);
        openConversation(run.conversationId, prompt, true);
        return;
      }

      if (card.conversationId) {
        await Promise.allSettled([
          recordCurrentFocusPriority(card.priorityTitle),
          dismissWorkDiscoveryOnboarding(),
        ]);
        openConversation(card.conversationId, prompt, true);
        return;
      }

      if (card.kind === 'project' && card.rootPath) {
        const policy = processingTarget?.remoteModel === false ? 'local_only' : 'remote_allowed';
        await grantUnderstandingWorkFolder(card.rootPath, policy).catch(() => {});
      }

      await Promise.allSettled([
        recordCurrentFocusPriority(card.priorityTitle),
        dismissWorkDiscoveryOnboarding(),
      ]);
      openNewChat(prompt);
    } finally {
      setBusy(false);
    }
  }, [busy, openConversation, openNewChat, processingTarget?.remoteModel, run, zh]);

  const loopiMood = error || stage === 'error'
    ? 'care'
    : busy || stage === 'analyzing'
      ? 'work'
      : stage === 'reveal'
        ? 'done'
        : goalText.trim().length > 0
          ? 'listen'
          : 'curious';

  const hasSubmitPayload = Boolean(goalText.trim() || attachedFolder || attachmentsApi.attachments.length > 0);
  const importNames = importSources.map((item) => item.name).join(' / ');
  const activeStepIndex = analysisMode === 'folder' && run
    ? Math.max(0, FOLDER_STAGES.indexOf(run.stage ?? 'folder_structure'))
    : localStepIndex;

  const progressLabels = analysisMode === 'folder'
    ? FOLDER_STAGES.map((item) => copy.stages[item])
    : zh
      ? ['读取近期文档', '提炼关注脉络', '准备起点']
      : ['Reading recent docs', 'Distilling themes', 'Preparing starts'];

  return (
    <div
      className="xopc-onboarding-experience relative flex h-full min-h-0 w-full flex-col overflow-hidden"
      data-focus-stage={stage}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Unified desktop drag header */}
      <header className={cn(
        'relative z-20 flex h-14 shrink-0 items-center justify-end gap-2 px-5 sm:px-8',
        isElectronDarwin() && APP_CHROME_BAR_CLASS,
        isElectronDarwin() && APP_CHROME_DRAG_CLASS,
      )}>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <OnboardingLanguageSwitch
            value={language}
            onChange={(nextLanguage) => {
              setError(null);
              setLanguage(nextLanguage);
            }}
          />
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => void skip()}
          >
            {copy.skip}
          </button>
        </div>
      </header>

      {/* Drag-and-drop overlay */}
      {dragActive && stage === 'focus' ? (
        <div className="pointer-events-none absolute inset-4 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-surface-overlay/85 backdrop-blur-md">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-fg">
              <Upload className="size-5" aria-hidden />
            </span>
            <p className="text-sm font-medium text-fg">
              {zh ? '松开即可附加' : 'Drop to attach'}
            </p>
          </div>
        </div>
      ) : null}

      <main className="xopc-onboarding-scroll relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 pb-10 pt-2 sm:px-8">
        <div
          key={stage}
          className={cn(
            'xopc-focus-stage w-full transition-[max-width] duration-300',
            stage === 'reveal' ? 'max-w-[44rem]' : 'max-w-[40rem]',
          )}
        >
          {/* Shared Loopi anchor (hidden in analyzing since Convergence renders Loopi as its hub) */}
          {stage !== 'analyzing' ? (
            <div className="mb-4 flex justify-center">
              <Loopi
                className={cn(
                  'transition-[width,height] duration-300 motion-reduce:transition-none',
                  stage === 'reveal' ? 'size-14' : 'size-20',
                )}
                interactive={stage === 'focus'}
                language={language}
                mood={loopiMood}
              />
            </div>
          ) : null}

          {/* ACT 1: PERCEPTION & ACTION CANVAS */}
          {stage === 'focus' ? (
            <div>
              <h1 className="text-center text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-fg sm:text-[2.125rem]">
                {localSignals.length > 0
                  ? (zh ? '先认识你的工作，或直接说一件事' : 'Let me learn your workspace, or jump in')
                  : (zh ? '现在最想先推进什么？' : 'What would you like to tackle first?')}
              </h1>

              {/* Zero-prompt Local Signals Strip -> One-click fast local understanding */}
              {loadingClues ? (
                <div className="mt-6 rounded-2xl border border-edge bg-surface-panel/80 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <Skeleton className="h-4 w-32 rounded-full" />
                    <Skeleton className="h-8 w-28 rounded-xl" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Skeleton className="h-8 w-28 rounded-xl" />
                    <Skeleton className="h-8 w-36 rounded-xl" />
                    <Skeleton className="h-8 w-32 rounded-xl" />
                  </div>
                </div>
              ) : localSignals.length > 0 ? (
                <section
                  aria-label={zh ? '本机线索' : 'Local signals'}
                  className="xopc-clue-card mt-6 rounded-2xl border border-edge bg-surface-panel/90 p-3.5 shadow-surface"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                      <span className="text-xs font-medium text-fg">
                        {zh ? `发现 ${localSignals.length} 处本机线索` : `${localSignals.length} signals on this Mac`}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                        <ShieldCheck className="size-3 text-accent-fg" aria-hidden />
                        {zh ? '只读' : 'Read-only'}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={busy}
                      className="h-8 gap-1.5 rounded-xl px-3.5 text-xs font-medium"
                      onClick={() => void launchQuickLocalUnderstanding()}
                    >
                      <Sparkles className="size-3.5" aria-hidden />
                      {zh ? '快速认识我' : 'Get to know me'}
                      <ArrowRight className="size-3.5 opacity-80" aria-hidden />
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {localSignals.map((signal, index) => (
                      <div
                        key={signal.id}
                        style={{ animationDelay: `${index * 40}ms` }}
                        className="xopc-signal-chip group inline-flex max-w-full items-center rounded-xl border border-edge-subtle bg-surface-base/85 text-xs transition-[border-color,background-color] hover:border-edge-strong hover:bg-surface-hover/50"
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleSignalClick(signal)}
                          className="inline-flex min-w-0 items-center gap-1.5 py-1.5 pl-2.5 pr-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {signal.kind === 'project' ? (
                            <FolderGit2 className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
                          ) : (
                            <FileKindIcon extension={signal.extension} className="size-3.5 shrink-0" />
                          )}
                          <span className="max-w-[11rem] truncate font-medium text-fg">{signal.label}</span>
                          {signal.meta ? (
                            <span className="shrink-0 text-[10px] text-fg-subtle">{signal.meta}</span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={zh ? `排除 ${signal.label}` : `Exclude ${signal.label}`}
                          onClick={() => handleExcludeSignal(signal)}
                          className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-md text-fg-subtle opacity-60 transition-opacity hover:bg-surface-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Hero Focus Composer */}
              <div className="xopc-focus-composer mt-4 rounded-2xl border border-edge bg-surface-panel p-3 shadow-surface transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
                {voice.voiceActive ? (
                  <ComposerVoiceInputBar
                    phase={voice.phase}
                    elapsedLabel={voice.elapsedLabel}
                    recordedDictation={voice.recordedDictation}
                    audioLevel={voice.audioLevel}
                    partialTranscript={voice.partialTranscript}
                    finalTranscript={voice.finalTranscript}
                    error={voice.error}
                    settingsRequired={voice.settingsRequired}
                    disabled={busy}
                    chat={allMessages.chat}
                    onCancel={voice.cancelVoiceInput}
                    onConfirm={voice.confirmVoiceInput}
                    onRetry={voice.retryVoiceInput}
                  />
                ) : null}

                {!(voice.voiceActive && voice.phase !== 'error') ? (
                  <textarea
                    ref={textareaRef}
                    autoFocus
                    rows={2}
                    value={goalText}
                    disabled={busy}
                    onChange={(event) => {
                      setGoalText(event.target.value);
                      if (error) setError(null);
                      if (contextNotice) setContextNotice(null);
                    }}
                    onKeyDown={handleComposerKeyDown}
                    onPaste={handleComposerPaste}
                    placeholder={zh
                      ? '直接说一句、或拖入文件开始…'
                      : 'Type a line, or drop files to start…'}
                    className="max-h-36 min-h-[3.25rem] w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-6 text-fg outline-none placeholder:text-fg-subtle"
                  />
                ) : null}

                {/* Attached folder / files / contextual source pills */}
                {(attachedFolder || attachmentsApi.attachments.length > 0 || attachedContext) ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 px-1.5">
                    {attachedFolder ? (
                      <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-edge-subtle bg-surface-inset px-2.5 py-1 text-xs font-medium text-fg">
                        <FolderOpen className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
                        <span className="truncate font-mono">{compactPath(attachedFolder)}</span>
                        <button
                          type="button"
                          aria-label={zh ? '移除文件夹' : 'Remove folder'}
                          className="ml-0.5 rounded text-fg-muted hover:text-fg"
                          onClick={() => setAttachedFolder(null)}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ) : null}
                    {attachedContext ? (
                      <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">
                          {zh
                            ? `已附带 ${attachedContext.label}（${attachedContext.count} 条）`
                            : `${attachedContext.label} attached (${attachedContext.count})`}
                        </span>
                        <button
                          type="button"
                          aria-label={zh ? '移除本地参考' : 'Remove local context'}
                          className="ml-0.5 rounded opacity-75 hover:opacity-100"
                          onClick={() => setAttachedContext(null)}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ) : null}
                    {attachmentsApi.attachments.map((file, index) => (
                      <span
                        key={`${file.name}-${index}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-edge-subtle bg-surface-inset px-2.5 py-1 text-xs font-medium text-fg"
                      >
                        <FileText className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                        <span className="max-w-[14rem] truncate">{file.name}</span>
                        <button
                          type="button"
                          aria-label={zh ? '移除附件' : 'Remove file'}
                          className="ml-0.5 rounded text-fg-muted hover:text-fg"
                          onClick={() => attachmentsApi.removeAttachment(index)}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                {/* Composer action bar */}
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-edge-subtle/80 pt-2.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy || picker.picking}
                      onClick={picker.pick}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <FolderOpen className="size-3.5" aria-hidden />
                      {zh ? '目录' : 'Folder'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => attachmentsApi.fileInputRef.current?.click()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Paperclip className="size-3.5" aria-hidden />
                      {zh ? '文件' : 'File'}
                    </button>
                    {!voice.voiceActive ? (
                      <ComposerVoiceInputButton
                        disabled={busy}
                        chat={allMessages.chat}
                        onStart={() => void voice.startVoiceInput()}
                      />
                    ) : null}
                    <input
                      ref={attachmentsApi.fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        const list = event.target.files ? Array.from(event.target.files) : [];
                        if (list.length > 0) void attachmentsApi.processFiles(list);
                        event.target.value = '';
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    className="h-9 gap-1.5 rounded-xl px-4 text-xs font-medium"
                    disabled={busy || voice.voiceActive || !hasSubmitPayload}
                    onClick={() => void launchFreeform(goalText)}
                  >
                    {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
                    {zh ? '立刻开始' : 'Start now'}
                    {!busy ? <CornerDownLeft className="size-3.5 opacity-80" aria-hidden /> : null}
                  </Button>
                </div>
              </div>

              {/* Just-in-time contextual local source chip (only when relevant to typed intent) */}
              {contextualOffer && attachedContext?.sourceId !== contextualOffer.sourceId ? (
                <div className="xopc-clue-card mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft/35 px-3.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <CalendarDays className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
                    <span className="truncate text-xs font-medium text-fg">{contextualOffer.label}</span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                    disabled={collectingContext || busy}
                    onClick={() => void handleCollectContextualSource()}
                  >
                    {collectingContext ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
                    {contextualOffer.actionLabel}
                  </Button>
                </div>
              ) : null}

              {contextNotice ? <p className="mt-2 text-center text-xs text-fg-muted">{contextNotice}</p> : null}
              {error ? <p className="mt-3 text-center text-xs text-danger" role="alert">{error}</p> : null}

              {/* Clean fallback starter pills when no local files/projects exist */}
              {!loadingClues && localSignals.length === 0 ? (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {fallbackStarters.map((starter, index) => (
                    <button
                      key={starter.id}
                      type="button"
                      disabled={busy}
                      style={{ animationDelay: `${index * 45}ms` }}
                      onClick={() => void launchFreeform(starter.prompt, starter.priorityTitle)}
                      className="xopc-signal-chip group inline-flex items-center gap-2 rounded-xl border border-edge bg-surface-panel px-3.5 py-2 text-xs font-medium text-fg transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-edge-strong hover:bg-surface-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:hover:translate-y-0"
                    >
                      <span className="text-accent-fg">
                        <StarterIcon icon={starter.icon} />
                      </span>
                      <span>{starter.title}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Compact one-line AI tool inheritance pill */}
              {importSources.length > 0 ? (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-edge-subtle bg-surface-panel/75 px-3.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Wand2 className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
                    <span className="truncate text-xs font-medium text-fg">
                      {importState === 'done'
                        ? (zh ? `已带入 ${importedCount} 项 ${importNames} 配置` : `Imported ${importedCount} items from ${importNames}`)
                        : (zh ? `${importNames} · Skills 与规则` : `${importNames} · Skills & rules`)}
                    </span>
                  </div>
                  {importState === 'done' ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                      <Check className="size-3" aria-hidden />
                      {zh ? '已带入' : 'Imported'}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                      disabled={importState === 'importing'}
                      onClick={() => void handleImportAiTools()}
                    >
                      {importState === 'importing' ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
                      {importState === 'importing' ? (zh ? '带入中…' : 'Importing…') : (zh ? '一键带入' : 'Import')}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ACT 2: LIVE ANIMATED CONVERGENCE */}
          {stage === 'analyzing' ? (
            <section className="text-center" aria-live="polite">
              <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl">
                {analysisMode === 'folder' && run
                  ? (zh ? `正在了解 ${compactPath(run.rootPath)}` : `Understanding ${compactPath(run.rootPath)}`)
                  : (zh ? '正在从你的文件快速认识你' : 'Getting to know your work')}
              </h1>

              <UnderstandingSourceConvergence
                signals={convergenceSignals}
                ariaLabel={copy.sourceSignals.ariaLabel}
                centerLabel={copy.sourceSignals.centerLabel}
                emergingLabels={analysisMode === 'folder' ? folderEmergingLabels : emergingLabels}
              />

              {/* Compact 3-segment progress rail */}
              <div className="mx-auto mt-5 grid max-w-[30rem] grid-cols-3 gap-2">
                {progressLabels.map((label, index) => {
                  const complete = index < activeStepIndex;
                  const active = index === activeStepIndex;
                  return (
                    <div key={label} className="min-w-0 text-left">
                      <span className={cn('block h-1 rounded-full transition-colors duration-300', active || complete ? 'bg-accent' : 'bg-surface-hover')} />
                      <span className={cn('mt-1.5 block truncate text-[11px]', active ? 'font-medium text-fg' : 'text-fg-muted')}>
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex items-center justify-center gap-3">
                {analysisMode === 'folder' && run ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 rounded-xl px-4 text-xs"
                    onClick={() => openConversation(run.conversationId)}
                  >
                    {zh ? '直接开聊' : 'Open chat now'}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 rounded-xl px-3.5 text-xs text-fg-muted"
                  onClick={async () => {
                    analysisAbortRef.current?.abort();
                    if (run) await cancelWorkDiscoveryRun(run.id).catch(() => {});
                    setRun(null);
                    setBusy(false);
                    setStage('focus');
                  }}
                >
                  {zh ? '返回' : 'Back'}
                </Button>
              </div>
            </section>
          ) : null}

          {/* ACT 3: INTERACTIVE UNDERSTANDING & LAUNCH CANVAS */}
          {stage === 'reveal' ? (
            <section aria-live="polite">
              <div className="text-center">
                {run?.rootPath ? (
                  <p className="text-xs font-medium text-accent-fg">{compactPath(run.rootPath)}</p>
                ) : null}
                <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-fg sm:text-[1.75rem]">
                  {localSnapshot
                    ? (zh ? '我大致了解你最近的重心了' : 'Here’s what I picked up')
                    : (zh ? '选一条，直接开始' : 'Pick a thread to jump in')}
                </h1>
              </div>

              {/* Interactive "About you" trait chips (direct remove / add) */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
                {traits.map((chip, index) => (
                  <span
                    key={chip.id}
                    style={{ animationDelay: `${index * 45}ms` }}
                    className="xopc-trait-chip inline-flex max-w-full items-center gap-1.5 rounded-full border border-edge bg-surface-panel py-1 pl-2.5 pr-1.5 text-xs font-medium text-fg shadow-surface"
                  >
                    <TraitIcon category={chip.category} />
                    <span className="max-w-[16rem] truncate">{chip.label}</span>
                    <button
                      type="button"
                      aria-label={zh ? `移除标签 ${chip.label}` : `Remove ${chip.label}`}
                      onClick={() => handleRemoveTrait(chip)}
                      className="flex size-4 shrink-0 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <X className="size-2.5" aria-hidden />
                    </button>
                  </span>
                ))}

                {addingTrait ? (
                  <form
                    className="inline-flex items-center gap-1 rounded-full border border-accent bg-surface-panel py-0.5 pl-3 pr-1.5 shadow-surface"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleAddCustomTrait();
                    }}
                  >
                    <input
                      autoFocus
                      value={newTraitText}
                      onChange={(event) => setNewTraitText(event.target.value)}
                      onBlur={() => void handleAddCustomTrait()}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setNewTraitText('');
                          setAddingTrait(false);
                        }
                      }}
                      placeholder={zh ? '补充一句偏好或角色…' : 'Add a quick note…'}
                      className="w-36 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
                    />
                    <button
                      type="submit"
                      aria-label={zh ? '保存补充' : 'Save note'}
                      onMouseDown={(event) => event.preventDefault()}
                      className="flex size-5 items-center justify-center rounded-full bg-accent text-on-accent"
                    >
                      <Check className="size-3" aria-hidden />
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingTrait(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-edge-strong px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Plus className="size-3" aria-hidden />
                    {zh ? '补充' : 'Add'}
                  </button>
                )}
              </div>

              {/* Concise visual thread / action cards */}
              <div className="mt-6 space-y-2.5">
                {threadCards.map((card, index) => (
                  <div
                    key={card.id}
                    style={{ animationDelay: `${80 + index * 60}ms` }}
                    className={cn(
                      'xopc-thread-card group flex items-center justify-between gap-4 rounded-2xl border p-4 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5',
                      card.primary
                        ? 'border-accent/40 bg-surface-panel shadow-surface hover:border-accent'
                        : 'border-edge bg-surface-panel/90 hover:border-edge-strong',
                    )}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleStartThreadCard(card, false)}
                      className="flex min-w-0 flex-1 items-center gap-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors',
                        card.primary ? 'bg-accent-soft text-accent-fg' : 'bg-surface-inset text-fg-muted group-hover:bg-accent-soft group-hover:text-accent-fg',
                      )}>
                        {card.kind === 'project' ? (
                          <FolderGit2 className="size-4" aria-hidden />
                        ) : (
                          <Sparkles className="size-4" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[15px] font-semibold text-fg">{card.title}</span>
                          {card.badge ? (
                            <span className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-medium',
                              card.primary ? 'bg-accent-soft text-accent-fg' : 'bg-surface-inset text-fg-muted',
                            )}>
                              {card.badge}
                            </span>
                          ) : null}
                        </span>
                        {card.meta ? (
                          <span className="mt-0.5 block truncate text-xs text-fg-muted">{card.meta}</span>
                        ) : null}
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-2">
                      {card.primary && card.suggestion ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          className="hidden h-8 rounded-lg px-2.5 text-xs text-fg-muted sm:inline-flex"
                          onClick={() => void handleStartThreadCard(card, true)}
                        >
                          {zh ? '先只评估' : 'Assess only'}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant={card.primary ? 'primary' : 'secondary'}
                        disabled={busy}
                        className="h-9 gap-1.5 rounded-xl px-3.5 text-xs font-medium"
                        onClick={() => void handleStartThreadCard(card, false)}
                      >
                        {busy && card.primary ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
                        {card.primary ? (zh ? '开始' : 'Start') : (zh ? '推进' : 'Go')}
                        <ArrowRight className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Quiet footer: optional evidence disclosure + direct chat + back */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-5 text-xs text-fg-muted">
                {revealEvidence.length > 0 ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-fg"
                    onClick={() => setEvidenceOpen((open) => !open)}
                  >
                    {zh ? '依据' : 'Sources'}
                    <ChevronDown className={cn('size-3.5 transition-transform', evidenceOpen && 'rotate-180')} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="hover:text-fg hover:underline"
                  onClick={() => {
                    setRun(null);
                    setLocalSnapshot(null);
                    setStage('focus');
                  }}
                >
                  {zh ? '换一件事' : 'Pick something else'}
                </button>
                <button
                  type="button"
                  className="hover:text-fg hover:underline"
                  onClick={async () => {
                    if (run) {
                      openConversation(run.conversationId);
                    } else {
                      await dismissWorkDiscoveryOnboarding().catch(() => {});
                      onRequestClose();
                    }
                  }}
                >
                  {zh ? '直接对话' : 'Open chat'}
                </button>
              </div>

              {evidenceOpen && revealEvidence.length > 0 ? (
                <div className="xopc-clue-card mt-3 space-y-1.5 rounded-xl border border-edge-subtle bg-surface-panel/80 px-4 py-3 text-xs text-fg-muted">
                  {revealEvidence.map((item, idx) => (
                    <div key={`${idx}-${item.path ?? item.observation}`} className="flex items-center gap-2">
                      <GitBranch className="size-3 shrink-0 text-accent-fg" aria-hidden />
                      <span className="truncate">
                        {item.path ? <code className="font-mono text-fg">{item.path}</code> : null}
                        {item.path && item.observation ? ' · ' : null}
                        {item.observation}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* ERROR RECOVERY */}
          {stage === 'error' && run ? (
            <section className="text-center">
              <h1 className="text-xl font-semibold text-fg">{copy.errorTitle}</h1>
              <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">{run.errorMessage}</p>
              <div className="mt-6 flex justify-center gap-3">
                <Button
                  type="button"
                  variant="primary"
                  className="h-10 rounded-xl px-4 text-sm"
                  onClick={() => void retryWorkDiscoveryRun(run.id).then(applyRun)}
                >
                  {copy.retry}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 rounded-xl px-4 text-sm"
                  onClick={() => openConversation(run.conversationId)}
                >
                  {zh ? '直接对话' : 'Open chat'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 rounded-xl px-4 text-sm"
                  onClick={() => {
                    setRun(null);
                    setStage('focus');
                  }}
                >
                  {zh ? '返回' : 'Back'}
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </main>

      {!picker.hasNativePicker ? (
        <WorkingDirectoryPickerModal
          open={picker.modalOpen}
          onOpenChange={picker.setModalOpen}
          initialAbsolutePath={attachedFolder ?? undefined}
          onConfirm={picker.confirmPick}
          wd={allMessages.chat.workingDirectory}
        />
      ) : null}
    </div>
  );
}
