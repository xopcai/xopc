import { create } from 'zustand';

import { claimPlayback, releasePlayback } from '@/features/media-playback/playback-coordinator';

import { acquireNoteMediaObjectUrl, releaseNoteMediaObjectUrl } from './note-media-blob';

export type VoicePlayerState = {
  /** Currently loaded note id. */
  noteId: string | null;
  /** Currently loaded attachment id. */
  attachmentId: string | null;
  /** Whether audio is playing. */
  playing: boolean;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Total duration in seconds. */
  duration: number;
  /** Loading state. */
  loading: boolean;
};

type VoicePlayerActions = {
  play: (noteId: string, attachmentId: string, hintDuration?: number) => void;
  pause: () => void;
  toggle: (noteId: string, attachmentId: string, hintDuration?: number) => void;
  seek: (time: number) => void;
  reset: () => void;
};

const initialState: VoicePlayerState = {
  noteId: null,
  attachmentId: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  loading: false,
};

let audioElement: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
let currentNoteId: string | null = null;
let currentAttachmentId: string | null = null;
let playbackOperation = 0;

function getAudio(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.addEventListener('timeupdate', () => {
      useVoicePlayerStore.setState({ currentTime: audioElement!.currentTime });
    });
    audioElement.addEventListener('loadedmetadata', () => {
      const dur = audioElement!.duration;
      if (Number.isFinite(dur)) {
        useVoicePlayerStore.setState({ duration: dur });
      }
    });
    audioElement.addEventListener('ended', () => {
      releasePlayback(audioElement!);
      useVoicePlayerStore.setState({ playing: false, currentTime: 0 });
      audioElement!.currentTime = 0;
    });
    audioElement.addEventListener('pause', () => {
      useVoicePlayerStore.setState({ playing: false });
    });
    audioElement.addEventListener('play', () => {
      useVoicePlayerStore.setState({ playing: true });
    });
  }
  return audioElement;
}

function releaseCurrent(): void {
  if (currentNoteId && currentAttachmentId) {
    releaseNoteMediaObjectUrl(currentNoteId, currentAttachmentId);
  }
  currentObjectUrl = null;
  currentNoteId = null;
  currentAttachmentId = null;
}

export const useVoicePlayerStore = create<VoicePlayerState & VoicePlayerActions>()((set, get) => ({
  ...initialState,

  play: async (noteId, attachmentId, hintDuration) => {
    const audio = getAudio();
    const state = get();
    const operation = ++playbackOperation;
    claimPlayback(audio, () => get().pause());

    try {
      if (state.noteId !== noteId || state.attachmentId !== attachmentId || !currentObjectUrl) {
        audio.pause();
        releaseCurrent();
        set({ noteId, attachmentId, playing: false, currentTime: 0, duration: hintDuration ?? 0, loading: true });
        const url = await acquireNoteMediaObjectUrl(noteId, attachmentId);
        if (operation !== playbackOperation) {
          releaseNoteMediaObjectUrl(noteId, attachmentId);
          return;
        }
        currentObjectUrl = url;
        currentNoteId = noteId;
        currentAttachmentId = attachmentId;
        audio.src = url;
      }
      await audio.play();
      if (operation === playbackOperation) set({ loading: false });
    } catch {
      if (operation !== playbackOperation) return;
      releasePlayback(audio);
      set({ loading: false, playing: false });
      releaseCurrent();
    }
  },

  pause: () => {
    playbackOperation += 1;
    if (audioElement) {
      releasePlayback(audioElement);
      audioElement.pause();
    }
    set({ playing: false, loading: false });
  },

  toggle: (noteId, attachmentId, hintDuration) => {
    const state = get();
    if (state.noteId === noteId && state.attachmentId === attachmentId && state.playing) {
      get().pause();
    } else {
      get().play(noteId, attachmentId, hintDuration);
    }
  },

  seek: (time) => {
    const audio = getAudio();
    audio.currentTime = time;
    set({ currentTime: time });
  },

  reset: () => {
    get().pause();
    if (audioElement) {
      audioElement.removeAttribute('src');
      audioElement.load();
    }
    releaseCurrent();
    set(initialState);
  },
}));
