/**
 * Registry-driven TTS provider listing for gateway / Web UI discovery.
 */

import type { Config } from '../../config/schema.js';
import { getVoiceProviderMetadata, type VoiceProviderMetadata } from '../metadata/index.js';

import { resolveSpeechProvider } from './factory.js';
import { mergeTtsConfigFromAppConfig } from './merge-config.js';
import { listSpeechProviders } from './speech-registry.js';

export interface TtsProviderListEntry extends VoiceProviderMetadata {
  aliases: string[];
  configured: boolean;
}

export interface TtsProvidersPayload {
  providers: TtsProviderListEntry[];
  active: string;
}

function fallbackMetadata(providerId: string, aliases: readonly string[]): VoiceProviderMetadata {
  return {
    id: providerId,
    capability: 'tts',
    displayName: providerId,
    aliases: [...aliases],
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', secret: true },
      { key: 'model', label: 'Model', type: 'string' },
      { key: 'voice', label: 'Voice', type: 'string' },
    ],
    diagnostics: {
      requiresApiKey: true,
      configPath: `messages.tts.providers.${providerId}`,
    },
  };
}

/** List registered speech providers with configured state and UI metadata. */
export function listTtsProvidersForApi(config: Config | undefined): TtsProvidersPayload {
  const ttsConfig = mergeTtsConfigFromAppConfig(config?.messages?.tts);
  const providers: TtsProviderListEntry[] = listSpeechProviders().map((plugin) => {
    const metadata = getVoiceProviderMetadata('tts', plugin.id) ?? fallbackMetadata(plugin.id, plugin.aliases ?? []);
    return {
      ...metadata,
      aliases: [...(metadata.aliases ?? plugin.aliases ?? [])],
      configured: resolveSpeechProvider(plugin.id, ttsConfig) !== null,
    };
  });

  return {
    providers,
    active: ttsConfig.provider,
  };
}
