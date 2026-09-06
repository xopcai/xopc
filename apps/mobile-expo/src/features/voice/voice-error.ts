import type { MessageBundle } from '../../i18n/messages';
export function voiceErrorMessage(code: string | undefined, m: MessageBundle['voice']): string {
  if (!code) return '';
  if (/EMPTY_UTTERANCE/.test(code)) return m.noSpeech;
  if (/PERMISSION/.test(code)) return m.permission;
  if (/UPGRADE|NATIVE_BUILD/.test(code)) return m.upgrade;
  if (/CONFLICT|BUSY|AUDIO_FOCUS|MICROPHONE_(?:FORMAT_)?UNAVAILABLE/.test(code)) return m.busy;
  if (/SESSION_CHANGED|NOT_FOUND|context_changed/.test(code)) return m.sessionChanged;
  if (/TIME_LIMIT|max_duration|session_limit|idle_timeout/.test(code)) return m.timeLimit;
  if (/INPUT_DROPPED|audio_backpressure/.test(code)) return m.inputDropped;
  if (/audio_focus_lost/.test(code)) return m.audioFocusLost;
  if (/capture_failed/.test(code)) return m.captureFailed;
  if (/route_lost/.test(code)) return m.routeLost;
  if (/background/.test(code)) return m.backgroundPaused;
  if (/interruption/.test(code)) return m.interruption;
  if (/NETWORK|CONNECT_TIMEOUT/.test(code)) return m.network;
  return m.error;
}
