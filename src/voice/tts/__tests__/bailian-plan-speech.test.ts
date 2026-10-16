import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderUsageScopeError, withModelUsageOrigin } from '../../../providers/model-usage.js';

const mocks = vi.hoisted(() => ({ post: vi.fn(), download: vi.fn(), key: vi.fn().mockResolvedValue('subscription-test-key') }));
vi.mock('../../../media-shared/http/index.js', () => ({ postJsonRequest: mocks.post, fetchWithTimeoutGuarded: mocks.download }));
vi.mock('../../../providers/provider-auth-service.js', () => ({ getProviderAuthService: () => ({ resolveApiKey: mocks.key }) }));
import { bailianPlanSpeechProvider } from '../providers/bailian-plan-speech.js';
import { bailianPlanTranscriptionProvider } from '../../stt/providers/bailian-plan-transcription.js';

beforeEach(() => { vi.clearAllMocks(); });
const request = { text: '你好', providerConfig: {}, timeoutMs: 1000 } as never;
describe('Bailian subscription voice bindings', () => {
  it('requests binary speech from the subscription endpoint with the shared credential', async () => {
    mocks.post.mockResolvedValue(new Response(new Uint8Array([73,68,51,1]), { headers: { 'content-type': 'audio/mpeg' } }));
    const result = await withModelUsageOrigin('interactive', () => bailianPlanSpeechProvider.synthesize!(request));
    expect(result.outputFormat).toBe('mp3'); expect(result.audioBuffer.length).toBe(4);
    expect(mocks.key).toHaveBeenCalledExactlyOnceWith('qwen-token-plan-cn');
    expect(mocks.post).toHaveBeenCalledWith('https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer', expect.objectContaining({
      headers: { Authorization: 'Bearer subscription-test-key' }, body: { model: 'qwen-audio-3.0-tts-plus', input: { text: '你好', voice: 'longanhuan_v3.6', format: 'mp3', sample_rate: 24000 } },
    }));
  });
  it('reuses the existing STT protocol without using the ordinary DashScope key or endpoint', async () => {
    mocks.post.mockResolvedValue(new Response(JSON.stringify({ output: { text: '你好' }, usage: { duration: 1 } })));
    const result = await withModelUsageOrigin('interactive', () => bailianPlanTranscriptionProvider.transcribeAudio!({ buffer: Buffer.from('wav'), fileName: 'test.wav', timeoutMs: 1000 }));
    expect(result.text).toBe('你好');
    expect(mocks.post.mock.calls[0][0]).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ body: { model: 'qwen-audio-3.0-asr-flash' }, headers: { Authorization: 'Bearer subscription-test-key' } });
    expect(bailianPlanTranscriptionProvider.streamingAudio).toBeUndefined();
  });
  it('accepts real-service JSON audio links and reports the downloaded WAV format', async () => {
    mocks.post.mockResolvedValue(new Response(JSON.stringify({output:{audio:{url:'https://audio.example.test/short-lived.wav',data:null}}}),{headers:{'content-type':'application/json'}}));
    mocks.download.mockResolvedValue(new Response(Buffer.from('RIFFxxxxWAVE'),{headers:{'content-type':'audio/wav'}}));
    const result = await withModelUsageOrigin('interactive',()=>bailianPlanSpeechProvider.synthesize!(request));
    expect(result.outputFormat).toBe('wav'); expect(result.fileExtension).toBe('wav');
    expect(mocks.download).toHaveBeenCalledWith('https://audio.example.test/short-lived.wav',expect.objectContaining({allowPrivateNetwork:false,init:{redirect:'error'}}));
  });
  it('upgrades service-returned HTTP audio links to HTTPS before the guarded download', async () => {
    mocks.post.mockResolvedValue(new Response(JSON.stringify({output:{audio:{url:'http://audio.example.test/short-lived.mp3?signature=fixture'}}}),{headers:{'content-type':'application/json'}}));
    mocks.download.mockResolvedValue(new Response(Buffer.from('ID3fixture'),{headers:{'content-type':'audio/mpeg'}}));
    await withModelUsageOrigin('interactive',()=>bailianPlanSpeechProvider.synthesize!(request));
    expect(mocks.download).toHaveBeenCalledWith('https://audio.example.test/short-lived.mp3?signature=fixture',expect.objectContaining({allowPrivateNetwork:false,init:{redirect:'error'}}));
  });
  it('rejects background and unknown speech before resolving credentials or making a request', async () => {
    await expect(bailianPlanSpeechProvider.synthesize!(request)).rejects.toThrow(ProviderUsageScopeError);
    await expect(withModelUsageOrigin('background', () => bailianPlanTranscriptionProvider.transcribeAudio!({ buffer: Buffer.from('wav'), fileName: 'test.wav', timeoutMs: 1000 }))).rejects.toThrow(ProviderUsageScopeError);
    expect(mocks.key).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled();
  });
  it('rejects empty or JSON responses rather than treating them as an audio file', async () => {
    mocks.post.mockResolvedValueOnce(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    await expect(withModelUsageOrigin('interactive', () => bailianPlanSpeechProvider.synthesize!(request))).rejects.toThrow('no audio');
    mocks.post.mockResolvedValueOnce(new Response(''));
    await expect(withModelUsageOrigin('interactive', () => bailianPlanSpeechProvider.synthesize!(request))).rejects.toThrow('empty audio');
  });
});
