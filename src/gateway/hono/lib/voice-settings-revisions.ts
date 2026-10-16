import { createHmac, randomBytes } from 'node:crypto';

import type { Config } from '../../../config/schema.js';

const revisionKey = randomBytes(32);
export const VOICE_SETTING_SCOPES = ['transcription', 'speech', 'conversation'] as const;
export type VoiceSettingScope = typeof VOICE_SETTING_SCOPES[number];

/** Opaque per-capability versions; credentials never appear in the public snapshot. */
export function voiceSettingsRevisions(config: Config): Record<VoiceSettingScope, string> {
  const values = {
    transcription: { stt: config.tools?.media?.audio, language: config.voice?.language, languageMode: config.voice?.languageMode, input: config.voice?.input },
    speech: config.messages?.tts,
    conversation: config.voice?.realtime,
  };
  return Object.fromEntries(VOICE_SETTING_SCOPES.map(scope => [scope,
    createHmac('sha256', revisionKey).update(JSON.stringify(values[scope]) ?? 'null').digest('hex'),
  ])) as Record<VoiceSettingScope, string>;
}
