export const VOICE_INPUT_TOGGLE_EVENT = 'xopc-voice-input-toggle';
export const VOICE_INPUT_CANCEL_EVENT = 'xopc-voice-input-cancel';
export const APP_SHORTCUT_RECORDING_EVENT = 'app-shortcut-recording';

export type VoiceInputShortcutTarget = 'chat' | 'note';

let pendingToggle = false;

export function dispatchVoiceInputEvent(
  type: typeof VOICE_INPUT_TOGGLE_EVENT | typeof VOICE_INPUT_CANCEL_EVENT,
  target: VoiceInputShortcutTarget,
): boolean {
  const event = new CustomEvent<{ target: VoiceInputShortcutTarget }>(type, {
    cancelable: true,
    detail: { target },
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export function queuePendingVoiceInputToggle(): void {
  pendingToggle = true;
}

export function takePendingVoiceInputToggle(): boolean {
  if (!pendingToggle) return false;
  pendingToggle = false;
  return true;
}
