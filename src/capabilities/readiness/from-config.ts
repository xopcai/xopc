import type { Config } from '../../config/schema.js';
import {
  getAgentDefaultImageGenerationModelConfig,
  getAgentDefaultImageModelConfig,
  parseModelRef,
} from '../../config/schema.js';
import {
  getModelCatalogStore,
  type CatalogModel,
  type ModelCatalogSnapshot,
} from '../../providers/model-catalog-store.js';
import { isProviderConfiguredSync } from '../../providers/index.js';
import { compareCatalogModels } from '../../providers/model-catalog-ranking.js';
import {
  DEFAULT_LOCAL_VOICE_MODEL_ID,
  hasInstalledLocalVoiceModel,
} from '../../voice/local/models.js';
import { planCapabilities } from './planner.js';
import type {
  CandidateSource,
  CapabilityCandidate,
  CapabilityId,
  CapabilityPlan,
  CapabilityPlannerInput,
  CapabilityPolicy,
} from './types.js';

interface BuildPlansOptions {
  catalog?: ModelCatalogSnapshot;
  providerReady?: (providerId: string) => boolean;
  localSttReady?: boolean;
}

export function buildCapabilityPlansForConfig(
  config: Config,
  options: BuildPlansOptions = {},
): Record<CapabilityId, CapabilityPlan> {
  const catalog = options.catalog ?? getModelCatalogStore().load();
  const cloud = catalog.sources['xopc-cloud'];
  const providerReady = options.providerReady ?? defaultProviderReady;
  const cloudReady = providerReady('xopc-cloud');
  const agentId = config.agents.default ?? config.agents.list[0]?.id ?? 'main';
  const stt = config.tools?.media?.audio;
  const tts = config.messages?.tts;
  const policies: Record<CapabilityId, CapabilityPolicy> = {
    vision: { explicit: refs(getAgentDefaultImageModelConfig(config)) },
    'image-generation': {
      explicit: refs(getAgentDefaultImageGenerationModelConfig(config, agentId)),
    },
    stt: {
      disabled: stt?.enabled === false,
      explicit: stt ? sttRefs(stt) : undefined,
    },
    tts: {
      disabled: tts?.enabled === false,
      explicit: tts ? ttsRefs(tts) : undefined,
    },
  };

  markExplicitReadiness(policies, catalog, providerReady);

  const automatic: CapabilityPlannerInput['automatic'] = {
    vision: cloudCandidates('vision', cloud?.models ?? [], cloudReady, 0, cloud?.recommended?.vision),
    'image-generation': cloudCandidates('image-generation', cloud?.models ?? [], cloudReady, 0, cloud?.recommended?.['image-generation']),
    stt: [
      candidate(
        'stt',
        'xopc-local',
        DEFAULT_LOCAL_VOICE_MODEL_ID,
        'installed-local',
        options.localSttReady ?? hasInstalledLocalVoiceModel(),
        0,
      ),
      ...cloudCandidates('stt', cloud?.models ?? [], cloudReady, 100, cloud?.recommended?.stt),
    ],
    tts: [
      ...cloudCandidates('tts', cloud?.models ?? [], cloudReady, 0, cloud?.recommended?.tts),
      candidate('tts', 'edge', 'edge', 'credentialless-fallback', true, 1_000),
    ],
  };

  return planCapabilities({ policies, automatic, catalogVersion: cloud?.etag });
}

function defaultProviderReady(providerId: string): boolean {
  if (providerId === 'edge') return true;
  if (providerId === 'xopc-local') return hasInstalledLocalVoiceModel();
  return isProviderConfiguredSync(providerId);
}

function refs(config: { primary: string; fallbacks?: string[] } | undefined) {
  if (!config) return undefined;
  return [config.primary, ...(config.fallbacks ?? [])]
    .map((ref) => parseModelRef(ref))
    .filter((ref): ref is NonNullable<typeof ref> => ref !== null);
}

function sttRefs(config: NonNullable<Config['tools']['media']>['audio']) {
  if (!config) return undefined;
  const modelRefs = [...(config.models ?? []), ...((config as { sharedModels?: typeof config.models }).sharedModels ?? [])]
    .filter((entry) => entry.capabilities?.includes('audio') !== false)
    .flatMap((entry) => entry.provider && entry.model ? [{ provider: entry.provider, model: entry.model }] : []);
  if (modelRefs.length > 0) return modelRefs;
  const provider = config.provider;
  const slice = config.providers?.[provider];
  const model = typeof slice?.model === 'string' ? slice.model : provider;
  return [{ provider, model }];
}

function ttsRefs(config: NonNullable<Config['messages']>['tts']) {
  if (!config) return undefined;
  const slice = config.providers?.[config.provider];
  const model = typeof slice?.model === 'string' ? slice.model : config.provider;
  const refs = [{ provider: config.provider, model }];
  if (config.fallback?.enabled) {
    for (const provider of config.fallback.order) {
      const fallbackSlice = config.providers?.[provider];
      refs.push({
        provider,
        model: typeof fallbackSlice?.model === 'string' ? fallbackSlice.model : provider,
      });
    }
  }
  return refs;
}

function markExplicitReadiness(
  policies: Record<CapabilityId, CapabilityPolicy>,
  catalog: ModelCatalogSnapshot,
  providerReady: (providerId: string) => boolean,
): void {
  for (const [capability, policy] of Object.entries(policies) as Array<[CapabilityId, CapabilityPolicy]>) {
    policy.explicit = policy.explicit?.map((entry) => {
      const ready = explicitReady(capability, entry.provider, entry.model, catalog, providerReady);
      return {
        ...entry,
        ready,
        reasons: ready ? [] : ['explicit_model_unavailable'],
      };
    });
  }
}

function explicitReady(
  capability: CapabilityId,
  provider: string,
  model: string,
  catalog: ModelCatalogSnapshot,
  providerReady: (providerId: string) => boolean,
): boolean {
  if (!providerReady(provider)) return false;
  if (provider !== 'xopc-cloud') return true;
  return (catalog.sources['xopc-cloud']?.models ?? []).some((entry) =>
    entry.id === model && matchesCapability(entry, capability));
}

function cloudCandidates(
  capability: CapabilityId,
  models: CatalogModel[],
  authorized: boolean,
  basePriority = 0,
  recommendedModel?: string,
): CapabilityCandidate[] {
  return models
    .filter((model) => model.availability === 'available' && matchesCapability(model, capability))
    .sort((left, right) => compareCatalogModels(left, right, recommendedModel))
    .map((model, index) => candidate(
      capability,
      'xopc-cloud',
      model.id,
      'xopc-cloud-managed',
      authorized,
      basePriority + index,
      {
        ...(model.tts?.defaultVoice ? { defaultVoice: model.tts.defaultVoice } : {}),
        ...(model.stability ? { stability: model.stability } : {}),
        ...(model.tier ? { tier: model.tier } : {}),
        ...(model.bestEffort !== undefined ? { bestEffort: model.bestEffort } : {}),
      },
    ));
}

function matchesCapability(model: CatalogModel, capability: CapabilityId): boolean {
  if (model.availability !== 'available') return false;
  switch (capability) {
    case 'vision':
      return model.kind === 'language' && model.input.includes('image');
    case 'image-generation':
      return model.kind === 'image' && model.operations.includes('images.generate');
    case 'stt':
      return model.kind === 'stt' && model.operations.includes('audio.transcription');
    case 'tts':
      return model.kind === 'tts'
        && model.operations.includes('audio.speech')
        && Boolean(model.tts?.defaultVoice);
  }
}

function candidate(
  capability: CapabilityId,
  provider: string,
  model: string,
  source: CandidateSource,
  ready: boolean,
  priority: number,
  metadata?: Record<string, unknown>,
): CapabilityCandidate {
  return {
    capability,
    provider,
    model,
    source,
    ready,
    priority,
    reasons: ready ? [] : [provider === 'xopc-cloud' ? 'oauth_not_connected' : 'provider_not_ready'],
    ...(metadata ? { metadata } : {}),
  };
}
