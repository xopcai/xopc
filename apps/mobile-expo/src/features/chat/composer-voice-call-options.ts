export type ComposerVoiceCallEngine = 'omni' | 'agent';

export const COMPOSER_VOICE_CALL_OPTIONS = [
  { key: 'voice-no-tools', engine: 'omni', icon: 'phone-outline' },
  { key: 'voice-with-tools', engine: 'agent', icon: 'phone-in-talk-outline' },
] as const satisfies ReadonlyArray<{
  key: string;
  engine: ComposerVoiceCallEngine;
  icon: string;
}>;
