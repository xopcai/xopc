import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

// --- Nested shapes (align with `src/config/schema.ts` AgentDefaultsSchema) ---

export type AgentDefaultsCompactionState = {
  enabled: boolean;
  mode: 'default' | 'safeguard';
  reserveTokens: number;
  triggerThreshold: number;
  minMessagesBeforeCompact: number;
  keepRecentMessages: number;
  evictionWindow: number;
  retentionWindow: number;
};

export type AgentDefaultsPruningState = {
  enabled: boolean;
  maxToolResultChars: number;
  headKeepRatio: number;
  tailKeepRatio: number;
};

export type AgentDefaultsMemoryState = {
  enabled: boolean;
  useEnhancedSystem: boolean;
  userProfileEnabled: boolean;
  provider: '' | 'none' | 'stub';
  injectionFrequency: '' | 'every-turn' | 'first-turn';
  memoryCharLimit: number | undefined;
  userCharLimit: number | undefined;
  contextCadence: number | undefined;
  dialecticCadence: number | undefined;
};

export type AgentDefaultsSessionSearchState = {
  summaryModel: string;
};

export type AgentDefaultsBackgroundReviewState = {
  enabled: boolean;
  memoryNudgeInterval: number;
  skillNudgeInterval: number;
  maxToolRounds: number;
  maxHistoryMessages: number;
  maxDurationMs: number;
};

export type AgentDefaultsWebExtractState = {
  model: string;
  maxLength: number | undefined;
};

import type { AgentTypedModelRow } from '@/features/settings/agents/typed-models-lib';
import {
  cleanTypedModelsForPatch,
  parseTypedModelsFromConfig,
} from '@/features/settings/agents/typed-models-lib';

export type { AgentTypedModelRow };
export type AgentDefaultsDelegateState = { enabled: boolean };
export type AgentDefaultsExecuteCodeState = { enabled: boolean };

export interface AgentDefaultsState {
  model: string;
  /** provider/model refs tried when the primary fails (stored as `agents.defaults.models.chat.fallbacks`). */
  modelFallbacks: string[];
  imageModel: string;
  imageModelFallbacks: string[];
  imageGenerationModel: string;
  imageGenerationModelFallbacks: string[];
  /** Per-call timeout (ms) for image generation; null = inherit gateway default. */
  imageGenerationModelTimeoutMs: number | null;
  /** Sweep every configured provider when primary chain fails. */
  imageGenerationModelAutoProviderFallback: boolean;
  mediaMaxMb: number | undefined;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  /** Config `maxTaskDurationMs` — UI stores whole minutes (empty = unset / gateway default). */
  maxTaskDurationMinutes: number | undefined;
  maxRequestsPerTurn: number;
  maxToolFailuresPerTurn: number;
  workspace: string;
  /** `browser_use` tool (`agents.defaults.browser.enabled`). */
  browserEnabled: boolean;
  /** Headless Chromium when browser tools are on (`agents.defaults.browser.headless`; default false = visible window). */
  browserHeadless: boolean;
  /** Skip private-IP blocking (cloud metadata always blocked). */
  browserAllowPrivateUrls: boolean;
  /** Per-command timeout in seconds (default 30). */
  browserCommandTimeout: number | undefined;
  /** Browser backend mode: local, cdp, cloud, extension, or CloakBrowser. */
  browserBackend: 'local' | 'cdp' | 'cloud' | 'extension' | 'cloakbrowser';
  /** Cloud browser backend: local, browserbase, or browser-use. */
  browserCloudProvider: 'local' | 'browserbase' | 'browser-use';
  /** Cloud provider API key. Masked as *** when already stored. */
  browserCloudApiKey: string;
  /** Optional Browserbase project id. */
  browserCloudProjectId: string;
  /** Optional cloud provider region. */
  browserCloudRegion: string;
  /** Direct CDP WebSocket endpoint URL. */
  browserCdpUrl: string;
  /** Chrome Extension bridge port (default 19820). */
  browserExtensionPort: number | undefined;
  /** Chrome Extension bridge host (default 127.0.0.1). */
  browserExtensionHost: string;
  /** Extension connection wait timeout in ms (default 30000). */
  browserExtensionConnectionTimeout: number | undefined;
  /** Keep CloakBrowser alive between tasks. */
  browserCloakKeepOpen: boolean;
  /** Use a temporary CloakBrowser profile. */
  browserCloakTemporaryProfile: boolean;
  /** Optional CloakBrowser binary cache directory. */
  browserCloakCacheDir: string;
  /** Optional CloakBrowser executable path. */
  browserCloakBinaryPath: string;
  /** CloakBrowser timezone emulation (e.g. America/New_York). */
  browserCloakTimezone: string;
  /** CloakBrowser locale emulation (e.g. en-US). */
  browserCloakLocale: string;
  /** Public IP for WebRTC leak prevention. */
  browserCloakWebrtcIp: string;
  /** Platform fingerprint override (e.g. windows, macos). */
  browserCloakFingerprintPlatform: string;
  /** Extra Chromium launch args (one per line in UI). */
  browserCloakExtraArgs: string;
  /** Humanized browser input simulation. */
  browserHumanize: boolean;
  /** Humanized input behavior preset. */
  browserHumanPreset: 'default' | 'careful';
  /** JS dialog handling policy. */
  browserDialogPolicy: 'must_respond' | 'auto_dismiss' | 'auto_accept';
  /** Dialog auto-timeout in seconds (default 300). */
  browserDialogTimeout: number | undefined;
  thinkingDefault: string;
  reasoningDefault: string;
  verboseDefault: string;
  compaction: AgentDefaultsCompactionState;
  pruning: AgentDefaultsPruningState;
  memory: AgentDefaultsMemoryState;
  sessionSearch: AgentDefaultsSessionSearchState;
  backgroundReview: AgentDefaultsBackgroundReviewState;
  webExtract: AgentDefaultsWebExtractState;
  delegate: AgentDefaultsDelegateState;
  executeCode: AgentDefaultsExecuteCodeState;
  systemPromptOverride: string;
  /** Maps to `agents.defaults.skills` (allowlist). */
  skillsAllowlist: string[];
  /** Maps to `agents.defaults.tools.disable`. */
  toolsDisable: string[];
  /** Named model roles for workflows (`agents.defaults.models`). */
  typedModels: AgentTypedModelRow[];
  /** JSON for `agents.defaults.params`. */
  paramsJson: string;
}

const DEFAULT_COMPACTION: AgentDefaultsCompactionState = {
  enabled: true,
  mode: 'default',
  reserveTokens: 8000,
  triggerThreshold: 0.8,
  minMessagesBeforeCompact: 10,
  keepRecentMessages: 5,
  evictionWindow: 0.2,
  retentionWindow: 6,
};

const DEFAULT_PRUNING: AgentDefaultsPruningState = {
  enabled: true,
  maxToolResultChars: 10000,
  headKeepRatio: 0.3,
  tailKeepRatio: 0.3,
};

const DEFAULT_MEMORY: AgentDefaultsMemoryState = {
  enabled: true,
  useEnhancedSystem: true,
  userProfileEnabled: true,
  provider: '',
  injectionFrequency: '',
  memoryCharLimit: undefined,
  userCharLimit: undefined,
  contextCadence: undefined,
  dialecticCadence: undefined,
};

const DEFAULT_SESSION_SEARCH: AgentDefaultsSessionSearchState = {
  summaryModel: '',
};

const DEFAULT_BG_REVIEW: AgentDefaultsBackgroundReviewState = {
  enabled: false,
  memoryNudgeInterval: 10,
  skillNudgeInterval: 10,
  maxToolRounds: 8,
  maxHistoryMessages: 80,
  maxDurationMs: 120_000,
};

const DEFAULT_WEB_EXTRACT: AgentDefaultsWebExtractState = {
  model: '',
  maxLength: undefined,
};

function normalizeModelRef(raw: unknown): string {
  if (!raw) return '';
  // API returns a plain string for model refs (via agentModelRefToString).
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const p = (raw as { primary?: unknown }).primary;
    return typeof p === 'string' ? p : '';
  }
  return '';
}

function normalizeModelFallbacks(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || !('fallbacks' in raw)) {
    return [];
  }
  const f = (raw as { fallbacks?: unknown }).fallbacks;
  if (!Array.isArray(f)) {
    return [];
  }
  return f.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function configFromApiResponse(res: unknown): unknown {
  if (!res || typeof res !== 'object') return undefined;
  const r = res as Record<string, unknown>;
  const payload = r.payload;
  if (payload && typeof payload === 'object' && 'config' in payload) {
    return (payload as { config?: unknown }).config;
  }
  if ('config' in r) return r.config;
  return undefined;
}

function truthyBrowserFlag(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

type BrowserFieldsPick = Pick<
  AgentDefaultsState,
  | 'browserEnabled'
  | 'browserHeadless'
  | 'browserAllowPrivateUrls'
  | 'browserCommandTimeout'
  | 'browserBackend'
  | 'browserCloudProvider'
  | 'browserCloudApiKey'
  | 'browserCloudProjectId'
  | 'browserCloudRegion'
  | 'browserCdpUrl'
  | 'browserExtensionPort'
  | 'browserExtensionHost'
  | 'browserExtensionConnectionTimeout'
  | 'browserCloakKeepOpen'
  | 'browserCloakTemporaryProfile'
  | 'browserCloakCacheDir'
  | 'browserCloakBinaryPath'
  | 'browserCloakTimezone'
  | 'browserCloakLocale'
  | 'browserCloakWebrtcIp'
  | 'browserCloakFingerprintPlatform'
  | 'browserCloakExtraArgs'
  | 'browserHumanize'
  | 'browserHumanPreset'
  | 'browserDialogPolicy'
  | 'browserDialogTimeout'
>;

function parseBrowserFromDefaults(d: Record<string, unknown>): BrowserFieldsPick {
  const browser = d.browser;
  if (!browser || typeof browser !== 'object' || Array.isArray(browser)) {
    return {
      browserEnabled: true,
      browserHeadless: false,
      browserAllowPrivateUrls: false,
      browserCommandTimeout: undefined,
      browserBackend: 'extension',
      browserCloudProvider: 'local',
      browserCloudApiKey: '',
      browserCloudProjectId: '',
      browserCloudRegion: '',
      browserCdpUrl: '',
      browserExtensionPort: undefined,
      browserExtensionHost: '127.0.0.1',
      browserExtensionConnectionTimeout: undefined,
      browserCloakKeepOpen: true,
      browserCloakTemporaryProfile: false,
      browserCloakCacheDir: '',
      browserCloakBinaryPath: '',
      browserCloakTimezone: '',
      browserCloakLocale: '',
      browserCloakWebrtcIp: '',
      browserCloakFingerprintPlatform: '',
      browserCloakExtraArgs: '',
      browserHumanize: true,
      browserHumanPreset: 'careful',
      browserDialogPolicy: 'auto_dismiss',
      browserDialogTimeout: undefined,
    };
  }
  const b = browser as Record<string, unknown>;
  const enabled = truthyBrowserFlag(b.enabled);
  const headlessRaw = b.headless;
  const headless =
    headlessRaw === true || headlessRaw === 'true' || headlessRaw === 1 ? true : false;

  const allowPrivateUrls = truthyBrowserFlag(b.allowPrivateUrls);

  const commandTimeout =
    typeof b.commandTimeout === 'number' && Number.isFinite(b.commandTimeout) && b.commandTimeout >= 5
      ? Math.floor(b.commandTimeout)
      : undefined;

  const backendRaw = b.backend;
  const backend: AgentDefaultsState['browserBackend'] =
    backendRaw === 'local' ||
    backendRaw === 'cdp' ||
    backendRaw === 'cloud' ||
    backendRaw === 'extension' ||
    backendRaw === 'cloakbrowser'
      ? backendRaw
      : 'extension';

  const cpRaw = b.cloudProvider;
  const cloudProvider: AgentDefaultsState['browserCloudProvider'] =
    cpRaw === 'browserbase' || cpRaw === 'browser-use' ? cpRaw : 'local';

  const cloud =
    typeof b.cloud === 'object' && b.cloud && !Array.isArray(b.cloud)
      ? (b.cloud as Record<string, unknown>)
      : {};
  const cloudApiKey = typeof cloud.apiKey === 'string' ? cloud.apiKey : '';
  const cloudProjectId = typeof cloud.projectId === 'string' ? cloud.projectId : '';
  const cloudRegion = typeof cloud.region === 'string' ? cloud.region : '';

  const cdpUrl = typeof b.cdpUrl === 'string' ? b.cdpUrl : '';

  // Extension config
  const ext = (typeof b.extension === 'object' && b.extension && !Array.isArray(b.extension))
    ? b.extension as Record<string, unknown>
    : {};
  const extensionPort =
    typeof ext.port === 'number' && Number.isFinite(ext.port) && ext.port >= 1024 && ext.port <= 65535
      ? Math.floor(ext.port)
      : undefined;
  const extensionHost = typeof ext.host === 'string' && ext.host ? ext.host : '127.0.0.1';
  const extensionConnectionTimeout =
    typeof ext.connectionTimeout === 'number' &&
    Number.isFinite(ext.connectionTimeout) &&
    ext.connectionTimeout >= 1000
      ? Math.floor(ext.connectionTimeout)
      : undefined;

  const cloakbrowser =
    typeof b.cloakbrowser === 'object' && b.cloakbrowser && !Array.isArray(b.cloakbrowser)
      ? (b.cloakbrowser as Record<string, unknown>)
      : {};
  const humanPreset: AgentDefaultsState['browserHumanPreset'] =
    b.humanPreset === 'default' ? 'default' : 'careful';

  const dpRaw = b.dialogPolicy;
  const dialogPolicy: AgentDefaultsState['browserDialogPolicy'] =
    dpRaw === 'must_respond' || dpRaw === 'auto_accept' ? dpRaw : 'auto_dismiss';

  const dialogTimeout =
    typeof b.dialogTimeoutSeconds === 'number' &&
    Number.isFinite(b.dialogTimeoutSeconds) &&
    b.dialogTimeoutSeconds >= 1
      ? Math.floor(b.dialogTimeoutSeconds)
      : undefined;

  return {
    browserEnabled: enabled,
    browserHeadless: headless,
    browserAllowPrivateUrls: allowPrivateUrls,
    browserCommandTimeout: commandTimeout,
    browserBackend: backend,
    browserCloudProvider: cloudProvider,
    browserCloudApiKey: cloudApiKey,
    browserCloudProjectId: cloudProjectId,
    browserCloudRegion: cloudRegion,
    browserCdpUrl: cdpUrl,
    browserExtensionPort: extensionPort,
    browserExtensionHost: extensionHost,
    browserExtensionConnectionTimeout: extensionConnectionTimeout,
    browserCloakKeepOpen: cloakbrowser.keepOpen !== false,
    browserCloakTemporaryProfile: cloakbrowser.temporaryProfile === true,
    browserCloakCacheDir: typeof cloakbrowser.cacheDir === 'string' ? cloakbrowser.cacheDir : '',
    browserCloakBinaryPath: typeof cloakbrowser.binaryPath === 'string' ? cloakbrowser.binaryPath : '',
    browserCloakTimezone: typeof cloakbrowser.timezone === 'string' ? cloakbrowser.timezone : '',
    browserCloakLocale: typeof cloakbrowser.locale === 'string' ? cloakbrowser.locale : '',
    browserCloakWebrtcIp: typeof cloakbrowser.webrtcIp === 'string' ? cloakbrowser.webrtcIp : '',
    browserCloakFingerprintPlatform:
      typeof cloakbrowser.fingerprintPlatform === 'string' ? cloakbrowser.fingerprintPlatform : '',
    browserCloakExtraArgs: Array.isArray(cloakbrowser.extraArgs)
      ? cloakbrowser.extraArgs
          .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
          .join('\n')
      : '',
    browserHumanize: b.humanize !== false,
    browserHumanPreset: humanPreset,
    browserDialogPolicy: dialogPolicy,
    browserDialogTimeout: dialogTimeout,
  };
}

function parseCompaction(raw: unknown): AgentDefaultsCompactionState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_COMPACTION };
  }
  const p = raw as Record<string, unknown>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_COMPACTION.enabled,
    mode: p.mode === 'safeguard' ? 'safeguard' : 'default',
    reserveTokens:
      typeof p.reserveTokens === 'number' && Number.isFinite(p.reserveTokens)
        ? Math.floor(p.reserveTokens)
        : DEFAULT_COMPACTION.reserveTokens,
    triggerThreshold:
      typeof p.triggerThreshold === 'number' && Number.isFinite(p.triggerThreshold)
        ? p.triggerThreshold
        : DEFAULT_COMPACTION.triggerThreshold,
    minMessagesBeforeCompact:
      typeof p.minMessagesBeforeCompact === 'number' && Number.isFinite(p.minMessagesBeforeCompact)
        ? Math.floor(p.minMessagesBeforeCompact)
        : DEFAULT_COMPACTION.minMessagesBeforeCompact,
    keepRecentMessages:
      typeof p.keepRecentMessages === 'number' && Number.isFinite(p.keepRecentMessages)
        ? Math.floor(p.keepRecentMessages)
        : DEFAULT_COMPACTION.keepRecentMessages,
    evictionWindow:
      typeof p.evictionWindow === 'number' && Number.isFinite(p.evictionWindow)
        ? p.evictionWindow
        : DEFAULT_COMPACTION.evictionWindow,
    retentionWindow:
      typeof p.retentionWindow === 'number' && Number.isFinite(p.retentionWindow)
        ? Math.floor(p.retentionWindow)
        : DEFAULT_COMPACTION.retentionWindow,
  };
}

function parsePruning(raw: unknown): AgentDefaultsPruningState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PRUNING };
  }
  const p = raw as Record<string, unknown>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_PRUNING.enabled,
    maxToolResultChars:
      typeof p.maxToolResultChars === 'number' && Number.isFinite(p.maxToolResultChars)
        ? Math.floor(p.maxToolResultChars)
        : DEFAULT_PRUNING.maxToolResultChars,
    headKeepRatio:
      typeof p.headKeepRatio === 'number' && Number.isFinite(p.headKeepRatio)
        ? p.headKeepRatio
        : DEFAULT_PRUNING.headKeepRatio,
    tailKeepRatio:
      typeof p.tailKeepRatio === 'number' && Number.isFinite(p.tailKeepRatio)
        ? p.tailKeepRatio
        : DEFAULT_PRUNING.tailKeepRatio,
  };
}

function parseMemory(raw: unknown): AgentDefaultsMemoryState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_MEMORY };
  }
  const p = raw as Record<string, unknown>;
  const providerRaw = p.provider;
  const provider: AgentDefaultsMemoryState['provider'] =
    providerRaw === 'none' || providerRaw === 'stub' ? providerRaw : '';
  const inj = p.injectionFrequency;
  const injectionFrequency: AgentDefaultsMemoryState['injectionFrequency'] =
    inj === 'every-turn' || inj === 'first-turn' ? inj : '';
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_MEMORY.enabled,
    useEnhancedSystem:
      typeof p.useEnhancedSystem === 'boolean' ? p.useEnhancedSystem : DEFAULT_MEMORY.useEnhancedSystem,
    userProfileEnabled:
      typeof p.userProfileEnabled === 'boolean' ? p.userProfileEnabled : DEFAULT_MEMORY.userProfileEnabled,
    provider,
    injectionFrequency,
    memoryCharLimit:
      typeof p.memoryCharLimit === 'number' && p.memoryCharLimit > 0
        ? Math.floor(p.memoryCharLimit)
        : undefined,
    userCharLimit:
      typeof p.userCharLimit === 'number' && p.userCharLimit > 0
        ? Math.floor(p.userCharLimit)
        : undefined,
    contextCadence:
      typeof p.contextCadence === 'number' && p.contextCadence >= 1
        ? Math.floor(p.contextCadence)
        : undefined,
    dialecticCadence:
      typeof p.dialecticCadence === 'number' && p.dialecticCadence >= 1
        ? Math.floor(p.dialecticCadence)
        : undefined,
  };
}

function parseSessionSearch(raw: unknown): AgentDefaultsSessionSearchState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SESSION_SEARCH };
  }
  const p = raw as Record<string, unknown>;
  return {
    summaryModel: typeof p.summaryModel === 'string' ? p.summaryModel : '',
  };
}

function parseBackgroundReview(raw: unknown): AgentDefaultsBackgroundReviewState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_BG_REVIEW };
  }
  const p = raw as Record<string, unknown>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_BG_REVIEW.enabled,
    memoryNudgeInterval:
      typeof p.memoryNudgeInterval === 'number' && p.memoryNudgeInterval >= 0
        ? Math.floor(p.memoryNudgeInterval)
        : DEFAULT_BG_REVIEW.memoryNudgeInterval,
    skillNudgeInterval:
      typeof p.skillNudgeInterval === 'number' && p.skillNudgeInterval >= 0
        ? Math.floor(p.skillNudgeInterval)
        : DEFAULT_BG_REVIEW.skillNudgeInterval,
    maxToolRounds:
      typeof p.maxToolRounds === 'number' && p.maxToolRounds >= 1 && p.maxToolRounds <= 32
        ? Math.floor(p.maxToolRounds)
        : DEFAULT_BG_REVIEW.maxToolRounds,
    maxHistoryMessages:
      typeof p.maxHistoryMessages === 'number' && p.maxHistoryMessages >= 10 && p.maxHistoryMessages <= 200
        ? Math.floor(p.maxHistoryMessages)
        : DEFAULT_BG_REVIEW.maxHistoryMessages,
    maxDurationMs:
      typeof p.maxDurationMs === 'number' && p.maxDurationMs >= 30_000 && p.maxDurationMs <= 600_000
        ? Math.floor(p.maxDurationMs)
        : DEFAULT_BG_REVIEW.maxDurationMs,
  };
}

function parseWebExtract(raw: unknown): AgentDefaultsWebExtractState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_WEB_EXTRACT };
  }
  const p = raw as Record<string, unknown>;
  return {
    model: typeof p.model === 'string' ? p.model : '',
    maxLength:
      typeof p.maxLength === 'number' && p.maxLength > 0 ? p.maxLength : undefined,
  };
}

function parseEnabledFlag(raw: unknown, def: boolean): { enabled: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { enabled: def };
  }
  const p = raw as Record<string, unknown>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : def,
  };
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((x): x is string => typeof x === 'string');
}

function parseParamsJson(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return '';
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) {
      return '';
    }
    try {
      const parsed: unknown = JSON.parse(t);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(parsed, null, 2);
      }
    } catch {
      return t;
    }
    return '';
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

function readImageGenerationTimeoutMsFromDefaults(d: Record<string, unknown>): number | null {
  const flat = d.imageGenerationModelTimeoutMs;
  if (typeof flat === 'number' && Number.isFinite(flat) && flat > 0) {
    return Math.floor(flat);
  }
  const igm = d.imageGenerationModel;
  if (igm && typeof igm === 'object' && !Array.isArray(igm)) {
    const tm = (igm as { timeoutMs?: unknown }).timeoutMs;
    if (typeof tm === 'number' && Number.isFinite(tm) && tm > 0) {
      return Math.floor(tm);
    }
  }
  return null;
}

function readImageGenerationAutoProviderFallbackFromDefaults(d: Record<string, unknown>): boolean {
  if (d.imageGenerationModelAutoProviderFallback === true) {
    return true;
  }
  const igm = d.imageGenerationModel;
  if (igm && typeof igm === 'object' && !Array.isArray(igm)) {
    return (igm as { autoProviderFallback?: unknown }).autoProviderFallback === true;
  }
  return false;
}

/** Parse `agents.defaults` from a gateway config root object. */
export function parseAgentDefaultsFromConfig(cfg: unknown): AgentDefaultsState {
  const agents =
    cfg && typeof cfg === 'object' && !Array.isArray(cfg) && 'agents' in cfg
      ? (cfg as { agents?: unknown }).agents
      : undefined;
  const defaults =
    agents && typeof agents === 'object' && !Array.isArray(agents) && 'defaults' in agents
      ? (agents as { defaults?: unknown }).defaults
      : undefined;
  const d =
    defaults && typeof defaults === 'object' && !Array.isArray(defaults)
      ? (defaults as Record<string, unknown>)
      : {};
  const modelConfig =
    d.models && typeof d.models === 'object' && !Array.isArray(d.models)
      ? (d.models as Record<string, unknown>)
      : {};
  const chatModel = modelConfig.chat;
  const mf = d.modelFallbacks;
  const modelFallbacksFromApi =
    Array.isArray(mf) && mf.every((x) => typeof x === 'string') ? mf : normalizeModelFallbacks(chatModel);
  const imf = d.imageModelFallbacks;
  const imageModelFallbacksFromApi =
    Array.isArray(imf) && imf.every((x) => typeof x === 'string')
      ? imf
      : normalizeModelFallbacks(d.imageModel);
  const igf = d.imageGenerationModelFallbacks;
  const imageGenerationModelFallbacksFromApi =
    Array.isArray(igf) && igf.every((x) => typeof x === 'string')
      ? igf
      : normalizeModelFallbacks(d.imageGenerationModel);
  const browserFields = parseBrowserFromDefaults(d);
  const maxTaskMs =
    typeof d.maxTaskDurationMs === 'number' && Number.isFinite(d.maxTaskDurationMs)
      ? d.maxTaskDurationMs
      : undefined;
  const maxTaskDurationMinutes =
    maxTaskMs !== undefined ? Math.round(maxTaskMs / 60_000) : undefined;

  return {
    model: normalizeModelRef(chatModel),
    modelFallbacks: modelFallbacksFromApi,
    imageModel: normalizeModelRef(d.imageModel),
    imageModelFallbacks: imageModelFallbacksFromApi,
    imageGenerationModel: normalizeModelRef(d.imageGenerationModel),
    imageGenerationModelFallbacks: imageGenerationModelFallbacksFromApi,
    imageGenerationModelTimeoutMs: readImageGenerationTimeoutMsFromDefaults(d),
    imageGenerationModelAutoProviderFallback: readImageGenerationAutoProviderFallbackFromDefaults(d),
    mediaMaxMb: typeof d.mediaMaxMb === 'number' && !Number.isNaN(d.mediaMaxMb) ? d.mediaMaxMb : undefined,
    maxTokens: typeof d.maxTokens === 'number' ? d.maxTokens : 8192,
    temperature: typeof d.temperature === 'number' ? d.temperature : 0.7,
    maxToolIterations: typeof d.maxToolIterations === 'number' ? d.maxToolIterations : 20,
    maxTaskDurationMinutes,
    maxRequestsPerTurn: typeof d.maxRequestsPerTurn === 'number' ? d.maxRequestsPerTurn : 50,
    maxToolFailuresPerTurn: typeof d.maxToolFailuresPerTurn === 'number' ? d.maxToolFailuresPerTurn : 3,
    workspace: typeof d.workspace === 'string' ? d.workspace : '~/.xopc/workspace',
    ...browserFields,
    thinkingDefault: typeof d.thinkingDefault === 'string' ? d.thinkingDefault : 'medium',
    reasoningDefault: typeof d.reasoningDefault === 'string' ? d.reasoningDefault : 'stream',
    verboseDefault: typeof d.verboseDefault === 'string' ? d.verboseDefault : 'full',
    compaction: parseCompaction(d.compaction),
    pruning: parsePruning(d.pruning),
    memory: parseMemory(d.memory),
    sessionSearch: parseSessionSearch(d.sessionSearch),
    backgroundReview: parseBackgroundReview(d.backgroundReview),
    webExtract: parseWebExtract(d.webExtract),
    delegate: parseEnabledFlag(d.delegate, false),
    executeCode: parseEnabledFlag(d.executeCode, false),
    systemPromptOverride: typeof d.systemPromptOverride === 'string' ? d.systemPromptOverride : '',
    skillsAllowlist: parseStringList(d.skills),
    toolsDisable: (() => {
      const t = d.tools;
      if (!t || typeof t !== 'object' || Array.isArray(t)) {
        return [] as string[];
      }
      const dis = (t as { disable?: unknown }).disable;
      return parseStringList(dis);
    })(),
    typedModels: parseTypedModelsFromConfig(modelConfig),
    paramsJson: parseParamsJson(d.params),
  };
}

function buildMemoryPatch(m: AgentDefaultsMemoryState): Record<string, unknown> {
  const o: Record<string, unknown> = {
    enabled: m.enabled,
    useEnhancedSystem: m.useEnhancedSystem,
    userProfileEnabled: m.userProfileEnabled,
  };
  if (m.provider === 'none' || m.provider === 'stub') {
    o.provider = m.provider;
  } else {
    o.provider = null;
  }
  if (m.injectionFrequency === 'every-turn' || m.injectionFrequency === 'first-turn') {
    o.injectionFrequency = m.injectionFrequency;
  } else {
    o.injectionFrequency = null;
  }
  o.memoryCharLimit = m.memoryCharLimit ?? null;
  o.userCharLimit = m.userCharLimit ?? null;
  o.contextCadence = m.contextCadence ?? null;
  o.dialecticCadence = m.dialecticCadence ?? null;
  return o;
}

/** @throws {SyntaxError} on invalid JSON; {Error} if not a plain object. */
export function parseParamsJsonForSave(paramsJson: string): Record<string, unknown> | null {
  const trimmed = paramsJson.trim();
  if (!trimmed) {
    return null;
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (parsed === null) {
    return null;
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('params must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Maps agent-defaults browser fields to `agents.defaults.browser` for PATCH payloads. */
export function buildBrowserConfigFromAgentDefaults(state: AgentDefaultsState): Record<string, unknown> {
  return {
    enabled: state.browserEnabled,
    headless: state.browserHeadless,
    allowPrivateUrls: state.browserAllowPrivateUrls,
    commandTimeout: state.browserCommandTimeout ?? null,
    backend: state.browserBackend === 'extension' ? null : state.browserBackend,
    cloudProvider: state.browserCloudProvider === 'local' ? null : state.browserCloudProvider,
    cloud: state.browserBackend === 'cloud'
      ? {
          apiKey: state.browserCloudApiKey.trim() || null,
          projectId: state.browserCloudProjectId.trim() || null,
          region: state.browserCloudRegion.trim() || null,
        }
      : null,
    cdpUrl: state.browserCdpUrl.trim() || null,
    extension: state.browserBackend === 'extension'
      ? {
          port: state.browserExtensionPort ?? null,
          host: state.browserExtensionHost.trim() || null,
          connectionTimeout: state.browserExtensionConnectionTimeout ?? null,
        }
      : null,
    cloakbrowser: state.browserBackend === 'cloakbrowser'
      ? {
          keepOpen: state.browserCloakKeepOpen,
          temporaryProfile: state.browserCloakTemporaryProfile,
          cacheDir: state.browserCloakCacheDir.trim() || null,
          binaryPath: state.browserCloakBinaryPath.trim() || null,
          timezone: state.browserCloakTimezone.trim() || null,
          locale: state.browserCloakLocale.trim() || null,
          webrtcIp: state.browserCloakWebrtcIp.trim() || null,
          fingerprintPlatform: state.browserCloakFingerprintPlatform.trim() || null,
          extraArgs: (() => {
            const args = state.browserCloakExtraArgs
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean);
            return args.length > 0 ? args : null;
          })(),
        }
      : null,
    humanize: state.browserBackend === 'cloakbrowser' ? state.browserHumanize : null,
    humanPreset: state.browserBackend === 'cloakbrowser' ? state.browserHumanPreset : null,
    dialogPolicy: state.browserDialogPolicy === 'auto_dismiss' ? null : state.browserDialogPolicy,
    dialogTimeoutSeconds: state.browserDialogTimeout ?? null,
  };
}

export async function fetchAgentDefaults(): Promise<AgentDefaultsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  const cfg = configFromApiResponse(res);
  return parseAgentDefaultsFromConfig(cfg ?? {});
}

export async function patchAgentDefaults(state: AgentDefaultsState): Promise<void> {
  const fallbacks = state.modelFallbacks.flatMap((s) => {
    const v = s.trim();
    return v ? [v] : [];
  });
  const primaryRef = state.model.trim();
  // Always object-form; backend deletes the slot when the field is null.
  const modelField: unknown = primaryRef
    ? fallbacks.length > 0
      ? { primary: primaryRef, fallbacks }
      : { primary: primaryRef }
    : null;

  const imageFbs = state.imageModelFallbacks.flatMap((s) => {
    const v = s.trim();
    return v ? [v] : [];
  });
  const imagePrimary = state.imageModel.trim();
  const imageModelField: unknown = imagePrimary
    ? imageFbs.length > 0
      ? { primary: imagePrimary, fallbacks: imageFbs }
      : { primary: imagePrimary }
    : null;

  const imageGenFbs = state.imageGenerationModelFallbacks.flatMap((s) => {
    const v = s.trim();
    return v ? [v] : [];
  });
  const imageGenPrimary = state.imageGenerationModel.trim();
  const imageGenTimeoutMs =
    typeof state.imageGenerationModelTimeoutMs === 'number' &&
    state.imageGenerationModelTimeoutMs > 0
      ? Math.floor(state.imageGenerationModelTimeoutMs)
      : null;
  const imageGenAuto = state.imageGenerationModelAutoProviderFallback === true;
  const imageGenerationModelField: unknown = imageGenPrimary
    ? {
        primary: imageGenPrimary,
        ...(imageGenFbs.length > 0 ? { fallbacks: imageGenFbs } : {}),
        ...(imageGenTimeoutMs ? { timeoutMs: imageGenTimeoutMs } : {}),
        ...(imageGenAuto ? { autoProviderFallback: true } : {}),
      }
    : null;

  const maxTaskDurationMs: number | null =
    state.maxTaskDurationMinutes === undefined || state.maxTaskDurationMinutes === null
      ? null
      : (() => {
          const n = Math.floor(state.maxTaskDurationMinutes);
          const ms = n * 60_000;
          if (ms < 60_000 || ms > 14_400_000) {
            return null;
          }
          return ms;
        })();

  const skillsClean = state.skillsAllowlist.flatMap((s) => {
    const v = s.trim();
    return v ? [v] : [];
  });
  const toolsDisableClean = state.toolsDisable.flatMap((s) => {
    const v = s.trim();
    return v ? [v] : [];
  });

  const paramsParsed = parseParamsJsonForSave(state.paramsJson);
  const params =
    paramsParsed === null || Object.keys(paramsParsed).length === 0 ? null : paramsParsed;

  const typedModelsClean = cleanTypedModelsForPatch(state.typedModels);

  const defaults: Record<string, unknown> = {
    models: {
      chat: modelField,
      ...(typedModelsClean ?? {}),
    },
    imageModel: imageModelField,
    imageGenerationModel: imageGenerationModelField,
    mediaMaxMb: state.mediaMaxMb ?? null,
    maxTokens: state.maxTokens,
    temperature: state.temperature,
    maxToolIterations: state.maxToolIterations,
    maxTaskDurationMs,
    maxRequestsPerTurn: state.maxRequestsPerTurn,
    maxToolFailuresPerTurn: state.maxToolFailuresPerTurn,
    workspace: state.workspace,
    browser: buildBrowserConfigFromAgentDefaults(state),
    thinkingDefault: state.thinkingDefault,
    reasoningDefault: state.reasoningDefault,
    verboseDefault: state.verboseDefault,
    compaction: { ...state.compaction },
    pruning: { ...state.pruning },
    memory: buildMemoryPatch(state.memory),
    sessionSearch: {
      summaryModel: state.sessionSearch.summaryModel.trim() || null,
    },
    backgroundReview: {
      enabled: state.backgroundReview.enabled,
      memoryNudgeInterval: state.backgroundReview.memoryNudgeInterval,
      skillNudgeInterval: state.backgroundReview.skillNudgeInterval,
      maxToolRounds: state.backgroundReview.maxToolRounds,
      maxHistoryMessages: state.backgroundReview.maxHistoryMessages,
      maxDurationMs: state.backgroundReview.maxDurationMs,
    },
    webExtract: {
      model: state.webExtract.model.trim() || null,
      maxLength: state.webExtract.maxLength ?? null,
    },
    delegate: { enabled: state.delegate.enabled },
    executeCode: { enabled: state.executeCode.enabled },
    systemPromptOverride: state.systemPromptOverride.trim() || null,
    skills: skillsClean.length > 0 ? skillsClean : null,
    tools: { disable: toolsDisableClean.length > 0 ? toolsDisableClean : null },
    params,
  };

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      agents: { defaults },
    }),
  });
  void revalidateGatewayConfig();
}
