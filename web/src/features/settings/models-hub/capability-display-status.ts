export type CapabilityId = 'vision' | 'image-generation' | 'stt' | 'tts' | 'computer-use';

export interface CapabilityReadinessPayload {
  capabilities: Record<CapabilityId, {
    status: 'ready' | 'degraded' | 'unavailable' | 'disabled';
    selectionSource: string;
    primary?: { provider: string; model: string };
    rejected?: Array<{ provider: string; model: string }>;
  }>;
}

export type CapabilityDisplayStatus = 'ready' | 'off' | 'not-configured' | 'degraded' | 'misconfigured';

export function deriveCapabilityDisplayStatus(
  plan: CapabilityReadinessPayload['capabilities'][CapabilityId],
): CapabilityDisplayStatus {
  if (plan.status === 'ready') return 'ready';
  if (plan.status === 'disabled') return 'off';
  if (plan.status === 'degraded') return 'degraded';
  return plan.rejected?.length ? 'misconfigured' : 'not-configured';
}
