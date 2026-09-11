import type { CreateVoiceSessionRequest, VoiceMode, VoiceProviderRoute } from '@xopcai/realtime-protocol/voice';

import type { Config } from '../../config/schema.js';
import type { MediaUnderstandingProvider } from '../../media-understanding/types.js';
import type { ResolvedSpeechProvider } from '../tts/factory.js';
import type { TTSConfig } from '../tts/types.js';
import type { VoiceConversationContext } from './conversation-context.js';
import type { OmniTranscript } from './omniEngine.js';
import type { OmniRoute } from './omniRoute.js';
import type { VoiceAgentBroker } from './agentBroker.js';

export interface ResolvedStreamingStt {
  plugin: MediaUnderstandingProvider & Required<Pick<MediaUnderstandingProvider, 'openAudioStream' | 'streamingAudio'>>;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  language?: string;
  prompt?: string;
  route: VoiceProviderRoute;
}

export interface VoiceTicketClaim {
  sessionId: string;
  connectionEpoch: number;
  principalId: string;
  mode?: VoiceMode;
  request: CreateVoiceSessionRequest;
  inputMode: 'server_vad';
  idleTimeoutMs: number;
  maxSessionMs: number;
  silenceDurationMs: number;
  stt?: ResolvedStreamingStt;
  omni?: OmniRoute;
  conversationSessionId?: string;
  tts?: ResolvedStreamingTts;
  config: Config;
  createdAt: number;
  expiresAt: number;
}

export interface ResolvedStreamingTts {
  provider: ResolvedSpeechProvider;
  config: TTSConfig;
  route: VoiceProviderRoute;
}

export interface VoiceRealtimeRuntimeOptions {
  recordOmniTranscript?: (sessionKey: string, callId: string, entry: OmniTranscript, expectedSessionId: string) => Promise<void>;
  getConversationContext?: (sessionKey: string, expectedSessionId: string) => Promise<VoiceConversationContext>;
  getSessionIdentity?: (sessionKey: string) => Promise<string | undefined>;
  getConfig: () => Config;
  sessionExists: (sessionKey: string) => Promise<boolean>;
  sessionBusy: (sessionKey: string) => boolean;
  agentBroker: VoiceAgentBroker;
  recordInterruption: (entry: {
    sessionKey: string;
    responseId: string;
    reason: 'barge_in' | 'client_cancelled';
    generatedCharacters: number;
    interruptedDuring: 'thinking' | 'speaking';
  }) => Promise<void>;
}
