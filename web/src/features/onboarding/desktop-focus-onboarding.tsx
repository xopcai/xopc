import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  CornerDownLeft,
  FileText,
  FolderGit2,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  Paperclip,
  Sparkles,
  Upload,
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
import { OnboardingLanguageSwitch } from '@/features/onboarding/onboarding-language-switch';
import { useRealtimeVoice } from '@/features/voice/realtime/use-realtime-voice';
import {
  cancelWorkDiscoveryRun,
  dismissWorkDiscoveryOnboarding,
  fetchWorkDiscoveryOnboarding,
  fetchWorkDiscoveryRun,
  grantUnderstandingWorkFolder,
  retryWorkDiscoveryRun,
  selectWorkDiscoverySuggestion,
  startWorkDiscoveryRun,
  submitWorkDiscoveryRecognitionFeedback,
  type WorkDiscoveryCandidate,
  type WorkDiscoveryProcessingTarget,
  type WorkDiscoveryRecentFile,
  type WorkDiscoveryRun,
  type WorkDiscoveryStage,
  type WorkDiscoverySuggestion,
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

type QuickClue =
  | {
    id: string;
    kind: 'project';
    title: string;
    subtitle: string;
    badge?: string;
    candidate: WorkDiscoveryCandidate;
  }
  | {
    id: string;
    kind: 'recent_files';
    title: string;
    subtitle: string;
    badge?: string;
    files: WorkDiscoveryRecentFile[];
  }
  | {
    id: string;
    kind: 'starter';
    title: string;
    subtitle: string;
    badge?: string;
    prompt: string;
    priorityTitle: string;
  };

const STAGES: WorkDiscoveryStage[] = ['folder_structure', 'recent_progress', 'next_steps'];

function compactPath(value: string): string {
  const parts = value.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || value;
}

function localizeRootLabel(label: string, zh: boolean): string {
  if (!zh) return label;
  const lower = label.toLowerCase();
  if (lower === 'desktop') return '桌面';
  if (lower === 'documents') return '文稿';
  if (lower === 'downloads') return '下载';
  return label;
}

function buildQuickClues(
  candidates: WorkDiscoveryCandidate[],
  recentFiles: WorkDiscoveryRecentFile[],
  zh: boolean,
): QuickClue[] {
  const clues: QuickClue[] = [];

  for (const candidate of candidates.slice(0, 2)) {
    const parts: string[] = [];
    if (candidate.branch) parts.push(candidate.branch);
    if (candidate.changedFileCount > 0) {
      parts.push(zh ? `${candidate.changedFileCount} 处近期改动` : `${candidate.changedFileCount} recent changes`);
    } else if (candidate.source === 'ai_tool_project') {
      parts.push(zh ? '来自 Claude Code / Codex' : 'From Claude Code / Codex');
    } else if (candidate.projectKind === 'coding') {
      parts.push(zh ? '软件项目' : 'Code project');
    } else {
      parts.push(compactPath(candidate.rootPath));
    }

    clues.push({
      id: `project:${candidate.id}`,
      kind: 'project',
      title: candidate.displayName,
      subtitle: parts.join(' · '),
      badge: candidate.source === 'ai_tool_project'
        ? (zh ? '最近使用' : 'Recent')
        : candidate.changedFileCount > 0
          ? (zh ? '进行中' : 'Active')
          : undefined,
      candidate,
    });
  }

  if (recentFiles.length > 0 && clues.length < 3) {
    const topFiles = recentFiles.slice(0, 3);
    const rootLabels = [...new Set(topFiles.map((file) => localizeRootLabel(file.rootLabel, zh)))];
    const filePreview = topFiles.slice(0, 2).map((file) => file.name).join(' · ');
    const firstFile = topFiles[0];
    if (firstFile) {
      clues.push({
        id: `recent-files:${firstFile.id}`,
        kind: 'recent_files',
        title: zh ? '整理最近更新的文档' : 'Organize recently updated documents',
        subtitle: filePreview,
        badge: rootLabels[0],
        files: topFiles,
      });
    }
  }

  const starters: Array<{ id: string; title: string; subtitle: string; prompt: string; priorityTitle: string }> = zh
    ? [
      {
        id: 'starter:priorities',
        title: '理清今天最重要的 3 件事',
        subtitle: '快速梳理目标、优先级与第一步行动',
        prompt: '帮我理清今天最重要的 3 件事。先问我 2 个最关键的问题，或者直接给我一份按影响力和紧迫度排序的行动清单框架。',
        priorityTitle: '理清今天最重要的 3 件事',
      },
      {
        id: 'starter:meeting',
        title: '准备下一场重要会议或汇报',
        subtitle: '生成议程提纲、核心观点与待确认问题',
        prompt: '我准备一场重要会议或汇报，请先给我一版精炼的议程与核心结论框架，并告诉我补充哪 2 个信息后可以直接写成完整材料。',
        priorityTitle: '准备重要会议或汇报',
      },
      {
        id: 'starter:research',
        title: '快速调研一个主题并输出简报',
        subtitle: '自动收集关键信息，整理结论与参考来源',
        prompt: '我想快速调研一个新主题并输出一份一页纸简报。请告诉我我只需提供什么关键词或目标，你就能立刻开始调研并整理结论。',
        priorityTitle: '快速调研并输出简报',
      },
    ]
    : [
      {
        id: 'starter:priorities',
        title: 'Clarify my top 3 priorities today',
        subtitle: 'Sort goals by impact and lock in the first step',
        prompt: 'Help me clarify my top 3 priorities today. Ask at most 2 sharp questions or draft an impact-ordered action plan I can refine right away.',
        priorityTitle: 'Clarify top 3 priorities today',
      },
      {
        id: 'starter:meeting',
        title: 'Prepare for an upcoming meeting',
        subtitle: 'Build a crisp agenda, key talking points, and open questions',
        prompt: 'Help me prepare for an important upcoming meeting. Draft a concise agenda and key decision checklist, then ask for the 2 details you need to tailor it.',
        priorityTitle: 'Prepare for upcoming meeting',
      },
      {
        id: 'starter:research',
        title: 'Research a topic and write a brief',
        subtitle: 'Gather key facts into an executive one-pager',
        prompt: 'I want to quickly research a topic and get a structured one-page brief. Ask for the topic and goal so you can start right away.',
        priorityTitle: 'Research a topic and write a brief',
      },
    ];

  for (const starter of starters) {
    if (clues.length >= 3) break;
    clues.push({ ...starter, kind: 'starter' });
  }

  return clues;
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
  const [loadingClues, setLoadingClues] = useState(true);
  const [candidates, setCandidates] = useState<WorkDiscoveryCandidate[]>([]);
  const [recentFiles, setRecentFiles] = useState<WorkDiscoveryRecentFile[]>([]);
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

  const [run, setRun] = useState<WorkDiscoveryRun | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustText, setAdjustText] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef(0);

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

  // Read available local source metadata (zero OS permission prompts) for just-in-time contextual offers.
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
    if (next.status === 'completed') setStage('reveal');
    else if (next.status === 'failed' || next.status === 'canceled') setStage('error');
    else setStage('analyzing');
  }, []);

  // Load any already-running discovery or prewarmed local clues immediately.
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
    if (!run || stage !== 'analyzing') return;
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
  }, [applyRun, run, stage]);

  const clues = useMemo(
    () => buildQuickClues(candidates, recentFiles, zh),
    [candidates, recentFiles, zh],
  );

  const openConversation = useCallback((conversationId: string, draft?: string, autoSend = true) => {
    markDesktopHabitAnchorPending();
    const params = new URLSearchParams();
    if (draft) params.set('draft', draft);
    if (draft && autoSend) params.set('autoSend', '1');
    const query = params.toString();
    onNavigateAway();
    navigate(`/chat/${encodeURIComponent(conversationId)}${query ? `?${query}` : ''}`);
  }, [navigate, onNavigateAway]);

  const launchFolderAnalysis = useCallback(async (rootPath: string) => {
    setBusy(true);
    setError(null);
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

  const picker = useDirectoryPicker({
    onPicked: (path) => {
      setAttachedFolder(path);
      textareaRef.current?.focus();
    },
  });

  const skip = useCallback(async () => {
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

      void recordCurrentFocusPriority(priorityLabel ?? trimmed ?? compactPath(attachedFolder ?? ''));

      // If user attached a local folder AND typed a concrete goal, grant + open the project chat immediately with autoSend!
      if (attachedFolder) {
        const policy = processingTarget?.remoteModel === false ? 'local_only' : 'remote_allowed';
        await grantUnderstandingWorkFolder(attachedFolder, policy);
        const started = await startWorkDiscoveryRun(attachedFolder);
        // If they didn't type a specific instruction, show the silky live analysis -> value reveal.
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
      markDesktopHabitAnchorPending();
      const handoffId = wireAttachments.length > 0 ? createComposerPayloadHandoff(wireAttachments) : undefined;
      const href = newChatAutoSendHref(finalPrompt, handoffId);
      if (href) {
        onNavigateAway();
        navigate(href);
      } else {
        onRequestClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [applyRun, attachedContext?.snippet, attachedFolder, attachmentsApi, navigate, onNavigateAway, onRequestClose, openConversation, processingTarget?.remoteModel, zh]);

  const handleClueClick = useCallback((clue: QuickClue) => {
    if (busy) return;
    if (clue.kind === 'project') {
      void recordCurrentFocusPriority(clue.candidate.displayName);
      void launchFolderAnalysis(clue.candidate.rootPath);
      return;
    }
    if (clue.kind === 'recent_files') {
      const list = clue.files.map((file) => `- ${file.name}（${file.directory}）`).join('\n');
      const prompt = zh
        ? `我最近更新了这些本地文档，请帮我只读梳理它们的核心脉络、整理出待跟进清单和最值得马上做的下一步：\n${list}`
        : `I recently updated these local documents. Please read them (read-only), synthesize what connects them, and draft a crisp follow-up checklist with the best next step:\n${list}`;
      void launchFreeform(prompt, zh ? `整理近期文档：${clue.files[0]?.name ?? ''}` : `Review recent docs: ${clue.files[0]?.name ?? ''}`);
      return;
    }
    void launchFreeform(clue.prompt, clue.priorityTitle);
  }, [busy, launchFolderAnalysis, launchFreeform, zh]);

  const handleImportAiTools = useCallback(async () => {
    if (importState !== 'idle' || importSources.length === 0) return;
    setImportState('importing');
    const result = await importSafeAiToolConfigs(importSources.map((item) => item.id));
    setImportedCount(result.importedCount);
    setImportState('done');
  }, [importSources, importState]);

  // Keyboard shortcuts: 1/2/3 to pick a clue when composer is empty, Escape to blur.
  useEffect(() => {
    if (stage !== 'focus') return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (busy || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const inInput = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
      if (inInput && goalText.trim().length > 0) return;
      if (event.key === '1' || event.key === '2' || event.key === '3') {
        const index = Number(event.key) - 1;
        const target = clues[index];
        if (target && !inInput) {
          event.preventDefault();
          handleClueClick(target);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, clues, goalText, handleClueClick, stage]);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void launchFreeform(goalText);
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
        setContextNotice(zh ? `未授权 ${contextualOffer.label}，你可以直接开始对话。` : `${contextualOffer.label} access was declined. You can still start right away.`);
        return;
      }
      if (result.status !== 'completed' || result.items.length === 0) {
        setContextNotice(zh ? `未在 ${contextualOffer.label} 中发现近期记录，可以直接开始。` : `No recent items found in ${contextualOffer.label}. Ready to start.`);
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
      setContextNotice(zh ? `读取 ${contextualOffer.label} 失败，不影响直接开始。` : `Could not read ${contextualOffer.label}. You can still start right away.`);
    } finally {
      setCollectingContext(false);
    }
  }, [collectingContext, contextualOffer, language, zh]);

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = collectClipboardFiles(event.clipboardData);
    if (pastedFiles.length > 0) {
      event.preventDefault();
      void attachmentsApi.processFiles(pastedFiles);
    }
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

    if (droppedFolderPath) {
      setAttachedFolder(droppedFolderPath);
    }
    if (regularFiles.length > 0) {
      void attachmentsApi.processFiles(regularFiles);
    }
    if (droppedFolderPath || regularFiles.length > 0) {
      textareaRef.current?.focus();
    }
  };

  const primarySuggestion: WorkDiscoverySuggestion | undefined = useMemo(() => {
    if (!run?.result) return undefined;
    return run.result.suggestions.find((item) => item.id === run.result?.primarySuggestionId)
      ?? run.result.suggestions[0];
  }, [run]);

  const alternativeSuggestions = useMemo(
    () => (run?.result?.suggestions ?? []).filter((item) => item.id !== primarySuggestion?.id),
    [primarySuggestion?.id, run?.result?.suggestions],
  );

  const runningSignals = useMemo<UnderstandingSignal[]>(() => {
    const fileSignals: UnderstandingSignal[] = (run?.snapshot?.files ?? []).slice(0, 3).map((file) => ({
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
      label: run?.rootPath ? compactPath(run.rootPath) : copy.sourceSignals.workFolder,
      kind: 'folder',
      meta: run?.snapshot?.branch ? `Git · ${run.snapshot.branch}` : copy.sourceSignals.scanningFiles,
      detail: run?.rootPath,
    };
    return [folderSignal, ...fileSignals];
  }, [copy.sourceSignals, run?.rootPath, run?.snapshot]);

  const startSuggestion = async (suggestion: WorkDiscoverySuggestion, discussOnly = false) => {
    if (!run || busy) return;
    setBusy(true);
    try {
      await Promise.allSettled([
        submitWorkDiscoveryRecognitionFeedback(run.id, 'confirmed'),
        selectWorkDiscoverySuggestion(run.id, suggestion.id),
        recordCurrentFocusPriority(suggestion.title),
      ]);
      const prompt = discussOnly
        ? `${zh ? '先帮我评估这个方向，不要修改文件：' : 'First assess this direction without changing files:'}\n\n${suggestion.actionPrompt}`
        : suggestion.actionPrompt;
      openConversation(run.conversationId, prompt, true);
    } finally {
      setBusy(false);
    }
  };

  const submitAdjustment = async () => {
    const trimmed = adjustText.trim();
    if (!run || !trimmed || busy) return;
    setBusy(true);
    try {
      await Promise.allSettled([
        submitWorkDiscoveryRecognitionFeedback(run.id, 'corrected', trimmed),
        recordCurrentFocusPriority(trimmed),
      ]);
      openConversation(run.conversationId, trimmed, true);
    } finally {
      setBusy(false);
    }
  };

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

      {/* Drag-and-drop ambient feedback */}
      {dragActive && stage === 'focus' ? (
        <div className="pointer-events-none absolute inset-4 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-surface-overlay/85 backdrop-blur-md">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-fg">
              <Upload className="size-5" aria-hidden />
            </span>
            <p className="text-sm font-medium text-fg">
              {zh ? '松开即可附加文件或文件夹作为上下文' : 'Drop files or a folder to attach as context'}
            </p>
          </div>
        </div>
      ) : null}

      <main className="xopc-onboarding-scroll relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 pb-10 pt-2 sm:px-8">
        <div
          key={stage}
          className={cn(
            'xopc-focus-stage w-full transition-[max-width] duration-300',
            stage === 'reveal' ? 'max-w-[46rem]' : 'max-w-[42rem]',
          )}
        >
          {/* Shared-element Loopi anchor */}
          <div className="mb-5 flex justify-center">
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

          {/* ACT 2: FOCUS CANVAS */}
          {stage === 'focus' ? (
            <div>
              <div className="text-center">
                <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-fg sm:text-[2.125rem]">
                  {zh ? '你现在手头最重要的一件事是什么？' : 'What matters most on your plate right now?'}
                </h1>
                <p className="mx-auto mt-2.5 max-w-[34rem] text-sm leading-6 text-fg-muted">
                  {zh
                    ? '直接说一句、拖入文件，或点选下方刚注意到的线索。我会备好环境并立刻交付第一份结果。'
                    : 'Type a line, drop files, or pick something I noticed below. I’ll set things up and deliver your first result right away.'}
                </p>
              </div>

              {/* Hero Focus Composer */}
              <div className="xopc-focus-composer mt-7 rounded-2xl border border-edge bg-surface-panel p-3 shadow-surface transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
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
                      ? '例如：准备下周产品评审、整理这几份报价单、或排查某个项目的问题…'
                      : 'e.g., Prep Friday’s product review, summarize these quotes, or debug a feature…'}
                    className="max-h-36 min-h-[3.5rem] w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-6 text-fg outline-none placeholder:text-fg-subtle"
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
                      {zh ? '附加目录' : 'Attach folder'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => attachmentsApi.fileInputRef.current?.click()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Paperclip className="size-3.5" aria-hidden />
                      {zh ? '上传文件' : 'Attach file'}
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

              {/* Just-in-time contextual local source micro-setup (only shown when relevant to user's typed intent) */}
              {contextualOffer && attachedContext?.sourceId !== contextualOffer.sourceId ? (
                <div className="xopc-clue-card mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft/35 px-3.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-panel text-accent-fg">
                      <CalendarDays className="size-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-fg">{contextualOffer.label}</p>
                      <p className="truncate text-[11px] text-fg-muted">{contextualOffer.reason}</p>
                    </div>
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

              {/* Curated local clues or concrete starters */}
              <section className="mt-7" aria-label={zh ? '快速起点' : 'Quick starting points'}>
                <div className="mb-2.5 flex items-center justify-between px-1">
                  <p className="text-xs font-medium text-fg-muted">
                    {candidates.length > 0 || recentFiles.length > 0
                      ? (zh ? '刚注意到的手头线索' : 'Noticed on this Mac')
                      : (zh ? '或从这里快速开始' : 'Or start with one of these')}
                  </p>
                  {candidates.length > 0 || recentFiles.length > 0 ? (
                    <span className="text-[11px] text-fg-subtle">
                      {zh ? '仅本地元数据 · 点击后才会只读分析' : 'Local metadata only · read-only on click'}
                    </span>
                  ) : null}
                </div>

                {loadingClues ? (
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <Skeleton key={index} className="h-[5.75rem] rounded-xl" />
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {clues.map((clue, index) => (
                      <button
                        key={clue.id}
                        type="button"
                        disabled={busy}
                        onClick={() => handleClueClick(clue)}
                        style={{ animationDelay: `${index * 45}ms` }}
                        className="xopc-clue-card group flex min-h-[5.75rem] flex-col justify-between rounded-xl border border-edge bg-surface-panel p-3.5 text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-edge-strong hover:bg-surface-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:hover:translate-y-0"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-inset text-fg-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent-fg">
                            {clue.kind === 'project'
                              ? <FolderGit2 className="size-3.5" aria-hidden />
                              : clue.kind === 'recent_files'
                                ? <FileText className="size-3.5" aria-hidden />
                                : <Sparkles className="size-3.5" aria-hidden />}
                          </span>
                          {clue.badge ? (
                            <span className="rounded-full bg-surface-inset px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                              {clue.badge}
                            </span>
                          ) : (
                            <ArrowRight className="size-3.5 text-fg-subtle opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
                          )}
                        </div>
                        <div className="mt-2.5 min-w-0">
                          <p className="truncate text-[13px] font-medium text-fg">{clue.title}</p>
                          <p className="mt-0.5 truncate text-[11px] leading-4 text-fg-muted">{clue.subtitle}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* Subtle one-click Claude Code / Codex inheritance pill */}
              {importSources.length > 0 ? (
                <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-edge-subtle bg-surface-panel/80 px-3.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
                      <Wand2 className="size-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-fg">
                        {zh ? `检测到本机 ${importNames} 配置` : `${importNames} detected on this device`}
                      </p>
                      <p className="truncate text-[11px] text-fg-muted">
                        {importState === 'done'
                          ? (zh ? `已顺手带入 ${importedCount} 项可用 Skills 与规则` : `Imported ${importedCount} ready skills and rules`)
                          : (zh ? '一键带入兼容的 Skills、规则与项目清单，仅导入安全项' : 'Bring over compatible skills, rules, and project roots safely')}
                      </p>
                    </div>
                  </div>
                  {importState === 'done' ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <Check className="size-3.5" aria-hidden />
                      {zh ? '已带入' : 'Imported'}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 shrink-0 px-3 text-xs"
                      disabled={importState === 'importing'}
                      onClick={() => void handleImportAiTools()}
                    >
                      {importState === 'importing' ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
                      {importState === 'importing'
                        ? (zh ? '带入中…' : 'Importing…')
                        : (zh ? '一键带入' : 'Import')}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ACT 3A: LIVE READING (for selected folder) */}
          {stage === 'analyzing' && run ? (
            <section className="text-center" aria-live="polite">
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-fg">
                {zh ? `正在了解 ${compactPath(run.rootPath)}` : `Understanding ${compactPath(run.rootPath)}`}
              </h1>
              <p className="mt-2 text-sm text-fg-muted">
                {zh ? '只读查看关键结构与最近变动，完成后直接给你可推进的下一步。' : 'Reading structure and recent changes (read-only) to prepare your first concrete action.'}
              </p>

              <UnderstandingSourceConvergence
                signals={runningSignals}
                ariaLabel={copy.sourceSignals.ariaLabel}
                centerLabel={copy.sourceSignals.centerLabel}
              />

              <div className="mx-auto mt-6 grid max-w-[34rem] grid-cols-3 gap-2">
                {STAGES.map((item, index) => {
                  const activeIndex = Math.max(0, STAGES.indexOf(run.stage ?? 'folder_structure'));
                  const complete = index < activeIndex;
                  const active = index === activeIndex;
                  return (
                    <div key={item} className="min-w-0 text-left">
                      <span className={cn('block h-1 rounded-full transition-colors', active || complete ? 'bg-accent' : 'bg-surface-hover')} />
                      <span className={cn('mt-2 block text-[11px] leading-4', active ? 'font-medium text-fg' : 'text-fg-muted')}>
                        {copy.stages[item]}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mx-auto mt-7 flex max-w-md flex-col gap-2.5 sm:flex-row sm:justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 px-4 text-sm"
                  onClick={() => openConversation(run.conversationId)}
                >
                  {zh ? '不等了，直接带着目录开聊' : 'Open conversation right away'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 px-4 text-sm text-fg-muted"
                  onClick={async () => {
                    await cancelWorkDiscoveryRun(run.id).catch(() => {});
                    setRun(null);
                    setStage('focus');
                  }}
                >
                  {zh ? '换一件事' : 'Pick something else'}
                </Button>
              </div>
            </section>
          ) : null}

          {/* ACT 3B: UNIFIED SINGLE-CARD VALUE REVEAL */}
          {stage === 'reveal' && run?.result ? (
            <section aria-live="polite">
              <div className="text-center">
                <p className="text-xs font-medium tracking-wide text-accent-fg">
                  {compactPath(run.rootPath)}
                </p>
                <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.03em] text-fg sm:text-[1.75rem]">
                  {zh ? '已经了解清楚，可以从这里直接开始' : 'Here’s where things stand — ready to jump in'}
                </h1>
              </div>

              {/* Unified Understanding + Primary Action Card */}
              <div className="mt-6 overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-surface">
                {/* Compact understanding strip */}
                <div className="border-b border-edge-subtle bg-surface-inset/45 px-5 py-4 sm:px-6">
                  <p className="text-sm leading-6 text-fg">{run.result.projectSummary}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"
                      onClick={() => setEvidenceOpen((open) => !open)}
                    >
                      {zh ? '查看依据' : 'View evidence'}
                      <ChevronDown className={cn('size-3.5 transition-transform', evidenceOpen && 'rotate-180')} />
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-fg-muted hover:text-fg"
                      onClick={() => setAdjustOpen((open) => !open)}
                    >
                      {zh ? '方向有偏差？微调一句' : 'Adjust focus'}
                    </button>
                  </div>

                  {evidenceOpen ? (
                    <div className="mt-3 space-y-2 border-t border-edge-subtle pt-3 text-xs leading-5 text-fg-muted">
                      {run.result.currentState ? <p>{run.result.currentState}</p> : null}
                      {primarySuggestion?.evidence.slice(0, 3).map((item, idx) => (
                        <div key={`${idx}-${item.path ?? item.observation}`} className="flex gap-2">
                          <GitBranch className="mt-0.5 size-3.5 shrink-0 text-accent-fg" aria-hidden />
                          <span>
                            {item.path ? <><code className="font-mono text-fg">{item.path}</code>: </> : null}
                            {item.observation}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {adjustOpen ? (
                    <div className="mt-3 flex gap-2 border-t border-edge-subtle pt-3">
                      <input
                        autoFocus
                        value={adjustText}
                        onChange={(event) => setAdjustText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && adjustText.trim()) {
                            event.preventDefault();
                            void submitAdjustment();
                          }
                        }}
                        placeholder={zh ? '告诉我你现在真正想推进什么…' : 'Tell me what you actually want to move forward…'}
                        className="h-9 flex-1 rounded-lg border border-edge bg-surface-base px-3 text-xs text-fg outline-none focus:border-accent"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        className="h-9 px-3 text-xs"
                        disabled={busy || !adjustText.trim()}
                        onClick={() => void submitAdjustment()}
                      >
                        {zh ? '按此开始' : 'Start with this'}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {/* Primary concrete next action */}
                {primarySuggestion ? (
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                      <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-medium text-accent-fg">
                        {zh ? '推荐第一步' : 'Recommended first step'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="size-3.5" aria-hidden />
                        {copy.estimatedMinutes.replace('{{count}}', String(primarySuggestion.estimatedMinutes))}
                      </span>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold text-fg">{primarySuggestion.title}</h2>
                    <p className="mt-1.5 text-sm leading-6 text-fg-muted">{primarySuggestion.rationale}</p>

                    <div className="mt-5 flex flex-wrap items-center gap-2.5">
                      <Button
                        type="button"
                        variant="primary"
                        className="h-10 gap-1.5 rounded-xl px-5 text-sm"
                        disabled={busy}
                        onClick={() => void startSuggestion(primarySuggestion, false)}
                      >
                        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                        {zh ? '马上开始这件事' : 'Start this now'}
                        {!busy ? <ArrowRight className="size-4" aria-hidden /> : null}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-10 rounded-xl px-4 text-sm"
                        disabled={busy}
                        onClick={() => void startSuggestion(primarySuggestion, true)}
                      >
                        {zh ? '先只评估，不动文件' : 'Assess first, read-only'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 sm:p-6">
                    <Button
                      type="button"
                      variant="primary"
                      className="h-10 rounded-xl px-5 text-sm"
                      onClick={() => openConversation(run.conversationId)}
                    >
                      {zh ? '进入项目对话' : 'Open project conversation'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Optional alternative directions */}
              {alternativeSuggestions.length > 0 ? (
                <div className="mt-4">
                  <button
                    type="button"
                    className="mx-auto flex items-center gap-1.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
                    onClick={() => setAlternativesOpen((open) => !open)}
                  >
                    {zh ? `查看其他 ${alternativeSuggestions.length} 个方向` : `See ${alternativeSuggestions.length} other directions`}
                    <ChevronDown className={cn('size-3.5 transition-transform', alternativesOpen && 'rotate-180')} />
                  </button>
                  {alternativesOpen ? (
                    <div className="mt-2 divide-y divide-edge-subtle overflow-hidden rounded-xl border border-edge bg-surface-panel">
                      {alternativeSuggestions.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          disabled={busy}
                          onClick={() => void startSuggestion(item, false)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/60"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-fg">{item.title}</p>
                            <p className="mt-0.5 line-clamp-1 text-xs text-fg-muted">{item.rationale}</p>
                          </div>
                          <ArrowRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5 flex justify-center gap-5 text-xs text-fg-muted">
                <button
                  type="button"
                  className="hover:text-fg hover:underline"
                  onClick={() => {
                    setRun(null);
                    setStage('focus');
                  }}
                >
                  {zh ? '换一件更重要的事' : 'Pick something else'}
                </button>
                <button
                  type="button"
                  className="hover:text-fg hover:underline"
                  onClick={() => openConversation(run.conversationId)}
                >
                  {zh ? '直接进入对话' : 'Open blank conversation'}
                </button>
              </div>
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
                  className="h-10 px-4 text-sm"
                  onClick={() => void retryWorkDiscoveryRun(run.id).then(applyRun)}
                >
                  {copy.retry}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 px-4 text-sm"
                  onClick={() => openConversation(run.conversationId)}
                >
                  {zh ? '直接带着目录对话' : 'Open conversation anyway'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 px-4 text-sm"
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
