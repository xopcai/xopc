import { EXTENSION_PROVIDER_BASE_URL } from '../providers/constants.js';

import { PhoneModelMetadataSchema } from './contracts.js';

/** Native phone protocols stay explicit; ordinary visual tool models use function calls. */
export function phoneModelProfile(model: unknown) {
  if (!model || typeof model !== 'object') return undefined;
  const value = model as { provider?: string; baseUrl?: string; api?: string; input?: string[]; supportsTools?: boolean; phoneUse?: unknown; computerUse?: unknown };
  if (!Array.isArray(value.input) || !value.input.includes('image')) return undefined;
  const compatibleApi = value.api === 'openai-completions' || value.api === 'openai-responses';
  if (value.phoneUse !== undefined) {
    const metadata = PhoneModelMetadataSchema.safeParse(value.phoneUse);
    if (!metadata.success) return undefined;
    return metadata.data.profile === 'structured-tools-phone-v1'
      ? compatibleApi && value.supportsTools !== false ? metadata.data.profile : undefined
      : value.api === 'openai-completions' ? metadata.data.profile : undefined;
  }
  // Managed services and dedicated desktop models must declare phone support themselves.
  if (value.provider === 'xopc-cloud' || value.baseUrl === EXTENSION_PROVIDER_BASE_URL || value.computerUse || value.supportsTools === false) return undefined;
  return compatibleApi ? 'structured-tools-phone-v1' as const : undefined;
}

/** Generic visual models remain eligible for ordinary chat and vision pickers. */
export function isDedicatedPhoneModel(model: unknown): boolean {
  const value = model as { phoneUse?: { profile?: unknown } } | undefined;
  return Boolean(value?.phoneUse && phoneModelProfile(model) && value.phoneUse.profile !== 'structured-tools-phone-v1');
}
