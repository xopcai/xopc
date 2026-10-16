import { resolveProviderApiKeyForAgentSync } from '../../../auth/sync-provider-auth.js';
import { postJsonRequest, fetchWithTimeoutGuarded } from '../../../media-shared/http/index.js';
import { getProviderAuthService } from '../../../providers/provider-auth-service.js';
import { assertProviderUsage } from '../../../providers/model-usage.js';
import { BAILIAN_PLAN_PROVIDER, BAILIAN_PLAN_HOST, BAILIAN_PLAN_TTS_MODEL, BAILIAN_PLAN_TTS_VOICE } from '../../token-plan.js';
import { registerSpeechProvider } from '../speech-registry.js';
import type { SpeechProviderPlugin } from '../speech-provider-types.js';

const secret = () => resolveProviderApiKeyForAgentSync(BAILIAN_PLAN_PROVIDER) ?? process.env.QWEN_TOKEN_PLAN_CN_API_KEY;

export const bailianPlanSpeechProvider: SpeechProviderPlugin = {
  id: BAILIAN_PLAN_PROVIDER,
  resolveConfig: ({ rawConfig }) => {
    const slice = rawConfig[BAILIAN_PLAN_PROVIDER] as Record<string, unknown> | undefined;
    return { model: BAILIAN_PLAN_TTS_MODEL, voice: BAILIAN_PLAN_TTS_VOICE, ...slice,
      baseUrl: `${BAILIAN_PLAN_HOST}/api/v1/services/audio/tts/SpeechSynthesizer` };
  },
  isConfigured: () => Boolean(secret()),
  listVoices: async () => [{ id: BAILIAN_PLAN_TTS_VOICE, name: 'Long Anhuan' }],
  synthesize: async req => {
    assertProviderUsage(BAILIAN_PLAN_PROVIDER);
    const apiKey = await getProviderAuthService().resolveApiKey(BAILIAN_PLAN_PROVIDER);
    if (!apiKey) throw new Error('Bailian subscription TTS credential is unavailable');
    const model = String(req.providerOverrides?.model ?? req.providerConfig.model ?? BAILIAN_PLAN_TTS_MODEL);
    if (model !== BAILIAN_PLAN_TTS_MODEL) throw new Error('Unsupported Bailian subscription TTS model');
    const response = await postJsonRequest(`${BAILIAN_PLAN_HOST}/api/v1/services/audio/tts/SpeechSynthesizer`, {
      timeoutMs: req.timeoutMs, signal: req.signal, label: 'Bailian subscription TTS',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { model, input: { text: req.text, voice: req.providerOverrides?.voice ?? req.providerConfig.voice ?? BAILIAN_PLAN_TTS_VOICE,
        format: 'mp3', sample_rate: 24000 } },
    });
    let audioResponse = response;
    let inline: Buffer | undefined;
    if (response.headers.get('content-type')?.includes('json')) {
      const data = await response.json() as { output?: { audio?: { data?: string; url?: string } } };
      const audio = data.output?.audio;
      if (audio?.data) inline = Buffer.from(audio.data.replace(/^data:audio\/[^;]+;base64,/, ''), 'base64');
      else if (audio?.url) {
        const audioUrl = new URL(audio.url);
        // The service can return HTTP CDN links; retrieve the same signed resource over TLS.
        if (audioUrl.protocol === 'http:') audioUrl.protocol = 'https:';
        if (audioUrl.protocol !== 'https:') throw new Error('Bailian subscription returned an unsupported audio URL');
        audioResponse = await fetchWithTimeoutGuarded(audioUrl.toString(), { timeoutMs: req.timeoutMs, signal: req.signal,
          label: 'Bailian subscription audio download', allowPrivateNetwork: false, init: { redirect: 'error' } });
        if (!audioResponse.ok) throw new Error(`Bailian subscription audio download failed: HTTP ${audioResponse.status}`);
      } else throw new Error('Bailian subscription TTS returned no audio');
    }
    const audioBuffer = inline ?? Buffer.from(await audioResponse.arrayBuffer());
    if (!audioBuffer.length) throw new Error('Bailian subscription TTS returned empty audio');
    const mime = inline ? undefined : audioResponse.headers.get('content-type')?.split(';')[0]?.trim();
    if (mime && !mime.startsWith('audio/') && mime !== 'application/octet-stream') throw new Error('Bailian subscription TTS returned an unsupported audio content type');
    const magic = audioBuffer.subarray(0, 4).toString('ascii');
    const format = magic === 'RIFF' ? 'wav' : magic === 'fLaC' ? 'flac' : magic === 'OggS' ? 'ogg'
      : mime === 'audio/wav' || mime === 'audio/x-wav' ? 'wav' : 'mp3';
    return { audioBuffer, outputFormat: format, fileExtension: format, voiceCompatible: false };
  },
};
registerSpeechProvider(bailianPlanSpeechProvider);
