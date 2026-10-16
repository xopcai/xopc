import { afterEach, describe, expect, it } from 'vitest';
import { voiceFixture } from '../../../voice/__tests__/voice-fixture.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../model-catalog-store.js';
import { ConfigSchema } from '../../../config/schema.js';
import { AgentDefaultsSchema } from '../../../agent-config/index.js';
import { previewProviderSetup, applyProviderSetup, type SetupSnapshot } from '../engine.js';
import { getProviderSetupProfile } from '../profiles.js';
import { readSetupVoiceState, applySetupVoice } from '../voice.js';

const provider = 'qwen-token-plan-cn';
function snapshot(config = ConfigSchema.parse({})): SetupSnapshot {
  return { profile: getProviderSetupProfile(provider), configured: true, configuredProviders: new Set([provider]),
    defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'existing/chat', fallbacks: [] } } }), models: [], images: [], voice: readSetupVoiceState(provider, config) };
}
describe('shared voice setup', () => {
  afterEach(() => resetModelCatalogStore());
  it('uses the same setup engine for account-discovered Cloud voice models', () => {
    getModelCatalogStore().replaceSourceModels('xopc-cloud', { providerId:'xopc-cloud',baseUrl:'https://test/v1',api:'openai-completions',etag:null,recommendedModel:null,lastSuccessAt:1 },
      (['tts','stt','omni'] as const).map(kind => ({id:`voice-${kind}`,name:kind,kind,input:['audio'],output:['text','audio'],operations:['audio.transcriptions','audio.speech'],reasoning:false,contextWindow:0,maxOutputTokens:null,
        voice:voiceFixture([kind === 'tts' ? 'speech' : kind === 'stt' ? 'transcription' : 'conversation'])})));
    const config = ConfigSchema.parse({});
    const data = snapshot(config); data.profile = getProviderSetupProfile('xopc-cloud'); data.voice = readSetupVoiceState('xopc-cloud',config);
    const preview = previewProviderSetup(data);
    expect(preview.uses.filter(use => use.selected).map(use => use.id)).toEqual(['transcription','speech','conversation']);
    const next = applySetupVoice(config,applyProviderSetup(data,{},preview.revision).voiceAssignments);
    expect(next.messages?.tts?.provider).toBe('xopc-cloud');
    expect(next.voice?.realtime.omni).toMatchObject({provider:'xopc-cloud',model:'voice-omni',voice:'voice-a'});
  });
  it('previews three supported subscription voice uses and applies them with one shared credential binding', () => {
    const config = ConfigSchema.parse({}); const data = snapshot(config);
    const request = { selected: ['speech','transcription','conversation'] as const };
    const preview = previewProviderSetup(data, {selected:[...request.selected]});
    const applied = applyProviderSetup(data, {selected:[...request.selected]}, preview.revision);
    const next = applySetupVoice(config, applied.voiceAssignments);
    expect(next.messages?.tts).toMatchObject({ provider, trigger: 'off', fallback: { enabled: false, order: [] } });
    expect(next.tools.media?.audio).toMatchObject({ provider, models: [{ provider, model: 'qwen-audio-3.0-asr-flash' }], fallback: { enabled: false, order: [] } });
    expect(next.voice?.realtime.omni).toMatchObject({ provider, model:'qwen-audio-3.0-realtime-plus', voice: 'longanqian' });
    expect(JSON.stringify(next)).not.toContain('apiKey');
    expect(applied.defaults).toEqual(data.defaults);
  });
  it('preserves existing voice choices, disabled settings and voices in fill mode', () => {
    const config = ConfigSchema.parse({ messages: { tts: { enabled: false, provider: 'alibaba', trigger: 'inbound', providers: { alibaba: { model:'old-model', voice:'Cherry' } } } },
      tools: { media: { audio: { enabled: false, provider: 'openai' } } },
    });
    const data = snapshot(config); const preview = previewProviderSetup(data);
    expect(preview.uses.find(use => use.id === 'speech')?.selected).toBe(false);
    expect(preview.uses.find(use => use.id === 'transcription')?.selected).toBe(false);
    const next = applySetupVoice(config, applyProviderSetup(data, {}, preview.revision).voiceAssignments);
    expect(next.messages).toEqual(config.messages); expect(next.tools.media).toEqual(config.tools.media);
  });
  it('uses a voice revision for concurrent config changes and changes only the selected voice use', () => {
    const config = ConfigSchema.parse({ messages: { tts: { provider:'edge', trigger:'always' } } });
    const data = snapshot(config); const revision = previewProviderSetup(data).revision;
    const next = applySetupVoice(config, applyProviderSetup(data, { mode:'replace',selected:['transcription'] }, revision).voiceAssignments);
    expect(next.messages).toEqual(config.messages);
    data.voice = readSetupVoiceState(provider, next);
    expect(previewProviderSetup(data).revision).not.toBe(revision);
  });
});
