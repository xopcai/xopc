import type { VoiceRecordingZone } from './VoiceRecordingCard';

const ENTER_DISTANCE = 72;
const EXIT_DISTANCE = 52;

export function resolveVoiceRecordingZone(
  dx: number,
  dy: number,
  current: VoiceRecordingZone = 'center',
): VoiceRecordingZone {
  if (current === 'lock' && dy < -EXIT_DISTANCE) return 'lock';
  if (current === 'cancel' && dx < -EXIT_DISTANCE) return 'cancel';
  if (current === 'text' && dx > EXIT_DISTANCE) return 'text';

  if (dy < -ENTER_DISTANCE && Math.abs(dy) >= Math.abs(dx)) return 'lock';
  if (dx < -ENTER_DISTANCE) return 'cancel';
  if (dx > ENTER_DISTANCE) return 'text';
  return 'center';
}
