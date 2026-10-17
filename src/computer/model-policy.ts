import { ComputerProfileSchema } from '@xopcai/computer-control-contract';
import { z } from 'zod';
import { EXTENSION_PROVIDER_BASE_URL } from '../providers/constants.js';

/** Service ceilings are advisory metadata; the server still enforces account quotas. */
export const ComputerServiceLimitsSchema = z.object({
  maxOutputTokens: z.number().int().positive(),
  requestsPerMinute: z.number().int().positive().optional(),
  concurrentRequests: z.number().int().positive().optional(),
  requestsPerDay: z.number().int().positive().optional(),
  tokensPerDay: z.number().int().positive().optional(),
  maxInputTokens: z.number().int().positive().optional(),
});
export type ComputerServiceLimits = z.infer<typeof ComputerServiceLimitsSchema>;

/** OpenAI-compatible language APIs support function tools unless explicitly disabled. */
export function computerModelProfile(model: unknown) {
  if (!model || typeof model !== 'object') return undefined;
  const value = model as { provider?: string; baseUrl?: string; api?: unknown; input?: unknown; supportsTools?: boolean; computerUse?: { profile?: unknown } };
  if (!Array.isArray(value.input) || !value.input.includes('image')) return undefined;
  if (value.computerUse) {
    const profile = ComputerProfileSchema.safeParse(value.computerUse.profile);
    if (!profile.success) return undefined;
    const compatible = profile.data === 'structured-tools-v1'
      ? value.api === 'openai-completions' || value.api === 'openai-responses'
      : value.api === (profile.data === 'openai-responses-computer-v1' ? 'openai-responses' : 'openai-completions');
    return compatible ? profile.data : undefined;
  }
  // Managed catalog and extension entries must declare their own supported protocol.
  if (value.provider === 'xopc-cloud' || value.baseUrl === EXTENSION_PROVIDER_BASE_URL || value.supportsTools === false) return undefined;
  return value.api === 'openai-completions' || value.api === 'openai-responses' ? 'structured-tools-v1' : undefined;
}

export function isComputerModel(model: unknown): boolean {
  return computerModelProfile(model) !== undefined;
}

/** Dedicated GUI models should not displace general-purpose models from chat and vision choices. */
export function isDedicatedComputerModel(model: unknown): boolean {
  const explicit = model as { computerUse?: { profile?: unknown } } | undefined;
  return Boolean(computerModelProfile(model) && isDedicatedComputerProfile(explicit?.computerUse?.profile));
}

export function isDedicatedComputerProfile(profile: unknown): boolean {
  return profile === 'gui-plus-2026-02-26' || profile === 'structured-tools-v1';
}
