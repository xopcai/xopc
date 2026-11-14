import { create } from 'zustand';

import { claimPlayback, markManagedPlayback, releasePlayback } from './playback-coordinator';

export type GeneratedMediaSource = { kind: 'audio' | 'video'; src: string; title: string };

type MediaEntry = {
  source: GeneratedMediaSource;
  element: HTMLMediaElement;
  hosts: Set<HTMLDivElement>;
};

type ActiveMedia = { entry: MediaEntry; inline: boolean };

const entries = new Map<string, MediaEntry>();
let floatingVideoHost: HTMLDivElement | null = null;

export const useGeneratedMediaStore = create<{ active: ActiveMedia | null }>(() => ({ active: null }));

function placeMedia(entry: MediaEntry): void {
  const { element, hosts, source } = entry;
  const active = useGeneratedMediaStore.getState().active;
  const isActive = active?.entry === entry;
  const currentHost = element.parentElement;
  const inlineHost = currentHost instanceof HTMLDivElement && currentHost.isConnected && hosts.has(currentHost)
    ? currentHost : [...hosts].find(host => host.isConnected);
  const destination = inlineHost ?? (isActive ? (source.kind === 'video' ? floatingVideoHost : null) ?? document.body : null);

  if (destination) {
    // Keep the playing element in the document when its React card unmounts.
    element.hidden = source.kind === 'audio' || destination === document.body;
    if (element.parentElement !== destination) destination.appendChild(element);
  } else {
    entries.delete(source.src);
    element.remove();
    element.removeAttribute('src');
    element.load();
  }

  if (isActive && active.inline !== Boolean(inlineHost)) {
    useGeneratedMediaStore.setState({ active: { entry, inline: Boolean(inlineHost) } });
  }
}

function closeMedia(entry: MediaEntry): void {
  if (useGeneratedMediaStore.getState().active?.entry !== entry) return;
  useGeneratedMediaStore.setState({ active: null });
  releasePlayback(entry.element);
  entry.element.pause();
  if (entry.element.readyState > 0) entry.element.currentTime = 0;
  placeMedia(entry);
}

function activate(entry: MediaEntry): void {
  claimPlayback(entry.element, () => closeMedia(entry));
  const active = useGeneratedMediaStore.getState().active;
  if (active?.entry === entry) return;
  if (active) closeMedia(active.entry);
  useGeneratedMediaStore.setState({ active: { entry, inline: entry.hosts.size > 0 } });
  placeMedia(entry);
}

function createMedia(source: GeneratedMediaSource): MediaEntry {
  const element = document.createElement(source.kind);
  element.preload = source.kind === 'audio' ? 'metadata' : 'none';
  element.setAttribute('aria-label', source.title);
  if (element instanceof HTMLVideoElement) {
    element.controls = true;
    element.playsInline = true;
    element.className = 'max-h-96 w-full rounded-lg bg-black';
  }
  markManagedPlayback(element);
  const entry = { source, element, hosts: new Set<HTMLDivElement>() };
  element.addEventListener('play', () => {
    if (!element.paused && entries.get(source.src) === entry) activate(entry);
  });
  element.src = source.src;
  entries.set(source.src, entry);
  return entry;
}

export function attachGeneratedMedia(source: GeneratedMediaSource, host: HTMLDivElement) {
  const entry = entries.get(source.src) ?? createMedia(source);
  entry.hosts.add(host);
  entry.source = source;
  entry.element.setAttribute('aria-label', source.title);
  placeMedia(entry);
  return {
    element: entry.element,
    detach: () => {
      entry.hosts.delete(host);
      placeMedia(entry);
    },
  };
}

export function setFloatingVideoHost(host: HTMLDivElement | null): void {
  floatingVideoHost = host;
  const active = useGeneratedMediaStore.getState().active;
  if (active?.entry.source.kind === 'video') placeMedia(active.entry);
}

export function startGeneratedMedia(element: HTMLMediaElement): Promise<void> {
  const entry = entries.get(element.getAttribute('src') ?? '');
  if (entry?.element !== element) return Promise.resolve();
  activate(entry);
  if (element.error) element.load();
  return element.play();
}

export async function playGeneratedMedia(source: GeneratedMediaSource): Promise<void> {
  const entry = entries.get(source.src) ?? createMedia(source);
  await startGeneratedMedia(entry.element).catch((error: unknown) => {
    if (useGeneratedMediaStore.getState().active?.entry === entry && entry.element.paused) closeMedia(entry);
    throw error;
  });
}

export function closeGeneratedMedia(): void {
  const active = useGeneratedMediaStore.getState().active;
  if (active) closeMedia(active.entry);
}
