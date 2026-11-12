let current: { owner: object; interrupt: () => void } | undefined;
const managedElements = new WeakSet<HTMLMediaElement>();
const observedElements = new WeakSet<HTMLMediaElement>();

export function claimPlayback(owner: object, interrupt: () => void): void {
  const previous = current;
  current = { owner, interrupt };
  if (previous && previous.owner !== owner) previous.interrupt();
}

export function releasePlayback(owner: object): void {
  if (current?.owner === owner) current = undefined;
}

export function ownsPlayback(owner: object): boolean {
  return current?.owner === owner;
}

export function interruptPlayback(): void {
  const previous = current;
  current = undefined;
  previous?.interrupt();
}

export function markManagedPlayback(element: HTMLMediaElement): void {
  managedElements.add(element);
}

export function claimNativePlayback(element: HTMLMediaElement): void {
  if (!observedElements.has(element)) {
    observedElements.add(element);
    element.addEventListener('pause', () => { if (element.paused) releasePlayback(element); });
    element.addEventListener('ended', () => releasePlayback(element));
    element.addEventListener('error', () => releasePlayback(element));
  }
  claimPlayback(element, () => element.pause());
}

export function observeNativePlayback(): () => void {
  const onPlay = (event: Event) => {
    const element = event.target;
    if (element instanceof HTMLMediaElement && !element.paused && !managedElements.has(element)) {
      claimNativePlayback(element);
    }
  };
  document.addEventListener('play', onPlay, true);
  window.addEventListener('xopc-voice-recording-start', interruptPlayback);
  return () => {
    document.removeEventListener('play', onPlay, true);
    window.removeEventListener('xopc-voice-recording-start', interruptPlayback);
  };
}
