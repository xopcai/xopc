import type { VoiceManifest, VoiceModeCapability } from '@xopcai/realtime-protocol/voice';
export function voiceFixture(modes: VoiceModeCapability[]): VoiceManifest {
  return {protocolVersion:1,serviceVersion:1,modes,transport:'websocket-pcm',inputFormat:{encoding:'pcm_s16le',sampleRate:16000,channels:1},outputFormat:{encoding:'pcm_s16le',sampleRate:24000,channels:1},turnDetection:['server_vad'],bargeIn:false,tools:false,resumable:false,voices:[{id:'voice-a',name:'Voice A',languages:['zh']}],defaultVoice:'voice-a',limits:{maxFrameBytes:65536,maxSessionSeconds:1800}};
}
