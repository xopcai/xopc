import { isMaskedKey, type ProviderMeta } from '@/features/settings/providers-api';
import type { WebSearchSettingsState } from '@/features/settings/web-search-config-api';
import type { ImageGenProviderCredentialSummary } from '@/features/settings/use-image-provider-credentials';
import type { VoiceSettingsState } from '@/features/settings/voice-settings.types';

export type CredentialDomainId = 'llm' | 'webSearch' | 'image' | 'voice';

export type CredentialDomainStatus = 'ready' | 'partial' | 'missing' | 'notNeeded';

export type CredentialDomainSummary = {
  id: CredentialDomainId;
  status: CredentialDomainStatus;
  detail: string;
  managePath: string;
};

function keyConfigured(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return isMaskedKey(value) || value.length > 0;
}

function llmDomain(
  providerMeta: ProviderMeta[],
  labels: CredentialsHubLabels,
): CredentialDomainSummary {
  const total = providerMeta.length;
  const configured = providerMeta.filter((p) => p.configured).length;
  let status: CredentialDomainStatus = 'missing';
  if (configured > 0) status = 'ready';

  const detail =
    total > 0
      ? labels.llmMetaReady(configured, total)
      : configured > 0
        ? labels.llmConfigured(configured)
        : labels.llmMissing;

  return { id: 'llm', status, detail, managePath: '/settings/capabilities/models' };
}

function webSearchDomain(
  webSearch: WebSearchSettingsState | null,
  labels: CredentialsHubLabels,
): CredentialDomainSummary {
  if (!webSearch) {
    return {
      id: 'webSearch',
      status: 'missing',
      detail: labels.webSearchNoProviders,
      managePath: '/settings/capabilities/search',
    };
  }

  const active = webSearch.providers.filter((p) => !p.disabled);
  if (active.length === 0) {
    return {
      id: 'webSearch',
      status: 'notNeeded',
      detail: labels.webSearchDisabled,
      managePath: '/settings/capabilities/search',
    };
  }
  const configured = active.filter((p) => keyConfigured(p.apiKey)).length;
  const total = active.length;

  let status: CredentialDomainStatus = 'missing';
  if (total === 0) status = 'missing';
  else if (configured === total) status = 'ready';
  else if (configured > 0) status = 'partial';

  return {
    id: 'webSearch',
    status,
    detail:
      total > 0
        ? labels.webSearchReady(configured, total)
        : labels.webSearchNoProviders,
    managePath: '/settings/capabilities/search',
  };
}

function imageDomain(
  imageProviders: ImageGenProviderCredentialSummary[],
  labels: CredentialsHubLabels,
): CredentialDomainSummary {
  const total = imageProviders.length;
  const configured = imageProviders.filter((p) => p.configured).length;

  let status: CredentialDomainStatus = 'missing';
  if (total === 0) status = 'notNeeded';
  else if (configured === total) status = 'ready';
  else if (configured > 0) status = 'partial';

  return {
    id: 'image',
    status,
    detail:
      total > 0
        ? labels.imageReady(configured, total)
        : labels.imageNoProviders,
    managePath: '/settings/capabilities/image',
  };
}

function voiceNeedsKey(provider: string): boolean {
  if (provider === 'edge' || provider === 'tts-local-cli') return false;
  return provider === 'openai' || provider === 'alibaba' || provider === 'minimax';
}

function sttNeedsKey(provider: string): boolean {
  return provider === 'openai' || provider === 'alibaba' || provider === 'groq';
}

function voiceProviderKey(voice: VoiceSettingsState, kind: 'stt' | 'tts'): string | undefined {
  if (kind === 'stt') {
    if (!voice.stt.enabled) return undefined;
    const p = voice.stt.provider;
    if (p === 'alibaba') return voice.stt.alibaba?.apiKey ?? voice.stt.providers?.alibaba?.apiKey as string | undefined;
    if (p === 'openai') return voice.stt.openai?.apiKey ?? voice.stt.providers?.openai?.apiKey as string | undefined;
    if (p === 'groq') return voice.stt.providers?.groq?.apiKey as string | undefined;
    const slice = voice.stt.providers?.[p];
    return typeof slice?.apiKey === 'string' ? slice.apiKey : undefined;
  }
  if (!voice.tts.enabled) return undefined;
  const p = voice.tts.provider;
  if (p === 'openai') return voice.tts.openai?.apiKey;
  if (p === 'alibaba') return voice.tts.alibaba?.apiKey;
  if (p === 'minimax') return voice.tts.minimax?.apiKey;
  return undefined;
}

function voiceDomain(
  voice: VoiceSettingsState | null,
  labels: CredentialsHubLabels,
): CredentialDomainSummary {
  if (!voice) {
    return {
      id: 'voice',
      status: 'missing',
      detail: labels.voiceMissing,
      managePath: '/settings/capabilities/voice',
    };
  }

  let needKeys = 0;
  let haveKeys = 0;

  if (voice.stt.enabled) {
    if (sttNeedsKey(voice.stt.provider)) {
      needKeys++;
      const key = voiceProviderKey(voice, 'stt');
      if (keyConfigured(key)) haveKeys++;
    }
  }

  if (voice.tts.enabled) {
    if (voiceNeedsKey(voice.tts.provider)) {
      needKeys++;
      const key = voiceProviderKey(voice, 'tts');
      if (keyConfigured(key)) haveKeys++;
    }
  }

  if (!voice.stt.enabled && !voice.tts.enabled) {
    return {
      id: 'voice',
      status: 'notNeeded',
      detail: labels.voiceDisabled,
      managePath: '/settings/capabilities/voice',
    };
  }

  if (needKeys === 0) {
    return {
      id: 'voice',
      status: 'ready',
      detail: labels.voiceReadyNoKeys,
      managePath: '/settings/capabilities/voice',
    };
  }

  let status: CredentialDomainStatus = 'missing';
  if (haveKeys === needKeys) status = 'ready';
  else if (haveKeys > 0) status = 'partial';

  return {
    id: 'voice',
    status,
    detail: labels.voiceKeysReady(haveKeys, needKeys),
    managePath: '/settings/capabilities/voice',
  };
}

export type CredentialsHubLabels = {
  llmMetaReady: (configured: number, total: number) => string;
  llmConfigured: (count: number) => string;
  llmMissing: string;
  webSearchDisabled: string;
  webSearchReady: (configured: number, total: number) => string;
  webSearchNoProviders: string;
  imageReady: (configured: number, total: number) => string;
  imageNoProviders: string;
  voiceDisabled: string;
  voiceReadyNoKeys: string;
  voiceKeysReady: (configured: number, total: number) => string;
  voiceMissing: string;
};

export function buildCredentialsHubSnapshot(input: {
  providerMeta: ProviderMeta[];
  webSearch: WebSearchSettingsState | null;
  imageProviders: ImageGenProviderCredentialSummary[];
  voice: VoiceSettingsState | null;
  labels: CredentialsHubLabels;
}): CredentialDomainSummary[] {
  return [
    llmDomain(input.providerMeta, input.labels),
    webSearchDomain(input.webSearch, input.labels),
    imageDomain(input.imageProviders, input.labels),
    voiceDomain(input.voice, input.labels),
  ];
}
