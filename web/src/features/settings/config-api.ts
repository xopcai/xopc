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

export type AgentDefaultsDelegateState = { enabled: boolean };
export type AgentDefaultsExecuteCodeState = { enabled: boolean };

export interface AgentDefaultsState {
  model: string;
  /** provider/model refs tried when the primary fails (stored as `agents.defaults.model.fallbacks`). */
  modelFallbacks: string[];
  imageModel: string;
  imageModelFallbacks: string[];
  imageGenerationModel: string;
  imageGenerationModelFallbacks: string[];
  mediaMaxMb: number | undefined;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  /** Config `maxTaskDurationMs` — UI stores whole minutes (empty = unset / gateway default). */
  maxTaskDurationMinutes: number | undefined;
  maxRequestsPerTurn: number;
  maxToolFailuresPerTurn: number;
  workspace: string;
  /** Playwright `browser_*` tools (`agents.defaults.browser.enabled`). */
  browserEnabled: boolean;
  /** Headless Chromium when browser tools are on (`agents.defaults.browser.headless`, default true). */
  browserHeadless: boolean;
  /** Skip private-IP blocking (cloud metadata always blocked). */
  browserAllowPrivateUrls: boolean;
  /** Per-command timeout in seconds (default 30). */
  browserCommandTimeout: number | undefined;
  /** Browser backend: local, browserbase, or browser-use. */
  browserCloudProvider: 'local' | 'browserbase' | 'browser-use';
  /** Direct CDP WebSocket endpoint URL. */
  browserCdpUrl: string;
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
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null && 'primary' in raw) {
    const p = (raw as { primary?: string }).primary;
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
  | 'browserCloudProvider'
  | 'browserCdpUrl'
  | 'browserDialogPolicy'
  | 'browserDialogTimeout'
>;

function parseBrowserFromDefaults(d: Record<string, unknown>): BrowserFieldsPick {
  const browser = d.browser;
  if (!browser || typeof browser !== 'object' || Array.isArray(browser)) {
    return {
      browserEnabled: false,
      browserHeadless: true,
      browserAllowPrivateUrls: false,
      browserCommandTimeout: undefined,
      browserCloudProvider: 'local',
      browserCdpUrl: '',
      browserDialogPolicy: 'auto_dismiss',
      browserDialogTimeout: undefined,
    };
  }
  const b = browser as Record<string, unknown>;
  const enabled = truthyBrowserFlag(b.enabled);
  const headlessRaw = b.headless;
  const headless =
    headlessRaw === false || headlessRaw === 'false' || headlessRaw === 0 ? false : true;

  const allowPrivateUrls = truthyBrowserFlag(b.allowPrivateUrls);

  const commandTimeout =
    typeof b.commandTimeout === 'number' && Number.isFinite(b.commandTimeout) && b.commandTimeout >= 5
      ? Math.floor(b.commandTimeout)
      : undefined;

  const cpRaw = b.cloudProvider;
  const cloudProvider: AgentDefaultsState['browserCloudProvider'] =
    cpRaw === 'browserbase' || cpRaw === 'browser-use' ? cpRaw : 'local';

  const cdpUrl = typeof b.cdpUrl === 'string' ? b.cdpUrl : '';

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
    browserCloudProvider: cloudProvider,
    browserCdpUrl: cdpUrl,
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
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return '';
    }
  }
  return '';
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
  const mf = d.modelFallbacks;
  const modelFallbacksFromApi =
    Array.isArray(mf) && mf.every((x) => typeof x === 'string') ? mf : normalizeModelFallbacks(d.model);
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
    model: normalizeModelRef(d.model),
    modelFallbacks: modelFallbacksFromApi,
    imageModel: normalizeModelRef(d.imageModel),
    imageModelFallbacks: imageModelFallbacksFromApi,
    imageGenerationModel: normalizeModelRef(d.imageGenerationModel),
    imageGenerationModelFallbacks: imageGenerationModelFallbacksFromApi,
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

export async function fetchAgentDefaults(): Promise<AgentDefaultsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  const cfg = configFromApiResponse(res);
  return parseAgentDefaultsFromConfig(cfg ?? {});
}

export async function patchAgentDefaults(state: AgentDefaultsState): Promise<void> {
  const fallbacks = state.modelFallbacks.map((s) => s.trim()).filter(Boolean);
  const modelField =
    fallbacks.length > 0 ? { primary: state.model, fallbacks } : state.model;

  const imageFbs = state.imageModelFallbacks.map((s) => s.trim()).filter(Boolean);
  const imageModelField =
    imageFbs.length > 0 && state.imageModel.trim()
      ? { primary: state.imageModel.trim(), fallbacks: imageFbs }
      : state.imageModel || '';

  const imageGenFbs = state.imageGenerationModelFallbacks.map((s) => s.trim()).filter(Boolean);
  const imageGenerationModelField =
    imageGenFbs.length > 0 && state.imageGenerationModel.trim()
      ? { primary: state.imageGenerationModel.trim(), fallbacks: imageGenFbs }
      : state.imageGenerationModel || '';

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

  const skillsClean = state.skillsAllowlist.map((s) => s.trim()).filter(Boolean);
  const toolsDisableClean = state.toolsDisable.map((s) => s.trim()).filter(Boolean);

  const paramsParsed = parseParamsJsonForSave(state.paramsJson);
  const params =
    paramsParsed === null || Object.keys(paramsParsed).length === 0 ? null : paramsParsed;

  const defaults: Record<string, unknown> = {
    model: modelField,
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
    browser: {
      enabled: state.browserEnabled,
      headless: state.browserHeadless,
      allowPrivateUrls: state.browserAllowPrivateUrls,
      commandTimeout: state.browserCommandTimeout ?? null,
      cloudProvider: state.browserCloudProvider === 'local' ? null : state.browserCloudProvider,
      cdpUrl: state.browserCdpUrl.trim() || null,
      dialogPolicy: state.browserDialogPolicy === 'auto_dismiss' ? null : state.browserDialogPolicy,
      dialogTimeoutSeconds: state.browserDialogTimeout ?? null,
    },
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
