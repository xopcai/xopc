import { isMaskedSecret } from '@/lib/is-masked-secret';

/** Minimal config shape for deciding if the user must configure providers / default model. */
export type GatewayModelSetupConfig = {
  agents: { defaults: { model: string } };
  providers: Record<string, string>;
};

/**
 * True when no provider is configured and/or default model is missing (first-launch / unusable chat).
 * Safe for partial/malformed API payloads (never throws).
 */
export function needsModelOrProviders(config: unknown): boolean {
  if (!config || typeof config !== 'object') return true;
  const c = config as Record<string, unknown>;

  const rawProviders = c.providers;
  const providers =
    rawProviders && typeof rawProviders === 'object' && !Array.isArray(rawProviders)
      ? (rawProviders as Record<string, unknown>)
      : {};
  const hasProvider = Object.values(providers).some(
    (v) => typeof v === 'string' && isMaskedSecret(v),
  );

  const agents = c.agents;
  let model = '';
  if (agents && typeof agents === 'object' && !Array.isArray(agents)) {
    const defaults = (agents as Record<string, unknown>).defaults;
    if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
      const m = (defaults as Record<string, unknown>).model;
      if (typeof m === 'string') model = m;
    }
  }
  const modelOk = model.trim().length > 0;
  return !hasProvider || !modelOk;
}
