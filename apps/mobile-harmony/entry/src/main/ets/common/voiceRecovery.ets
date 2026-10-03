const XOPC_TRANSIENT_VOICE_FAILURES: string[] = [
  'NETWORK', 'route_lost', 'CAPTURE_FAILED', 'PLAYBACK_FAILED', 'CAPTURE_INTERRUPTED',
  'OMNI_CONNECTION_CLOSED', 'OMNI_CONNECTION_FAILED'
];

export function xopcVoiceShouldReconnect(reason: string): boolean {
  return XOPC_TRANSIENT_VOICE_FAILURES.includes(reason);
}
