import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  FileCode2,
  FileText,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  ListTodo,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  StickyNote,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Loopi } from '@/components/brand/loopi';
import { APP_CHROME_BAR_CLASS, APP_CHROME_DRAG_CLASS, APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { newChatAutoSendHref, newChatHrefForProject } from '@/features/chat/session/composer-handoff-params';
import { ConnectorLogo } from '@/features/connectors/components/connector-logo';
import { InstallConnectorDialog } from '@/features/connectors/components/install-connector-dialog';
import { buildInitialDraft, type InstallDraft } from '@/features/connectors/components/install-connector-draft';
import {
  fetchComposioConnectorCatalog,
  fetchConnectorInstances,
  type ConnectorDefinition,
  type ConnectorInstance,
} from '@/features/connectors/connectors-api';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { markDesktopHabitAnchorPending } from '@/features/onboarding/desktop-habit-toast';
import { OnboardingLanguageSwitch } from '@/features/onboarding/onboarding-language-switch';
import { resolveWorkspaceProject, type Project } from '@/features/projects/api';
import {
  fetchProjectUnderstanding,
  isProjectUnderstandingRunning,
  startProjectUnderstanding,
  type ProjectUnderstanding,
} from '@/features/projects/project-understanding-api';
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
  type WorkDiscoveryCandidate,
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
import {
  mergeUnderstandingConnectors,
  ONBOARDING_CONNECTOR_FALLBACKS,
  sortUnderstandingConnectors,
} from '@/features/work-discovery/work-discovery-connectors';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectronDarwin, isElectronWin32 } from '@/lib/electron-window-chrome';
import { useLocaleStore } from '@/stores/locale-store';
import type {
  ElectronUnderstandingSourceDefinition,
  ElectronUnderstandingSourceItem,
} from '@/types/electron';

type OnboardingStep = 'understand' | 'projects';
type UnderstandView = 'select' | 'analyzing' | 'reveal';
type ProjectView = 'select' | 'created';
type ItemDecision = 'accepted' | 'edited' | 'rejected';

type CreatedOnboardingProject = {
  project: Project;
  created: boolean;
  understandingStatus: ProjectUnderstanding['status'];
  overview: string | null;
};

const TIER1_ORDER = [
  'local-ai-instructions',
  'local-obsidian',
  'local-markdown-notes',
  'local-recent-files',
  'chromium-bookmarks',
] as const;

type SourceUiMeta = {
  id: string;
  zh: string;
  en: string;
  icon: LucideIcon;
  signalKind: UnderstandingSignalKind;
};

const SOURCE_META: Record<string, SourceUiMeta> = {
  'local-ai-instructions': { id: 'local-ai-instructions', zh: 'AI 规则', en: 'AI Rules', icon: FileCode2, signalKind: 'note' },
  'local-obsidian': { id: 'local-obsidian', zh: 'Obsidian', en: 'Obsidian', icon: BookOpenText, signalKind: 'note' },
  'local-markdown-notes': { id: 'local-markdown-notes', zh: '本地笔记', en: 'Local Notes', icon: StickyNote, signalKind: 'note' },
  'local-recent-files': { id: 'local-recent-files', zh: '近期文档', en: 'Recent Docs', icon: FileText, signalKind: 'recent' },
  'chromium-bookmarks': { id: 'chromium-bookmarks', zh: '浏览器书签', en: 'Bookmarks', icon: Bookmark, signalKind: 'data' },
  'apple-notes': { id: 'apple-notes', zh: '备忘录', en: 'Notes', icon: StickyNote, signalKind: 'note' },
  'apple-mail': { id: 'apple-mail', zh: '邮件', en: 'Mail', icon: Mail, signalKind: 'mail' },
  'apple-calendar': { id: 'apple-calendar', zh: '日历', en: 'Calendar', icon: CalendarDays, signalKind: 'calendar' },
  'apple-reminders': { id: 'apple-reminders', zh: '提醒事项', en: 'Reminders', icon: ListTodo, signalKind: 'task' },
};

const DIMENSION_LABELS: Record<WritingStyleDimension, { zh: string; en: string }> = {
  language: { zh: '语言', en: 'Language' },
  structure: { zh: '结构', en: 'Structure' },
  tone: { zh: '语气', en: 'Tone' },
  density: { zh: '密度', en: 'Density' },
  scenarios: { zh: '场景', en: 'Scenarios' },
  vocabulary: { zh: '术语', en: 'Vocabulary' },
};

const DOMAIN_LABELS: Record<string, { zh: string; en: string }> = {
  identity: { zh: '角色', en: 'Identity' },
  capabilities: { zh: '专长', en: 'Capabilities' },
  cognition: { zh: '思维', en: 'Cognition' },
  behavior: { zh: '节奏', en: 'Rhythm' },
  values: { zh: '原则', en: 'Values' },
  preferences: { zh: '偏好', en: 'Preferences' },
  relationships: { zh: '协作', en: 'People' },
};

function isConnectorConnected(instance: ConnectorInstance | undefined): boolean {
  return Boolean(instance?.enabled && (
    instance.status === 'connected'
    || instance.connectionStatus === 'connected'
    || instance.authStatus === 'connected'
  ));
}

function sourceLabel(sourceId: string, zh: boolean): string {
  const meta = SOURCE_META[sourceId];
  if (!meta) return sourceId;
  return zh ? meta.zh : meta.en;
}

type HostPlatform = 'darwin' | 'win32' | 'linux';

function normalizeHostPlatform(raw?: string): HostPlatform {
  if (raw === 'win32' || raw === 'linux' || raw === 'darwin') return raw;
  return 'darwin';
}

function sourcePlatformHint(sourceId: string, platform: HostPlatform, zh: boolean): string | undefined {
  if (sourceId === 'local-recent-files') {
    if (platform === 'win32') return zh ? '文档 · OneDrive' : 'Documents · OneDrive';
    if (platform === 'linux') return 'Documents · Desktop';
    return zh ? '文稿 · 桌面' : 'Documents · Desktop';
  }
  if (sourceId === 'local-markdown-notes') {
    if (platform === 'win32') return zh ? 'Notes · OneDrive' : 'Notes · OneDrive';
    if (platform === 'linux') return 'Notes · Org · Logseq';
    return zh ? 'Notes · iCloud' : 'Notes · iCloud';
  }
  if (sourceId === 'chromium-bookmarks') {
    if (platform === 'win32') return 'Edge · Chrome';
    if (platform === 'linux') return 'Chrome · Chromium';
    return 'Chrome · Arc';
  }
  return undefined;
}

function compactPath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  const winDrive = /^[A-Za-z]:/.exec(normalized)?.[0];
  const parts = normalized.replace(/^[A-Za-z]:/, '').split('/').filter(Boolean);
  if (winDrive) {
    if (parts.length <= 2) return `${winDrive}\\${parts.join('\\')}`;
    return `${winDrive}\\…\\${parts.slice(-2).join('\\')}`;
  }
  return parts.slice(-2).join('/') || value;
}

function phaseCenterLabel(phase: DeepUnderstandingPhase, zh: boolean): string {
  if (phase === 'collecting') return zh ? '读取本地线索…' : 'Reading local sources…';
  if (phase === 'analyzing_writing') return zh ? '提炼写作与表达风格…' : 'Analyzing writing style…';
  if (phase === 'synthesizing') return zh ? '跨来源综合画像…' : 'Synthesizing profile…';
  return zh ? '整理初版认识…' : 'Finishing up…';
}

function compactOverviewSnippet(overview: string | null): string | null {
  if (!overview) return null;
  const firstLine = overview
    .split('\n')
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 120) : null;
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
  const allMessages = messages(language);
  const wdMessages = allMessages.chat.workingDirectory;
  const connectorCopy = allMessages.connectorsSettings;
  const navigate = useNavigate();

  // Independent pages: Page 1 (About You) and Page 2 (Projects) can run fully in parallel.
  const [step, setStep] = useState<OnboardingStep>('understand');
  const [understandView, setUnderstandView] = useState<UnderstandView>('select');
  const [projectView, setProjectView] = useState<ProjectView>('select');

  // Page 1: Local + Remote Sources (independent loading & action states)
  const [loadingLocalSources, setLoadingLocalSources] = useState(true);
  const [hostPlatform, setHostPlatform] = useState<HostPlatform>(() => normalizeHostPlatform(window.electronAPI?.platform));
  const [previews, setPreviews] = useState<LocalSourcePreview[]>([]);
  const [tier2Sources, setTier2Sources] = useState<ElectronUnderstandingSourceDefinition[]>([]);
  const [selectedTier1, setSelectedTier1] = useState<Set<string>>(() => new Set());
  const [selectedTier2, setSelectedTier2] = useState<Set<string>>(() => new Set());
  const [customNoteDirs, setCustomNoteDirs] = useState<string[]>([]);

  const [connectors, setConnectors] = useState<ConnectorDefinition[]>(() => sortUnderstandingConnectors(ONBOARDING_CONNECTOR_FALLBACKS));
  const [connectorInstances, setConnectorInstances] = useState<ConnectorInstance[]>([]);
  const [sessionConnectedIds, setSessionConnectedIds] = useState<Set<string>>(() => new Set());
  const [installDraft, setInstallDraft] = useState<InstallDraft | null>(null);

  const [deepRun, setDeepRun] = useState<DeepUnderstandingRun | null>(null);
  const [understandLaunching, setUnderstandLaunching] = useState(false);
  const [understandConfirming, setUnderstandConfirming] = useState(false);
  const [understandError, setUnderstandError] = useState<string | null>(null);
  const [deepConfirmed, setDeepConfirmed] = useState(false);
  const [aboutDecisions, setAboutDecisions] = useState<Record<string, { decision: ItemDecision; statement: string }>>({});
  const [writingDecisions, setWritingDecisions] = useState<Record<string, { decision: ItemDecision; statement: string }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [customRules, setCustomRules] = useState<string[]>([]);
  const [newRuleText, setNewRuleText] = useState('');
  const [calibrationAnswers, setCalibrationAnswers] = useState<Record<string, string>>({});

  // Page 2: Multi-Project Selection -> Fast Creation + Async Understanding (independent states)
  const [loadingWorkFolders, setLoadingWorkFolders] = useState(true);
  const [processingTarget, setProcessingTarget] = useState<WorkDiscoveryProcessingTarget | null>(null);
  const [workCandidates, setWorkCandidates] = useState<WorkDiscoveryCandidate[]>([]);
  const [customWorkFolders, setCustomWorkFolders] = useState<string[]>([]);
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<Set<string>>(() => new Set());
  const [createdProjects, setCreatedProjects] = useState<CreatedOnboardingProject[]>([]);
  const [projectsCreating, setProjectsCreating] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const [pickerPurpose, setPickerPurpose] = useState<'notes' | 'project'>('notes');
  const initializedFoldersRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadConnectorInstances = useCallback(async () => {
    const next = await fetchConnectorInstances().catch(() => []);
    if (mountedRef.current) setConnectorInstances(next);
  }, []);

  const refreshLocalSources = useCallback(async (dirs: string[]) => {
    const [previewList, catalog] = await Promise.allSettled([
      fetchLocalSourcePreviews(dirs),
      window.electronAPI?.understandingSources?.catalog() ?? Promise.resolve([]),
    ]);
    if (!mountedRef.current) return;
    if (previewList.status === 'fulfilled') {
      setHostPlatform(normalizeHostPlatform(window.electronAPI?.platform ?? previewList.value.platform));
      setPreviews(previewList.value.previews);
      const detectedIds = previewList.value.previews.filter((item) => item.detected).map((item) => item.sourceId);
      setSelectedTier1((prev) => (prev.size > 0 ? new Set([...prev, ...detectedIds]) : new Set(detectedIds)));
    }
    if (catalog.status === 'fulfilled') {
      setTier2Sources(catalog.value.filter((source) => source.tier === 2 && source.availability === 'available'));
    }
    setLoadingLocalSources(false);
  }, []);

  const refreshWorkCandidates = useCallback(async () => {
    try {
      const result = await discoverWorkDiscoveryCandidates();
      if (!mountedRef.current) return;
      setProcessingTarget(result.processingTarget);
      setWorkCandidates(result.candidates);
      const firstCandidatePath = result.candidates[0]?.rootPath;
      if (!initializedFoldersRef.current && firstCandidatePath) {
        initializedFoldersRef.current = true;
        setSelectedFolderPaths((prev) => (prev.size > 0 ? prev : new Set([firstCandidatePath])));
      }
    } catch {
      // Non-fatal: users can still pick any local folder manually.
    } finally {
      if (mountedRef.current) setLoadingWorkFolders(false);
    }
  }, []);

  useEffect(() => {
    const store = useUnderstandingActivityStore.getState();
    if (store.deepRun?.status === 'running') {
      setDeepRun(store.deepRun);
      setUnderstandView('analyzing');
    } else if (store.deepRun?.status === 'completed' && store.deepRun.result) {
      setDeepRun(store.deepRun);
    }

    // Load Page 1 and Page 2 discovery fully independently so neither delays the other.
    void refreshLocalSources([]);
    void refreshWorkCandidates();
    void loadConnectorInstances();
    void fetchComposioConnectorCatalog({ page: 1, pageSize: 20, verification: 'verified' })
      .then((result) => {
        if (mountedRef.current) {
          setConnectors(mergeUnderstandingConnectors(ONBOARDING_CONNECTOR_FALLBACKS, result.connectors));
        }
      })
      .catch(() => {});
  }, [loadConnectorInstances, refreshLocalSources, refreshWorkCandidates]);

  const picker = useDirectoryPicker({
    onPicked: (pickedPath) => {
      if (pickerPurpose === 'notes') {
        setCustomNoteDirs((prev) => {
          if (prev.includes(pickedPath)) return prev;
          const next = [...prev, pickedPath];
          setSelectedTier1((sel) => new Set(sel).add('local-markdown-notes'));
          void refreshLocalSources(next);
          return next;
        });
        return;
      }
      setCustomWorkFolders((prev) => (prev.includes(pickedPath) ? prev : [pickedPath, ...prev]));
      setSelectedFolderPaths((prev) => new Set(prev).add(pickedPath));
    },
  });

  const openFolderPicker = (purpose: 'notes' | 'project') => {
    setPickerPurpose(purpose);
    picker.pick();
  };

  // Apply Page 1 Deep Run updates (always updates global store so background tracking survives unmount)
  const applyDeepRunState = useCallback((next: DeepUnderstandingRun) => {
    useUnderstandingActivityStore.getState().updateDeepRun(next);
    if (!mountedRef.current) return;
    setDeepRun(next);
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
      setUnderstandView((current) => (current === 'analyzing' ? 'reveal' : current));
    } else if (next.status === 'failed' || next.status === 'canceled') {
      setUnderstandError(next.errorMessage ?? (zh ? '分析未完成，可重试或跳过。' : 'Analysis did not finish. Retry or skip.'));
      setUnderstandView((current) => (current === 'analyzing' ? 'select' : current));
    }
  }, [zh]);

  // Listen to Page 1 Deep Run progress (continues even while user works on Page 2)
  useEffect(() => {
    if (!deepRun || deepRun.status !== 'running') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchDeepUnderstandingRun(deepRun.id);
        if (!cancelled) applyDeepRunState(next);
      } catch {
        // Recover on next tick or realtime event.
      }
    };
    const interval = window.setInterval(() => void poll(), 1_200);
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string; run?: DeepUnderstandingRun }>).detail;
      if (detail?.runId && detail.runId !== deepRun.id) return;
      if (detail?.run) applyDeepRunState(detail.run);
      else void poll();
    };
    const names = ['understanding-progress', 'understanding-completed', 'understanding-failed', 'understanding-canceled'];
    for (const name of names) window.addEventListener(name, onEvent);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      for (const name of names) window.removeEventListener(name, onEvent);
    };
  }, [applyDeepRunState, deepRun]);

  // Listen to Page 2 async background project understanding updates (when user waits on Created view)
  const runningProjectIdsKey = useMemo(
    () => createdProjects
      .filter((entry) => isProjectUnderstandingRunning(entry.understandingStatus))
      .map((entry) => entry.project.id)
      .join(','),
    [createdProjects],
  );

  const syncProjectUnderstandingStatus = useCallback(async (projectId: string) => {
    try {
      const state = await fetchProjectUnderstanding(projectId);
      if (!mountedRef.current) return;
      setCreatedProjects((prev) => prev.map((entry) => (
        entry.project.id === projectId
          ? { ...entry, understandingStatus: state.status, overview: state.overview }
          : entry
      )));
    } catch {
      // Retry on next event or poll tick.
    }
  }, []);

  useEffect(() => {
    if (!runningProjectIdsKey) return;
    const ids = runningProjectIdsKey.split(',').filter(Boolean);
    const idSet = new Set(ids);
    const pollAll = () => {
      for (const projectId of ids) void syncProjectUnderstandingStatus(projectId);
    };
    const onProjectUpdated = (event: Event) => {
      const projectId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (projectId && idSet.has(projectId)) void syncProjectUnderstandingStatus(projectId);
    };
    window.addEventListener('project-updated', onProjectUpdated);
    const timer = window.setInterval(pollAll, 2_000);
    return () => {
      window.removeEventListener('project-updated', onProjectUpdated);
      window.clearInterval(timer);
    };
  }, [runningProjectIdsKey, syncProjectUnderstandingStatus]);

  const previewMap = useMemo(() => new Map(previews.map((item) => [item.sourceId, item])), [previews]);
  const detectedTier1 = useMemo(
    () => TIER1_ORDER.filter((id) => previewMap.get(id)?.detected || (id === 'local-markdown-notes' && customNoteDirs.length > 0)),
    [customNoteDirs.length, previewMap],
  );
  const instanceByConnectorId = useMemo(
    () => new Map(connectorInstances.map((instance) => [instance.connectorId, instance])),
    [connectorInstances],
  );

  const selectedLocalCount = selectedTier1.size + selectedTier2.size;
  const connectedRemoteCount = useMemo(
    () => connectors.filter((c) => isConnectorConnected(instanceByConnectorId.get(c.id))).length,
    [connectors, instanceByConnectorId],
  );

  const createdProjectPaths = useMemo(
    () => new Set(createdProjects.map((entry) => entry.project.workspaceRoot).filter((p): p is string => Boolean(p))),
    [createdProjects],
  );

  const allWorkFolders = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ path: string; name: string; meta: string; isRepo: boolean; existingProject: boolean }> = [];
    for (const custom of customWorkFolders) {
      if (seen.has(custom)) continue;
      seen.add(custom);
      const parts = custom.replaceAll('\\', '/').split('/').filter(Boolean);
      items.push({
        path: custom,
        name: parts[parts.length - 1] ?? custom,
        meta: compactPath(custom),
        isRepo: false,
        existingProject: createdProjectPaths.has(custom),
      });
    }
    for (const candidate of workCandidates.slice(0, 6)) {
      if (seen.has(candidate.rootPath)) continue;
      seen.add(candidate.rootPath);
      const meta = candidate.branch
        ? `${candidate.branch}${candidate.changedFileCount > 0 ? (zh ? ` · ${candidate.changedFileCount} 处改动` : ` · ${candidate.changedFileCount} changes`) : ''}`
        : compactPath(candidate.rootPath);
      items.push({
        path: candidate.rootPath,
        name: candidate.displayName,
        meta,
        isRepo: candidate.projectKind === 'coding',
        existingProject: Boolean(candidate.projectId) || createdProjectPaths.has(candidate.rootPath),
      });
    }
    return items;
  }, [createdProjectPaths, customWorkFolders, workCandidates, zh]);

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

  const toggleWorkFolder = (folderPath: string) => {
    setSelectedFolderPaths((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const leaveToApp = useCallback((destination?: { projectId?: string; prompt?: string }) => {
    markDesktopHabitAnchorPending();
    if (destination?.projectId) {
      onNavigateAway?.();
      if (!onNavigateAway) onRequestClose?.();
      navigate(newChatHrefForProject(destination.projectId));
      return;
    }
    if (destination?.prompt?.trim()) {
      const href = newChatAutoSendHref(destination.prompt.trim());
      if (href) {
        onNavigateAway?.();
        if (!onNavigateAway) onRequestClose?.();
        navigate(href);
        return;
      }
    }
    onRequestClose?.();
    if (!onRequestClose) navigate('/chat');
  }, [navigate, onNavigateAway, onRequestClose]);

  // Page 1: Launch background Deep Understanding (completely decoupled from Page 2!)
  const launchStep1Understanding = useCallback(async () => {
    if (understandLaunching) return;
    if (selectedLocalCount === 0) {
      setStep('projects');
      return;
    }
    setUnderstandLaunching(true);
    setUnderstandError(null);
    setUnderstandView('analyzing');

    try {
      const precollectedItems: ElectronUnderstandingSourceItem[] = [];
      const sourceCheckpoints: Record<string, { fingerprint: string; collectedAt: number }> = {};

      const tier2List = [...selectedTier2];
      if (tier2List.length > 0 && window.electronAPI?.understandingSources?.collect) {
        const results = await window.electronAPI.understandingSources.collect(tier2List);
        for (const result of results) {
          if (result.status === 'completed') {
            precollectedItems.push(...result.items);
            if (result.checkpoint) sourceCheckpoints[result.sourceId] = result.checkpoint;
          }
        }
      }

      const tier1List = [...selectedTier1];
      if (tier1List.length === 0 && precollectedItems.length === 0) {
        if (mountedRef.current) {
          setUnderstandView('select');
          setStep('projects');
        }
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
      applyDeepRunState(run);
    } catch (cause) {
      if (mountedRef.current) {
        setUnderstandError(cause instanceof Error ? cause.message : String(cause));
        setUnderstandView('select');
      }
    } finally {
      if (mountedRef.current) setUnderstandLaunching(false);
    }
  }, [applyDeepRunState, customNoteDirs, processingTarget?.remoteModel, selectedLocalCount, selectedTier1, selectedTier2, understandLaunching]);

  const commitStep1Confirmation = useCallback(async (nextAction: 'projects' | 'finish' | WorkUnderstandingThread) => {
    if (!deepRun || !deepRun.result || understandConfirming) return;
    setUnderstandConfirming(true);
    setUnderstandError(null);
    const completingFlow = nextAction !== 'projects';
    try {
      await confirmDeepUnderstandingRun(deepRun.id, {
        aboutYou: deepRun.result.aboutYou.map((item) => {
          const state = aboutDecisions[item.id] ?? { decision: 'accepted', statement: item.statement };
          return {
            id: item.id,
            assertionId: item.assertionId,
            decision: state.decision,
            ...(state.decision === 'edited' ? { statement: state.statement } : {}),
          };
        }),
        writingPreferences: deepRun.result.writingPreferences.map((pref) => {
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
        calibrationAnswers: deepRun.result.calibrationQuestions.flatMap((q) => {
          const answer = calibrationAnswers[q.id]?.trim();
          return answer ? [{ question: q.question, answer }] : [];
        }),
        ...(typeof nextAction === 'object' ? { selectedThreadId: nextAction.id } : {}),
        markOnboardingCompleted: completingFlow,
      });
      setDeepConfirmed(true);
      if (nextAction === 'projects') {
        setStep('projects');
      } else if (nextAction === 'finish') {
        leaveToApp();
      } else {
        const prompt = zh
          ? `围绕「${nextAction.title}」继续推进：${nextAction.recommendedFirstStep ?? nextAction.summary}`
          : `Continue on "${nextAction.title}": ${nextAction.recommendedFirstStep ?? nextAction.summary}`;
        leaveToApp({ prompt });
      }
    } catch (cause) {
      setUnderstandError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUnderstandConfirming(false);
    }
  }, [aboutDecisions, calibrationAnswers, customRules, deepRun, leaveToApp, understandConfirming, writingDecisions, zh]);

  // Page 2: Fast multi-project creation + async background project understanding (never blocks chat entry!)
  const launchProjectCreation = useCallback(async () => {
    const paths = [...selectedFolderPaths];
    if (paths.length === 0 || projectsCreating) return;
    setProjectsCreating(true);
    setProjectError(null);
    try {
      const settled = await Promise.allSettled(
        paths.map(async (workspacePath) => {
          const resolved = await resolveWorkspaceProject({ workspacePath, autoCreate: true });
          if (!resolved.project) {
            throw new Error(zh
              ? `目录不可作为项目根目录：${compactPath(workspacePath)}`
              : `Folder cannot be used as a project root: ${compactPath(workspacePath)}`);
          }
          const project = resolved.project;
          window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: project.id } }));
          let understandingStatus: ProjectUnderstanding['status'] = 'queued';
          try {
            const started = await startProjectUnderstanding(project.id);
            understandingStatus = started.status;
          } catch {
            understandingStatus = 'failed';
          }
          return {
            project,
            created: resolved.created !== false,
            understandingStatus,
            overview: null,
          } satisfies CreatedOnboardingProject;
        }),
      );

      if (!mountedRef.current) return;

      const succeeded: CreatedOnboardingProject[] = [];
      const failures: string[] = [];
      for (const result of settled) {
        if (result.status === 'fulfilled') succeeded.push(result.value);
        else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }

      if (failures.length > 0) {
        setProjectError(failures.join(' · '));
      }

      if (succeeded.length > 0) {
        setCreatedProjects((prev) => {
          const byId = new Map(prev.map((entry) => [entry.project.id, entry]));
          for (const entry of succeeded) byId.set(entry.project.id, entry);
          return [...byId.values()];
        });
        setProjectView('created');
      }
    } finally {
      if (mountedRef.current) setProjectsCreating(false);
    }
  }, [projectsCreating, selectedFolderPaths, zh]);

  const retryProjectUnderstanding = useCallback(async (projectId: string) => {
    setCreatedProjects((prev) => prev.map((entry) => (
      entry.project.id === projectId ? { ...entry, understandingStatus: 'queued' } : entry
    )));
    try {
      const started = await startProjectUnderstanding(projectId);
      if (!mountedRef.current) return;
      setCreatedProjects((prev) => prev.map((entry) => (
        entry.project.id === projectId ? { ...entry, understandingStatus: started.status } : entry
      )));
    } catch {
      if (!mountedRef.current) return;
      setCreatedProjects((prev) => prev.map((entry) => (
        entry.project.id === projectId ? { ...entry, understandingStatus: 'failed' } : entry
      )));
    }
  }, []);

  const handleSkipToChat = useCallback(async () => {
    await dismissWorkDiscoveryOnboarding().catch(() => {});
    leaveToApp();
  }, [leaveToApp]);

  const handleOpenProjectChat = useCallback((projectId: string) => {
    void dismissWorkDiscoveryOnboarding().catch(() => {});
    leaveToApp({ projectId });
  }, [leaveToApp]);

  const addCustomRule = () => {
    const trimmed = newRuleText.trim();
    if (!trimmed) return;
    setCustomRules((prev) => [...prev, trimmed]);
    setNewRuleText('');
  };

  const convergenceSignals: UnderstandingSignal[] = useMemo(() => {
    const sourceList = deepRun?.selectedSources ?? [...selectedTier1, ...selectedTier2];
    const progressById = new Map((deepRun?.sourceStatuses ?? []).map((entry) => [entry.sourceId, entry]));
    return sourceList.map((sourceId) => {
      const meta = SOURCE_META[sourceId];
      const progress = progressById.get(sourceId);
      return {
        id: sourceId,
        label: sourceLabel(sourceId, zh),
        kind: meta?.signalKind ?? 'data',
        meta: progress?.itemCount ? `${progress.itemCount}` : undefined,
      };
    });
  }, [deepRun, selectedTier1, selectedTier2, zh]);

  const reveal = deepRun?.result;
  const understandRunning = understandLaunching || deepRun?.status === 'running';
  const understandReady = !deepConfirmed && deepRun?.status === 'completed' && Boolean(deepRun.result);
  const anyProjectUnderstandingRunning = createdProjects.some((entry) => isProjectUnderstandingRunning(entry.understandingStatus));
  const allProjectsUnderstood = createdProjects.length > 0 && !anyProjectUnderstandingRunning
    && createdProjects.every((entry) => entry.understandingStatus === 'completed');
  const activeError = step === 'understand' ? understandError : projectError;
  const clearActiveError = () => {
    if (step === 'understand') setUnderstandError(null);
    else setProjectError(null);
  };

  return (
    <div className="xopc-onboarding-experience flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-base text-fg">
      {/* Clean top bar — clears macOS left traffic lights AND Windows right caption buttons; tabs are always independently clickable */}
      {!embedded ? (
        <header
          className={cn(
            'grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6',
            isElectronDarwin() ? `${APP_CHROME_BAR_CLASS} ${APP_CHROME_DRAG_CLASS} pl-[88px]` : '',
            isElectronWin32() ? `${APP_CHROME_BAR_CLASS} ${APP_CHROME_DRAG_CLASS} pr-[144px]` : '',
          )}
        >
          <div aria-hidden />
          <nav
            aria-label={zh ? '引导步骤' : 'Onboarding steps'}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn('mx-auto flex items-center gap-1 rounded-full border border-edge bg-surface-panel/90 p-1 shadow-surface', APP_CHROME_NO_DRAG_CLASS)}
          >
            <button
              type="button"
              onClick={() => setStep('understand')}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                step === 'understand' ? 'bg-fg text-surface-panel' : 'text-fg-muted hover:text-fg',
              )}
            >
              <span>1</span>
              <span>{zh ? '认识你' : 'About You'}</span>
              {understandRunning ? (
                <Loader2 className={cn('size-3 animate-spin', step === 'understand' ? 'text-surface-panel' : 'text-accent-fg')} aria-hidden />
              ) : understandReady || deepConfirmed ? (
                <Check className={cn('size-3', step === 'understand' ? 'text-surface-panel' : 'text-success')} aria-hidden />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setStep('projects')}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                step === 'projects' ? 'bg-fg text-surface-panel' : 'text-fg-muted hover:text-fg',
              )}
            >
              <span>2</span>
              <span>{zh ? '工作项目' : 'Workspace'}</span>
              {anyProjectUnderstandingRunning ? (
                <Loader2 className={cn('size-3 animate-spin', step === 'projects' ? 'text-surface-panel' : 'text-accent-fg')} aria-hidden />
              ) : allProjectsUnderstood ? (
                <Check className={cn('size-3', step === 'projects' ? 'text-surface-panel' : 'text-success')} aria-hidden />
              ) : null}
            </button>
          </nav>
          <div
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn('flex justify-end', APP_CHROME_NO_DRAG_CLASS)}
          >
            <OnboardingLanguageSwitch value={language} onChange={setLanguage} />
          </div>
        </header>
      ) : null}

      {/* Scrollable centered Apple-style canvas */}
      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto flex w-full max-w-[38rem] flex-col">
          {activeError ? (
            <div role="alert" className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
              <span>{activeError}</span>
              <button type="button" onClick={clearActiveError} aria-label={zh ? '关闭提示' : 'Dismiss'}>
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}

          {/* ============================================================== */}
          {/* PAGE 1: ABOUT YOU (Local Sources + Remote Connectors)          */}
          {/* ============================================================== */}
          {step === 'understand' && understandView === 'select' ? (
            <section className="space-y-6" aria-label={zh ? '认识你' : 'Get to know you'}>
              <div className="flex flex-col items-center text-center">
                <Loopi variant="avatar" className="mb-3 size-12" />
                <h1 className="text-2xl font-semibold tracking-tight text-fg">
                  {zh ? '认识你' : 'Get to know you'}
                </h1>
                <p className="mt-1 text-sm text-fg-muted">
                  {zh ? '选好来源后将在后台异步理解，可随时切去建立项目。' : 'Selected sources run in the background — switch to projects anytime.'}
                </p>
              </div>

              {/* Group 1: Local Sources */}
              <div className="overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-surface">
                <div className="flex items-center justify-between border-b border-edge-subtle px-4 py-2.5">
                  <span className="text-xs font-medium text-fg-muted">
                    {zh ? '本机来源' : 'On this device'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openFolderPicker('notes')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
                  >
                    <FolderPlus className="size-3.5" aria-hidden />
                    <span>{zh ? '添加笔记目录' : 'Add notes folder'}</span>
                  </button>
                </div>

                {loadingLocalSources ? (
                  <div className="space-y-2 p-3" aria-busy>
                    <Skeleton className="h-11 rounded-xl" />
                    <Skeleton className="h-11 rounded-xl" />
                  </div>
                ) : (
                  <div className="divide-y divide-edge-subtle">
                    {detectedTier1.length > 0 ? (
                      detectedTier1.map((sourceId) => {
                        const meta = SOURCE_META[sourceId];
                        if (!meta) return null;
                        const Icon = meta.icon;
                        const preview = previewMap.get(sourceId);
                        const checked = selectedTier1.has(sourceId);
                        const platformHint = sourcePlatformHint(sourceId, hostPlatform, zh);
                        const metric = preview?.summary
                          ? `${preview.summary} · ${preview.itemCount}`
                          : (preview?.itemCount
                            ? (platformHint ? `${platformHint} · ${preview.itemCount}` : (zh ? `${preview.itemCount} 项` : `${preview.itemCount} items`))
                            : (platformHint ?? ''));
                        return (
                          <button
                            key={sourceId}
                            type="button"
                            onClick={() => toggleTier1(sourceId)}
                            aria-pressed={checked}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/50"
                          >
                            <span className={cn(
                              'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                              checked ? 'bg-accent text-on-accent' : 'bg-surface-inset text-fg-muted',
                            )}>
                              <Icon className="size-4" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                              {zh ? meta.zh : meta.en}
                            </span>
                            {metric ? (
                              <span className="shrink-0 text-xs text-fg-muted">{metric}</span>
                            ) : null}
                            <span className={cn(
                              'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                              checked ? 'border-accent bg-accent text-on-accent' : 'border-edge-strong bg-transparent',
                            )}>
                              {checked ? <Check className="size-3" aria-hidden /> : null}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-4 py-4 text-center text-xs text-fg-muted">
                        {zh ? '暂未发现本地笔记，可添加笔记 / Obsidian 目录，或直接连接下方云端服务。' : 'No local notes detected yet. Add a notes / Obsidian folder or connect a cloud service below.'}
                      </div>
                    )}

                    {/* On Windows/Linux, offer an explicit one-tap row when Obsidian & Local Notes weren't auto-detected */}
                    {hostPlatform !== 'darwin'
                      && !previewMap.get('local-obsidian')?.detected
                      && !previewMap.get('local-markdown-notes')?.detected
                      && customNoteDirs.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => openFolderPicker('notes')}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs font-medium text-accent-fg transition-colors hover:bg-surface-hover/50"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
                          <BookOpenText className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          {hostPlatform === 'win32'
                            ? (zh ? '添加本地笔记或 Obsidian 目录（支持 OneDrive / 自定义盘符）' : 'Add local notes or Obsidian vault (OneDrive / custom drive)')
                            : (zh ? '添加本地笔记或 Obsidian 目录（支持 Markdown / Org / Logseq）' : 'Add local notes or Obsidian vault (Markdown / Org / Logseq)')}
                        </span>
                      </button>
                    ) : null}

                    {/* Custom note dirs pill row if added */}
                    {customNoteDirs.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 bg-surface-base/40 px-4 py-2">
                        {customNoteDirs.map((dir) => (
                          <span
                            key={dir}
                            className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-panel px-2 py-0.5 text-[11px] text-fg-muted"
                          >
                            <span className="max-w-[14rem] truncate">{compactPath(dir)}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const next = customNoteDirs.filter((item) => item !== dir);
                                setCustomNoteDirs(next);
                                void refreshLocalSources(next);
                              }}
                              aria-label={zh ? '移除目录' : 'Remove directory'}
                              className="hover:text-fg"
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {/* Compact macOS Apple Apps row (darwin only) */}
                    {hostPlatform === 'darwin' && tier2Sources.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2 bg-surface-base/35 px-4 py-3">
                        <span className="mr-1 text-[11px] text-fg-subtle">Apple</span>
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
                                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                                checked
                                  ? 'border-accent bg-accent-soft text-accent-fg'
                                  : 'border-edge bg-surface-panel text-fg-muted hover:border-edge-strong hover:text-fg',
                              )}
                            >
                              <Icon className="size-3.5" aria-hidden />
                              <span>{sourceLabel(source.id, zh)}</span>
                              {checked ? <Check className="size-3" aria-hidden /> : <Lock className="size-2.5 opacity-60" aria-hidden />}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Group 2: Remote Connectors (binding starts background account learning automatically) */}
              <div className="overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-surface">
                <div className="flex items-center justify-between border-b border-edge-subtle px-4 py-2.5">
                  <span className="text-xs font-medium text-fg-muted">
                    {zh ? '云端服务（绑定后自动后台学习）' : 'Cloud services (syncs in background)'}
                  </span>
                  {connectedRemoteCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      <span>
                        {sessionConnectedIds.size > 0
                          ? (zh ? `已连接 ${connectedRemoteCount} · 后台同步` : `${connectedRemoteCount} connected · syncing`)
                          : (zh ? `已连接 ${connectedRemoteCount}` : `${connectedRemoteCount} connected`)}
                      </span>
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 p-3.5">
                  {connectors.slice(0, 5).map((connector) => {
                    const connected = isConnectorConnected(instanceByConnectorId.get(connector.id));
                    return (
                      <button
                        key={connector.id}
                        type="button"
                        onClick={() => {
                          if (!connected) setInstallDraft(buildInitialDraft(connector));
                        }}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors',
                          connected
                            ? 'border-success/40 bg-success-soft/50 text-fg'
                            : 'border-edge bg-surface-base/50 text-fg hover:border-edge-strong hover:bg-surface-hover/50',
                        )}
                      >
                        <ConnectorLogo connector={connector} size="sm" className="size-4 rounded" />
                        <span>{connector.displayName}</span>
                        {connected ? (
                          <Check className="size-3.5 text-success" aria-hidden />
                        ) : (
                          <Plus className="size-3 text-fg-muted" aria-hidden />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {/* PAGE 1: ANALYZING (User may wait OR jump straight to Page 2) */}
          {step === 'understand' && understandView === 'analyzing' ? (
            <section className="flex flex-col items-center py-6 text-center" aria-live="polite">
              <h2 className="text-xl font-semibold tracking-tight text-fg">
                {zh ? '正在认识你' : 'Getting to know you'}
              </h2>
              <p className="mt-1 text-xs text-fg-muted">
                {zh ? '可在此等待，或直接去选择工作项目，分析会在后台继续。' : 'Wait here or move on to projects — this continues in the background.'}
              </p>
              <UnderstandingSourceConvergence
                signals={convergenceSignals}
                ariaLabel={phaseCenterLabel(deepRun?.phase ?? 'collecting', zh)}
                centerLabel={phaseCenterLabel(deepRun?.phase ?? 'collecting', zh)}
              />
            </section>
          ) : null}

          {/* PAGE 1: REVEAL & CALIBRATION */}
          {step === 'understand' && understandView === 'reveal' && reveal ? (
            <section className="space-y-4" aria-label={zh ? '确认对你的认识' : 'Review understanding'}>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-fg">
                    {zh ? '初版认识' : 'What I learned'}
                  </h1>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {zh ? '可微调或关闭任意一条，写作风格确认即生效。' : 'Tweak or dismiss anything. Confirmed writing rules apply immediately.'}
                  </p>
                </div>
                <Loopi variant="avatar" className="size-9 shrink-0" />
              </div>

              {/* About You */}
              {reveal.aboutYou.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-surface">
                  <div className="border-b border-edge-subtle px-4 py-2 text-xs font-medium text-fg-muted">
                    {zh ? '关于你' : 'About you'}
                  </div>
                  <div className="divide-y divide-edge-subtle">
                    {reveal.aboutYou.map((item) => {
                      const state: { decision: ItemDecision; statement: string } = aboutDecisions[item.id] ?? { decision: 'accepted', statement: item.statement };
                      const domainMeta = item.domain ? DOMAIN_LABELS[item.domain] : undefined;
                      const isEditing = editingId === `about:${item.id}`;
                      return (
                        <div key={item.id} className={cn('px-4 py-2.5', state.decision === 'rejected' && 'opacity-50')}>
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingDraft}
                                onChange={(e) => setEditingDraft(e.target.value)}
                                className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-base px-2.5 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                                autoFocus
                              />
                              <Button
                                type="button"
                                onClick={() => {
                                  const nextText = editingDraft.trim();
                                  if (nextText) setAboutDecisions((prev) => ({ ...prev, [item.id]: { decision: 'edited', statement: nextText } }));
                                  setEditingId(null);
                                }}
                                className="h-7 px-2.5 text-xs"
                              >
                                {zh ? '保存' : 'Save'}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className={cn('text-sm text-fg', state.decision === 'rejected' && 'line-through')}>
                                  {state.statement}
                                </p>
                                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-muted">
                                  {domainMeta ? <span>{zh ? domainMeta.zh : domainMeta.en}</span> : null}
                                  {item.sourceIds && item.sourceIds.length >= 2 ? (
                                    <span className="text-accent-fg">{zh ? `${item.sourceIds.length} 源印证` : `${item.sourceIds.length} sources`}</span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => setAboutDecisions((prev) => ({ ...prev, [item.id]: { decision: 'accepted', statement: state.statement } }))}
                                  aria-label={zh ? '确认' : 'Confirm'}
                                  className={cn('rounded-lg p-1.5', state.decision !== 'rejected' ? 'text-accent-fg' : 'text-fg-muted hover:text-fg')}
                                >
                                  <Check className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setEditingId(`about:${item.id}`); setEditingDraft(state.statement); }}
                                  aria-label={zh ? '改一句' : 'Edit'}
                                  className="rounded-lg p-1.5 text-fg-muted hover:text-fg"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAboutDecisions((prev) => ({ ...prev, [item.id]: { decision: 'rejected', statement: state.statement } }))}
                                  aria-label={zh ? '不准确' : 'Reject'}
                                  className={cn('rounded-lg p-1.5', state.decision === 'rejected' ? 'text-danger' : 'text-fg-muted hover:text-danger')}
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
                </div>
              ) : null}

              {/* Writing & Expression Style */}
              <div className="overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-surface">
                <div className="border-b border-edge-subtle px-4 py-2 text-xs font-medium text-fg-muted">
                  {zh ? '写作与表达偏好' : 'Writing & expression'}
                </div>
                <div className="divide-y divide-edge-subtle">
                  {reveal.writingPreferences.map((pref) => {
                    const state: { decision: ItemDecision; statement: string } = writingDecisions[pref.id] ?? { decision: 'accepted', statement: pref.statement };
                    const dimLabel = DIMENSION_LABELS[pref.dimension];
                    const isEditing = editingId === `writing:${pref.id}`;
                    return (
                      <div key={pref.id} className={cn('px-4 py-2.5', state.decision === 'rejected' && 'opacity-50')}>
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editingDraft}
                              onChange={(e) => setEditingDraft(e.target.value)}
                              className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-base px-2.5 py-1 text-sm text-fg focus:border-accent focus:outline-none"
                              autoFocus
                            />
                            <Button
                              type="button"
                              onClick={() => {
                                const nextText = editingDraft.trim();
                                if (nextText) setWritingDecisions((prev) => ({ ...prev, [pref.id]: { decision: 'edited', statement: nextText } }));
                                setEditingId(null);
                              }}
                              className="h-7 px-2.5 text-xs"
                            >
                              {zh ? '保存' : 'Save'}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <span className="mr-2 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-fg">
                                {zh ? dimLabel.zh : dimLabel.en}
                              </span>
                              <span className={cn('text-sm text-fg', state.decision === 'rejected' && 'line-through')}>
                                {state.statement}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => setWritingDecisions((prev) => ({ ...prev, [pref.id]: { decision: 'accepted', statement: state.statement } }))}
                                aria-label={zh ? '启用' : 'Enable'}
                                className={cn('rounded-lg p-1.5', state.decision !== 'rejected' ? 'text-accent-fg' : 'text-fg-muted hover:text-fg')}
                              >
                                <Check className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => { setEditingId(`writing:${pref.id}`); setEditingDraft(state.statement); }}
                                aria-label={zh ? '编辑' : 'Edit'}
                                className="rounded-lg p-1.5 text-fg-muted hover:text-fg"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setWritingDecisions((prev) => ({ ...prev, [pref.id]: { decision: 'rejected', statement: state.statement } }))}
                                aria-label={zh ? '禁用' : 'Disable'}
                                className={cn('rounded-lg p-1.5', state.decision === 'rejected' ? 'text-danger' : 'text-fg-muted hover:text-danger')}
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                    {customRules.map((rule, idx) => (
                      <span
                        key={`${rule}-${idx}`}
                        className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent-fg"
                      >
                        <span>{rule}</span>
                        <button type="button" onClick={() => setCustomRules((prev) => prev.filter((_, i) => i !== idx))} aria-label={zh ? '移除' : 'Remove'}>
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
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
                      placeholder={zh ? '+ 补充一条要求（回车添加）' : '+ Add a style rule (Enter)'}
                      className="min-w-[12rem] flex-1 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Cross-Source Work Threads */}
              {reveal.workThreads.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-surface">
                  <div className="border-b border-edge-subtle px-4 py-2 text-xs font-medium text-fg-muted">
                    {zh ? '近期主线' : 'Active threads'}
                  </div>
                  <div className="divide-y divide-edge-subtle">
                    {reveal.workThreads.slice(0, 3).map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        disabled={understandConfirming}
                        onClick={() => void commitStep1Confirmation(thread)}
                        className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-fg group-hover:text-accent-fg">{thread.title}</div>
                          <div className="mt-0.5 truncate text-xs text-fg-muted">{thread.summary}</div>
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-fg-muted group-hover:text-accent-fg" aria-hidden />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Optional Calibration Question */}
              {reveal.calibrationQuestions.length > 0 ? (
                <div className="rounded-2xl border border-edge bg-surface-panel p-4 shadow-surface">
                  {reveal.calibrationQuestions.slice(0, 1).map((q) => (
                    <div key={q.id} className="space-y-2">
                      <p className="text-xs font-medium text-fg">{q.question}</p>
                      {q.options?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {q.options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setCalibrationAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                                calibrationAnswers[q.id] === opt
                                  ? 'border-accent bg-accent-soft text-accent-fg'
                                  : 'border-edge bg-surface-base text-fg-muted hover:text-fg',
                              )}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* ============================================================== */}
          {/* PAGE 2: MULTI-PROJECT SELECTION -> INSTANT CREATE + ASYNC RUN  */}
          {/* ============================================================== */}
          {step === 'projects' ? (
            <section className="space-y-5" aria-label={zh ? '建立工作项目' : 'Set up workspace projects'}>
              {/* Non-blocking Page 1 Status Pill */}
              {understandRunning || understandReady ? (
                <div className="flex justify-center">
                  {understandRunning ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-panel px-3 py-1 text-xs text-fg-muted shadow-surface">
                      <Loader2 className="size-3 animate-spin text-accent-fg" aria-hidden />
                      <span>{zh ? '后台正在认识你…' : 'Learning about you in background…'}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setStep('understand');
                        setUnderstandView('reveal');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-3 py-1 text-xs font-medium text-accent-fg shadow-surface transition-colors hover:bg-accent-soft/80"
                    >
                      <Sparkles className="size-3" aria-hidden />
                      <span>{zh ? '个人画像已就绪 · 点击校准' : 'Your profile is ready · Review'}</span>
                    </button>
                  )}
                </div>
              ) : null}

              {projectView === 'select' ? (
                <>
                  <div className="flex flex-col items-center text-center">
                    <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-fg">
                      <FolderGit2 className="size-6" aria-hidden />
                    </span>
                    <h1 className="text-2xl font-semibold tracking-tight text-fg">
                      {zh ? '选择工作项目' : 'Choose your projects'}
                    </h1>
                    <p className="mt-1 text-sm text-fg-muted">
                      {zh ? '支持多选本地目录，建好项目即可直接对话，理解在后台自动完成。' : 'Select one or more folders. Projects open immediately while analysis runs in the background.'}
                    </p>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-surface">
                    <div className="flex items-center justify-between border-b border-edge-subtle px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-fg-muted">
                          {zh ? '本机工作目录' : 'Local folders'}
                        </span>
                        {selectedFolderPaths.size > 0 ? (
                          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg">
                            {zh ? `已选 ${selectedFolderPaths.size}` : `${selectedFolderPaths.size} selected`}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => openFolderPicker('project')}
                        className="inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
                      >
                        <FolderPlus className="size-3.5" aria-hidden />
                        <span>{zh ? '添加文件夹' : 'Add folder'}</span>
                      </button>
                    </div>

                    {loadingWorkFolders ? (
                      <div className="space-y-2 p-3" aria-busy>
                        <Skeleton className="h-12 rounded-xl" />
                        <Skeleton className="h-12 rounded-xl" />
                      </div>
                    ) : (
                      <div className="divide-y divide-edge-subtle">
                        {allWorkFolders.map((folder) => {
                          const selected = selectedFolderPaths.has(folder.path);
                          return (
                            <button
                              key={folder.path}
                              type="button"
                              onClick={() => toggleWorkFolder(folder.path)}
                              aria-pressed={selected}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/50"
                            >
                              <span className={cn(
                                'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                                selected ? 'bg-accent text-on-accent' : 'bg-surface-inset text-fg-muted',
                              )}>
                                {folder.isRepo ? <GitBranch className="size-4" aria-hidden /> : <FolderOpen className="size-4" aria-hidden />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium text-fg">{folder.name}</span>
                                  {folder.existingProject ? (
                                    <span className="shrink-0 rounded bg-surface-inset px-1.5 py-0.5 text-[10px] text-fg-muted">
                                      {zh ? '已有项目' : 'Existing'}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="block truncate text-xs text-fg-muted">{folder.meta}</span>
                              </span>
                              <span className={cn(
                                'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                                selected ? 'border-accent bg-accent text-on-accent' : 'border-edge-strong bg-transparent',
                              )}>
                                {selected ? <Check className="size-3" aria-hidden /> : null}
                              </span>
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() => openFolderPicker('project')}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-accent-fg transition-colors hover:bg-surface-hover/50"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
                            <FolderPlus className="size-4" aria-hidden />
                          </span>
                          <span>{zh ? '选择其他文件夹…' : 'Choose another folder…'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              {projectView === 'created' && createdProjects.length > 0 ? (
                <div className="space-y-5">
                  <div className="flex flex-col items-center text-center">
                    <span className={cn(
                      'mb-2.5 flex size-11 items-center justify-center rounded-full',
                      allProjectsUnderstood ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent-fg',
                    )}>
                      <CheckCircle2 className="size-5" aria-hidden />
                    </span>
                    <h2 className="text-xl font-semibold tracking-tight text-fg">
                      {allProjectsUnderstood
                        ? (zh ? '项目理解已完成' : 'Projects ready')
                        : (createdProjects.length === 1
                          ? (zh ? '项目已创建' : 'Project created')
                          : (zh ? `已创建 ${createdProjects.length} 个项目` : `${createdProjects.length} projects created`))}
                    </h2>
                    <p className="mt-1 max-w-md text-xs text-fg-muted">
                      {anyProjectUnderstandingRunning
                        ? (zh ? '后台正在异步理解项目，现在就可以直接进入对话，也可以在此等待。' : 'Understanding runs in the background. Open any project chat now, or wait here.')
                        : (zh ? '点击任意项目即可开始对话。' : 'Open any project below to start chatting.')}
                    </p>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-surface">
                    <div className="divide-y divide-edge-subtle">
                      {createdProjects.map((entry) => {
                        const running = isProjectUnderstandingRunning(entry.understandingStatus);
                        const completed = entry.understandingStatus === 'completed';
                        const failed = entry.understandingStatus === 'failed' || entry.understandingStatus === 'canceled';
                        const snippet = compactOverviewSnippet(entry.overview);
                        return (
                          <div key={entry.project.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
                                <FolderGit2 className="size-4" aria-hidden />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="truncate text-sm font-medium text-fg">{entry.project.name}</span>
                                  {running ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg">
                                      <Loader2 className="size-2.5 animate-spin" aria-hidden />
                                      <span>{zh ? '后台理解中…' : 'Analyzing…'}</span>
                                    </span>
                                  ) : completed ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                                      <Check className="size-2.5" aria-hidden />
                                      <span>{zh ? '已理解' : 'Ready'}</span>
                                    </span>
                                  ) : failed ? (
                                    <button
                                      type="button"
                                      onClick={() => void retryProjectUnderstanding(entry.project.id)}
                                      className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg"
                                    >
                                      <RotateCcw className="size-2.5" aria-hidden />
                                      <span>{zh ? '重试理解' : 'Retry'}</span>
                                    </button>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-fg-muted">
                                  {snippet ?? (entry.project.workspaceRoot ? compactPath(entry.project.workspaceRoot) : '')}
                                </div>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => handleOpenProjectChat(entry.project.id)}
                              className="h-8 shrink-0 gap-1 rounded-lg px-2.5 text-xs font-medium text-accent-fg hover:bg-accent-soft"
                            >
                              <MessageSquare className="size-3.5" aria-hidden />
                              <span>{zh ? '进入对话' : 'Chat'}</span>
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </main>

      {/* Pinned Apple-style Footer Bar — each page's controls are independent and never cross-blocked */}
      <footer className="shrink-0 border-t border-edge-subtle bg-surface-panel/90 px-5 py-3.5 backdrop-blur-md sm:px-8">
        <div className="mx-auto flex w-full max-w-[38rem] items-center justify-between gap-3">
          {/* PAGE 1 FOOTERS */}
          {step === 'understand' && understandView === 'select' ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep('projects')}
                className="text-xs text-fg-muted hover:text-fg"
              >
                {zh ? '跳过' : 'Skip'}
              </Button>
              <div className="flex items-center gap-3">
                <span className="hidden items-center gap-1 text-[11px] text-fg-subtle sm:inline-flex">
                  <ShieldCheck className="size-3.5 text-accent-fg" aria-hidden />
                  <span>
                    {processingTarget?.remoteModel
                      ? (zh ? `${processingTarget.provider} 脱敏提炼` : `Redacted via ${processingTarget.provider}`)
                      : (zh ? '本机离线分析' : 'Local offline')}
                  </span>
                </span>
                <Button
                  type="button"
                  disabled={understandLaunching}
                  onClick={() => void launchStep1Understanding()}
                  className="h-9 gap-1.5 rounded-xl px-4 text-sm font-medium"
                >
                  <span>
                    {selectedLocalCount > 0
                      ? (zh ? '开始认识我' : 'Start learning')
                      : (zh ? '下一步：工作项目' : 'Next: Projects')}
                  </span>
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              </div>
            </>
          ) : null}

          {step === 'understand' && understandView === 'analyzing' ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (deepRun?.id) void cancelDeepUnderstandingRun(deepRun.id).catch(() => {});
                  setUnderstandView('select');
                }}
                className="text-xs text-fg-muted hover:text-fg"
              >
                {zh ? '取消' : 'Cancel'}
              </Button>
              <Button
                type="button"
                onClick={() => setStep('projects')}
                className="h-9 gap-1.5 rounded-xl px-4 text-sm font-medium"
              >
                <span>{zh ? '后台继续，去选项目' : 'Continue in background → Projects'}</span>
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </>
          ) : null}

          {step === 'understand' && understandView === 'reveal' ? (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={understandConfirming}
                onClick={() => void commitStep1Confirmation('finish')}
                className="text-xs text-fg-muted hover:text-fg"
              >
                {zh ? '保存并进入对话' : 'Save & start chatting'}
              </Button>
              <Button
                type="button"
                disabled={understandConfirming}
                onClick={() => void commitStep1Confirmation('projects')}
                className="h-9 gap-1.5 rounded-xl px-4 text-sm font-medium"
              >
                <span>{zh ? '保存，下一步：工作项目' : 'Save & choose projects'}</span>
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </>
          ) : null}

          {/* PAGE 2 FOOTERS */}
          {step === 'projects' && projectView === 'select' ? (
            <>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep('understand')}
                  className="gap-1 px-2 text-xs text-fg-muted hover:text-fg"
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  <span>{zh ? '上一步' : 'Back'}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleSkipToChat()}
                  className="text-xs text-fg-muted hover:text-fg"
                >
                  {zh ? '跳过，直接对话' : 'Skip to chat'}
                </Button>
              </div>
              <Button
                type="button"
                disabled={projectsCreating || selectedFolderPaths.size === 0}
                onClick={() => void launchProjectCreation()}
                className="h-9 gap-1.5 rounded-xl px-4 text-sm font-medium"
              >
                {projectsCreating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    <span>{zh ? '正在创建项目…' : 'Creating…'}</span>
                  </>
                ) : (
                  <>
                    <span>
                      {selectedFolderPaths.size > 1
                        ? (zh ? `创建 ${selectedFolderPaths.size} 个项目并理解` : `Create ${selectedFolderPaths.size} projects`)
                        : (zh ? '创建项目并理解' : 'Create project & analyze')}
                    </span>
                    <ArrowRight className="size-4" aria-hidden />
                  </>
                )}
              </Button>
            </>
          ) : null}

          {step === 'projects' && projectView === 'created' && createdProjects[0] ? (() => {
            const primaryProject = createdProjects[0].project;
            return (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setProjectView('select')}
                  className="gap-1 px-2 text-xs text-fg-muted hover:text-fg"
                >
                  <Plus className="size-3.5" aria-hidden />
                  <span>{zh ? '继续添加项目' : 'Add more projects'}</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => handleOpenProjectChat(primaryProject.id)}
                  className="h-9 gap-1.5 rounded-xl px-4 text-sm font-medium"
                >
                  <span>
                    {createdProjects.length === 1
                      ? (anyProjectUnderstandingRunning
                        ? (zh ? `直接进入「${primaryProject.name}」对话` : `Open ${primaryProject.name} now`)
                        : (zh ? `进入「${primaryProject.name}」对话` : `Open ${primaryProject.name}`))
                      : (anyProjectUnderstandingRunning
                        ? (zh ? '跳过等待，直接进入对话' : 'Open project chat now')
                        : (zh ? '进入项目对话' : 'Open project chat'))}
                  </span>
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              </>
            );
          })() : null}
        </div>
      </footer>

      <WorkingDirectoryPickerModal
        open={picker.modalOpen}
        onOpenChange={picker.setModalOpen}
        onConfirm={picker.confirmPick}
        wd={wdMessages}
        nested
      />

      {installDraft ? (
        <InstallConnectorDialog
          draft={installDraft}
          onChange={setInstallDraft}
          onClose={() => setInstallDraft(null)}
          t={connectorCopy}
          onInstalled={async (instance) => {
            setSessionConnectedIds((prev) => new Set(prev).add(instance.connectorId));
            await loadConnectorInstances();
            setInstallDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}
