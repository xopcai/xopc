import {
  ArrowRight,
  BookOpenText,
  Bookmark,
  CalendarDays,
  Check,
  CornerDownLeft,
  FileCode2,
  FileText,
  FolderPlus,
  ListTodo,
  Lock,
  Mail,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  StickyNote,
  X,
  type LucideIcon,
} from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Loopi } from '@/components/brand/loopi';
import { APP_CHROME_BAR_CLASS, APP_CHROME_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { newChatAutoSendHref } from '@/features/chat/session/composer-handoff-params';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { markDesktopHabitAnchorPending } from '@/features/onboarding/desktop-habit-toast';
import { recordCurrentFocusPriority } from '@/features/onboarding/desktop-onboarding-bootstrap';
import { OnboardingLanguageSwitch } from '@/features/onboarding/onboarding-language-switch';
import {
  cancelDeepUnderstandingRun,
  confirmDeepUnderstandingRun,
  discoverWorkDiscoveryCandidates,
  dismissWorkDiscoveryOnboarding,
  fetchDeepUnderstandingRun,
  fetchLocalSourcePreviews,
  startDeepUnderstandingRun,
  type DeepUnderstandingPhase,
  type DeepUnderstandingRun,
  type LocalSourcePreview,
  type WorkDiscoveryProcessingTarget,
  type WorkUnderstandingThread,
  type WritingStyleDimension,
} from '@/features/work-discovery/api';
import { useUnderstandingActivityStore } from '@/features/work-discovery/understanding-activity-store';
import {
  UnderstandingSourceConvergence,
  type UnderstandingSignal,
  type UnderstandingSignalKind,
} from '@/features/work-discovery/understanding-source-convergence';
import { cn } from '@/lib/cn';
import { isElectronDarwin } from '@/lib/electron-window-chrome';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import type {
  ElectronUnderstandingSourceDefinition,
  ElectronUnderstandingSourceItem,
} from '@/types/electron';

type OnboardingAct = 'sources' | 'analyzing' | 'reveal';
type ItemDecision = 'accepted' | 'edited' | 'rejected';

const TIER1_ORDER = [
  'local-ai-instructions',
  'local-obsidian',
  'local-markdown-notes',
  'local-recent-files',
  'chromium-bookmarks',
] as const;

type SourceUiMeta = {
  id: string;
  zh: { label: string; hint: string };
  en: { label: string; hint: string };
  icon: LucideIcon;
  signalKind: UnderstandingSignalKind;
};

const SOURCE_META: Record<string, SourceUiMeta> = {
  'local-ai-instructions': {
    id: 'local-ai-instructions',
    zh: { label: 'AI 规则 (CLAUDE.md / AGENTS.md)', hint: '你明文写下的偏好与沟通习惯' },
    en: { label: 'AI Rules (CLAUDE.md / AGENTS.md)', hint: 'Explicit preferences and habits you wrote' },
    icon: FileCode2,
    signalKind: 'note',
  },
  'local-obsidian': {
    id: 'local-obsidian',
    zh: { label: 'Obsidian 知识库', hint: '核心思考、术语体系与写作风格' },
    en: { label: 'Obsidian Vaults', hint: 'Core thinking, terminology, and writing voice' },
    icon: BookOpenText,
    signalKind: 'note',
  },
  'local-markdown-notes': {
    id: 'local-markdown-notes',
    zh: { label: '本地笔记目录', hint: 'Markdown 笔记与自定义目录' },
    en: { label: 'Local Markdown Notes', hint: 'Common note folders & custom directories' },
    icon: StickyNote,
    signalKind: 'note',
  },
  'local-recent-files': {
    id: 'local-recent-files',
    zh: { label: '近期本地文档', hint: '文稿/桌面里的创作与方案文件' },
    en: { label: 'Recent Local Documents', hint: 'Recent authored drafts and specs' },
    icon: FileText,
    signalKind: 'recent',
  },
  'chromium-bookmarks': {
    id: 'chromium-bookmarks',
    zh: { label: '浏览器书签', hint: '近期调研主题与关注领域' },
    en: { label: 'Browser Bookmarks', hint: 'Research topics and focus areas' },
    icon: Bookmark,
    signalKind: 'data',
  },
  'apple-notes': {
    id: 'apple-notes',
    zh: { label: 'Apple 备忘录', hint: '碎片灵感、草稿与口语化表达' },
    en: { label: 'Apple Notes', hint: 'Drafts, ideas, and natural voice' },
    icon: StickyNote,
    signalKind: 'note',
  },
  'apple-mail': {
    id: 'apple-mail',
    zh: { label: 'Apple 邮件（含已发风格）', hint: '对外正式写作风格与核心事务' },
    en: { label: 'Apple Mail (Sent & Inbox)', hint: 'Formal writing style & active threads' },
    icon: Mail,
    signalKind: 'mail',
  },
  'apple-calendar': {
    id: 'apple-calendar',
    zh: { label: 'Apple 日历', hint: '周期例会、工作节奏与协作主题' },
    en: { label: 'Apple Calendar', hint: 'Recurring meetings & work rhythm' },
    icon: CalendarDays,
    signalKind: 'calendar',
  },
  'apple-reminders': {
    id: 'apple-reminders',
    zh: { label: 'Apple 提醒事项', hint: '近期承诺与日常任务清单' },
    en: { label: 'Apple Reminders', hint: 'Open commitments & daily lists' },
    icon: ListTodo,
    signalKind: 'task',
  },
};

const DIMENSION_LABELS: Record<WritingStyleDimension, { zh: string; en: string }> = {
  language: { zh: '语言习惯', en: 'Language' },
  structure: { zh: '结构排版', en: 'Structure' },
  tone: { zh: '语气修辞', en: 'Tone' },
  density: { zh: '信息密度', en: 'Density' },
  scenarios: { zh: '分场景风格', en: 'Scenarios' },
  vocabulary: { zh: '常用术语', en: 'Vocabulary' },
};

const DOMAIN_LABELS: Record<string, { zh: string; en: string }> = {
  identity: { zh: '角色身份', en: 'Identity' },
  capabilities: { zh: '核心专长', en: 'Capabilities' },
  cognition: { zh: '思维方式', en: 'Cognition' },
  behavior: { zh: '工作节奏', en: 'Work Rhythm' },
  values: { zh: '关注原则', en: 'Values' },
  preferences: { zh: '偏好习惯', en: 'Preferences' },
  relationships: { zh: '协作关系', en: 'Relationships' },
};

function sourceShortLabel(sourceId: string, zh: boolean): string {
  const meta = SOURCE_META[sourceId];
  if (!meta) return sourceId;
  return zh ? (meta.zh.label.split(' ')[0] ?? meta.zh.label) : (meta.en.label.split(' (')[0] ?? meta.en.label);
}

function phaseCenterLabel(phase: DeepUnderstandingPhase, zh: boolean): string {
  if (phase === 'collecting') {
    return zh ? '正在读取笔记与近期文档…' : 'Reading notes and recent documents…';
  }
  if (phase === 'analyzing_writing') {
    return zh ? '正在分析你的写作与表达风格…' : 'Analyzing your writing & expression style…';
  }
  if (phase === 'synthesizing') {
    return zh ? '正在跨来源综合你的背景与当前重心…' : 'Synthesizing cross-source understanding…';
  }
  return zh ? '正在整理你的初版认知…' : 'Finalizing your understanding…';
}

export function DeepUnderstandingOnboarding({
  embedded = false,
  onRequestClose,
  onNavigateAway,
}: {
  embedded?: boolean;
  onRequestClose?: () => void;
  onNavigateAway?: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const zh = language === 'zh';
  const wdMessages = messages(language).chat.workingDirectory;
  const navigate = useNavigate();

  const [act, setAct] = useState<OnboardingAct>('sources');
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previews, setPreviews] = useState<LocalSourcePreview[]>([]);
  const [processingTarget, setProcessingTarget] = useState<WorkDiscoveryProcessingTarget | null>(null);
  const [tier2Sources, setTier2Sources] = useState<ElectronUnderstandingSourceDefinition[]>([]);
  const [selectedTier1, setSelectedTier1] = useState<Set<string>>(() => new Set(TIER1_ORDER));
  const [selectedTier2, setSelectedTier2] = useState<Set<string>>(() => new Set());
  const [customNoteDirs, setCustomNoteDirs] = useState<string[]>([]);
  const [directPrompt, setDirectPrompt] = useState('');

  const [activeRun, setActiveRun] = useState<DeepUnderstandingRun | null>(null);
  const [tier2Notice, setTier2Notice] = useState<string | null>(null);
  const [showBackgroundCta, setShowBackgroundCta] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Act 3 Calibration State
  const [aboutDecisions, setAboutDecisions] = useState<Record<string, { decision: ItemDecision; statement: string }>>({});
  const [writingDecisions, setWritingDecisions] = useState<Record<string, { decision: ItemDecision; statement: string }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [customRules, setCustomRules] = useState<string[]>([]);
  const [newRuleText, setNewRuleText] = useState('');
  const [calibrationAnswers, setCalibrationAnswers] = useState<Record<string, string>>({});

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshPreviews = useCallback(async (dirs: string[]) => {
    const [previewList, candidatesResult, catalog] = await Promise.allSettled([
      fetchLocalSourcePreviews(dirs),
      discoverWorkDiscoveryCandidates(),
      window.electronAPI?.understandingSources?.catalog() ?? Promise.resolve([]),
    ]);
    if (!mountedRef.current) return;
    if (previewList.status === 'fulfilled') {
      setPreviews(previewList.value);
      setSelectedTier1((prev) => {
        const detectedIds = previewList.value.filter((item) => item.detected).map((item) => item.sourceId);
        return detectedIds.length > 0 ? new Set(detectedIds) : prev;
      });
    }
    if (candidatesResult.status === 'fulfilled') {
      setProcessingTarget(candidatesResult.value.processingTarget);
    }
    if (catalog.status === 'fulfilled') {
      setTier2Sources(catalog.value.filter((source) => source.tier === 2 && source.availability === 'available'));
    }
    setLoadingPreview(false);
  }, []);

  useEffect(() => {
    const existingDeep = useUnderstandingActivityStore.getState().deepRun;
    if (existingDeep?.status === 'running') {
      setActiveRun(existingDeep);
      setAct('analyzing');
      setShowBackgroundCta(true);
      setLoadingPreview(false);
      return;
    }
    void refreshPreviews([]);
  }, [refreshPreviews]);

  const picker = useDirectoryPicker({
    onPicked: (pickedPath) => {
      setCustomNoteDirs((prev) => {
        if (prev.includes(pickedPath)) return prev;
        const next = [...prev, pickedPath];
        setSelectedTier1((sel) => new Set(sel).add('local-markdown-notes'));
        void refreshPreviews(next);
        return next;
      });
    },
  });

  // Expose "Continue in background" button smoothly after 5 seconds in Act 2.
  useEffect(() => {
    if (act !== 'analyzing') {
      setShowBackgroundCta(false);
      return;
    }
    const timer = window.setTimeout(() => setShowBackgroundCta(true), 5_000);
    return () => window.clearTimeout(timer);
  }, [act]);

  const applyRunState = useCallback((next: DeepUnderstandingRun) => {
    useUnderstandingActivityStore.getState().updateDeepRun(next);
    setActiveRun(next);
    if (next.status === 'completed' && next.result) {
      const nextAbout: Record<string, { decision: ItemDecision; statement: string }> = {};
      for (const item of next.result.aboutYou) {
        nextAbout[item.id] = { decision: 'accepted', statement: item.statement };
      }
      const nextWriting: Record<string, { decision: ItemDecision; statement: string }> = {};
      for (const item of next.result.writingPreferences) {
        nextWriting[item.id] = { decision: 'accepted', statement: item.statement };
      }
      setAboutDecisions(nextAbout);
      setWritingDecisions(nextWriting);
      setAct('reveal');
    } else if (next.status === 'failed' || next.status === 'canceled') {
      setError(next.errorMessage ?? (zh ? '分析未完成，请重试或直接开始聊天。' : 'Analysis did not finish. Retry or jump straight into chat.'));
      setAct('sources');
    }
  }, [zh]);

  // Listen to realtime events + poll fallback while Act 2 is running.
  useEffect(() => {
    if (act !== 'analyzing' || !activeRun) return;
    if (activeRun.status !== 'running') {
      applyRunState(activeRun);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchDeepUnderstandingRun(activeRun.id);
        if (!cancelled) applyRunState(next);
      } catch {
        // Recover on next tick or realtime event.
      }
    };
    const interval = window.setInterval(() => void poll(), 1_200);
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string; run?: DeepUnderstandingRun }>).detail;
      if (detail?.runId && detail.runId !== activeRun.id) return;
      if (detail?.run) applyRunState(detail.run);
      else void poll();
    };
    const names = ['understanding-progress', 'understanding-completed', 'understanding-failed', 'understanding-canceled'];
    for (const name of names) window.addEventListener(name, onEvent);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      for (const name of names) window.removeEventListener(name, onEvent);
    };
  }, [act, activeRun, applyRunState]);

  const previewMap = useMemo(
    () => new Map(previews.map((item) => [item.sourceId, item])),
    [previews],
  );

  const selectedCount = selectedTier1.size + selectedTier2.size;

  const toggleTier1 = (sourceId: string) => {
    setSelectedTier1((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const toggleTier2 = (sourceId: string) => {
    setSelectedTier2((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const launchDeepUnderstanding = useCallback(async () => {
    if (busy || selectedCount === 0) return;
    setBusy(true);
    setError(null);
    setTier2Notice(null);
    setAct('analyzing');

    try {
      const precollectedItems: ElectronUnderstandingSourceItem[] = [];
      const sourceCheckpoints: Record<string, { fingerprint: string; collectedAt: number }> = {};

      // Collect opted-in Tier 2 Apple sources serially via Electron IPC; denials degrade smoothly.
      const tier2List = [...selectedTier2];
      if (tier2List.length > 0 && window.electronAPI?.understandingSources?.collect) {
        const deniedLabels: string[] = [];
        const results = await window.electronAPI.understandingSources.collect(tier2List);
        for (const result of results) {
          if (result.status === 'completed') {
            precollectedItems.push(...result.items);
            if (result.checkpoint) sourceCheckpoints[result.sourceId] = result.checkpoint;
          } else if (result.status === 'denied') {
            deniedLabels.push(sourceShortLabel(result.sourceId, zh));
          }
        }
        if (deniedLabels.length > 0) {
          setTier2Notice(zh
            ? `已跳过未授权的 ${deniedLabels.join('、')}，继续分析其余来源。`
            : `Skipped unauthorized ${deniedLabels.join(', ')} and continued with remaining sources.`);
        }
      }

      const tier1List = [...selectedTier1];
      if (tier1List.length === 0 && precollectedItems.length === 0) {
        setError(zh ? '所选来源暂无可读取内容，请勾选其他来源或直接开始对话。' : 'No readable items found in selected sources. Pick another source or start chatting.');
        setAct('sources');
        return;
      }

      const policy = processingTarget?.remoteModel === false ? 'local_only' : 'remote_allowed';
      const run = await startDeepUnderstandingRun({
        selectedTier1Sources: tier1List,
        customNoteDirectories: customNoteDirs,
        precollectedItems,
        sourceCheckpoints,
        processingPolicy: policy,
      });
      applyRunState(run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setAct('sources');
    } finally {
      setBusy(false);
    }
  }, [applyRunState, busy, customNoteDirs, processingTarget?.remoteModel, selectedCount, selectedTier1, selectedTier2, zh]);

  const leaveToChat = useCallback((prompt?: string) => {
    markDesktopHabitAnchorPending();
    if (prompt?.trim()) {
      const href = newChatAutoSendHref(prompt.trim());
      if (href) {
        onNavigateAway?.();
        navigate(href);
        return;
      }
    }
    onRequestClose?.();
    if (!onRequestClose) navigate('/chat');
  }, [navigate, onNavigateAway, onRequestClose]);

  const handleContinueInBackground = useCallback(async () => {
    await dismissWorkDiscoveryOnboarding().catch(() => {});
    leaveToChat();
  }, [leaveToChat]);

  const handleSkip = useCallback(async () => {
    if (activeRun?.status === 'running') {
      void cancelDeepUnderstandingRun(activeRun.id).catch(() => {});
    }
    await dismissWorkDiscoveryOnboarding().catch(() => {});
    leaveToChat();
  }, [activeRun, leaveToChat]);

  const handleDirectStart = useCallback(async () => {
    const trimmed = directPrompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      void recordCurrentFocusPriority(trimmed);
      await dismissWorkDiscoveryOnboarding().catch(() => {});
      leaveToChat(trimmed);
    } finally {
      setBusy(false);
    }
  }, [busy, directPrompt, leaveToChat]);

  const handleDirectKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleDirectStart();
    }
  };

  const commitConfirmations = useCallback(async (selectedThread?: WorkUnderstandingThread) => {
    if (!activeRun || !activeRun.result || busy) return;
    setBusy(true);
    setError(null);
    try {
      await confirmDeepUnderstandingRun(activeRun.id, {
        aboutYou: activeRun.result.aboutYou.map((item) => {
          const state = aboutDecisions[item.id] ?? { decision: 'accepted', statement: item.statement };
          return {
            id: item.id,
            assertionId: item.assertionId,
            decision: state.decision,
            ...(state.decision === 'edited' ? { statement: state.statement } : {}),
          };
        }),
        writingPreferences: activeRun.result.writingPreferences.map((pref) => {
          const state = writingDecisions[pref.id] ?? { decision: 'accepted', statement: pref.statement };
          return {
            id: pref.id,
            assertionId: pref.assertionId,
            dimension: pref.dimension,
            decision: state.decision,
            statement: state.statement,
            sourceIds: pref.sourceIds,
          };
        }),
        customWritingRules: customRules,
        calibrationAnswers: activeRun.result.calibrationQuestions.flatMap((q) => {
          const answer = calibrationAnswers[q.id]?.trim();
          return answer ? [{ question: q.question, answer }] : [];
        }),
        ...(selectedThread ? { selectedThreadId: selectedThread.id } : {}),
        markOnboardingCompleted: true,
      });

      if (selectedThread) {
        const prompt = zh
          ? `围绕「${selectedThread.title}」继续推进：${selectedThread.recommendedFirstStep ?? selectedThread.summary}`
          : `Let's continue on "${selectedThread.title}": ${selectedThread.recommendedFirstStep ?? selectedThread.summary}`;
        leaveToChat(prompt);
      } else {
        leaveToChat();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [aboutDecisions, activeRun, busy, calibrationAnswers, customRules, leaveToChat, writingDecisions, zh]);

  const addCustomRule = () => {
    const trimmed = newRuleText.trim();
    if (!trimmed) return;
    setCustomRules((prev) => [...prev, trimmed]);
    setNewRuleText('');
  };

  const convergenceSignals: UnderstandingSignal[] = useMemo(() => {
    const sourceList = activeRun?.selectedSources ?? [...selectedTier1, ...selectedTier2];
    const progressById = new Map((activeRun?.sourceStatuses ?? []).map((entry) => [entry.sourceId, entry]));
    return sourceList.map((sourceId) => {
      const meta = SOURCE_META[sourceId];
      const progress = progressById.get(sourceId);
      const countText = progress?.itemCount
        ? (zh ? `${progress.itemCount} 条` : `${progress.itemCount} items`)
        : (zh ? '读取中' : 'Reading');
      return {
        id: sourceId,
        label: sourceShortLabel(sourceId, zh),
        kind: meta?.signalKind ?? 'data',
        meta: countText,
      };
    });
  }, [activeRun, selectedTier1, selectedTier2, zh]);

  const emergingLabels = useMemo(() => {
    if (!activeRun) return [];
    return activeRun.sourceStatuses
      .filter((entry) => entry.itemCount > 0)
      .slice(0, 3)
      .map((entry) => `${sourceShortLabel(entry.sourceId, zh)} ${entry.itemCount}`);
  }, [activeRun, zh]);

  const reveal = activeRun?.result;

  return (
    <div className="xopc-onboarding-experience flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-base text-fg">
      {!embedded ? (
        <header
          className={cn(
            'flex h-12 shrink-0 items-center justify-between px-4 sm:px-6',
            isElectronDarwin() ? `${APP_CHROME_BAR_CLASS} ${APP_CHROME_DRAG_CLASS} pl-20` : '',
          )}
        >
          <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            <Sparkles className="size-3.5 text-accent-fg" aria-hidden />
            <span>{zh ? '深度认识你' : 'Deep Understanding'}</span>
          </div>
          <div className="flex items-center gap-2">
            <OnboardingLanguageSwitch value={language} onChange={setLanguage} />
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleSkip()}
              className="h-7 px-2 text-xs text-fg-muted hover:text-fg"
            >
              {zh ? '跳过' : 'Skip'}
            </Button>
          </div>
        </header>
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-[44rem] flex-col">
          {/* ACT 1: Source Canvas */}
          {act === 'sources' ? (
            <section className="space-y-6" aria-label={zh ? '选择认识你的线索' : 'Choose sources to understand you'}>
              <div className="flex flex-col items-center text-center">
                <Loopi variant="avatar" className="mb-3 size-14" />
                <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
                  {zh ? '让我先真正认识你' : 'Let me really get to know you'}
                </h1>
                <p className="mt-1.5 max-w-lg text-sm text-fg-muted">
                  {zh
                    ? '只读本地资料，提炼你的背景、写作风格和近期重心。所有派生认知仅留在你的设备，随时可改可删。'
                    : 'Read-only local scan to learn your background, writing voice, and active work. Stored locally and editable anytime.'}
                </p>
              </div>

              {error ? (
                <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
                  {error}
                </div>
              ) : null}

              {/* Tier 1: Zero-Prompt Local Sources */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    {zh ? '自动发现的本机线索（零权限弹窗）' : 'Auto-discovered local sources (zero popups)'}
                  </h2>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => picker.pick()}
                    className="h-7 gap-1.5 px-2 text-xs text-accent-fg"
                  >
                    <FolderPlus className="size-3.5" aria-hidden />
                    <span>{zh ? '添加笔记目录' : 'Add notes folder'}</span>
                  </Button>
                </div>

                {loadingPreview ? (
                  <div className="grid gap-2.5 sm:grid-cols-2" aria-busy>
                    {Array.from({ length: 4 }).map((_, idx) => (
                      <Skeleton key={idx} className="h-16 rounded-xl" />
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {TIER1_ORDER.map((sourceId) => {
                      const meta = SOURCE_META[sourceId];
                      if (!meta) return null;
                      const Icon = meta.icon;
                      const preview = previewMap.get(sourceId);
                      const checked = selectedTier1.has(sourceId);
                      const detected = preview?.detected === true;
                      const countBadge = detected
                        ? (preview?.summary
                          ? `${preview.summary} · ${preview.itemCount}`
                          : (zh ? `发现 ${preview.itemCount} 项` : `${preview.itemCount} found`))
                        : (zh ? '未检测到' : 'Not detected');
                      return (
                        <button
                          key={sourceId}
                          type="button"
                          onClick={() => toggleTier1(sourceId)}
                          aria-pressed={checked}
                          className={cn(
                            'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                            checked
                              ? 'border-accent/60 bg-accent-soft/35'
                              : 'border-edge bg-surface-panel hover:border-edge-strong',
                          )}
                        >
                          <span className={cn(
                            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                            checked ? 'bg-accent text-white' : 'bg-surface-base text-fg-muted',
                          )}>
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium text-fg">
                                {zh ? meta.zh.label : meta.en.label}
                              </span>
                              {checked ? <Check className="size-4 shrink-0 text-accent-fg" aria-hidden /> : null}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-fg-muted">
                              {zh ? meta.zh.hint : meta.en.hint}
                            </span>
                            <span className={cn(
                              'mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px]',
                              detected ? 'bg-accent-soft/60 text-accent-fg' : 'bg-surface-base text-fg-muted',
                            )}>
                              {countBadge}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {customNoteDirs.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {customNoteDirs.map((dir) => (
                      <span
                        key={dir}
                        className="inline-flex items-center gap-1 rounded-lg border border-edge bg-surface-panel px-2 py-1 text-xs text-fg-muted"
                      >
                        <span className="max-w-[16rem] truncate">{dir}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = customNoteDirs.filter((item) => item !== dir);
                            setCustomNoteDirs(next);
                            void refreshPreviews(next);
                          }}
                          className="text-fg-muted hover:text-fg"
                          aria-label={zh ? '移除目录' : 'Remove directory'}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Tier 2: Opt-in OS Permission Sources (macOS Electron) */}
              {tier2Sources.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <Lock className="size-3.5 text-fg-muted" aria-hidden />
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                      {zh ? '可选解锁更深入来源（勾选后依次请求系统授权）' : 'Optional deeper sources (requests OS permission only if checked)'}
                    </h2>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {tier2Sources.map((source) => {
                      const meta = SOURCE_META[source.id];
                      const Icon = meta?.icon ?? StickyNote;
                      const checked = selectedTier2.has(source.id);
                      return (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => toggleTier2(source.id)}
                          aria-pressed={checked}
                          className={cn(
                            'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                            checked
                              ? 'border-accent/60 bg-accent-soft/35'
                              : 'border-edge bg-surface-panel hover:border-edge-strong',
                          )}
                        >
                          <span className={cn(
                            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                            checked ? 'bg-accent text-white' : 'bg-surface-base text-fg-muted',
                          )}>
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium text-fg">
                                {meta ? (zh ? meta.zh.label : meta.en.label) : source.displayName}
                              </span>
                              {checked ? <Check className="size-4 shrink-0 text-accent-fg" aria-hidden /> : <Lock className="size-3.5 shrink-0 text-fg-muted" aria-hidden />}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-fg-muted">
                              {meta ? (zh ? meta.zh.hint : meta.en.hint) : source.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Primary CTA & Privacy Disclosure */}
              <div className="space-y-3 pt-1">
                <Button
                  type="button"
                  onClick={() => void launchDeepUnderstanding()}
                  disabled={busy || selectedCount === 0}
                  className="h-11 w-full gap-2 rounded-xl text-sm font-medium"
                >
                  <Sparkles className="size-4" aria-hidden />
                  <span>
                    {zh
                      ? `深入认识我（已选 ${selectedCount} 个来源 · 约 20–40 秒）`
                      : `Deeply understand me (${selectedCount} sources · ~20–40s)`}
                  </span>
                  <ArrowRight className="size-4" aria-hidden />
                </Button>

                <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-fg-muted">
                  <ShieldCheck className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
                  <span>
                    {processingTarget?.remoteModel
                      ? (zh
                        ? `将仅向当前配置的云端模型（${processingTarget.provider}）发送脱敏采样片段用于提炼画像，原文不落盘。`
                        : `Only bounded, redacted excerpts are sent to ${processingTarget.provider} to synthesize your profile; raw text is never stored.`)
                      : (zh
                        ? '当前使用本机模型，分析全程离线运行，数据不出本机。'
                        : 'Using a local model — analysis runs completely offline on your device.')}
                  </span>
                </p>

                {/* Lightweight Direct Chat Entry */}
                <div className="flex items-center gap-2 rounded-xl border border-edge bg-surface-panel px-3 py-2">
                  <input
                    type="text"
                    value={directPrompt}
                    onChange={(e) => setDirectPrompt(e.target.value)}
                    onKeyDown={handleDirectKeyDown}
                    placeholder={zh ? '或者直接说一件事开始…' : 'Or type anything to start right away…'}
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-muted focus:outline-none"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!directPrompt.trim() || busy}
                    onClick={() => void handleDirectStart()}
                    className="h-7 gap-1 px-2 text-xs text-accent-fg"
                  >
                    <span>{zh ? '直接开聊' : 'Start'}</span>
                    <CornerDownLeft className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {/* ACT 2: Live Two-Speed Understanding */}
          {act === 'analyzing' ? (
            <section className="flex flex-col items-center py-6 text-center" aria-live="polite">
              <h2 className="text-lg font-semibold text-fg">
                {zh ? '正在从你的本地线索建立深度认识' : 'Building your deep understanding'}
              </h2>
              <p className="mt-1 text-xs text-fg-muted">
                {tier2Notice ?? (zh ? '严格只读分析，提取背景认知、写作偏好与当前主线' : 'Read-only synthesis of your context, writing voice, and active work')}
              </p>

              <UnderstandingSourceConvergence
                signals={convergenceSignals}
                ariaLabel={phaseCenterLabel(activeRun?.phase ?? 'collecting', zh)}
                centerLabel={phaseCenterLabel(activeRun?.phase ?? 'collecting', zh)}
                emergingLabels={emergingLabels}
              />

              <div className="mt-6 flex items-center gap-3">
                {showBackgroundCta ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleContinueInBackground()}
                    className="rounded-xl text-xs"
                  >
                    {zh ? '后台继续，先去聊天' : 'Continue in background & chat'}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (activeRun?.id) void cancelDeepUnderstandingRun(activeRun.id).catch(() => {});
                    setAct('sources');
                  }}
                  className="text-xs text-fg-muted"
                >
                  {zh ? '取消并返回' : 'Cancel'}
                </Button>
              </div>
            </section>
          ) : null}

          {/* ACT 3: Deep Understanding Reveal & Calibration */}
          {act === 'reveal' && reveal ? (
            <section className="space-y-6" aria-label={zh ? '初版深度认识校准台' : 'Deep understanding calibration'}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold text-fg">
                    {zh ? '这是我目前对你的认识' : 'Here is what I learned about you'}
                  </h1>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {zh
                      ? '确认或微调任何一条，写作偏好会立刻在下一句对话生效。'
                      : 'Confirm or tweak anything below. Confirmed writing preferences take effect immediately.'}
                  </p>
                </div>
                <Loopi variant="avatar" className="size-10 shrink-0" />
              </div>

              {error ? (
                <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
                  {error}
                </div>
              ) : null}

              {/* Module A: About You */}
              <div className="space-y-2.5 rounded-2xl border border-edge bg-surface-panel p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-fg">
                    {zh ? '关于你 · 身份、领域与思考方式' : 'About You · Role, Domain & Thinking'}
                  </h2>
                  <span className="text-[11px] text-fg-muted">
                    {zh ? `${reveal.aboutYou.length} 条认知` : `${reveal.aboutYou.length} insights`}
                  </span>
                </div>
                {reveal.aboutYou.length === 0 ? (
                  <p className="text-xs text-fg-muted">
                    {zh ? '暂未提取到明确的背景认知，你可以在后续对话中自然补充。' : 'No durable background insights yet — they will grow naturally as we chat.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {reveal.aboutYou.map((item) => {
                      const state: { decision: ItemDecision; statement: string } = aboutDecisions[item.id] ?? { decision: 'accepted', statement: item.statement };
                      const domainMeta = item.domain ? DOMAIN_LABELS[item.domain] : undefined;
                      const isEditing = editingId === `about:${item.id}`;
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'rounded-xl border px-3 py-2.5 transition-colors',
                            state.decision === 'rejected'
                              ? 'border-edge-subtle bg-surface-base/40 opacity-55'
                              : 'border-edge bg-surface-base',
                          )}
                        >
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingDraft}
                                onChange={(e) => setEditingDraft(e.target.value)}
                                className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-2.5 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                                autoFocus
                              />
                              <Button
                                type="button"
                                onClick={() => {
                                  const nextText = editingDraft.trim();
                                  if (nextText) {
                                    setAboutDecisions((prev) => ({
                                      ...prev,
                                      [item.id]: { decision: 'edited', statement: nextText },
                                    }));
                                  }
                                  setEditingId(null);
                                }}
                                className="h-7 px-2.5 text-xs"
                              >
                                {zh ? '保存' : 'Save'}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className={cn('text-sm text-fg', state.decision === 'rejected' && 'line-through')}>
                                  {state.statement}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
                                  {domainMeta ? (
                                    <span className="rounded bg-surface-panel px-1.5 py-0.5">
                                      {zh ? domainMeta.zh : domainMeta.en}
                                    </span>
                                  ) : null}
                                  {(item.sourceIds?.length ?? 0) >= 2 ? (
                                    <span className="rounded bg-accent-soft/60 px-1.5 py-0.5 text-accent-fg">
                                      {zh ? `跨 ${item.sourceIds!.length} 个来源印证` : `Corroborated across ${item.sourceIds!.length} sources`}
                                    </span>
                                  ) : item.sourceIds?.[0] ? (
                                    <span>{sourceShortLabel(item.sourceIds[0], zh)}</span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setAboutDecisions((prev) => ({
                                    ...prev,
                                    [item.id]: { decision: 'accepted', statement: state.statement },
                                  }))}
                                  aria-label={zh ? '确认' : 'Confirm'}
                                  className={cn(
                                    'rounded-lg p-1.5 transition-colors',
                                    state.decision !== 'rejected' ? 'bg-accent-soft/70 text-accent-fg' : 'text-fg-muted hover:text-fg',
                                  )}
                                >
                                  <Check className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(`about:${item.id}`);
                                    setEditingDraft(state.statement);
                                  }}
                                  aria-label={zh ? '改一句' : 'Edit'}
                                  className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-panel hover:text-fg"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAboutDecisions((prev) => ({
                                    ...prev,
                                    [item.id]: { decision: 'rejected', statement: state.statement },
                                  }))}
                                  aria-label={zh ? '不准确' : 'Reject'}
                                  className={cn(
                                    'rounded-lg p-1.5 transition-colors',
                                    state.decision === 'rejected' ? 'bg-danger/15 text-danger' : 'text-fg-muted hover:text-danger',
                                  )}
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Module B: Writing & Expression Preferences */}
              <div className="space-y-2.5 rounded-2xl border border-edge bg-surface-panel p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-fg">
                    {zh ? '你的写作与表达偏好（确认即生效为协作规则）' : 'Writing & Communication Style (active immediately)'}
                  </h2>
                </div>
                {reveal.writingPreferences.length > 0 ? (
                  <div className="space-y-2">
                    {reveal.writingPreferences.map((pref) => {
                      const state: { decision: ItemDecision; statement: string } = writingDecisions[pref.id] ?? { decision: 'accepted', statement: pref.statement };
                      const dimLabel = DIMENSION_LABELS[pref.dimension];
                      const isEditing = editingId === `writing:${pref.id}`;
                      return (
                        <div
                          key={pref.id}
                          className={cn(
                            'rounded-xl border px-3 py-2.5 transition-colors',
                            state.decision === 'rejected'
                              ? 'border-edge-subtle bg-surface-base/40 opacity-55'
                              : 'border-edge bg-surface-base',
                          )}
                        >
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingDraft}
                                onChange={(e) => setEditingDraft(e.target.value)}
                                className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-2.5 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                                autoFocus
                              />
                              <Button
                                type="button"
                                onClick={() => {
                                  const nextText = editingDraft.trim();
                                  if (nextText) {
                                    setWritingDecisions((prev) => ({
                                      ...prev,
                                      [pref.id]: { decision: 'edited', statement: nextText },
                                    }));
                                  }
                                  setEditingId(null);
                                }}
                                className="h-7 px-2.5 text-xs"
                              >
                                {zh ? '保存' : 'Save'}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <span className="mr-2 inline-block rounded bg-accent-soft/60 px-1.5 py-0.5 text-[11px] font-medium text-accent-fg">
                                  {zh ? dimLabel.zh : dimLabel.en}
                                </span>
                                <span className={cn('text-sm text-fg', state.decision === 'rejected' && 'line-through')}>
                                  {state.statement}
                                </span>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setWritingDecisions((prev) => ({
                                    ...prev,
                                    [pref.id]: { decision: 'accepted', statement: state.statement },
                                  }))}
                                  aria-label={zh ? '启用该风格' : 'Enable style'}
                                  className={cn(
                                    'rounded-lg p-1.5 transition-colors',
                                    state.decision !== 'rejected' ? 'bg-accent-soft/70 text-accent-fg' : 'text-fg-muted hover:text-fg',
                                  )}
                                >
                                  <Check className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(`writing:${pref.id}`);
                                    setEditingDraft(state.statement);
                                  }}
                                  aria-label={zh ? '编辑风格' : 'Edit style'}
                                  className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-panel hover:text-fg"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setWritingDecisions((prev) => ({
                                    ...prev,
                                    [pref.id]: { decision: 'rejected', statement: state.statement },
                                  }))}
                                  aria-label={zh ? '不使用' : 'Disable style'}
                                  className={cn(
                                    'rounded-lg p-1.5 transition-colors',
                                    state.decision === 'rejected' ? 'bg-danger/15 text-danger' : 'text-fg-muted hover:text-danger',
                                  )}
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {customRules.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {customRules.map((rule, idx) => (
                      <span
                        key={`${rule}-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft/40 px-2.5 py-1 text-xs text-fg"
                      >
                        <span>{rule}</span>
                        <button
                          type="button"
                          onClick={() => setCustomRules((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label={zh ? '删除自定义规则' : 'Remove custom rule'}
                          className="text-fg-muted hover:text-danger"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={newRuleText}
                    onChange={(e) => setNewRuleText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        addCustomRule();
                      }
                    }}
                    placeholder={zh ? '补充一条表达要求，例如：回复不要用太多 emoji' : 'Add a style preference, e.g. Avoid excessive emojis'}
                    className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                  />
                  <Button type="button" variant="secondary" onClick={addCustomRule} className="h-7 gap-1 px-2.5 text-xs">
                    <Plus className="size-3.5" aria-hidden />
                    <span>{zh ? '添加' : 'Add'}</span>
                  </Button>
                </div>
              </div>

              {/* Module C: Cross-Source Work Threads */}
              {reveal.workThreads.length > 0 ? (
                <div className="space-y-2.5 rounded-2xl border border-edge bg-surface-panel p-4">
                  <h2 className="text-sm font-semibold text-fg">
                    {zh ? '你最近在推进的事（点击任意主线直接开始）' : 'Active Work Threads (click any to jump in)'}
                  </h2>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {reveal.workThreads.slice(0, 4).map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void commitConfirmations(thread)}
                        className="group flex flex-col justify-between rounded-xl border border-edge bg-surface-base p-3.5 text-left transition-colors hover:border-accent/60"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-fg group-hover:text-accent-fg">
                              {thread.title}
                            </span>
                            <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent-fg" aria-hidden />
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{thread.summary}</p>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          {(thread.sourceIds ?? []).map((src) => (
                            <span key={src} className="rounded bg-surface-panel px-1.5 py-0.5 text-[10px] text-fg-muted">
                              {sourceShortLabel(src, zh)}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Optional Calibration Question */}
              {reveal.calibrationQuestions.length > 0 ? (
                <div className="space-y-2 rounded-2xl border border-edge bg-surface-panel p-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    {zh ? '一句话帮你更准（可选）' : 'One quick clarification (optional)'}
                  </h2>
                  {reveal.calibrationQuestions.slice(0, 1).map((q) => (
                    <div key={q.id} className="space-y-2">
                      <p className="text-sm text-fg">{q.question}</p>
                      {q.options?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {q.options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setCalibrationAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                              className={cn(
                                'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                                calibrationAnswers[q.id] === opt
                                  ? 'border-accent bg-accent-soft/60 text-accent-fg'
                                  : 'border-edge bg-surface-base text-fg-muted hover:text-fg',
                              )}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <input
                        type="text"
                        value={calibrationAnswers[q.id] ?? ''}
                        onChange={(e) => setCalibrationAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder={zh ? '或直接输入一句话回答…' : 'Or type a quick answer…'}
                        className="w-full rounded-lg border border-edge bg-surface-base px-3 py-1.5 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Bottom Primary Action */}
              <div className="flex items-center justify-end gap-3 pt-1">
                <Button
                  type="button"
                  onClick={() => void commitConfirmations()}
                  disabled={busy}
                  className="h-10 gap-2 rounded-xl px-5 text-sm font-medium"
                >
                  <Check className="size-4" aria-hidden />
                  <span>{zh ? '保存对我的认识，开始使用' : 'Save understanding & continue'}</span>
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </main>

      <WorkingDirectoryPickerModal
        open={picker.modalOpen}
        onOpenChange={picker.setModalOpen}
        onConfirm={picker.confirmPick}
        wd={wdMessages}
        nested
      />
    </div>
  );
}
