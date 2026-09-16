import { ComputerProfileSchema } from '@xopcai/computer-control-contract';

/** Shared by discovery, configuration validation and execution. Vision alone is insufficient. */
export function computerModelProfile(model: unknown) {
  if (!model || typeof model !== 'object') return undefined;
  const value = model as { api?: unknown; input?: unknown; computerUse?: { profile?: unknown } };
  if (value.api !== 'openai-completions' || !Array.isArray(value.input) || !value.input.includes('image')) return undefined;
  const profile = ComputerProfileSchema.safeParse(value.computerUse?.profile);
  return profile.success ? profile.data : undefined;
}

export function isComputerModel(model: unknown): boolean {
  return computerModelProfile(model) !== undefined;
}
