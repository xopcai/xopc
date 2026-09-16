import { createHash } from 'node:crypto';
import type { VoiceSelection, VoiceSettingsCatalog } from '@xopcai/realtime-protocol/voice';
import { ConfigSchema, type Config } from '../config/schema.js';
import { getModelCatalogStore } from '../providers/model-catalog-store.js';
import { requirePlatformVoiceModel } from './platform-catalog.js';

export function voiceSettingsCatalog(config: Config): VoiceSettingsCatalog {
  const source = getModelCatalogStore().getSource('xopc-cloud');
  const selections: VoiceSelection[] = [];
  const add = (mode: VoiceSelection['mode'], slice: { provider?: string; model?: string; voice?: string } | undefined) => {
    if (slice?.provider === 'xopc-cloud' && slice.model) selections.push({ mode, model: slice.model, ...(slice.voice ? { voice: slice.voice } : {}) });
  };
  const audio = config.tools?.media?.audio;
  const tts = config.messages?.tts;
  add('transcription', { ...audio?.providers?.['xopc-cloud'], provider: audio?.provider } as Parameters<typeof add>[1]);
  add('speech', { ...tts?.providers?.['xopc-cloud'], provider: tts?.provider } as Parameters<typeof add>[1]);
  add('transcription.stream', config.voice?.realtime?.stt);
  add('speech.stream', config.voice?.realtime?.tts);
  add('conversation', config.voice?.realtime?.omni);
  const revision = createHash('sha256').update(JSON.stringify([config.voice, audio, tts])).digest('hex');
  return { revision, catalogVersion: source?.etag ?? null, selections,
    models: (source?.models ?? []).flatMap(model => model.availability === 'available' && model.voice ? [{id: model.id, name: model.name, voice: model.voice}] : []) };
}

export function selectPlatformVoice(config: Config, selection: VoiceSelection): Config {
  const model = requirePlatformVoiceModel(selection.model, selection.mode);
  const output = selection.mode === 'speech' || selection.mode === 'speech.stream' || selection.mode === 'conversation';
  const voice = selection.voice ?? model.voice.defaultVoice ?? model.voice.voices[0]?.id;
  if (output && (!voice || !model.voice.voices.some(item => item.id === voice))) throw new Error('Choose an available model voice');
  const next = structuredClone(config);
  const selected = { provider: 'xopc-cloud' as const, model: selection.model, ...(output ? {voice} : {}) };
  if (selection.mode === 'transcription') {
    next.tools.media ??= {};
    const audio = next.tools.media.audio ?? {enabled: true, provider: 'xopc-cloud', fallback: {enabled: false, order: []}, providers: {}};
    next.tools.media.audio = { ...audio, enabled: true, provider: 'xopc-cloud', providers: { ...audio.providers, 'xopc-cloud': { ...audio.providers?.['xopc-cloud'], model: selection.model } } };
  } else if (selection.mode === 'speech') {
    next.messages ??= {};
    const tts = next.messages.tts ?? {enabled: true, provider: 'xopc-cloud', trigger: 'off' as const, maxTextLength: 4000, timeoutMs: 30000, providers: {}};
    next.messages.tts = { ...tts, enabled: true, provider: 'xopc-cloud', providers: { ...tts.providers, 'xopc-cloud': { ...tts.providers?.['xopc-cloud'], model: selection.model, voice } } };
  } else {
    next.voice = ConfigSchema.parse({...next, voice: next.voice ?? {}}).voice;
    next.voice.realtime.enabled = true;
    if (selection.mode === 'transcription.stream') next.voice.realtime.stt = selected;
    if (selection.mode === 'speech.stream') next.voice.realtime.tts = selected;
    if (selection.mode === 'conversation') next.voice.realtime.omni = { ...selected, voice: voice!, instructions: next.voice.realtime.omni?.instructions ?? 'Keep replies conversational and concise. You cannot execute tools.' };
  }
  return ConfigSchema.parse(next);
}
