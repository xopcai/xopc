import { resolveProviderApiKeyForAgentSync } from '../../../auth/sync-provider-auth.js';
import { getProviderAuthService } from '../../../providers/provider-auth-service.js';
import { assertProviderUsage } from '../../../providers/model-usage.js';
import { registerMediaUnderstandingProvider } from '../../../media-understanding/registry.js';
import type { MediaUnderstandingProvider } from '../../../media-understanding/types.js';
import { BAILIAN_PLAN_PROVIDER, BAILIAN_PLAN_HOST, BAILIAN_PLAN_STT_MODEL } from '../../token-plan.js';
import { alibabaTranscriptionProvider } from './alibaba-transcription.js';

export const bailianPlanTranscriptionProvider: MediaUnderstandingProvider = {
  id: BAILIAN_PLAN_PROVIDER, capabilities: ['audio'], requiresApiKey: false,
  defaultModels: { audio: BAILIAN_PLAN_STT_MODEL },
  isConfigured: () => Boolean(resolveProviderApiKeyForAgentSync(BAILIAN_PLAN_PROVIDER) ?? process.env.QWEN_TOKEN_PLAN_CN_API_KEY),
  transcribeAudio: async request => {
    assertProviderUsage(BAILIAN_PLAN_PROVIDER);
    const apiKey = await getProviderAuthService().resolveApiKey(BAILIAN_PLAN_PROVIDER);
    if (!apiKey) throw new Error('Bailian subscription STT credential is unavailable');
    if (request.model && request.model !== BAILIAN_PLAN_STT_MODEL) throw new Error('Unsupported Bailian subscription STT model');
    return alibabaTranscriptionProvider.transcribeAudio!({ ...request, apiKey, model: BAILIAN_PLAN_STT_MODEL,
      baseUrl: `${BAILIAN_PLAN_HOST}/api/v1/services/aigc/multimodal-generation/generation` });
  },
};
registerMediaUnderstandingProvider(bailianPlanTranscriptionProvider);
