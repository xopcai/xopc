import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

// --- Nested shapes (align with `src/config/schema.ts`) ---

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

export type AgentDefaultsWebExtractState = {
  model: string;
  maxLength: number | undefined;
};

import type { AgentTypedModelRow } from '@/features/settings/agents/typed-models-lib';
import {
  parseTypedModelsFromConfig,
} from '@/features/settings/agents/typed-models-lib';

export type { AgentTypedModelRow };
export type AgentDefaultsDelegateState = { enabled: boolean };
export type AgentDefaultsExecuteCodeState = { enabled: boolean };

export interface AgentDefaultsState {
  model: string;
  /** Provider/model refs tried when the primary fails. */
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
  /** `browser_use` runtime (`browser.enabled`). */
  browserEnabled: boolean;
  /** Headless Chromium when browser tools are on (`browser.headless`; default false = visible window). */
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
  webExtract: AgentDefaultsWebExtractState;
  delegate: AgentDefaultsDelegateState;
  executeCode: AgentDefaultsExecuteCodeState;
  systemPromptOverride: string;
  /** Agent skill allowlist draft. */
  skillsAllowlist: string[];
  /** Built-in tool deny list draft. */
  toolsDisable: string[];
  /** Named model roles for workflows. */
  typedModels: AgentTypedModelRow[];
  /** JSON runtime params draft. */
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

function parseBrowserConfig(raw: unknown): BrowserFieldsPick {
  const browser = raw;
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

/** Parse the browser settings draft from a gateway config root object. */
export function parseAgentDefaultsFromConfig(cfg: unknown): AgentDefaultsState {
  const d: Record<string, unknown> = {};
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
  const root = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : {};
  const browserFields = parseBrowserConfig(root.browser);
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

/** Maps browser form fields to top-level `browser` for PATCH payloads. */
export function buildBrowserConfigFromAgentDefaults(state: AgentDefaultsState): Record<string, unknown> {
  const config: Record<string, unknown> = {
    enabled: state.browserEnabled,
    headless: state.browserHeadless,
    allowPrivateUrls: state.browserAllowPrivateUrls,
    ...(state.browserCommandTimeout !== undefined ? { commandTimeout: state.browserCommandTimeout } : {}),
    backend: state.browserBackend,
    ...(state.browserCloudProvider !== 'local' ? { cloudProvider: state.browserCloudProvider } : {}),
    ...(state.browserBackend === 'cloud'
      ? {
          cloud: {
            ...(state.browserCloudApiKey.trim() ? { apiKey: state.browserCloudApiKey.trim() } : {}),
            ...(state.browserCloudProjectId.trim() ? { projectId: state.browserCloudProjectId.trim() } : {}),
            ...(state.browserCloudRegion.trim() ? { region: state.browserCloudRegion.trim() } : {}),
          },
        }
      : {}),
    ...(state.browserCdpUrl.trim() ? { cdpUrl: state.browserCdpUrl.trim() } : {}),
    ...(state.browserBackend === 'extension'
      ? {
          extension: {
            ...(state.browserExtensionPort !== undefined ? { port: state.browserExtensionPort } : {}),
            ...(state.browserExtensionHost.trim() ? { host: state.browserExtensionHost.trim() } : {}),
            ...(state.browserExtensionConnectionTimeout !== undefined
              ? { connectionTimeout: state.browserExtensionConnectionTimeout }
              : {}),
          },
        }
      : {}),
    ...(state.browserBackend === 'cloakbrowser'
      ? {
          cloakbrowser: {
            keepOpen: state.browserCloakKeepOpen,
            temporaryProfile: state.browserCloakTemporaryProfile,
            ...(state.browserCloakCacheDir.trim() ? { cacheDir: state.browserCloakCacheDir.trim() } : {}),
            ...(state.browserCloakBinaryPath.trim() ? { binaryPath: state.browserCloakBinaryPath.trim() } : {}),
            ...(state.browserCloakTimezone.trim() ? { timezone: state.browserCloakTimezone.trim() } : {}),
            ...(state.browserCloakLocale.trim() ? { locale: state.browserCloakLocale.trim() } : {}),
            ...(state.browserCloakWebrtcIp.trim() ? { webrtcIp: state.browserCloakWebrtcIp.trim() } : {}),
            ...(state.browserCloakFingerprintPlatform.trim()
              ? { fingerprintPlatform: state.browserCloakFingerprintPlatform.trim() }
              : {}),
            ...(() => {
              const args = state.browserCloakExtraArgs
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
              return args.length > 0 ? { extraArgs: args } : {};
            })(),
          },
          humanize: state.browserHumanize,
          humanPreset: state.browserHumanPreset,
        }
      : {}),
    ...(state.browserDialogPolicy !== 'auto_dismiss' ? { dialogPolicy: state.browserDialogPolicy } : {}),
    ...(state.browserDialogTimeout !== undefined ? { dialogTimeoutSeconds: state.browserDialogTimeout } : {}),
  };
  return config;
}

export async function patchBrowserSettings(state: AgentDefaultsState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      browser: buildBrowserConfigFromAgentDefaults(state),
    }),
  });
  void revalidateGatewayConfig();
}
