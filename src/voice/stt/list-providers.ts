/**
 * Registry-driven STT provider listing for gateway / Web UI discovery.
 */

import type { Config } from '../../config/schema.js';
import { mergeSttConfigFromAppConfig } from '../../channels/attachments/voice-stt-webchat.js';
import { listMediaUnderstandingProviders } from '../../media-understanding/registry.js';
import { getVoiceProviderMetadata, type VoiceProviderMetadata } from '../metadata/index.js';

import { resolveSTTProviderConfig } from './factory.js';
import type { STTConfig } from './types.js';

export interface SttProviderListEntry extends VoiceProviderMetadata {
  aliases: string[];
  configured: boolean;
}

export interface SttProvidersPayload {
  providers: SttProviderListEntry[];
  active: string;
}

function fallbackMetadata(providerId: string, aliases: readonly string[]): VoiceProviderMetadata {
  return {
    id: providerId,
    capability: 'stt',
    displayName: providerId,
    aliases: [...aliases],
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', secret: true },
      { key: 'model', label: 'Model', type: 'string' },
      { key: 'baseUrl', label: 'Base URL', type: 'string' },
    ],
    diagnostics: {
      requiresApiKey: true,
      configPath: `tools.media.audio.providers.${providerId}`,
    },
  };
}

export function isSttProviderConfigured(providerId: string, config: STTConfig): boolean {
  return resolveSTTProviderConfig(providerId, config) !== null;
}

/** List registered audio STT providers with configured state and UI metadata. */
export function listSttProvidersForApi(config: Config | undefined): SttProvidersPayload {
  const sttConfig = mergeSttConfigFromAppConfig(config?.tools?.media?.audio, config?.tools?.media);
  const providers: SttProviderListEntry[] = listMediaUnderstandingProviders()
    .filter(
      (plugin) =>
        plugin.capabilities?.includes('audio') && typeof plugin.transcribeAudio === 'function',
    )
    .map((plugin) => {
      const metadata = getVoiceProviderMetadata('stt', plugin.id) ?? fallbackMetadata(plugin.id, plugin.aliases ?? []);
      return {
        ...metadata,
        aliases: [...(metadata.aliases ?? plugin.aliases ?? [])],
        configured: isSttProviderConfigured(plugin.id, sttConfig),
      };
    });

  return {
    providers,
    active: sttConfig.provider,
  };
}
