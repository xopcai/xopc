export interface XopcPersonalAgentRecord {
  agentId: string;
  conversationId: string;
  state: 'provisioning' | 'ready' | 'error';
  displayName: string;
  appearance: string;
  errorMessage: string | null;
  revision?: number;
  userCallName?: string | null;
  preferences?: XopcPersonalPreferences;
  voicePreference?: XopcPersonalVoicePreference | null;
}

export interface XopcPersonalAgentResponse {
  ok: boolean;
  payload: XopcPersonalAgentRecord | null;
  error?: string;
}

export interface XopcPersonalPreferences {
  addressAs?: string;
  guidance?: string;
  warmth?: string;
  supportMode?: string;
  detailLevel?: string;
  proactivity?: string;
  humor?: string;
}
export interface XopcPersonalVoicePreference { provider: string; model: string; voice: string; }
export interface XopcPersonalVoiceOption { id: string; name: string; }
export interface XopcPersonalProactivity {
  revision: number; mode: string; timezone: string; quietStart: number; quietEnd: number;
  dailyMessages: number; dailyModelCalls: number;
}
export interface XopcPersonalProactivityResponse { ok: boolean; payload: XopcPersonalProactivity; error?: string; }
export interface XopcPersonalVoiceStatus { payload: XopcPersonalVoiceRoute; }
export interface XopcPersonalVoiceRoute { tts?: XopcPersonalVoicePreference; }
export interface XopcPersonalVoicesResponse { ok: boolean; payload: XopcPersonalVoices; error?: string; }
export interface XopcPersonalVoices { voices: XopcPersonalVoiceOption[]; }
export interface XopcPersonalProfilePatch {
  revision: number; displayName: string; appearance: string; preferences: XopcPersonalPreferences;
  voicePreference?: XopcPersonalVoicePreference | null;
}
