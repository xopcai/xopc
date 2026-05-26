/**
 * Registry-driven STT provider listing for gateway / Web UI discovery.
 */

import type { Config } from '../../config/schema.js';
import { mergeSttConfigFromAppConfig } from '../../channels/attachments/voice-stt-webchat.js';

import { resolveSTTProviderConfig } from './factory.js';
import type { STTConfig } from './types.js';
import { listMediaUnderstandingProviders } from '../../media-understanding/registry.js';

export interface SttProviderListEntry {
  id: string;
  aliases: string[];
  configured: boolean;
}

export interface SttProvidersPayload {
  providers: SttProviderListEntry[];
  active: string;
}

export function isSttProviderConfigured(providerId: string, config: STTConfig): boolean {
  return resolveSTTProviderConfig(providerId, config) !== null;
}

/** List registered audio STT providers with configured state for the current app config. */
export function listSttProvidersForApi(config: Config | undefined): SttProvidersPayload {
  const sttConfig = mergeSttConfigFromAppConfig(config?.tools?.media?.audio, config?.tools?.media);
  const providers: SttProviderListEntry[] = listMediaUnderstandingProviders()
    .filter(
      (plugin) =>
        plugin.capabilities?.includes('audio') && typeof plugin.transcribeAudio === 'function',
    )
    .map((plugin) => ({
      id: plugin.id,
      aliases: [...(plugin.aliases ?? [])],
      configured: isSttProviderConfigured(plugin.id, sttConfig),
    }));

  return {
    providers,
    active: sttConfig.provider,
  };
}
