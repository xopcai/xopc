import { userErrorMessage } from './userError';

export function voiceInputErrorMessage(raw: string): ResourceStr {
  switch (raw) {
    case 'MICROPHONE_PERMISSION_REQUIRED': return $r('app.string.voice_input_permission');
    case 'RECORDING_TOO_SHORT': return $r('app.string.voice_input_too_short');
    case 'RECORDING_FAILED': return $r('app.string.voice_input_recording_failed');
    case 'EMPTY_TRANSCRIPTION': return $r('app.string.voice_input_no_speech');
    case 'PLAYBACK_FAILED': return $r('app.string.voice_input_playback_failed');
    default: return userErrorMessage(raw, 'media');
  }
}
