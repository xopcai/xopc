import type {
  CapabilityCandidate,
  CapabilityId,
  CapabilityPlan,
  CapabilityPlannerInput,
} from './types.js';

const CAPABILITIES: CapabilityId[] = ['vision', 'image-generation', 'stt', 'tts'];

export function planCapabilities(input: CapabilityPlannerInput): Record<CapabilityId, CapabilityPlan> {
  return Object.fromEntries(CAPABILITIES.map((capability) => [
    capability,
    planCapability(capability, input),
  ])) as Record<CapabilityId, CapabilityPlan>;
}

export function planCapability(
  capability: CapabilityId,
  input: CapabilityPlannerInput,
): CapabilityPlan {
  const policy = input.policies[capability];
  if (policy.disabled) {
    return {
      capability,
      status: 'disabled',
      fallbacks: [],
      rejected: [],
      selectionSource: 'none',
      catalogVersion: input.catalogVersion,
    };
  }

  const explicit = (policy.explicit ?? []).map((entry, index): CapabilityCandidate => ({
    capability,
    provider: entry.provider,
    model: entry.model,
    source: 'explicit-config',
    ready: entry.ready ?? true,
    priority: index,
    reasons: entry.reasons ?? (entry.ready === false ? ['explicit_model_unavailable'] : []),
  }));
  const automatic = [...(input.automatic[capability] ?? [])]
    .sort((left, right) => left.priority - right.priority
      || left.provider.localeCompare(right.provider)
      || left.model.localeCompare(right.model));
  const candidates = dedupeCandidates([...explicit, ...automatic]);
  const ready = candidates.filter((candidate) => candidate.ready);
  const rejected = candidates.filter((candidate) => !candidate.ready);
  const primary = ready[0];
  const explicitRejected = rejected.some((candidate) => candidate.source === 'explicit-config');

  return {
    capability,
    status: primary ? explicitRejected ? 'degraded' : 'ready' : 'unavailable',
    ...(primary ? { primary } : {}),
    fallbacks: ready.slice(1),
    rejected,
    selectionSource: primary?.source ?? 'none',
    catalogVersion: input.catalogVersion,
  };
}

function dedupeCandidates(candidates: CapabilityCandidate[]): CapabilityCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.provider}/${candidate.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
