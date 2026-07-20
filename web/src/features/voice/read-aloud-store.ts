import { create } from 'zustand';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useVoicePlayerStore } from '@/features/notes/voice-player-store';

import { splitSpeakableText } from './read-aloud-text';

const CONSENT_STORAGE_KEY = 'xopc:read-aloud-online-consent:v1';
const PLAYBACK_ID = 'read-aloud';

export type ReadAloudSource = {
  type: 'chat-message' | 'note' | 'selection';
  id: string;
  title: string;
};

export type ReadAloudInput = {
  source: ReadAloudSource;
  text: string;
  language: 'en-US' | 'zh-CN';
};

export type ReadAloudStatus = 'idle' | 'preparing' | 'playing' | 'paused' | 'error';

type ReadAloudState = {
  source: ReadAloudSource | null;
  status: ReadAloudStatus;
  currentChunkIndex: number;
  chunkCount: number;
  currentTime: number;
  duration: number;
  rate: number;
  error: string | null;
  consentRequired: boolean;
  requestStart: (input: ReadAloudInput) => void;
  acceptConsent: () => void;
  declineConsent: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setRate: (rate: number) => void;
};

const initialState = {
  source: null,
  status: 'idle' as const,
  currentChunkIndex: 0,
  chunkCount: 0,
  currentTime: 0,
  duration: 0,
  rate: 1,
  error: null,
  consentRequired: false,
};

let audioElement: HTMLAudioElement | null = null;
let activeInput: ReadAloudInput | null = null;
let pendingInput: ReadAloudInput | null = null;
let chunks: string[] = [];
let chunkUrls: Array<string | null> = [];
let chunkDurations: number[] = [];
let chunkRequests = new Map<number, Promise<string>>();
let requestController: AbortController | null = null;
let generation = 0;
let sessionConsent = false;

function hasConsent(): boolean {
  if (sessionConsent) return true;
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY) === 'accepted';
  } catch {
    return false;
  }
}

function releaseUrls(): void {
  for (const url of chunkUrls) {
    if (url) URL.revokeObjectURL(url);
  }
  chunkUrls = [];
  chunkDurations = [];
  chunkRequests.clear();
}

function completedDuration(index: number): number {
  return chunkDurations.slice(0, index).reduce((sum, value) => sum + (value || 0), 0);
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { error?: string | { message?: string } };
  if (typeof body.error === 'string') return body.error;
  return body.error?.message || `Speech request failed (${response.status})`;
}

async function ensureChunk(index: number, runGeneration: number): Promise<string> {
  const existing = chunkUrls[index];
  if (existing) return existing;
  const inFlight = chunkRequests.get(index);
  if (inFlight) return inFlight;
  const input = activeInput;
  if (!input || !chunks[index]) throw new Error('Speech chunk is unavailable');

  const promise = (async () => {
    const response = await apiFetch(apiUrl('/api/voice/speech'), {
      method: 'POST',
      signal: requestController?.signal,
      body: JSON.stringify({ text: chunks[index], language: input.language }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const blob = await response.blob();
    if (!blob.size) throw new Error('Speech service returned empty audio');
    if (runGeneration !== generation) throw new DOMException('Stale speech request', 'AbortError');
    const url = URL.createObjectURL(blob);
    chunkUrls[index] = url;
    return url;
  })();
  chunkRequests.set(index, promise);
  try {
    return await promise;
  } finally {
    chunkRequests.delete(index);
  }
}

async function playChunk(index: number, runGeneration: number): Promise<void> {
  const audio = getAudio();
  useReadAloudStore.setState({ status: 'preparing', currentChunkIndex: index, error: null });
  try {
    const url = await ensureChunk(index, runGeneration);
    if (runGeneration !== generation) return;
    audio.src = url;
    audio.playbackRate = useReadAloudStore.getState().rate;
    await audio.play();
    if (runGeneration !== generation) return;
    useReadAloudStore.setState({ status: 'playing' });
    window.dispatchEvent(new CustomEvent('xopc-voice-playback-start', { detail: { id: PLAYBACK_ID } }));
    if (index + 1 < chunks.length) void ensureChunk(index + 1, runGeneration).catch(() => undefined);
  } catch (error) {
    if (runGeneration !== generation || (error instanceof DOMException && error.name === 'AbortError')) return;
    const message = error instanceof Error ? error.message : String(error);
    useReadAloudStore.setState({ status: 'error', error: message });
  }
}

function getAudio(): HTMLAudioElement {
  if (audioElement) return audioElement;
  audioElement = new Audio();
  audioElement.preload = 'metadata';
  audioElement.addEventListener('loadedmetadata', () => {
    if (!audioElement) return;
    const index = useReadAloudStore.getState().currentChunkIndex;
    if (Number.isFinite(audioElement.duration)) chunkDurations[index] = audioElement.duration;
    useReadAloudStore.setState({ duration: chunkDurations.reduce((sum, value) => sum + (value || 0), 0) });
  });
  audioElement.addEventListener('timeupdate', () => {
    if (!audioElement) return;
    const index = useReadAloudStore.getState().currentChunkIndex;
    useReadAloudStore.setState({ currentTime: completedDuration(index) + audioElement.currentTime });
  });
  audioElement.addEventListener('pause', () => {
    const state = useReadAloudStore.getState();
    if (state.status === 'playing') useReadAloudStore.setState({ status: 'paused' });
  });
  audioElement.addEventListener('ended', () => {
    const next = useReadAloudStore.getState().currentChunkIndex + 1;
    if (next < chunks.length) {
      void playChunk(next, generation);
    } else {
      useReadAloudStore.setState({ status: 'paused', currentTime: 0, currentChunkIndex: 0 });
      if (audioElement) audioElement.currentTime = 0;
    }
  });
  audioElement.addEventListener('error', () => {
    if (useReadAloudStore.getState().status !== 'idle') {
      useReadAloudStore.setState({ status: 'error', error: 'Audio playback failed' });
    }
  });

  window.addEventListener('xopc-voice-recording-start', () => useReadAloudStore.getState().pause());
  window.addEventListener('xopc-voice-playback-start', (event) => {
    const otherId = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (otherId && otherId !== PLAYBACK_ID) useReadAloudStore.getState().pause();
  });
  return audioElement;
}

function stopPlayback(): void {
  generation += 1;
  requestController?.abort();
  requestController = null;
  if (audioElement) {
    audioElement.pause();
    audioElement.removeAttribute('src');
    audioElement.load();
  }
  releaseUrls();
  chunks = [];
  activeInput = null;
  useReadAloudStore.setState({ ...initialState, rate: useReadAloudStore.getState().rate });
}

function startPlayback(input: ReadAloudInput): void {
  stopPlayback();
  const nextChunks = splitSpeakableText(input.text);
  if (!nextChunks.length) {
    useReadAloudStore.setState({ status: 'error', error: 'There is no readable text' });
    return;
  }
  activeInput = input;
  chunks = nextChunks;
  chunkUrls = Array.from({ length: chunks.length }, () => null);
  chunkDurations = Array.from({ length: chunks.length }, () => 0);
  requestController = new AbortController();
  const runGeneration = generation;
  useVoicePlayerStore.getState().pause();
  useReadAloudStore.setState({
    source: input.source,
    status: 'preparing',
    currentChunkIndex: 0,
    chunkCount: chunks.length,
    currentTime: 0,
    duration: 0,
    error: null,
    consentRequired: false,
  });
  void playChunk(0, runGeneration);
}

export const useReadAloudStore = create<ReadAloudState>()((set, get) => ({
  ...initialState,

  requestStart: (input) => {
    const state = get();
    const isSameSource = state.source?.type === input.source.type && state.source.id === input.source.id;
    if (isSameSource && state.status === 'playing' && activeInput?.text === input.text) {
      get().pause();
      return;
    }
    if (isSameSource && state.status === 'paused' && activeInput?.text === input.text) {
      get().resume();
      return;
    }
    if (!hasConsent()) {
      pendingInput = input;
      set({ consentRequired: true });
      return;
    }
    startPlayback(input);
  },

  acceptConsent: () => {
    sessionConsent = true;
    try { localStorage.setItem(CONSENT_STORAGE_KEY, 'accepted'); } catch { /* continue for this session */ }
    const input = pendingInput;
    pendingInput = null;
    set({ consentRequired: false });
    if (input) startPlayback(input);
  },

  declineConsent: () => {
    pendingInput = null;
    set({ consentRequired: false });
  },

  pause: () => {
    if (get().status === 'preparing') {
      stopPlayback();
      return;
    }
    if (audioElement && !audioElement.paused) audioElement.pause();
  },

  resume: () => {
    const state = get();
    if (!state.source || !activeInput) return;
    if (audioElement?.src && audioElement.currentTime > 0) {
      audioElement.playbackRate = state.rate;
      void audioElement.play().then(() => set({ status: 'playing' })).catch((error) => {
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      });
      return;
    }
    requestController = new AbortController();
    void playChunk(state.currentChunkIndex, generation);
  },

  stop: stopPlayback,

  setRate: (rate) => {
    const safeRate = [0.75, 1, 1.25, 1.5, 2].includes(rate) ? rate : 1;
    if (audioElement) audioElement.playbackRate = safeRate;
    set({ rate: safeRate });
  },
}));
