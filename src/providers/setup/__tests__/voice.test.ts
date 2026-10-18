import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('projects native voice candidates from their own credentials and preserves other uses', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const config = ConfigSchema.parse({ tools: { media: { audio: { enabled: false, provider: 'openai', providers: { openai: { apiKey: 'fixture-native-key', model: 'whisper-1' } } } } }, messages: { tts: { enabled: false, provider: 'edge' } } });
    const native = readSetupVoiceState('openai', config);
    expect(native.choices.transcription.length).toBeGreaterThan(0);
    expect(native.choices.speech).toEqual([]);
    const model = native.choices.transcription[0]!;
    const next = applySetupVoice(config, [{ use: 'transcription', model }]);
    expect(next.tools.media?.audio?.providers?.openai?.apiKey).toBe('fixture-native-key');
    expect(next.tools.media?.audio?.fallback).toEqual({ enabled: false, order: [] });
    expect(next.messages).toEqual(config.messages);
    expect(next.voice).toEqual(config.voice);
    const edge = readSetupVoiceState('edge', config);
    expect(edge.choices.speech.length).toBeGreaterThan(0);
    expect(edge.choices.conversation).toEqual([]);
    expect(readSetupVoiceState('openai', ConfigSchema.parse({})).choices.transcription).toEqual([]);
  });
  afterEach(() => { resetModelCatalogStore(); vi.unstubAllEnvs(); });
  it('retains saved subscription parameters when re-enabling the same models', () => {
    const config = ConfigSchema.parse({ messages: { tts: { enabled: false, provider, providers: { [provider]: { model:'qwen-audio-3.0-tts-plus', voice:'saved-voice', speed:1.2 } } } }, tools: {media:{audio:{enabled:false,provider,providers:{[provider]:{model:'qwen-audio-3.0-asr-flash',language:'zh',prompt:'Saved prompt'}}}}} });
    const voice = readSetupVoiceState(provider, config);
    const next = applySetupVoice(config, [{use:'speech',model:voice.choices.speech[0]!}, {use:'transcription',model:voice.choices.transcription[0]!}]);
    expect(next.messages?.tts?.providers?.[provider]).toMatchObject({voice:'saved-voice',speed:1.2});
    expect(next.tools.media?.audio?.providers?.[provider]).toMatchObject({language:'zh',prompt:'Saved prompt'});
    expect(next.messages?.tts?.enabled).toBe(true);
    expect(next.tools.media?.audio?.enabled).toBe(true);
  });
  it('does not carry a native voice choice into a different model', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const config = ConfigSchema.parse({messages:{tts:{provider:'openai',providers:{openai:{apiKey:'fixture',model:'gpt-4o-mini-tts',voice:'coral'}}}}});
    const choices = readSetupVoiceState('openai',config).choices.speech;
    expect(choices.find(choice => choice.model === 'gpt-4o-mini-tts')?.voice).toBe('coral');
    expect(choices.find(choice => choice.model === 'tts-1')?.voice).not.toBe('coral');
  });
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
  it('recommends a stable available Cloud voice when several models have no explicit recommendation', () => {
    getModelCatalogStore().replaceSourceModels('xopc-cloud', { providerId: 'xopc-cloud', baseUrl: 'https://test/v1', api: 'openai-completions', etag: null, recommendedModel: null, lastSuccessAt: 1 },
      ['preview', 'stable'].map(id => ({ id, name: id, kind: 'tts', input: ['text'], output: ['audio'], operations: ['audio.speech'], reasoning: false,
        contextWindow: 0, maxOutputTokens: null, stability: id === 'preview' ? 'preview' : 'stable', voice: voiceFixture(['speech', 'speech.stream']) })));
    const config = ConfigSchema.parse({});
    const data = snapshot(config); data.profile = getProviderSetupProfile('xopc-cloud'); data.voice = readSetupVoiceState('xopc-cloud', config);
    const preview = previewProviderSetup(data, { mode: 'replace' });
    expect(preview.uses.find(use => use.id === 'speech')).toMatchObject({ recommended: 'xopc-cloud/stable', selected: true });
    const next = applySetupVoice(config, applyProviderSetup(data, { mode: 'replace' }, preview.revision).voiceAssignments);
    expect(next.messages?.tts?.providers?.['xopc-cloud']?.model).toBe('stable');
    expect(next.voice?.realtime.tts?.model).toBe('stable');
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
