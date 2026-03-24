import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface AgentDefaultsState {
  model: string;
  imageModel: string;
  imageGenerationModel: string;
  mediaMaxMb: number | undefined;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  workspace: string;
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

export async function fetchAgentDefaults(): Promise<AgentDefaultsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  const d = (res.payload?.config as { agents?: { defaults?: Record<string, unknown> } })?.agents?.defaults ?? {};
  return {
    model: normalizeModelRef(d.model),
    imageModel: normalizeModelRef(d.imageModel),
    imageGenerationModel: normalizeModelRef(d.imageGenerationModel),
    mediaMaxMb: typeof d.mediaMaxMb === 'number' && !Number.isNaN(d.mediaMaxMb) ? d.mediaMaxMb : undefined,
    maxTokens: typeof d.maxTokens === 'number' ? d.maxTokens : 8192,
    temperature: typeof d.temperature === 'number' ? d.temperature : 0.7,
    maxToolIterations: typeof d.maxToolIterations === 'number' ? d.maxToolIterations : 20,
    workspace: typeof d.workspace === 'string' ? d.workspace : '~/.xopcbot/workspace',
    thinkingDefault: typeof d.thinkingDefault === 'string' ? d.thinkingDefault : 'medium',
    reasoningDefault: typeof d.reasoningDefault === 'string' ? d.reasoningDefault : 'off',
    verboseDefault: typeof d.verboseDefault === 'string' ? d.verboseDefault : 'off',
  };
}

export async function patchAgentDefaults(state: AgentDefaultsState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      agents: {
        defaults: {
          model: state.model,
          imageModel: state.imageModel || '',
          imageGenerationModel: state.imageGenerationModel || '',
          mediaMaxMb: state.mediaMaxMb ?? null,
          maxTokens: state.maxTokens,
          temperature: state.temperature,
          maxToolIterations: state.maxToolIterations,
          workspace: state.workspace,
          thinkingDefault: state.thinkingDefault,
          reasoningDefault: state.reasoningDefault,
          verboseDefault: state.verboseDefault,
        },
      },
    }),
  });
}
