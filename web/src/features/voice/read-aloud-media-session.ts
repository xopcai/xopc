type PlaybackState = {
  source: { title: string } | null;
  status: string;
  duration: number;
  durationComplete: boolean;
  currentTime: number;
  rate: number;
};

let owned = false;
const actions = ['play', 'pause', 'stop', 'seekto', 'seekbackward', 'seekforward'] as const;

function mediaSession(): MediaSession | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
}

export function claimReadAloudMediaSession(controls: {
  resume: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  position: () => number;
}) {
  const session = mediaSession();
  if (!session) return;
  owned = true;
  const handlers: Record<(typeof actions)[number], MediaSessionActionHandler> = {
    play: controls.resume,
    pause: controls.pause,
    stop: controls.stop,
    seekto: ({ seekTime }) => { if (seekTime !== undefined) controls.seek(seekTime); },
    seekbackward: ({ seekOffset }) => controls.seek(controls.position() - (seekOffset ?? 10)),
    seekforward: ({ seekOffset }) => controls.seek(controls.position() + (seekOffset ?? 10)),
  };
  for (const action of actions) {
    try { session.setActionHandler(action, handlers[action]); } catch { /* Some browsers expose only a subset of media actions. */ }
  }
}

export function updateReadAloudMediaSession(state: PlaybackState) {
  const session = mediaSession();
  if (!owned || !session) return;
  if (typeof MediaMetadata !== 'undefined' && session.metadata?.title !== state.source?.title) {
    session.metadata = state.source ? new MediaMetadata({ title: state.source.title, artist: 'xopc' }) : null;
  }
  session.playbackState = state.status === 'playing' ? 'playing' : 'paused';
  try {
    session.setPositionState(state.durationComplete && state.duration > 0 ? {
      duration: state.duration,
      playbackRate: state.rate,
      position: Math.min(state.duration, Math.max(0, state.currentTime)),
    } : undefined);
  } catch { /* Position controls are optional on mobile browsers. */ }
}

export function releaseReadAloudMediaSession() {
  const session = mediaSession();
  if (!owned || !session) return;
  owned = false;
  session.metadata = null;
  session.playbackState = 'none';
  for (const action of actions) {
    try { session.setActionHandler(action, null); } catch { /* Unsupported action. */ }
  }
  try { session.setPositionState(); } catch { /* Unsupported position control. */ }
}
