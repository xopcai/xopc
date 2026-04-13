import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

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
  workspace: string;
  /** Playwright `browser_*` tools (`agents.defaults.browser.enabled`). */
  browserEnabled: boolean;
  /** Headless Chromium when browser tools are on (`agents.defaults.browser.headless`, default true). */
  browserHeadless: boolean;
  thinkingDefault: string;
  reasoningDefault: string;
  verboseDefault: string;
}

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

function parseBrowserFromDefaults(d: Record<string, unknown>): Pick<AgentDefaultsState, 'browserEnabled' | 'browserHeadless'> {
  const browser = d.browser;
  if (!browser || typeof browser !== 'object' || Array.isArray(browser)) {
    return { browserEnabled: false, browserHeadless: true };
  }
  const b = browser as Record<string, unknown>;
  const enabled = truthyBrowserFlag(b.enabled);
  const headlessRaw = b.headless;
  const headless =
    headlessRaw === false || headlessRaw === 'false' || headlessRaw === 0 ? false : true;
  return { browserEnabled: enabled, browserHeadless: headless };
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
  const { browserEnabled, browserHeadless } = parseBrowserFromDefaults(d);
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
    workspace: typeof d.workspace === 'string' ? d.workspace : '~/.xopc/workspace',
    browserEnabled,
    browserHeadless,
    thinkingDefault: typeof d.thinkingDefault === 'string' ? d.thinkingDefault : 'medium',
    reasoningDefault: typeof d.reasoningDefault === 'string' ? d.reasoningDefault : 'off',
    verboseDefault: typeof d.verboseDefault === 'string' ? d.verboseDefault : 'off',
  };
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

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      agents: {
        defaults: {
          model: modelField,
          imageModel: imageModelField,
          imageGenerationModel: imageGenerationModelField,
          mediaMaxMb: state.mediaMaxMb ?? null,
          maxTokens: state.maxTokens,
          temperature: state.temperature,
          maxToolIterations: state.maxToolIterations,
          workspace: state.workspace,
          browser: {
            enabled: state.browserEnabled,
            headless: state.browserHeadless,
          },
          thinkingDefault: state.thinkingDefault,
          reasoningDefault: state.reasoningDefault,
          verboseDefault: state.verboseDefault,
        },
      },
    }),
  });
  void revalidateGatewayConfig();
}
