type PlaybackOwner = {
  id: string;
  pause: () => void;
};

let activeOwner: PlaybackOwner | null = null;

export function claimAudioPlayback(id: string, pause: () => void): void {
  if (activeOwner?.id !== id) activeOwner?.pause();
  activeOwner = { id, pause };
}

export function releaseAudioPlayback(id: string): void {
  if (activeOwner?.id === id) activeOwner = null;
}

export function pauseActiveAudioPlayback(): void {
  const owner = activeOwner;
  activeOwner = null;
  owner?.pause();
}
