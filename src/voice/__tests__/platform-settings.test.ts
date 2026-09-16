import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { voiceManifestSchema } from '@xopcai/realtime-protocol/voice';
import { ConfigSchema } from '../../config/schema.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../providers/model-catalog-store.js';
import { selectPlatformVoice, voiceSettingsCatalog } from '../platform-settings.js';
import { requirePlatformVoiceModel } from '../platform-catalog.js';

const voice = voiceManifestSchema.parse({ protocolVersion:1, serviceVersion:3, modes:['transcription','transcription.stream','speech','speech.stream','conversation'], transport:'websocket-pcm', inputFormat:{encoding:'pcm_s16le',sampleRate:16000,channels:1}, outputFormat:{encoding:'pcm_s16le',sampleRate:24000,channels:1}, turnDetection:['server_vad'], bargeIn:true,tools:false,resumable:false, voices:[{id:'new-voice',name:'New Voice',languages:['zh']}], limits:{maxFrameBytes:65536,maxSessionSeconds:1800} });
beforeEach(() => getModelCatalogStore().saveSource('xopc-cloud', {providerId:'xopc-cloud',baseUrl:'https://example.test/v1',api:'openai-completions',etag:'v3',recommendedModel:null,lastSuccessAt:1,models:[{id:'future-provider-model',name:'Future provider',availability:'available',kind:'omni',input:['audio'],output:['audio','text'],operations:['audio.conversation'],contextWindow:128000,maxOutputTokens:null,reasoning:false,voice}]}));
afterEach(resetModelCatalogStore);
describe('shared platform voice settings', () => {
  it('configures every mode from a newly discovered model without vendor switches', () => {
    let config = ConfigSchema.parse({});
    for (const mode of voice.modes) config = selectPlatformVoice(config, {mode,model:'future-provider-model'});
    const state = voiceSettingsCatalog(config);
    expect(state.selections).toHaveLength(5);
    expect(state.selections.find(item => item.mode === 'conversation')?.voice).toBe('new-voice');
    expect(config.voice.realtime.enabled).toBe(true);
    expect(config.messages?.tts?.trigger).toBe('off');
  });
  it('preserves prior configuration and detects concurrent setting changes', () => {
    const original = ConfigSchema.parse({}); const before = voiceSettingsCatalog(original);
    const next = selectPlatformVoice(original,{mode:'conversation',model:'future-provider-model'});
    expect(voiceSettingsCatalog(original).revision).toBe(before.revision);
    expect(voiceSettingsCatalog(next).revision).not.toBe(before.revision);
    expect(() => selectPlatformVoice(next,{mode:'conversation',model:'future-provider-model',voice:'wrong-vendor-voice'})).toThrow('available');
  });
  it('retains a selected unavailable model and never substitutes another one', () => {
    const config = selectPlatformVoice(ConfigSchema.parse({}),{mode:'conversation',model:'future-provider-model'});
    getModelCatalogStore().removeSource('xopc-cloud');
    expect(voiceSettingsCatalog(config).selections[0]?.model).toBe('future-provider-model');
    expect(voiceSettingsCatalog(config).models).toEqual([]);
    expect(() => requirePlatformVoiceModel('future-provider-model','conversation')).toThrow('unavailable');
  });
  it('rejects unknown protocol versions and audio formats', () => {
    expect(voiceManifestSchema.safeParse({...voice,protocolVersion:2}).success).toBe(false);
    expect(voiceManifestSchema.safeParse({...voice,inputFormat:{...voice.inputFormat,sampleRate:44100}}).success).toBe(false);
  });
});
