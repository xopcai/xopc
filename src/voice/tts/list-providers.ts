/**
 * Registry-driven TTS provider listing for gateway / Web UI discovery.
 */

import type { Config } from '../../config/schema.js';

import { resolveSpeechProvider } from './factory.js';
import { mergeTtsConfigFromAppConfig } from './merge-config.js';
import { listSpeechProviders } from './speech-registry.js';

export interface TtsProviderListEntry {
  id: string;
  aliases: string[];
  configured: boolean;
}

export interface TtsProvidersPayload {
  providers: TtsProviderListEntry[];
  active: string;
}

/** List registered speech providers with configured state for the current app config. */
export function listTtsProvidersForApi(config: Config | undefined): TtsProvidersPayload {
  const ttsConfig = mergeTtsConfigFromAppConfig(config?.messages?.tts);
  const providers: TtsProviderListEntry[] = listSpeechProviders().map((plugin) => ({
    id: plugin.id,
    aliases: [...(plugin.aliases ?? [])],
    configured: resolveSpeechProvider(plugin.id, ttsConfig) !== null,
  }));

  return {
    providers,
    active: ttsConfig.provider,
  };
}
