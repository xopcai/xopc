type PlaybackOwner = {
  id: string;
  pause: () => void;
};

let activeOwner: PlaybackOwner | null = null;
let captureOwner: symbol | null = null;

export function claimAudioCapture(owner: symbol): boolean {
  if (captureOwner && captureOwner !== owner) return false;
  pauseActiveAudioPlayback();
  captureOwner = owner;
  return true;
}

export function releaseAudioCapture(owner: symbol): void {
  if (captureOwner === owner) captureOwner = null;
}

export function isAudioCaptureActive(): boolean { return captureOwner !== null; }

export function claimAudioPlayback(id: string, pause: () => void): void {
  if (captureOwner) throw new Error('Microphone is in use');
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
