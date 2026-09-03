import { createHash } from 'node:crypto';

import type { MobilePrivacyDisclosure, MobilePrivacyRecipient } from '@xopcai/gateway-contract';

import type { Config } from '../config/schema.js';
import { getAvailableModels, PROVIDER_META } from '../providers/index.js';
import { getProviderRegistry } from '../providers/plugin-registry.js';
import { getVoiceProviderMetadata } from '../voice/metadata/index.js';
import { mergeSttConfigFromAppConfig } from '../voice/stt/config.js';
import { resolveSTTProviderChain } from '../voice/stt/factory.js';
import { resolveSpeechProviderChain } from '../voice/tts/factory.js';
import { mergeTtsConfigFromAppConfig } from '../voice/tts/merge-config.js';
import { getImageGenerationCatalog } from './image-generation-setup.js';

/** Only expose origins: provider URLs can contain credentials, query tokens and tenant paths. */
export function privacyRecipientOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function buildMobilePrivacyDisclosure(recipients: MobilePrivacyRecipient[]): MobilePrivacyDisclosure {
  const unique = new Map<string, MobilePrivacyRecipient>();
  for (const recipient of recipients) {
    const safe = {
      id: recipient.id,
      name: recipient.name,
      capability: recipient.capability,
      ...(privacyRecipientOrigin(recipient.origin) ? { origin: privacyRecipientOrigin(recipient.origin) } : {}),
    };
    unique.set(JSON.stringify(safe), safe);
  }
  const sorted = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  return {
    version: 1,
    revision: createHash('sha256').update(JSON.stringify({ version: 1, recipients: sorted })).digest('hex'),
    recipients: sorted,
  };
}

/** Catalog of potential recipients, including configured fallbacks, without content or credentials. */
export async function getMobilePrivacyDisclosure(config: Config): Promise<MobilePrivacyDisclosure> {
  const recipients: MobilePrivacyRecipient[] = [];
  const registry = getProviderRegistry();
  for (const model of await getAvailableModels()) {
    recipients.push({
      id: model.provider,
      name: registry.get(model.provider)?.name ?? PROVIDER_META[model.provider]?.name ?? model.provider,
      capability: 'model',
      origin: privacyRecipientOrigin(model.baseUrl),
    });
  }
  const stt = mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media);
  for (const provider of resolveSTTProviderChain(stt)) {
    recipients.push({
      id: provider.id,
      name: getVoiceProviderMetadata('stt', provider.id)?.displayName ?? provider.id,
      capability: 'transcription',
      origin: privacyRecipientOrigin(provider.baseUrl),
    });
  }
  const tts = mergeTtsConfigFromAppConfig(config.messages?.tts);
  if (tts.enabled) {
    // An unavailable speech chain has no recipients; other catalog failures remain fatal.
    let speech: ReturnType<typeof resolveSpeechProviderChain> = [];
    try { speech = resolveSpeechProviderChain(tts); } catch { /* no available speech providers */ }
    for (const provider of speech) {
      recipients.push({
        id: provider.providerId,
        name: getVoiceProviderMetadata('tts', provider.providerId)?.displayName ?? provider.providerId,
        capability: 'speech',
        origin: privacyRecipientOrigin(provider.providerConfig.baseUrl),
      });
    }
  }
  for (const provider of getImageGenerationCatalog(config).filter((entry) => entry.configured)) {
    recipients.push({ id: provider.id, name: provider.label, capability: 'image', origin: privacyRecipientOrigin(provider.config.baseUrl) });
  }
  for (const provider of config.tools?.web?.search?.providers ?? []) {
    if (!provider.disabled) recipients.push({ id: provider.type, name: provider.type, capability: 'search', origin: privacyRecipientOrigin(provider.url) });
  }
  recipients.push(
    { id: 'bing-html', name: 'Microsoft Bing', capability: 'search', origin: 'https://cn.bing.com' },
    { id: 'duckduckgo-html', name: 'DuckDuckGo', capability: 'search', origin: 'https://html.duckduckgo.com' },
  );
  return buildMobilePrivacyDisclosure(recipients);
}
