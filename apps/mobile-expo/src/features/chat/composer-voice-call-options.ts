export type ComposerVoiceCallMode = 'natural' | 'assistant';

export const COMPOSER_VOICE_CALL_OPTIONS = [
  { key: 'voice-no-tools', mode: 'natural', icon: 'phone-outline' },
  { key: 'voice-with-tools', mode: 'assistant', icon: 'phone-in-talk-outline' },
] as const satisfies ReadonlyArray<{
  key: string;
  mode: ComposerVoiceCallMode;
  icon: string;
}>;

export function resolveComposerVoiceCallOption(mode?: ComposerVoiceCallMode) {
  return COMPOSER_VOICE_CALL_OPTIONS.find((item) => item.mode === mode)
    ?? COMPOSER_VOICE_CALL_OPTIONS[0];
}
