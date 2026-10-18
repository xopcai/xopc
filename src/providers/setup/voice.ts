import { createHash } from 'node:crypto';
import type { ModelSetupUse } from '@xopcai/gateway-contract';
import { voiceSupportsMode } from '@xopcai/realtime-protocol/voice';

import { listSttProvidersForApi } from '../../voice/stt/list-providers.js';
import { listTtsProvidersForApi } from '../../voice/tts/list-providers.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import { compareCatalogModels } from '../model-catalog-ranking.js';
import { getModelCatalogStore } from '../model-catalog-store.js';
import { selectPlatformVoice } from '../../voice/platform-settings.js';
import { BAILIAN_PLAN_HOST, BAILIAN_PLAN_PROVIDER, BAILIAN_PLAN_TTS_MODEL, BAILIAN_PLAN_TTS_VOICE,
  BAILIAN_PLAN_STT_MODEL, BAILIAN_PLAN_OMNI_MODEL, BAILIAN_PLAN_OMNI_VOICE } from '../../voice/token-plan.js';

export type VoiceSetupUse = Extract<ModelSetupUse, 'speech' | 'transcription' | 'conversation'>;
export type SetupVoiceModel = { ref: string; name: string; provider: string; model: string; voice?: string; recommended?: boolean };
export type SetupVoiceState = { revision: string; current: Partial<Record<VoiceSetupUse, string>>; choices: Record<VoiceSetupUse, SetupVoiceModel[]> };
export const voiceSetupUses: VoiceSetupUse[] = ['transcription', 'speech', 'conversation'];

export function readSetupVoiceState(provider: string, config: Config): SetupVoiceState {
  const tts = config.messages?.tts; const stt = config.tools.media?.audio; const omni = config.voice?.realtime?.omni;
  const choices: SetupVoiceState['choices'] = { speech: [], transcription: [], conversation: [] };
  if (provider === BAILIAN_PLAN_PROVIDER) {
    choices.speech.push({ ref: `${provider}/${BAILIAN_PLAN_TTS_MODEL}`, name: 'Qwen Audio 3.0 TTS Plus', provider, model: BAILIAN_PLAN_TTS_MODEL, voice: BAILIAN_PLAN_TTS_VOICE });
    choices.transcription.push({ ref: `${provider}/${BAILIAN_PLAN_STT_MODEL}`, name: 'Qwen Audio 3.0 ASR Flash', provider, model: BAILIAN_PLAN_STT_MODEL });
    choices.conversation.push({ ref: `${provider}/${BAILIAN_PLAN_OMNI_MODEL}`, name: 'Qwen Audio 3.0 Realtime Plus', provider, model: BAILIAN_PLAN_OMNI_MODEL, voice: BAILIAN_PLAN_OMNI_VOICE });
  } else if (provider === 'xopc-cloud') {
    const source = getModelCatalogStore().getSource(provider);
    for (const model of source?.models ?? []) {
      if (model.availability !== 'available' || !model.voice) continue;
      for (const use of voiceSetupUses) {
        const kind = { speech: 'tts', transcription: 'stt', conversation: 'omni' }[use];
        if (model.kind !== kind) continue;
        if (!model.voice.modes.includes(use)) continue;
        const voice = use === 'transcription' ? undefined : model.voice.voices.find(voice => voice.id === model.voice?.defaultVoice && voiceSupportsMode(voice, use))?.id
          ?? model.voice.voices.find(voice => voiceSupportsMode(voice, use))?.id;
        if (use !== 'transcription' && !voice) continue;
        choices[use].push({ ref: `${provider}/${model.id}`, name: model.name, provider, model: model.id, ...(voice ? { voice } : {}),
          recommended: source?.recommended?.[model.kind] === model.id });
      }
    }
    for (const use of voiceSetupUses) {
      const candidates = choices[use];
      const recommendation = use === 'conversation' ? undefined : source?.recommended?.[use === 'speech' ? 'tts' : 'stt'];
      candidates.sort((left, right) => {
        const a = source!.models.find(entry => entry.id === left.model)!;
        const b = source!.models.find(entry => entry.id === right.model)!;
        return compareCatalogModels(a, b, recommendation);
      });
      if (candidates[0]) candidates[0].recommended = true;
    }
  }
  if (provider !== BAILIAN_PLAN_PROVIDER && provider !== 'xopc-cloud') {
    for (const [use, entries] of [
      ['transcription', listSttProvidersForApi(config).providers],
      ['speech', listTtsProvidersForApi(config).providers],
    ] as const) {
      const entry = entries.find(entry => entry.id === provider && entry.configured);
      if (!entry) continue;
      const configured = use === 'speech' ? tts?.providers?.[provider] : stt?.providers?.[provider];
      const models = entry.models?.length ? entry.models : [{ id: String(configured?.model ?? 'default'), name: entry.displayName }];
      const currentModel = configured?.model ?? entry.fields.find(field => field.key === 'model')?.defaultValue ?? models[0]?.id;
      const voiceDefault = entry.fields.find(field => field.key === 'voice')?.defaultValue;
      const defaultVoice = typeof voiceDefault === 'string' ? voiceDefault : entry.voices?.[0]?.id;
      for (const model of models) choices[use].push({ ref: `${provider}/${model.id}`, name: model.name, provider, model: model.id,
        ...(use === 'speech' ? { voice: currentModel === model.id && typeof configured?.voice === 'string' ? configured.voice : defaultVoice } : {}) });
    }
  }
  const current: SetupVoiceState['current'] = {};
  if (tts?.provider) current.speech = `${tts.provider}/${tts.providers?.[tts.provider]?.model ?? 'default'}`;
  if (stt?.provider) current.transcription = `${stt.provider}/${stt.providers?.[stt.provider]?.model ?? 'default'}`;
  if (omni) current.conversation = `${omni.provider}/${omni.model}`;
  return { current, choices, revision: createHash('sha256').update(JSON.stringify([tts, stt, config.voice, choices])).digest('hex') };
}

/** Voice lives in the existing app configuration; never copy the provider secret. */
export function applySetupVoice(config: Config, assignments: Array<{ use: VoiceSetupUse; model: SetupVoiceModel }>): Config {
  let next = structuredClone(config);
  for (const { use, model } of assignments) {
    if (model.provider === 'xopc-cloud') {
      next = selectPlatformVoice(next, { mode: use, model: model.model, ...(model.voice ? { voice: model.voice } : {}) });
      const streamMode = use === 'speech' ? 'speech.stream' : use === 'transcription' ? 'transcription.stream' : undefined;
      if (streamMode) {
        const source = getModelCatalogStore().getSource('xopc-cloud');
        const stream = source?.models.filter(entry => entry.availability === 'available' && entry.voice?.modes.includes(streamMode)
          && (use === 'transcription' || entry.voice.voices.some(voice => voiceSupportsMode(voice, streamMode))))
          .sort((left, right) => compareCatalogModels(left, right, model.model))[0];
        if (stream) next = selectPlatformVoice(next, { mode: streamMode, model: stream.id });
      }
    }
    else if (model.provider === BAILIAN_PLAN_PROVIDER) {
      if (use === 'speech') {
        const current = next.messages?.tts;
        const previous = current?.providers?.[model.provider];
        const voice = (!previous?.model || previous.model === model.model) && typeof previous?.voice === 'string' ? previous.voice : model.voice;
        next.messages ??= {};
        next.messages.tts = { enabled: true, provider: model.provider, trigger: 'off', maxTextLength: 512, timeoutMs: 60000, ...current,
          providers: { ...current?.providers, [model.provider]: { ...previous, model: model.model, voice } } };
        next.messages.tts.provider = model.provider;
        next.messages.tts.enabled = true;
      } else if (use === 'transcription') {
        next.tools.media ??= {};
        const current = next.tools.media.audio;
        next.tools.media.audio = { ...current, enabled: true, provider: model.provider, fallback: { enabled: false, order: [] },
          models: [{ provider: model.provider, model: model.model, capabilities: ['audio'] }],
          providers: { ...current?.providers, [model.provider]: { ...current?.providers?.[model.provider], model: model.model } } };
      } else {
        next = ConfigSchema.parse({ ...next, voice: next.voice ?? {} });
        next.voice!.realtime.enabled = true;
        next.voice!.realtime.omni = { provider: BAILIAN_PLAN_PROVIDER, model: model.model, voice: model.voice!,
          baseUrl: `${BAILIAN_PLAN_HOST.replace('https:', 'wss:')}/api-ws/v1/realtime`, instructions: next.voice?.realtime.omni?.instructions ?? 'Keep replies conversational and concise. You cannot execute tools.' };
      }
    } else if (use === 'speech') {
      const current = next.messages?.tts;
      next.messages ??= {};
      next.messages.tts = { enabled: true, trigger: 'off', maxTextLength: 512, timeoutMs: 60000, ...current,
        provider: model.provider, providers: { ...current?.providers, [model.provider]: { ...current?.providers?.[model.provider], model: model.model, ...(model.voice ? { voice: model.voice } : {}) } } };
      next.messages.tts.enabled = true;
    } else if (use === 'transcription') {
      next.tools.media ??= {};
      const current = next.tools.media.audio;
      next.tools.media.audio = { ...current, enabled: true, provider: model.provider,
        providers: { ...current?.providers, [model.provider]: { ...current?.providers?.[model.provider], model: model.model } } };
    } else throw new Error('No realtime voice configuration binding for this provider');
    if (use === 'speech' && next.messages?.tts) next.messages.tts.fallback = { enabled: false, order: [] };
    if (use === 'conversation' && next.voice) next.voice.realtime.defaultEngine = 'omni';
    if (use === 'transcription' && next.tools.media?.audio) {
      next.tools.media.audio.fallback = { enabled: false, order: [] };
      next.tools.media.audio.models = [{ provider: model.provider, model: model.model, capabilities: ['audio'] }];
    }
  }
  return ConfigSchema.parse(next);
}
