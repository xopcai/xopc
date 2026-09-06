export type VoiceRecordingDestination = 'send' | 'cancel' | 'text';

/** Require an upward diagonal; hysteresis prevents hints flickering at the boundary. */
export function resolveVoiceRecordingDestination(
  dx: number,
  dy: number,
  current: VoiceRecordingDestination = 'send',
): VoiceRecordingDestination {
  if (current === 'cancel' && dy < -52 && dx < -24) return 'cancel';
  if (current === 'text' && dy < -52 && dx > 24) return 'text';
  if (dy < -72 && dx < -40) return 'cancel';
  if (dy < -72 && dx > 40) return 'text';
  return 'send';
}
