import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface AgentDefaultsState {
  model: string;
  /** provider/model refs tried when the primary fails (stored as `agents.defaults.model.fallbacks`). */
  modelFallbacks: string[];
  imageModel: string;
  imageGenerationModel: string;
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

export async function fetchAgentDefaults(): Promise<AgentDefaultsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  const d = (res.payload?.config as { agents?: { defaults?: Record<string, unknown> } })?.agents?.defaults ?? {};
  const mf = (d as { modelFallbacks?: unknown }).modelFallbacks;
  const modelFallbacksFromApi =
    Array.isArray(mf) && mf.every((x) => typeof x === 'string') ? mf : normalizeModelFallbacks(d.model);
  const browser = d.browser;
  const browserObj =
    typeof browser === 'object' && browser !== null && !Array.isArray(browser)
      ? (browser as Record<string, unknown>)
      : null;
  return {
    model: normalizeModelRef(d.model),
    modelFallbacks: modelFallbacksFromApi,
    imageModel: normalizeModelRef(d.imageModel),
    imageGenerationModel: normalizeModelRef(d.imageGenerationModel),
    mediaMaxMb: typeof d.mediaMaxMb === 'number' && !Number.isNaN(d.mediaMaxMb) ? d.mediaMaxMb : undefined,
    maxTokens: typeof d.maxTokens === 'number' ? d.maxTokens : 8192,
    temperature: typeof d.temperature === 'number' ? d.temperature : 0.7,
    maxToolIterations: typeof d.maxToolIterations === 'number' ? d.maxToolIterations : 20,
    workspace: typeof d.workspace === 'string' ? d.workspace : '~/.xopcbot/workspace',
    browserEnabled: browserObj?.enabled === true,
    browserHeadless: browserObj?.headless !== false,
    thinkingDefault: typeof d.thinkingDefault === 'string' ? d.thinkingDefault : 'medium',
    reasoningDefault: typeof d.reasoningDefault === 'string' ? d.reasoningDefault : 'off',
    verboseDefault: typeof d.verboseDefault === 'string' ? d.verboseDefault : 'off',
  };
}

export async function patchAgentDefaults(state: AgentDefaultsState): Promise<void> {
  const fallbacks = state.modelFallbacks.map((s) => s.trim()).filter(Boolean);
  const modelField =
    fallbacks.length > 0 ? { primary: state.model, fallbacks } : state.model;

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      agents: {
        defaults: {
          model: modelField,
          imageModel: state.imageModel || '',
          imageGenerationModel: state.imageGenerationModel || '',
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
}
