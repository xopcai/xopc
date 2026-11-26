import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  Download,
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

import { ExternalRuntimePill } from '@/components/brand/external-runtime-badge';
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
import {
  importRequest,
  type DetectedImportSource,
  type ImportInventory,
  type ImportSelection,
  type ImportSource,
  type ProductImportResult,
} from '@/features/imports/import-api';
import { ImportSelectionDialog } from '@/features/imports/import-selection-dialog';
import { toggleItems } from '@/features/imports/selection';
import { markDesktopHabitAnchorPending } from '@/features/onboarding/desktop-habit-toast';
import {
  importSafeAiToolConfigs,
  prefetchExternalRuntimesFast,
  prefetchExternalRuntimesFull,
} from '@/features/onboarding/desktop-onboarding-bootstrap';
import {
  EXTERNAL_KIND_TO_IMPORT_SOURCE,
  ExternalRuntimesOnboardingSection,
} from '@/features/onboarding/external-runtimes-onboarding-section';
import { OnboardingLanguageSwitch } from '@/features/onboarding/onboarding-language-switch';
import { fetchProject, resolveWorkspaceProject, type Project } from '@/features/projects/api';
import {
  fetchGatewayAgents,
  quickSetupExternalAgentRuntimes,
  type ExternalAgentKind,
  type ExternalContextAccess,
  type ExternalPermissionMode,
  type ExternalRuntimeFastDetection,
  type ExternalRuntimeProbeResult,
  type GatewayAgentRow,
} from '@/features/settings/agents-admin-api';
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

  // Page 2: External coding runtimes (Codex / Antigravity / Claude Code)
  const [loadingExternalFast, setLoadingExternalFast] = useState(true);
  const [loadingExternalFull, setLoadingExternalFull] = useState(false);
  const [refreshingExternal, setRefreshingExternal] = useState(false);
  const [externalFast, setExternalFast] = useState<ExternalRuntimeFastDetection[]>([]);
  const [externalProbes, setExternalProbes] = useState<ExternalRuntimeProbeResult[]>([]);
  const [existingAgents, setExistingAgents] = useState<GatewayAgentRow[]>([]);
  const [selectedExternalKinds, setSelectedExternalKinds] = useState<Set<ExternalAgentKind>>(() => new Set());
  const [externalPermissionMode, setExternalPermissionMode] = useState<ExternalPermissionMode>('full_access');
  const [externalContextAccess, setExternalContextAccess] = useState<ExternalContextAccess>('read_write');
  const [syncExternalConfigs, setSyncExternalConfigs] = useState(true);
  const [projectDefaultRuntime, setProjectDefaultRuntime] = useState<'embedded' | ExternalAgentKind>('embedded');
  const [connectedExternalKinds, setConnectedExternalKinds] = useState<Array<{ kind: ExternalAgentKind; agentId: string }>>([]);
  const [externalSyncSummary, setExternalSyncSummary] = useState<{ importedCount: number; skills: number; context: number; projects: number } | null>(null);
  const externalSelectionTouchedRef = useRef(false);
  const projectDefaultTouchedRef = useRef(false);

  // Page 2: External AI tool imports (Codex / Claude Code / Antigravity)
  const [importSources, setImportSources] = useState<DetectedImportSource[]>([]);
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importInventory, setImportInventory] = useState<ImportInventory | undefined>(undefined);
  const [importSelected, setImportSelected] = useState<Set<string>>(() => new Set());
  const [importPending, setImportPending] = useState<ImportSelection | undefined>(undefined);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const importScanAbortRef = useRef<AbortController | null>(null);

  const [pickerPurpose, setPickerPurpose] = useState<'notes' | 'project'>('notes');
  const initializedFoldersRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importScanAbortRef.current?.abort();
    };
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

  const loadExternalRuntimes = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshingExternal(true);
    } else {
      setLoadingExternalFast(true);
    }
    try {
      const [fastResult, agentsResult] = await Promise.allSettled([
        prefetchExternalRuntimesFast(forceRefresh),
        fetchGatewayAgents(),
      ]);
      if (!mountedRef.current) return;

      const detections = fastResult.status === 'fulfilled' ? fastResult.value : [];
      const currentAgents = agentsResult.status === 'fulfilled' ? agentsResult.value.agents : [];
      setExternalFast(detections);
      if (agentsResult.status === 'fulfilled') {
        setExistingAgents(currentAgents);
      }
      setLoadingExternalFast(false);

      const hasInstalled = detections.some((entry) => entry.installed);
      if (!hasInstalled) {
        setExternalProbes([]);
        setLoadingExternalFull(false);
        return;
      }

      setLoadingExternalFull(true);
      const probes = await prefetchExternalRuntimesFull(forceRefresh);
      if (!mountedRef.current) return;
      setExternalProbes(probes);

      const configuredKinds = new Set<ExternalAgentKind>(
        currentAgents
          .filter((agent) => agent.override.enabled !== false)
          .map((agent) => agent.override.execution?.kind)
          .filter((kind): kind is ExternalAgentKind => Boolean(kind)),
      );
      const readyUnconfigured = probes
        .filter((entry) => entry.installed && entry.status === 'ready' && !configuredKinds.has(entry.kind))
        .map((entry) => entry.kind);

      if (!externalSelectionTouchedRef.current) {
        setSelectedExternalKinds(new Set(readyUnconfigured));
      }
      if (!projectDefaultTouchedRef.current) {
        const firstReady = probes.find((entry) => entry.installed && entry.status === 'ready')?.kind
          ?? [...configuredKinds][0];
        if (firstReady) setProjectDefaultRuntime(firstReady);
      }
    } finally {
      if (mountedRef.current) {
        setLoadingExternalFast(false);
        setLoadingExternalFull(false);
        setRefreshingExternal(false);
      }
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
    void loadExternalRuntimes(false);
    void importRequest<{ sources: DetectedImportSource[] }>('/sources')
      .then((data) => {
        if (mountedRef.current) setImportSources(data.sources);
      })
      .catch(() => {});
    void fetchComposioConnectorCatalog({ page: 1, pageSize: 20, verification: 'verified' })
      .then((result) => {
        if (mountedRef.current) {
          setConnectors(mergeUnderstandingConnectors(ONBOARDING_CONNECTOR_FALLBACKS, result.connectors));
        }
      })
      .catch(() => {});
  }, [loadConnectorInstances, loadExternalRuntimes, refreshLocalSources, refreshWorkCandidates]);

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

  const toggleExternalKind = (kind: ExternalAgentKind) => {
    externalSelectionTouchedRef.current = true;
    setSelectedExternalKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      if (!projectDefaultTouchedRef.current) {
        if (next.size > 0 && (projectDefaultRuntime === 'embedded' || !next.has(projectDefaultRuntime))) {
          const first = [...next][0];
          if (first) setProjectDefaultRuntime(first);
        } else if (next.size === 0) {
          const fallbackConfigured = existingAgents.find(
            (agent) => agent.override.enabled !== false && agent.override.execution?.kind,
          )?.override.execution?.kind;
          setProjectDefaultRuntime(fallbackConfigured ?? 'embedded');
        }
      }
      return next;
    });
  };

  const handleExternalRuntimeSignedIn = useCallback((kind: ExternalAgentKind, probe?: ExternalRuntimeProbeResult) => {
    if (probe) {
      setExternalProbes((prev) => {
        const rest = prev.filter((entry) => entry.kind !== kind);
        return [...rest, probe];
      });
    } else {
      void loadExternalRuntimes(true);
    }
    const alreadyConfigured = existingAgents.some(
      (agent) => agent.override.enabled !== false && agent.override.execution?.kind === kind,
    );
    if (!alreadyConfigured) {
      setSelectedExternalKinds((prev) => new Set(prev).add(kind));
      if (!projectDefaultTouchedRef.current && projectDefaultRuntime === 'embedded') {
        setProjectDefaultRuntime(kind);
      }
    }
  }, [existingAgents, loadExternalRuntimes, projectDefaultRuntime]);

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

  // Page 2: Fast external runtime quick-setup + multi-project creation + async background understanding (never blocks chat entry!)
  const launchProjectCreation = useCallback(async () => {
    const paths = [...selectedFolderPaths];
    const externalKinds = [...selectedExternalKinds];
    if ((paths.length === 0 && externalKinds.length === 0) || projectsCreating) return;
    setProjectsCreating(true);
    setProjectError(null);
    try {
      const failures: string[] = [];
      const agentIdByKind = new Map<ExternalAgentKind, string>();
      for (const agent of existingAgents) {
        const kind = agent.override.execution?.kind;
        if (kind && agent.override.enabled !== false && !agentIdByKind.has(kind)) {
          agentIdByKind.set(kind, agent.id);
        }
      }

      const newlyConnected: Array<{ kind: ExternalAgentKind; agentId: string }> = [];
      if (externalKinds.length > 0) {
        try {
          const setupPayload = await quickSetupExternalAgentRuntimes(
            externalKinds.map((kind) => ({
              kind,
              permissionMode: externalPermissionMode,
              contextAccess: externalContextAccess,
            })),
          );
          if (!mountedRef.current) return;
          setExistingAgents(setupPayload.agents.agents);
          for (const item of setupPayload.results) {
            if (item.status === 'ok' && item.agentId) {
              agentIdByKind.set(item.kind, item.agentId);
              newlyConnected.push({ kind: item.kind, agentId: item.agentId });
            } else if (item.error) {
              failures.push(item.error);
            }
          }
          if (newlyConnected.length > 0) {
            setConnectedExternalKinds((prev) => {
              const byKind = new Map(prev.map((entry) => [entry.kind, entry]));
              for (const entry of newlyConnected) byKind.set(entry.kind, entry);
              return [...byKind.values()];
            });
            setSelectedExternalKinds((prev) => {
              const next = new Set(prev);
              for (const entry of newlyConnected) next.delete(entry.kind);
              return next;
            });
          }
        } catch (cause) {
          failures.push(cause instanceof Error ? cause.message : String(cause));
        }
      }

      const resolvedProjectDefaultAgentId =
        projectDefaultRuntime !== 'embedded'
          ? agentIdByKind.get(projectDefaultRuntime)
          : undefined;

      const succeeded: CreatedOnboardingProject[] = [];
      if (paths.length > 0) {
        const settled = await Promise.allSettled(
          paths.map(async (workspacePath) => {
            const resolved = await resolveWorkspaceProject({
              workspacePath,
              autoCreate: true,
              ...(resolvedProjectDefaultAgentId ? { defaultAgentId: resolvedProjectDefaultAgentId } : {}),
            });
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

        for (const result of settled) {
          if (result.status === 'fulfilled') succeeded.push(result.value);
          else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
      }

      // Extension layer 1: non-blocking safe sync of Skills & Rules for connected runtimes
      if (syncExternalConfigs && newlyConnected.length > 0) {
        const matchingSources = newlyConnected
          .map((entry) => EXTERNAL_KIND_TO_IMPORT_SOURCE[entry.kind])
          .filter((sourceId) => importSources.some((src) => src.id === sourceId && src.detected && !src.lastImport));
        if (matchingSources.length > 0) {
          void importSafeAiToolConfigs(matchingSources).then((summary) => {
            if (mountedRef.current && summary.importedCount > 0) {
              setExternalSyncSummary(summary);
            }
          });
        }
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
      }

      if (succeeded.length > 0 || newlyConnected.length > 0) {
        setProjectView('created');
      }
    } finally {
      if (mountedRef.current) setProjectsCreating(false);
    }
  }, [
    existingAgents,
    externalContextAccess,
    externalPermissionMode,
    importSources,
    projectDefaultRuntime,
    projectsCreating,
    selectedExternalKinds,
    selectedFolderPaths,
    syncExternalConfigs,
    zh,
  ]);

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

  const startToolImportScan = useCallback(async (nextSource: ImportSource) => {
    importScanAbortRef.current?.abort();
    const abort = new AbortController();
    importScanAbortRef.current = abort;
    setImportSource(nextSource);
    setImportOpen(true);
    setImportInventory(undefined);
    setImportSelected(new Set());
    setImportPending(undefined);
    setImportError('');
    try {
      const next = await importRequest<ImportInventory>(`/sources/${nextSource}/scan`, {}, abort.signal);
      if (abort.signal.aborted || !mountedRef.current) return;
      setImportInventory(next);
      // Pre-select ready projects (and their suggested child skills/rules) for quick project import.
      const readyProjects = next.candidates.filter((item) => item.kind === 'project' && item.status === 'ready');
      const suggestedTopLevel = next.candidates.filter((item) => !item.parentId && item.suggested);
      let initial = toggleItems(next, new Set<string>(), readyProjects, true);
      if (initial.size === 0 && suggestedTopLevel.length > 0) {
        initial = toggleItems(next, initial, suggestedTopLevel, true);
      }
      setImportSelected(initial);
    } catch (cause) {
      if (!abort.signal.aborted && mountedRef.current) {
        setImportError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }, []);

  const submitToolImport = useCallback(async () => {
    if (!importInventory || importSelected.size === 0 || importBusy) return;
    setImportBusy(true);
    setImportError('');
    const selection: ImportSelection = importPending ?? {
      inventoryId: importInventory.id,
      candidateIds: [...importSelected],
      requestId: crypto.randomUUID(),
    };
    setImportPending(selection);
    try {
      const result = await importRequest<ProductImportResult>('/runs', selection);
      if (!mountedRef.current) return;
      setImportSources((prev) => prev.map((item) => (
        item.id === result.source ? { ...item, lastImport: result } : item
      )));
      setImportPending(undefined);
      setImportOpen(false);
      void refreshWorkCandidates();

      const projectRunItems = result.items.filter(
        (item): item is ProductImportResult['items'][number] & { targetId: string } =>
          item.kind === 'project'
          && typeof item.targetId === 'string'
          && item.targetId.length > 0
          && (item.status === 'imported' || item.status === 'existing'),
      );
      if (projectRunItems.length > 0) {
        const resolvedEntries = await Promise.all(
          projectRunItems.map(async (item): Promise<CreatedOnboardingProject | null> => {
            const project = await fetchProject(item.targetId).catch(() => null);
            if (!project) return null;
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
              created: item.status === 'imported',
              understandingStatus,
              overview: null,
            };
          }),
        );
        const importedEntries = resolvedEntries.filter((entry): entry is CreatedOnboardingProject => entry !== null);
        if (mountedRef.current && importedEntries.length > 0) {
          setCreatedProjects((prev) => {
            const byId = new Map(prev.map((entry) => [entry.project.id, entry]));
            for (const entry of importedEntries) byId.set(entry.project.id, entry);
            return [...byId.values()];
          });
          setProjectView('created');
        }
      }
    } catch (cause) {
      if (!mountedRef.current) return;
      setImportError(cause instanceof Error ? cause.message : String(cause));
      const code = (cause as { body?: { code?: string } }).body?.code;
      if (code && ['invalid_input', 'inventory_stale', 'invalid_selection', 'missing_parent', 'not_found', 'conflict'].includes(code)) {
        setImportPending(undefined);
      }
    } finally {
      if (mountedRef.current) setImportBusy(false);
    }
  }, [importBusy, importInventory, importPending, importSelected, refreshWorkCandidates]);

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

  const stageKey = `${step}:${step === 'understand' ? understandView : projectView}`;
  const installedExternalImportSourceIds = useMemo(() => {
    const ids = new Set<ImportSource>();
    for (const entry of externalFast) {
      if (entry.installed) ids.add(EXTERNAL_KIND_TO_IMPORT_SOURCE[entry.kind]);
    }
    for (const entry of externalProbes) {
      if (entry.installed) ids.add(EXTERNAL_KIND_TO_IMPORT_SOURCE[entry.kind]);
    }
    return ids;
  }, [externalFast, externalProbes]);
  const detectedImportSources = importSources.filter(
    (item) => (item.detected || item.lastImport) && !installedExternalImportSourceIds.has(item.id),
  );
  const agentKindById = useMemo(() => {
    const map = new Map<string, ExternalAgentKind>();
    for (const agent of existingAgents) {
      const kind = agent.override.execution?.kind;
      if (kind) map.set(agent.id, kind);
    }
    for (const connected of connectedExternalKinds) {
      map.set(connected.agentId, connected.kind);
    }
    return map;
  }, [connectedExternalKinds, existingAgents]);

  return (
    <div className="xopc-onboarding-experience flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-base text-fg">
      {/* Clean top bar — clears macOS left traffic lights AND Windows right caption buttons */}
      {!embedded ? (
        <header
          className={cn(
            'grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-5 sm:px-8',
            isElectronDarwin() ? `${APP_CHROME_BAR_CLASS} ${APP_CHROME_DRAG_CLASS} pl-[88px]` : '',
            isElectronWin32() ? `${APP_CHROME_BAR_CLASS} ${APP_CHROME_DRAG_CLASS} pr-[144px]` : '',
          )}
        >
          <div aria-hidden />
          {/* Apple-style sliding glass segmented control */}
          <nav
            aria-label={zh ? '引导步骤' : 'Onboarding steps'}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn(
              'relative mx-auto grid w-[14.5rem] grid-cols-2 rounded-full border border-edge/80 bg-surface-panel/80 p-1 shadow-surface backdrop-blur-xl',
              APP_CHROME_NO_DRAG_CLASS,
            )}
          >
            <span
              aria-hidden
              className={cn(
                'xopc-segmented-thumb pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-fg shadow-xs',
                step === 'projects' ? 'translate-x-full' : 'translate-x-0',
              )}
            />
            <button
              type="button"
              onClick={() => setStep('understand')}
              className={cn(
                'relative z-10 flex items-center justify-center gap-1.5 rounded-full py-1 text-xs font-medium transition-colors duration-200',
                step === 'understand' ? 'text-surface-panel' : 'text-fg-muted hover:text-fg',
              )}
            >
              <span>{zh ? '认识你' : 'About You'}</span>
              {understandRunning ? (
                <Loader2 className={cn('size-3 animate-spin', step === 'understand' ? 'text-surface-panel/85' : 'text-accent-fg')} aria-hidden />
              ) : understandReady || deepConfirmed ? (
                <Check className={cn('size-3', step === 'understand' ? 'text-surface-panel' : 'text-success')} aria-hidden />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setStep('projects')}
              className={cn(
                'relative z-10 flex items-center justify-center gap-1.5 rounded-full py-1 text-xs font-medium transition-colors duration-200',
                step === 'projects' ? 'text-surface-panel' : 'text-fg-muted hover:text-fg',
              )}
            >
              <span>{zh ? '工作项目' : 'Projects'}</span>
              {anyProjectUnderstandingRunning ? (
                <Loader2 className={cn('size-3 animate-spin', step === 'projects' ? 'text-surface-panel/85' : 'text-accent-fg')} aria-hidden />
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
      <main className="xopc-onboarding-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
        <div key={stageKey} className="xopc-apple-stage mx-auto flex w-full max-w-[34rem] flex-col">
          {activeError ? (
            <div role="alert" className="mb-5 flex items-center justify-between gap-2 rounded-xl border border-danger/25 bg-danger-soft/70 px-3.5 py-2.5 text-xs text-danger">
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
            <section className="space-y-7" aria-label={zh ? '认识你' : 'Get to know you'}>
              <div className="flex flex-col items-center text-center">
                <Loopi variant="avatar" className="mb-3.5 size-14" />
                <h1 className="text-[1.625rem] font-semibold tracking-[-0.03em] text-fg">
                  {zh ? '认识你' : 'Get to know you'}
                </h1>
                <p className="mt-1 text-sm text-fg-muted">
                  {zh ? '选择要了解的来源' : 'Choose what to learn from.'}
                </p>
              </div>

              {/* Group 1: Local Sources (macOS Sequoia inset grouped list) */}
              <div className="xopc-apple-card space-y-2" style={{ animationDelay: '35ms' }}>
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-medium tracking-[0.02em] text-fg-subtle">
                    {zh ? '本机来源' : 'On this device'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openFolderPicker('notes')}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted transition-colors hover:text-fg"
                  >
                    <FolderPlus className="size-3" aria-hidden />
                    <span>{zh ? '添加目录' : 'Add folder'}</span>
                  </button>
                </div>

                <div className="overflow-hidden rounded-2xl border border-edge/80 bg-surface-panel/95 shadow-surface">
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
                              ? (platformHint ? `${platformHint} · ${preview.itemCount}` : `${preview.itemCount}`)
                              : (platformHint ?? ''));
                          return (
                            <button
                              key={sourceId}
                              type="button"
                              onClick={() => toggleTier1(sourceId)}
                              aria-pressed={checked}
                              className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-hover/45 active:scale-[0.995]"
                            >
                              <span className={cn(
                                'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200',
                                checked ? 'bg-surface-inset text-fg' : 'bg-surface-inset/55 text-fg-subtle',
                              )}>
                                <Icon className="size-4" aria-hidden />
                              </span>
                              <span className={cn(
                                'min-w-0 flex-1 truncate text-[13.5px] font-medium transition-colors',
                                checked ? 'text-fg' : 'text-fg-muted',
                              )}>
                                {zh ? meta.zh : meta.en}
                              </span>
                              {metric ? (
                                <span className="shrink-0 text-xs text-fg-subtle">{metric}</span>
                              ) : null}
                              <span className={cn(
                                'flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-all duration-200',
                                checked ? 'xopc-check-pop border-accent bg-accent text-on-accent' : 'border-edge-strong bg-transparent',
                              )}>
                                {checked ? <Check className="size-2.5 stroke-[2.6]" aria-hidden /> : null}
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-4 py-4 text-center text-xs text-fg-subtle">
                          {zh ? '暂未发现本地笔记' : 'No local notes detected yet'}
                        </div>
                      )}

                      {/* Windows/Linux explicit notes/Obsidian quick-add row */}
                      {hostPlatform !== 'darwin'
                        && !previewMap.get('local-obsidian')?.detected
                        && !previewMap.get('local-markdown-notes')?.detected
                        && customNoteDirs.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => openFolderPicker('notes')}
                          className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-hover/45 active:scale-[0.995]"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-inset text-fg-muted">
                            <BookOpenText className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg">
                            {zh ? '添加笔记或 Obsidian 目录' : 'Add notes or Obsidian vault'}
                          </span>
                          <span className="shrink-0 text-xs text-fg-subtle">
                            {hostPlatform === 'win32'
                              ? (zh ? 'OneDrive · 自定义盘符' : 'OneDrive · Custom drive')
                              : 'Markdown · Org · Logseq'}
                          </span>
                        </button>
                      ) : null}

                      {/* Custom note dirs pills */}
                      {customNoteDirs.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 bg-surface-base/40 px-4 py-2.5">
                          {customNoteDirs.map((dir) => (
                            <span
                              key={dir}
                              className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-panel px-2.5 py-0.5 text-[11px] text-fg-muted"
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
                          <span className="mr-1 text-[11px] font-medium text-fg-subtle">Apple</span>
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
                                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.97]',
                                  checked
                                    ? 'border-accent/60 bg-accent-soft text-accent-fg'
                                    : 'border-edge bg-surface-panel text-fg-muted hover:border-edge-strong hover:text-fg',
                                )}
                              >
                                <Icon className="size-3.5" aria-hidden />
                                <span>{sourceLabel(source.id, zh)}</span>
                                {checked ? <Check className="xopc-check-pop size-3" aria-hidden /> : <Lock className="size-2.5 opacity-55" aria-hidden />}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              {/* Group 2: Remote Cloud Services */}
              <div className="xopc-apple-card space-y-2" style={{ animationDelay: '85ms' }}>
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-medium tracking-[0.02em] text-fg-subtle">
                    {zh ? '云端服务' : 'Cloud services'}
                  </span>
                  {connectedRemoteCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                      <CheckCircle2 className="size-3" aria-hidden />
                      <span>
                        {sessionConnectedIds.size > 0
                          ? (zh ? `已连接 ${connectedRemoteCount} · 同步中` : `${connectedRemoteCount} connected · Syncing`)
                          : (zh ? `已连接 ${connectedRemoteCount}` : `${connectedRemoteCount} connected`)}
                      </span>
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 rounded-2xl border border-edge/80 bg-surface-panel/95 p-3.5 shadow-surface">
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
                          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 active:scale-[0.97]',
                          connected
                            ? 'border-success/35 bg-success-soft/55 text-fg'
                            : 'border-edge bg-surface-base/60 text-fg hover:border-edge-strong hover:bg-surface-hover/55',
                        )}
                      >
                        <ConnectorLogo connector={connector} size="sm" className="size-4 rounded" />
                        <span>{connector.displayName}</span>
                        {connected ? (
                          <Check className="xopc-check-pop size-3 text-success" aria-hidden />
                        ) : (
                          <Plus className="size-3 text-fg-subtle" aria-hidden />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {/* PAGE 1: ANALYZING */}
          {step === 'understand' && understandView === 'analyzing' ? (
            <section className="flex flex-col items-center py-6 text-center" aria-live="polite">
              <h2 className="text-[1.5rem] font-semibold tracking-[-0.03em] text-fg">
                {zh ? '正在认识你' : 'Getting to know you'}
              </h2>
              <p className="mt-1.5 text-xs text-fg-muted">
                {zh ? '分析在后台进行，随时可去下一步' : 'Continues in the background.'}
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
            <section className="space-y-5" aria-label={zh ? '确认对你的认识' : 'Review understanding'}>
              <div className="flex items-center justify-between px-1">
                <div>
                  <h1 className="text-[1.5rem] font-semibold tracking-[-0.03em] text-fg">
                    {zh ? '初版认识' : 'What I learned'}
                  </h1>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {zh ? '可随时微调或关闭' : 'Edit or turn off any item.'}
                  </p>
                </div>
                <Loopi variant="avatar" className="size-10 shrink-0" />
              </div>

              {/* About You */}
              {reveal.aboutYou.length > 0 ? (
                <div className="xopc-apple-card space-y-1.5" style={{ animationDelay: '35ms' }}>
                  <div className="px-1 text-[11px] font-medium tracking-[0.02em] text-fg-subtle">
                    {zh ? '关于你' : 'About you'}
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-edge/80 bg-surface-panel/95 shadow-surface">
                    <div className="divide-y divide-edge-subtle">
                      {reveal.aboutYou.map((item) => {
                        const state: { decision: ItemDecision; statement: string } = aboutDecisions[item.id] ?? { decision: 'accepted', statement: item.statement };
                        const domainMeta = item.domain ? DOMAIN_LABELS[item.domain] : undefined;
                        const isEditing = editingId === `about:${item.id}`;
                        return (
                          <div key={item.id} className={cn('px-4 py-3 transition-opacity', state.decision === 'rejected' && 'opacity-45')}>
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
                                  <p className={cn('text-[13.5px] text-fg', state.decision === 'rejected' && 'line-through')}>
                                    {state.statement}
                                  </p>
                                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle">
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
                                    className={cn('rounded-lg p-1.5 transition-colors', state.decision !== 'rejected' ? 'text-accent-fg' : 'text-fg-subtle hover:text-fg')}
                                  >
                                    <Check className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setEditingId(`about:${item.id}`); setEditingDraft(state.statement); }}
                                    aria-label={zh ? '改一句' : 'Edit'}
                                    className="rounded-lg p-1.5 text-fg-subtle transition-colors hover:text-fg"
                                  >
                                    <Pencil className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAboutDecisions((prev) => ({ ...prev, [item.id]: { decision: 'rejected', statement: state.statement } }))}
                                    aria-label={zh ? '不准确' : 'Reject'}
                                    className={cn('rounded-lg p-1.5 transition-colors', state.decision === 'rejected' ? 'text-danger' : 'text-fg-subtle hover:text-danger')}
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
                </div>
              ) : null}

              {/* Writing & Expression Style */}
              <div className="xopc-apple-card space-y-1.5" style={{ animationDelay: '75ms' }}>
                <div className="px-1 text-[11px] font-medium tracking-[0.02em] text-fg-subtle">
                  {zh ? '写作与表达' : 'Writing style'}
                </div>
                <div className="overflow-hidden rounded-2xl border border-edge/80 bg-surface-panel/95 shadow-surface">
                  <div className="divide-y divide-edge-subtle">
                    {reveal.writingPreferences.map((pref) => {
                      const state: { decision: ItemDecision; statement: string } = writingDecisions[pref.id] ?? { decision: 'accepted', statement: pref.statement };
                      const dimLabel = DIMENSION_LABELS[pref.dimension];
                      const isEditing = editingId === `writing:${pref.id}`;
                      return (
                        <div key={pref.id} className={cn('px-4 py-3 transition-opacity', state.decision === 'rejected' && 'opacity-45')}>
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
                                <span className="mr-2 rounded-md bg-surface-inset px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
                                  {zh ? dimLabel.zh : dimLabel.en}
                                </span>
                                <span className={cn('text-[13.5px] text-fg', state.decision === 'rejected' && 'line-through')}>
                                  {state.statement}
                                </span>
                              </div>
                              <div className="flex shrink-0 items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => setWritingDecisions((prev) => ({ ...prev, [pref.id]: { decision: 'accepted', statement: state.statement } }))}
                                  aria-label={zh ? '启用' : 'Enable'}
                                  className={cn('rounded-lg p-1.5 transition-colors', state.decision !== 'rejected' ? 'text-accent-fg' : 'text-fg-subtle hover:text-fg')}
                                >
                                  <Check className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setEditingId(`writing:${pref.id}`); setEditingDraft(state.statement); }}
                                  aria-label={zh ? '编辑' : 'Edit'}
                                  className="rounded-lg p-1.5 text-fg-subtle transition-colors hover:text-fg"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setWritingDecisions((prev) => ({ ...prev, [pref.id]: { decision: 'rejected', statement: state.statement } }))}
                                  aria-label={zh ? '禁用' : 'Disable'}
                                  className={cn('rounded-lg p-1.5 transition-colors', state.decision === 'rejected' ? 'text-danger' : 'text-fg-subtle hover:text-danger')}
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
                          className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2.5 py-0.5 text-xs text-fg"
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
                        placeholder={zh ? '+ 补充一条要求…' : '+ Add a rule…'}
                        className="min-w-[12rem] flex-1 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Cross-Source Work Threads */}
              {reveal.workThreads.length > 0 ? (
                <div className="xopc-apple-card space-y-1.5" style={{ animationDelay: '115ms' }}>
                  <div className="px-1 text-[11px] font-medium tracking-[0.02em] text-fg-subtle">
                    {zh ? '近期主线' : 'Active threads'}
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-edge/80 bg-surface-panel/95 shadow-surface">
                    <div className="divide-y divide-edge-subtle">
                      {reveal.workThreads.slice(0, 3).map((thread) => (
                        <button
                          key={thread.id}
                          type="button"
                          disabled={understandConfirming}
                          onClick={() => void commitStep1Confirmation(thread)}
                          className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/45 active:scale-[0.995]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13.5px] font-medium text-fg group-hover:text-accent-fg">{thread.title}</div>
                            <div className="mt-0.5 truncate text-xs text-fg-muted">{thread.summary}</div>
                          </div>
                          <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent-fg" aria-hidden />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Optional Calibration Question */}
              {reveal.calibrationQuestions.length > 0 ? (
                <div className="xopc-apple-card rounded-2xl border border-edge/80 bg-surface-panel/95 p-4 shadow-surface" style={{ animationDelay: '145ms' }}>
                  {reveal.calibrationQuestions.slice(0, 1).map((q) => (
                    <div key={q.id} className="space-y-2.5">
                      <p className="text-xs font-medium text-fg">{q.question}</p>
                      {q.options?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {q.options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setCalibrationAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                              className={cn(
                                'rounded-full border px-3 py-1 text-xs transition-all duration-150 active:scale-[0.97]',
                                calibrationAnswers[q.id] === opt
                                  ? 'border-accent/60 bg-accent-soft text-accent-fg'
                                  : 'border-edge bg-surface-base/60 text-fg-muted hover:text-fg',
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
            <section className="space-y-6" aria-label={zh ? '建立工作项目' : 'Set up workspace projects'}>
              {/* Subtle non-blocking Page 1 Status Pill */}
              {understandRunning || understandReady ? (
                <div className="flex justify-center">
                  {understandRunning ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-edge/80 bg-surface-panel/85 px-3 py-1 text-[11px] text-fg-muted shadow-surface backdrop-blur-md">
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
                      className="inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-accent-soft px-3 py-1 text-[11px] font-medium text-accent-fg shadow-surface transition-all duration-150 hover:bg-accent-soft/80 active:scale-[0.98]"
                    >
                      <Sparkles className="size-3" aria-hidden />
                      <span>{zh ? '个人画像已就绪 · 去看看' : 'Profile ready · Review'}</span>
                    </button>
                  )}
                </div>
              ) : null}

              {projectView === 'select' ? (
                <>
                  <div className="flex flex-col items-center text-center">
                    <span className="mb-3.5 flex size-14 items-center justify-center rounded-2xl bg-surface-panel text-fg shadow-surface ring-1 ring-edge/80">
                      <FolderGit2 className="size-6" aria-hidden />
                    </span>
                    <h1 className="text-[1.625rem] font-semibold tracking-[-0.03em] text-fg">
                      {zh ? '工作项目' : 'Projects'}
                    </h1>
                    <p className="mt-1 text-sm text-fg-muted">
                      {zh ? '选择一个或多个本地目录' : 'Choose one or more folders.'}
                    </p>
                  </div>

                  {/* Group 0: Host-installed external coding runtimes (Codex / Antigravity / Claude Code) */}
                  <ExternalRuntimesOnboardingSection
                    zh={zh}
                    loadingFast={loadingExternalFast}
                    loadingFull={loadingExternalFull}
                    refreshing={refreshingExternal}
                    fastDetections={externalFast}
                    probes={externalProbes}
                    existingAgents={existingAgents}
                    selectedKinds={selectedExternalKinds}
                    permissionMode={externalPermissionMode}
                    contextAccess={externalContextAccess}
                    syncConfigs={syncExternalConfigs}
                    importSources={importSources}
                    hasSelectedProjects={selectedFolderPaths.size > 0}
                    projectDefaultRuntime={projectDefaultRuntime}
                    disabled={projectsCreating}
                    onToggleKind={toggleExternalKind}
                    onRefresh={() => void loadExternalRuntimes(true)}
                    onRuntimeSignedIn={handleExternalRuntimeSignedIn}
                    onPermissionModeChange={setExternalPermissionMode}
                    onContextAccessChange={setExternalContextAccess}
                    onSyncConfigsChange={setSyncExternalConfigs}
                    onProjectDefaultRuntimeChange={(value) => {
                      projectDefaultTouchedRef.current = true;
                      setProjectDefaultRuntime(value);
                    }}
                    onCustomizeImport={(source) => void startToolImportScan(source)}
                  />

                  {/* Group 1: Local folders (macOS Sequoia inset grouped list) */}
                  <div className="xopc-apple-card space-y-2" style={{ animationDelay: '35ms' }}>
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium tracking-[0.02em] text-fg-subtle">
                          {zh ? '本机目录' : 'Local folders'}
                        </span>
                        {selectedFolderPaths.size > 0 ? (
                          <span className="rounded-full bg-surface-panel px-2 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-edge/80">
                            {zh ? `已选 ${selectedFolderPaths.size}` : `${selectedFolderPaths.size} selected`}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => openFolderPicker('project')}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted transition-colors hover:text-fg"
                      >
                        <FolderPlus className="size-3" aria-hidden />
                        <span>{zh ? '添加文件夹' : 'Add folder'}</span>
                      </button>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-edge/80 bg-surface-panel/95 shadow-surface">
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
                                className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-hover/45 active:scale-[0.995]"
                              >
                                <span className={cn(
                                  'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200',
                                  selected ? 'bg-surface-inset text-fg' : 'bg-surface-inset/55 text-fg-subtle',
                                )}>
                                  {folder.isRepo ? <GitBranch className="size-4" aria-hidden /> : <FolderOpen className="size-4" aria-hidden />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-2">
                                    <span className="truncate text-[13.5px] font-medium text-fg">{folder.name}</span>
                                    {folder.existingProject ? (
                                      <span className="shrink-0 rounded-full bg-surface-inset px-1.5 py-0.5 text-[10px] text-fg-subtle">
                                        {zh ? '已有项目' : 'Existing'}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="block truncate text-xs text-fg-subtle">{folder.meta}</span>
                                </span>
                                <span className={cn(
                                  'flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-all duration-200',
                                  selected ? 'xopc-check-pop border-accent bg-accent text-on-accent' : 'border-edge-strong bg-transparent',
                                )}>
                                  {selected ? <Check className="size-2.5 stroke-[2.6]" aria-hidden /> : null}
                                </span>
                              </button>
                            );
                          })}

                          <button
                            type="button"
                            onClick={() => openFolderPicker('project')}
                            className="flex w-full items-center gap-3.5 px-4 py-3 text-left text-[13.5px] font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover/45 hover:text-fg active:scale-[0.995]"
                          >
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-inset/70 text-fg-muted">
                              <FolderPlus className="size-4" aria-hidden />
                            </span>
                            <span>{zh ? '选择其他文件夹…' : 'Choose another folder…'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Group 2: Import existing projects from Codex / Claude Code */}
                  {detectedImportSources.length > 0 ? (
                    <div className="xopc-apple-card space-y-2" style={{ animationDelay: '85ms' }}>
                      <div className="px-1 text-[11px] font-medium tracking-[0.02em] text-fg-subtle">
                        {zh ? '从其他工具导入' : 'Import from'}
                      </div>
                      <div className="flex flex-wrap gap-2 rounded-2xl border border-edge/80 bg-surface-panel/95 p-3.5 shadow-surface">
                        {detectedImportSources.map((item) => {
                          const importedCount = item.lastImport?.projects ?? 0;
                          const hasImported = Boolean(item.lastImport && item.lastImport.status !== 'running');
                          return (
                            <button
                              key={item.id}
                              type="button"
                              disabled={!item.detected || importBusy}
                              onClick={() => void startToolImportScan(item.id)}
                              className={cn(
                                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-50',
                                hasImported
                                  ? 'border-success/35 bg-success-soft/55 text-fg'
                                  : 'border-edge bg-surface-base/60 text-fg hover:border-edge-strong hover:bg-surface-hover/55',
                              )}
                            >
                              <Download className="size-3.5 text-fg-muted" aria-hidden />
                              <span>{item.name}</span>
                              {hasImported ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-success">
                                  <Check className="xopc-check-pop size-3" aria-hidden />
                                  {importedCount > 0 ? <span>{importedCount}</span> : null}
                                </span>
                              ) : (
                                <Plus className="size-3 text-fg-subtle" aria-hidden />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {projectView === 'created' && (createdProjects.length > 0 || connectedExternalKinds.length > 0) ? (
                <div className="space-y-6">
                  <div className="flex flex-col items-center text-center">
                    <span className={cn(
                      'xopc-check-pop mb-3 flex size-12 items-center justify-center rounded-full',
                      (allProjectsUnderstood || (createdProjects.length === 0 && connectedExternalKinds.length > 0))
                        ? 'bg-success-soft text-success'
                        : 'bg-surface-panel text-fg shadow-surface ring-1 ring-edge/80',
                    )}>
                      <CheckCircle2 className="size-5" aria-hidden />
                    </span>
                    <h2 className="text-[1.5rem] font-semibold tracking-[-0.03em] text-fg">
                      {createdProjects.length === 0
                        ? (zh ? '编程助手已就绪' : 'Coding agents ready')
                        : allProjectsUnderstood
                          ? (zh ? '项目已就绪' : 'Projects ready')
                          : (createdProjects.length === 1
                            ? (zh ? '项目已创建' : 'Project created')
                            : (zh ? `已创建 ${createdProjects.length} 个项目` : `${createdProjects.length} projects created`))}
                    </h2>
                    {anyProjectUnderstandingRunning ? (
                      <p className="mt-1 text-xs text-fg-muted">
                        {zh ? '理解在后台进行，现在即可开始对话' : 'Analyzing in background — ready to chat.'}
                      </p>
                    ) : null}
                  </div>

                  {connectedExternalKinds.length > 0 ? (
                    <div
                      data-onboarding-connected-runtimes
                      className="xopc-apple-card flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-edge/80 bg-surface-panel/95 px-4 py-3 shadow-surface"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-fg-muted">
                          {zh ? '已接入助手' : 'Connected'}
                        </span>
                        {connectedExternalKinds.map((entry) => (
                          <ExternalRuntimePill key={entry.agentId} kind={entry.kind} />
                        ))}
                      </div>
                      {externalSyncSummary && externalSyncSummary.importedCount > 0 ? (
                        <span className="text-[11px] text-success">
                          {zh
                            ? `已同步 ${externalSyncSummary.importedCount} 项技能与规则`
                            : `Synced ${externalSyncSummary.importedCount} skills & rules`}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {createdProjects.length > 0 ? (
                  <div className="xopc-apple-card overflow-hidden rounded-2xl border border-edge/80 bg-surface-panel/95 shadow-surface" style={{ animationDelay: '40ms' }}>
                    <div className="divide-y divide-edge-subtle">
                      {createdProjects.map((entry) => {
                        const running = isProjectUnderstandingRunning(entry.understandingStatus);
                        const completed = entry.understandingStatus === 'completed';
                        const failed = entry.understandingStatus === 'failed' || entry.understandingStatus === 'canceled';
                        const snippet = compactOverviewSnippet(entry.overview);
                        const boundExternalKind = entry.project.defaultAgentId
                          ? agentKindById.get(entry.project.defaultAgentId)
                          : undefined;
                        return (
                          <div key={entry.project.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-inset text-fg">
                                <FolderGit2 className="size-4" aria-hidden />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="truncate text-[13.5px] font-medium text-fg">{entry.project.name}</span>
                                  {boundExternalKind ? <ExternalRuntimePill kind={boundExternalKind} /> : null}
                                  {running ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                                      <Loader2 className="size-2.5 animate-spin text-accent-fg" aria-hidden />
                                      <span>{zh ? '理解中…' : 'Analyzing…'}</span>
                                    </span>
                                  ) : completed ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                                      <Check className="xopc-check-pop size-2.5" aria-hidden />
                                      <span>{zh ? '已理解' : 'Ready'}</span>
                                    </span>
                                  ) : failed ? (
                                    <button
                                      type="button"
                                      onClick={() => void retryProjectUnderstanding(entry.project.id)}
                                      className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg"
                                    >
                                      <RotateCcw className="size-2.5" aria-hidden />
                                      <span>{zh ? '重试' : 'Retry'}</span>
                                    </button>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-fg-subtle">
                                  {snippet ?? (entry.project.workspaceRoot ? compactPath(entry.project.workspaceRoot) : '')}
                                </div>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => handleOpenProjectChat(entry.project.id)}
                              className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs font-medium text-fg-muted transition-all duration-150 hover:bg-surface-hover hover:text-fg active:scale-[0.97]"
                            >
                              <MessageSquare className="size-3.5" aria-hidden />
                              <span>{zh ? '进入对话' : 'Chat'}</span>
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </main>

      {/* Translucent Apple-style Footer Bar — calm glass surface aligned to card measure */}
      <footer className="shrink-0 border-t border-edge-subtle/75 bg-surface-base/80 px-5 py-3.5 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex w-full max-w-[34rem] items-center justify-between gap-3">
          {/* PAGE 1 FOOTERS */}
          {step === 'understand' && understandView === 'select' ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep('projects')}
                className="h-9 rounded-full px-3 text-xs text-fg-muted hover:text-fg"
              >
                {zh ? '跳过' : 'Skip'}
              </Button>
              <div className="flex items-center gap-3">
                <span className="hidden items-center gap-1 text-[11px] text-fg-subtle sm:inline-flex">
                  <ShieldCheck className="size-3.5 opacity-75" aria-hidden />
                  <span>
                    {processingTarget?.remoteModel
                      ? (zh ? `${processingTarget.provider} 脱敏提炼` : `Redacted · ${processingTarget.provider}`)
                      : (zh ? '本机离线' : 'Local only')}
                  </span>
                </span>
                <Button
                  type="button"
                  disabled={understandLaunching}
                  onClick={() => void launchStep1Understanding()}
                  className="h-9 gap-1.5 rounded-full px-5 text-[13px] font-medium transition-transform duration-150 active:scale-[0.98]"
                >
                  <span>
                    {selectedLocalCount > 0
                      ? (zh ? '开始认识我' : 'Start learning')
                      : (zh ? '下一步' : 'Continue')}
                  </span>
                  <ArrowRight className="size-3.5" aria-hidden />
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
                className="h-9 rounded-full px-3 text-xs text-fg-muted hover:text-fg"
              >
                {zh ? '取消' : 'Cancel'}
              </Button>
              <Button
                type="button"
                onClick={() => setStep('projects')}
                className="h-9 gap-1.5 rounded-full px-5 text-[13px] font-medium transition-transform duration-150 active:scale-[0.98]"
              >
                <span>{zh ? '下一步：工作项目' : 'Next: Projects'}</span>
                <ArrowRight className="size-3.5" aria-hidden />
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
                className="h-9 rounded-full px-3 text-xs text-fg-muted hover:text-fg"
              >
                {zh ? '保存并进入' : 'Save & finish'}
              </Button>
              <Button
                type="button"
                disabled={understandConfirming}
                onClick={() => void commitStep1Confirmation('projects')}
                className="h-9 gap-1.5 rounded-full px-5 text-[13px] font-medium transition-transform duration-150 active:scale-[0.98]"
              >
                <span>{zh ? '下一步：工作项目' : 'Save & choose projects'}</span>
                <ArrowRight className="size-3.5" aria-hidden />
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
                  className="h-9 gap-1 rounded-full px-2.5 text-xs text-fg-muted hover:text-fg"
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  <span>{zh ? '上一步' : 'Back'}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleSkipToChat()}
                  className="h-9 rounded-full px-3 text-xs text-fg-muted hover:text-fg"
                >
                  {zh ? '跳过' : 'Skip'}
                </Button>
              </div>
              <Button
                type="button"
                disabled={projectsCreating || (selectedFolderPaths.size === 0 && selectedExternalKinds.size === 0)}
                onClick={() => void launchProjectCreation()}
                className="h-9 gap-1.5 rounded-full px-5 text-[13px] font-medium transition-transform duration-150 active:scale-[0.98]"
              >
                {projectsCreating ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    <span>{zh ? '配置中…' : 'Setting up…'}</span>
                  </>
                ) : (
                  <>
                    <span>
                      {selectedFolderPaths.size > 0 && selectedExternalKinds.size > 0
                        ? (zh ? '创建并接入助手' : 'Create & connect')
                        : selectedFolderPaths.size > 1
                          ? (zh ? `创建 ${selectedFolderPaths.size} 个项目` : `Create ${selectedFolderPaths.size} projects`)
                          : selectedFolderPaths.size === 1
                            ? (zh ? '创建项目' : 'Create project')
                            : (zh ? `接入 ${selectedExternalKinds.size} 个助手` : `Connect ${selectedExternalKinds.size} agent${selectedExternalKinds.size > 1 ? 's' : ''}`)}
                    </span>
                    <ArrowRight className="size-3.5" aria-hidden />
                  </>
                )}
              </Button>
            </>
          ) : null}

          {step === 'projects' && projectView === 'created' && (createdProjects[0] || connectedExternalKinds.length > 0) ? (() => {
            const primaryProject = createdProjects[0]?.project;
            return (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setProjectView('select')}
                  className="h-9 gap-1 rounded-full px-3 text-xs text-fg-muted hover:text-fg"
                >
                  <Plus className="size-3.5" aria-hidden />
                  <span>{zh ? '添加更多' : 'Add more'}</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (primaryProject) handleOpenProjectChat(primaryProject.id);
                    else void handleSkipToChat();
                  }}
                  className="h-9 gap-1.5 rounded-full px-5 text-[13px] font-medium transition-transform duration-150 active:scale-[0.98]"
                >
                  <span>
                    {primaryProject
                      ? (createdProjects.length === 1
                        ? (zh ? `进入「${primaryProject.name}」对话` : `Open ${primaryProject.name}`)
                        : (zh ? '进入对话' : 'Open chat'))
                      : (zh ? '开始使用 XOPC' : 'Start using XOPC')}
                  </span>
                  <ArrowRight className="size-3.5" aria-hidden />
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

      <ImportSelectionDialog
        open={importOpen}
        sourceName={importSources.find((item) => item.id === importSource)?.name ?? ''}
        inventory={importInventory}
        selected={importSelected}
        onSelected={setImportSelected}
        busy={importBusy}
        locked={importBusy}
        error={importError}
        defaultProjectsOpen
        nested
        onClose={() => {
          importScanAbortRef.current?.abort();
          setImportOpen(false);
        }}
        onRefresh={() => {
          if (importSource) void startToolImportScan(importSource);
        }}
        onSubmit={() => void submitToolImport()}
      />
    </div>
  );
}
