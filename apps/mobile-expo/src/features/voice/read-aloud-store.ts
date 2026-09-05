import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { create } from 'zustand';

import {
  recordInteractionPerformanceEvent,
  recordUsageEvent,
} from '../../product/usage-metrics';
import { claimAudioPlayback, releaseAudioPlayback, isAudioCaptureActive } from './audio-playback-coordinator';
import { generateSpeechChunk } from './read-aloud-api';
import { ReadAloudCache } from './read-aloud-cache';
import {
  endReadAloudLiveActivity,
  startReadAloudLiveActivity,
  updateReadAloudLiveActivity,
} from './read-aloud-live-activity';
import type { ReadAloudLiveActivityStatus } from './read-aloud-live-activity.types';
import { splitSpeakableText } from './read-aloud-text';

const PLAYBACK_OWNER = 'assistant-read-aloud';
const RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export type ReadAloudStatus = 'idle' | 'preparing' | 'playing' | 'paused' | 'error';
export type ReadAloudError = 'empty' | 'generation' | null;

export type ReadAloudInput = {
  source: {
    id: string;
    sessionKey?: string;
    title: string;
    preview?: string;
  };
  text: string;
  language: 'en-US' | 'zh-CN';
};

type ReadAloudState = {
  source: ReadAloudInput['source'] | null;
  status: ReadAloudStatus;
  error: ReadAloudError;
  currentChunkIndex: number;
  chunkCount: number;
  currentTime: number;
  duration: number;
  rate: number;
  requestStart: (input: ReadAloudInput) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  retry: () => void;
  cycleRate: () => void;
};

const initialPlaybackState = {
  source: null,
  status: 'idle' as const,
  error: null,
  currentChunkIndex: 0,
  chunkCount: 0,
  currentTime: 0,
  duration: 0,
};

let activeInput: ReadAloudInput | null = null;
let lastInput: ReadAloudInput | null = null;
let chunks: string[] = [];
let chunkFiles: Array<string | undefined> = [];
let chunkDurations: number[] = [];
const chunkRequests = new Map<number, Promise<string>>();
let requestController: AbortController | null = null;
let player: AudioPlayer | null = null;
let playerSetup: Promise<AudioPlayer> | null = null;
let playerChunkIndex = 0;
let playerChunkHasStarted = false;
let playerHasSystemMediaControls = false;
let cache: ReadAloudCache | null = null;
let generation = 0;
let finishingChunk = false;
let playbackRequestedAt = 0;

function liveActivitySnapshot(status: ReadAloudLiveActivityStatus) {
  const input = activeInput;
  if (!input) return null;
  const state = useReadAloudStore.getState();
  return {
    sessionKey: input.source.sessionKey,
    title: input.source.title,
    status,
    currentChunkIndex: state.currentChunkIndex,
    chunkCount: state.chunkCount,
    rate: state.rate,
  };
}

function syncLiveActivity(status: ReadAloudLiveActivityStatus): void {
  const snapshot = liveActivitySnapshot(status);
  if (snapshot) updateReadAloudLiveActivity(snapshot);
}

function completedDuration(index: number): number {
  return chunkDurations.slice(0, index).reduce((total, value) => total + (value || 0), 0);
}

function removePlayer(): void {
  const current = player;
  player = null;
  playerSetup = null;
  playerChunkIndex = 0;
  playerChunkHasStarted = false;
  playerHasSystemMediaControls = false;
  if (!current) return;
  try {
    current.pause();
  } catch {
    // The native player may already be stopped after an interruption.
  }
  try {
    current.clearLockScreenControls();
  } catch {
    // Lock screen controls may already belong to another player.
  }
  try {
    current.remove();
  } catch {
    // The native player may already be released after an interruption.
  }
}

function ensurePlayer(runGeneration: number): Promise<AudioPlayer> {
  if (isAudioCaptureActive()) return Promise.reject(new Error('Microphone is in use'));
  if (player) return playerSetup ?? Promise.resolve(player);

  const audioMode = setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: true,
  });
  let nextPlayer: AudioPlayer;
  try {
    nextPlayer = createAudioPlayer(null, {
      updateInterval: 250,
      keepAudioSessionActive: true,
    });
    player = nextPlayer;
    nextPlayer.setPlaybackRate(useReadAloudStore.getState().rate);
    claimAudioPlayback(PLAYBACK_OWNER, () => useReadAloudStore.getState().pause());
    nextPlayer.addListener('playbackStatusUpdate', (status) => {
      if (player !== nextPlayer || runGeneration !== generation || !status.isLoaded) return;
      const index = playerChunkIndex;
      const duration = Number.isFinite(status.duration) ? status.duration : 0;
      if (duration > 0) chunkDurations[index] = duration;
      if (status.playing) playerChunkHasStarted = true;
      const previousStatus = useReadAloudStore.getState().status;
      const nextStatus = status.playing
        ? 'playing' as const
        : playerChunkHasStarted && !status.didJustFinish
          ? 'paused' as const
          : null;
      useReadAloudStore.setState({
        currentTime: completedDuration(index) + (status.currentTime || 0),
        duration: chunkDurations.reduce((total, value) => total + (value || 0), 0),
        ...(nextStatus ? { status: nextStatus } : {}),
      });
      if (nextStatus && nextStatus !== previousStatus) syncLiveActivity(nextStatus);
      if (!status.didJustFinish || finishingChunk || !playerChunkHasStarted) return;
      finishingChunk = true;
      const nextIndex = index + 1;
      if (nextIndex < chunks.length) {
        void playChunk(nextIndex, runGeneration);
      } else {
        const rate = useReadAloudStore.getState().rate;
        resetPlayback();
        lastInput = null;
        recordUsageEvent('read_aloud_completed');
        useReadAloudStore.setState({ ...initialPlaybackState, rate });
      }
    });
  } catch (error) {
    void audioMode.catch(() => undefined);
    removePlayer();
    return Promise.reject(error);
  }

  const setup = audioMode.then(() => {
    if (runGeneration !== generation || player !== nextPlayer) {
      throw new Error('Stale speech player');
    }
    return nextPlayer;
  });
  playerSetup = setup;
  void setup.finally(() => {
    if (playerSetup === setup) playerSetup = null;
  }).catch(() => undefined);
  return setup;
}

function activateSystemMediaControls(nextPlayer: AudioPlayer): void {
  if (playerHasSystemMediaControls) return;
  const source = activeInput?.source;
  if (!source) return;
  try {
    nextPlayer.setActiveForLockScreen(true, {
      title: source.title,
      artist: 'xopc AI',
      albumTitle: 'AI read aloud',
    });
    playerHasSystemMediaControls = true;
  } catch (error) {
    console.warn('[ReadAloud] System media controls unavailable', error);
  }
}

function resetPlayback(): void {
  generation += 1;
  requestController?.abort();
  requestController = null;
  removePlayer();
  cache?.remove();
  cache = null;
  chunks = [];
  chunkFiles = [];
  chunkDurations = [];
  chunkRequests.clear();
  activeInput = null;
  finishingChunk = false;
  playbackRequestedAt = 0;
  releaseAudioPlayback(PLAYBACK_OWNER);
  endReadAloudLiveActivity();
}

async function ensureChunk(index: number, runGeneration: number): Promise<string> {
  const existing = chunkFiles[index];
  if (existing) return existing;
  const inFlight = chunkRequests.get(index);
  if (inFlight) return inFlight;
  const input = activeInput;
  const text = chunks[index];
  if (!input || !text || !cache) throw new Error('Speech chunk is unavailable');

  const promise = generateSpeechChunk({
    text,
    language: input.language,
    signal: requestController?.signal,
  }).then((result) => {
    if (runGeneration !== generation || !cache) throw new Error('Stale speech request');
    const uri = cache.write(index, result.bytes, result.mimeType);
    chunkFiles[index] = uri;
    return uri;
  });
  chunkRequests.set(index, promise);
  try {
    return await promise;
  } finally {
    chunkRequests.delete(index);
  }
}

async function playChunk(index: number, runGeneration: number): Promise<void> {
  useReadAloudStore.setState({
    status: 'preparing',
    error: null,
    currentChunkIndex: index,
    currentTime: completedDuration(index),
  });
  syncLiveActivity('preparing');
  try {
    const playerPromise = ensurePlayer(runGeneration);
    const [nextPlayer, uri] = await Promise.all([
      playerPromise,
      ensureChunk(index, runGeneration),
    ]);
    if (runGeneration !== generation) return;
    if (player !== nextPlayer) throw new Error('Speech player is unavailable');
    playerChunkIndex = index;
    playerChunkHasStarted = false;
    nextPlayer.replace({ uri });
    nextPlayer.setPlaybackRate(useReadAloudStore.getState().rate);
    activateSystemMediaControls(nextPlayer);
    finishingChunk = false;
    nextPlayer.play();
    useReadAloudStore.setState({ status: 'playing' });
    syncLiveActivity('playing');
    if (index === 0 && playbackRequestedAt > 0) {
      recordInteractionPerformanceEvent('read_aloud_first_audio', Date.now() - playbackRequestedAt);
      playbackRequestedAt = 0;
    }
    if (index + 1 < chunks.length) void ensureChunk(index + 1, runGeneration).catch(() => undefined);
  } catch (error) {
    if (runGeneration !== generation) return;
    console.warn('[ReadAloud] Playback failed', error);
    removePlayer();
    endReadAloudLiveActivity();
    releaseAudioPlayback(PLAYBACK_OWNER);
    playbackRequestedAt = 0;
    recordUsageEvent('read_aloud_failed');
    useReadAloudStore.setState({ status: 'error', error: 'generation' });
  }
}

function startPlayback(input: ReadAloudInput): void {
  const previousStatus = useReadAloudStore.getState().status;
  if (activeInput && previousStatus !== 'error') {
    recordUsageEvent('read_aloud_stopped');
  }
  resetPlayback();
  const nextChunks = splitSpeakableText(input.text);
  if (nextChunks.length === 0) {
    useReadAloudStore.setState({ status: 'error', error: 'empty' });
    return;
  }
  activeInput = input;
  lastInput = input;
  chunks = nextChunks;
  chunkFiles = Array.from({ length: chunks.length });
  chunkDurations = Array.from({ length: chunks.length }, () => 0);
  requestController = new AbortController();
  try {
    cache = new ReadAloudCache(`${Date.now()}-${generation}`);
  } catch {
    resetPlayback();
    recordUsageEvent('read_aloud_failed');
    useReadAloudStore.setState({
      source: input.source,
      status: 'error',
      error: 'generation',
      chunkCount: nextChunks.length,
    });
    return;
  }
  playbackRequestedAt = Date.now();
  recordUsageEvent('read_aloud_started');
  const runGeneration = generation;
  useReadAloudStore.setState({
    source: input.source,
    status: 'preparing',
    error: null,
    currentChunkIndex: 0,
    chunkCount: chunks.length,
    currentTime: 0,
    duration: 0,
  });
  const snapshot = liveActivitySnapshot('preparing');
  if (snapshot) startReadAloudLiveActivity(snapshot);
  void playChunk(0, runGeneration);
}

export const useReadAloudStore = create<ReadAloudState>()((set, get) => ({
  ...initialPlaybackState,
  rate: 1,

  requestStart: (input) => {
    const state = get();
    const sameSource = state.source?.id === input.source.id && activeInput?.text === input.text;
    if (sameSource && state.status === 'playing') return get().pause();
    if (sameSource && state.status === 'paused') return get().resume();
    if (sameSource && state.status === 'preparing') return get().stop();
    startPlayback(input);
  },

  pause: () => {
    if (!activeInput) return;
    if (get().status === 'preparing') {
      return get().stop();
    }
    player?.pause();
    set({ status: 'paused' });
    syncLiveActivity('paused');
  },

  resume: () => {
    if (isAudioCaptureActive()) return;
    if (!activeInput) return;
    if (player && player.currentTime > 0) {
      claimAudioPlayback(PLAYBACK_OWNER, () => get().pause());
      player.setPlaybackRate(get().rate);
      player.play();
      set({ status: 'playing' });
      syncLiveActivity('playing');
      return;
    }
    requestController = new AbortController();
    void playChunk(get().currentChunkIndex, generation);
  },

  stop: () => {
    if (activeInput && get().status !== 'error') {
      recordUsageEvent('read_aloud_stopped');
    }
    resetPlayback();
    lastInput = null;
    set({ ...initialPlaybackState, rate: get().rate });
  },

  retry: () => {
    if (lastInput) startPlayback(lastInput);
  },

  cycleRate: () => {
    const currentIndex = RATES.indexOf(get().rate as typeof RATES[number]);
    const rate = RATES[(currentIndex + 1) % RATES.length] ?? 1;
    player?.setPlaybackRate(rate);
    set({ rate });
    const status = get().status;
    if (status === 'preparing' || status === 'playing' || status === 'paused') {
      syncLiveActivity(status);
    }
  },
}));
