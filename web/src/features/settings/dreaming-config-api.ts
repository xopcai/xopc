import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export type DreamingConfigState = {
  enabled: boolean;
  frequency: string;
  timezone: string;
  deepEnabled: boolean;
  minScore: number;
  minRecallCount: number;
  limit: number;
};

const DEFAULTS: DreamingConfigState = {
  enabled: false,
  frequency: '0 3 * * *',
  timezone: '',
  deepEnabled: true,
  minScore: 0.8,
  minRecallCount: 3,
  limit: 10,
};

function clamp01(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function toInt(n: unknown, fallback: number): number {
  const x = typeof n === 'string' ? Number(n) : (n as number);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.floor(x));
}

export function normalizeDreamingFromConfig(config: unknown): DreamingConfigState {
  const c = isRecord(config) ? config : {};
  const agents = isRecord(c.agents) ? c.agents : {};
  const defaults = isRecord(agents.defaults) ? agents.defaults : {};
  const memory = isRecord(defaults.memory) ? defaults.memory : {};
  const dreaming = isRecord(memory.dreaming) ? memory.dreaming : {};
  const phases = isRecord(dreaming.phases) ? dreaming.phases : {};
  const deep = isRecord(phases.deep) ? phases.deep : {};

  return {
    enabled: dreaming.enabled === true,
    frequency: typeof dreaming.frequency === 'string' && dreaming.frequency.trim() ? dreaming.frequency.trim() : DEFAULTS.frequency,
    timezone: typeof dreaming.timezone === 'string' ? dreaming.timezone : '',
    deepEnabled: deep.enabled !== false,
    minScore: clamp01(typeof deep.minScore === 'number' ? deep.minScore : Number(deep.minScore), DEFAULTS.minScore),
    minRecallCount: Math.max(1, toInt(deep.minRecallCount, DEFAULTS.minRecallCount)),
    limit: toInt(deep.limit, DEFAULTS.limit),
  };
}

export async function patchDreamingConfig(state: DreamingConfigState): Promise<void> {
  const freq = state.frequency.trim();
  const tz = state.timezone.trim();

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      agents: {
        defaults: {
          memory: {
            dreaming: {
              enabled: Boolean(state.enabled),
              frequency: freq || null,
              timezone: tz || null,
              phases: {
                deep: {
                  enabled: Boolean(state.deepEnabled),
                  minScore: clamp01(state.minScore, DEFAULTS.minScore),
                  minRecallCount: Math.max(1, Math.floor(state.minRecallCount)),
                  limit: Math.max(0, Math.floor(state.limit)),
                },
              },
            },
          },
        },
      },
    }),
  });

  void revalidateGatewayConfig();
}

