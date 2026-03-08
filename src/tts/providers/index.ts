/**
 * TTS Providers
 */

export { BaseTTSProvider, type BaseProviderConfig } from './base.js';
export { 
  OpenAIProvider, 
  type OpenAIProviderConfig,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  isValidOpenAIVoice,
  isValidOpenAIModel,
} from './openai.js';
export { 
  AlibabaProvider, 
  type AlibabaProviderConfig 
} from './alibaba.js';
export { 
  EdgeProvider, 
  type EdgeProviderConfig,
  inferEdgeExtension,
} from './edge.js';
