import { create } from 'zustand';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { claimPlayback, ownsPlayback, releasePlayback } from '@/features/media-playback/playback-coordinator';

import { claimReadAloudMediaSession, releaseReadAloudMediaSession, updateReadAloudMediaSession } from './read-aloud-media-session';
import { splitSpeakableText } from './read-aloud-text';

const CONSENT_STORAGE_KEY = 'xopc:read-aloud-online-consent:v1';
const PLAYBACK_ID = 'read-aloud';

export type ReadAloudSource = {
  type: 'chat-message' | 'note' | 'selection';
  id: string;
  title: string;
  conversationId?: string;
  href?: string;
  targetId?: string;
};

export type ReadAloudInput = {
  source: ReadAloudSource;
  text: string;
  language: 'en-US' | 'zh-CN';
};

export type ReadAloudStatus = 'idle' | 'preparing' | 'playing' | 'paused' | 'ended' | 'error';

type ReadAloudState = {
  source: ReadAloudSource | null;
  status: ReadAloudStatus;
  currentChunkIndex: number;
  chunkCount: number;
  currentTime: number;
  duration: number;
  durationComplete: boolean;
  currentText: string;
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
  seek: (time: number) => void;
};

const initialState = {
  source: null,
  status: 'idle' as const,
  currentChunkIndex: 0,
  chunkCount: 0,
  currentTime: 0,
  duration: 0,
  durationComplete: false,
  currentText: '',
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
let playbackOperation = 0;
let advanceChunks = false;
let loadedChunkIndex: number | null = null;
let offsetOnLoad: number | null = null;
let sessionConsent = false;

type PlaybackPosition = { index: number; offset: number; autoplay: boolean };
type ChatReading = {
  queue: ReadAloudInput[];
  seen: Set<string>;
  finished: boolean;
  position?: PlaybackPosition;
};
type ChatSurface = { conversationId: string; replies: ReadAloudInput[] };
const chatReadings = new Map<string, ChatReading>();
const chatSurfaces = new Set<ChatSurface>();
let activeChatSurface: ChatSurface | undefined;
let activeChatReading: ChatReading | undefined;

export function resetChatReadAloud(conversationId: string): void {
  chatReadings.delete(conversationId);
  if (activeInput?.source.conversationId === conversationId) useReadAloudStore.getState().stop();
  if (pendingInput?.source.conversationId === conversationId) useReadAloudStore.getState().declineConsent();
}

export function clearReadAloudSession(): void {
  chatReadings.clear();
  useReadAloudStore.getState().stop();
}

export function bindChatReadAloud(conversationId: string) {
  const surface: ChatSurface = { conversationId, replies: [] };
  chatSurfaces.add(surface);
  focusChatSurface(surface);
  return {
    update(replies: ReadAloudInput[]) {
      surface.replies = replies;
      if (activeChatSurface === surface) syncChatReading(surface);
    },
    dispose() {
      chatSurfaces.delete(surface);
      if (activeChatSurface !== surface) return;
      focusChatSurface(undefined);
      queueMicrotask(() => {
        if (!activeChatSurface) {
          const previous = Array.from(chatSurfaces).at(-1);
          if (previous) {
            focusChatSurface(previous);
            syncChatReading(previous);
          }
        }
      });
    },
  };
}

function focusChatSurface(surface: ChatSurface | undefined): void {
  const nextId = surface?.conversationId;
  if (activeChatReading && activeInput?.source.conversationId !== nextId) {
    const state = useReadAloudStore.getState();
    const index = state.currentChunkIndex;
    const offset = offsetOnLoad ?? (loadedChunkIndex === index && audioElement?.readyState
      ? audioElement.currentTime : Math.max(0, state.currentTime - completedDuration(index)));
    activeChatReading.position = { index, offset, autoplay: advanceChunks || state.status === 'ended' };
    activeChatReading = undefined;
    stopPlayback();
  }
  if (pendingInput?.source.conversationId && pendingInput.source.conversationId !== nextId) {
    useReadAloudStore.getState().declineConsent();
  }
  activeChatSurface = surface;
}

function syncChatReading(surface: ChatSurface): void {
  const reading = chatReadings.get(surface.conversationId);
  if (!reading) return;
  const { replies } = surface;
  // Matching the most recent known reply keeps prepended history out of the queue.
  const anchor = replies.findLastIndex(reply => reading.seen.has(reply.source.id));
  for (const reply of replies.slice(anchor + 1)) {
    if (!reading.seen.has(reply.source.id)) reading.queue.push(reply);
    reading.seen.add(reply.source.id);
  }
  if (activeChatReading !== reading) {
    if (useReadAloudStore.getState().source || !reading.position) return;
    activeChatReading = reading;
    if (reading.finished && reading.queue.length === 1) {
      const source = reading.queue[0].source;
      activeInput = reading.queue[0];
      useReadAloudStore.setState({ source, status: 'ended' });
    } else if (!advanceChatReading()) {
      startPlayback(reading.queue[0], reading.position);
    }
    reading.position = undefined;
  } else {
    advanceChatReading();
  }
}

function advanceChatReading(): boolean {
  const reading = activeChatReading;
  if (!reading?.finished || reading.queue.length < 2) return false;
  reading.queue.shift();
  reading.finished = false;
  startPlayback(reading.queue[0]);
  return true;
}

function startReading(input: ReadAloudInput): void {
  const id = input.source.conversationId;
  if (!id) {
    const previousId = activeInput?.source.conversationId;
    if (previousId) chatReadings.delete(previousId);
    activeChatReading = undefined;
    startPlayback(input);
    return;
  }
  const surface = activeChatSurface?.conversationId === id
    ? activeChatSurface : Array.from(chatSurfaces).findLast(item => item.conversationId === id);
  if (surface) focusChatSurface(surface);
  const replies = surface?.replies ?? [];
  const index = replies.findIndex(reply => reply.source.id === input.source.id);
  const queue = [input, ...(index === -1 ? [] : replies.slice(index + 1))];
  const reading = { queue, seen: new Set([...replies.map(reply => reply.source.id), input.source.id]), finished: false };
  chatReadings.set(id, reading);
  activeChatReading = reading;
  startPlayback(input);
}

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
    if (chunkRequests.get(index) === promise) chunkRequests.delete(index);
  }
}

async function playChunk(index: number, offset = 0, autoplay = true): Promise<void> {
  const runGeneration = generation;
  const operation = ++playbackOperation;
  const audio = getAudio();
  advanceChunks = autoplay;
  if (autoplay) claimPlayback(audio, () => {
    releaseReadAloudMediaSession();
    useReadAloudStore.getState().pause();
  });
  useReadAloudStore.setState({ status: 'preparing', currentChunkIndex: index, currentText: chunks[index] ?? '', currentTime: completedDuration(index) + offset, error: null });
  audio.pause();
  try {
    const pending = ensureChunk(index, runGeneration);
    if (index + 1 < chunks.length) void ensureChunk(index + 1, runGeneration).catch(() => undefined);
    const url = await pending;
    if (runGeneration !== generation || operation !== playbackOperation) return;
    if (loadedChunkIndex !== index || audio.getAttribute('src') !== url) {
      loadedChunkIndex = index;
      offsetOnLoad = offset;
      audio.src = url;
    } else if (audio.readyState === 0) {
      offsetOnLoad = offset;
    } else {
      offsetOnLoad = null;
      audio.currentTime = offset;
    }
    audio.playbackRate = useReadAloudStore.getState().rate;
    if (autoplay) await audio.play();
    if (runGeneration !== generation || operation !== playbackOperation) return;
    useReadAloudStore.setState({ status: autoplay ? 'playing' : 'paused' });
    if (autoplay) {
      window.dispatchEvent(new CustomEvent('xopc-voice-playback-start', { detail: { id: PLAYBACK_ID } }));
      claimReadAloudMediaSession({ ...useReadAloudStore.getState(), position: () => useReadAloudStore.getState().currentTime });
      updateReadAloudMediaSession(useReadAloudStore.getState());
    }
  } catch (error) {
    if (runGeneration !== generation || operation !== playbackOperation || (error instanceof DOMException && error.name === 'AbortError')) return;
    releasePlayback(audio);
    releaseReadAloudMediaSession();
    useReadAloudStore.setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

function getAudio(): HTMLAudioElement {
  if (audioElement) return audioElement;
  audioElement = new Audio();
  audioElement.preload = 'metadata';
  audioElement.addEventListener('loadedmetadata', () => {
    if (!audioElement || loadedChunkIndex === null || !activeInput) return;
    if (Number.isFinite(audioElement.duration) && audioElement.duration > 0) chunkDurations[loadedChunkIndex] = audioElement.duration;
    if (offsetOnLoad !== null) { audioElement.currentTime = offsetOnLoad; offsetOnLoad = null; }
    useReadAloudStore.setState({
      duration: chunkDurations.reduce((sum, value) => sum + value, 0),
      durationComplete: chunkDurations.length > 0 && chunkDurations.every((value) => value > 0),
    });
  });
  audioElement.addEventListener('timeupdate', () => {
    if (!audioElement || loadedChunkIndex === null || offsetOnLoad !== null) return;
    const state = useReadAloudStore.getState();
    if (state.status !== 'playing' && state.status !== 'paused') return;
    useReadAloudStore.setState({ currentTime: completedDuration(loadedChunkIndex) + audioElement.currentTime });
  });
  audioElement.addEventListener('pause', () => {
    const state = useReadAloudStore.getState();
    if (state.status === 'playing') useReadAloudStore.setState({ status: 'paused' });
  });
  audioElement.addEventListener('ended', () => {
    const status = useReadAloudStore.getState().status;
    if (!audioElement || !ownsPlayback(audioElement) || !advanceChunks || !activeInput || (status !== 'playing' && status !== 'paused')) return;
    const next = useReadAloudStore.getState().currentChunkIndex + 1;
    if (next < chunks.length) {
      void playChunk(next);
    } else {
      advanceChunks = false;
      if (activeChatReading) {
        activeChatReading.finished = true;
        if (advanceChatReading()) return;
      }
      useReadAloudStore.setState({ status: 'ended', currentTime: useReadAloudStore.getState().duration });
    }
  });
  audioElement.addEventListener('error', () => {
    if (useReadAloudStore.getState().status === 'idle') return;
    // A failed audio decode must be fetched again when the user retries.
    if (loadedChunkIndex !== null) {
      const url = chunkUrls[loadedChunkIndex];
      if (url) URL.revokeObjectURL(url);
      chunkUrls[loadedChunkIndex] = null;
      chunkDurations[loadedChunkIndex] = 0;
      loadedChunkIndex = null;
    }
    playbackOperation += 1;
    advanceChunks = false;
    if (audioElement) releasePlayback(audioElement);
    releaseReadAloudMediaSession();
    useReadAloudStore.setState({ status: 'error', error: 'Audio playback failed', durationComplete: false });
  });

  window.addEventListener('xopc-voice-recording-start', () => useReadAloudStore.getState().pause());
  return audioElement;
}

function stopPlayback(): void {
  releaseReadAloudMediaSession();
  generation += 1;
  playbackOperation += 1;
  advanceChunks = false;
  loadedChunkIndex = null;
  offsetOnLoad = null;
  useReadAloudStore.setState({ ...initialState, rate: useReadAloudStore.getState().rate });
  requestController?.abort();
  requestController = null;
  if (audioElement) {
    releasePlayback(audioElement);
    audioElement.pause();
    audioElement.removeAttribute('src');
    audioElement.load();
  }
  releaseUrls();
  chunks = [];
  activeInput = null;
}

function startPlayback(input: ReadAloudInput, position?: PlaybackPosition): void {
  stopPlayback();
  const nextChunks = splitSpeakableText(input.text);
  if (!nextChunks.length) {
    useReadAloudStore.setState({ source: input.source, status: 'error', error: 'There is no readable text' });
    return;
  }
  activeInput = input;
  chunks = nextChunks;
  chunkUrls = Array.from({ length: chunks.length }, () => null);
  chunkDurations = Array.from({ length: chunks.length }, () => 0);
  requestController = new AbortController();
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
  void playChunk(position?.index ?? 0, position?.offset ?? 0, position?.autoplay ?? true);
}

export const useReadAloudStore = create<ReadAloudState>()((set, get) => ({
  ...initialState,

  requestStart: (input) => {
    const state = get();
    const isSameSource = state.source?.type === input.source.type && state.source.id === input.source.id;
    if (isSameSource && (state.status === 'playing' || state.status === 'preparing') && activeInput?.text === input.text) {
      get().pause();
      return;
    }
    if (isSameSource && (state.status === 'paused' || state.status === 'ended' || state.status === 'error') && activeInput?.text === input.text) {
      get().resume();
      return;
    }
    if (!hasConsent()) {
      pendingInput = input;
      set({ consentRequired: true });
      return;
    }
    startReading(input);
  },

  acceptConsent: () => {
    sessionConsent = true;
    try { localStorage.setItem(CONSENT_STORAGE_KEY, 'accepted'); } catch { /* continue for this session */ }
    const input = pendingInput;
    pendingInput = null;
    set({ consentRequired: false });
    if (input) startReading(input);
  },

  declineConsent: () => {
    pendingInput = null;
    set({ consentRequired: false });
  },

  pause: () => {
    const state = get();
    if (state.status !== 'playing' && state.status !== 'preparing') return;
    playbackOperation += 1;
    advanceChunks = false;
    audioElement?.pause();
    set({ status: 'paused' });
  },

  resume: () => {
    const state = get();
    if (!state.source || !activeInput || state.status === 'preparing' || state.status === 'playing') return;
    if (state.status === 'ended' && activeChatReading) {
      activeChatReading.finished = false;
      startPlayback(activeInput);
      return;
    }
    const index = state.status === 'ended' ? 0 : state.currentChunkIndex;
    const offset = state.status === 'ended' ? 0 : Math.max(0, state.currentTime - completedDuration(index));
    void playChunk(index, offset);
  },

  seek: (time) => {
    const state = get();
    if (!state.durationComplete || !Number.isFinite(time) || !activeInput) return;
    const target = Math.max(0, Math.min(time, state.duration));
    if (target === state.duration) {
      playbackOperation += 1;
      advanceChunks = false;
      audioElement?.pause();
      if (activeChatReading) activeChatReading.finished = true;
      set({ status: 'ended', currentTime: target });
      return;
    }
    let index = 0;
    let offset = target;
    while (index < chunkDurations.length - 1 && offset >= chunkDurations[index]) {
      offset -= chunkDurations[index];
      index += 1;
    }
    void playChunk(index, offset, state.status === 'playing');
  },

  stop: () => {
    const id = get().source?.conversationId;
    if (id) chatReadings.delete(id);
    activeChatReading = undefined;
    pendingInput = null;
    stopPlayback();
  },

  setRate: (rate) => {
    const safeRate = [0.75, 1, 1.25, 1.5, 2].includes(rate) ? rate : 1;
    if (audioElement) audioElement.playbackRate = safeRate;
    set({ rate: safeRate });
  },
}));

useReadAloudStore.subscribe(updateReadAloudMediaSession);
