import { isElectron } from '@/lib/electron-env';

export type DiscussionAudioCaptureMode = 'microphone' | 'meeting_mix';

const LEGACY_PREFERRED_AUDIO_MODE_KEY = 'xopc.discussions.preferredAudioMode';

export interface AcquiredDiscussionAudio {
  stream: MediaStream;
  mode: DiscussionAudioCaptureMode;
  cleanup: () => void;
}

export function isSystemAudioMixSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (
    !isElectron() &&
    typeof navigator.userAgent === 'string' &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  ) {
    return false;
  }
  return (
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof AudioContext !== 'undefined'
  );
}

/**
 * Purge any previously persisted `meeting_mix` auto-start preference so starting a
 * recording in Chrome/Web never unexpectedly triggers OS Screen Recording prompts.
 */
export function clearLegacyPreferredAudioMode(): void {
  try {
    globalThis.localStorage?.removeItem(LEGACY_PREFERRED_AUDIO_MODE_KEY);
  } catch {
    /* ignore unavailable storage */
  }
}

/**
 * Acquire either a plain microphone stream ('microphone') or a real-time WebAudio mix
 * of OS/browser system audio + microphone ('meeting_mix') for online meetings
 * (Zoom, Feishu, Tencent Meeting, Teams, browser calls).
 *
 * Important browser rules:
 * 1. `getDisplayMedia` MUST be called synchronously on the first tick of the user gesture
 *    before awaiting `getUserMedia`, otherwise browsers may drop transient activation.
 * 2. In standard browsers (Chrome on macOS), passing `video: { displaySurface: 'browser' }`
 *    pre-selects the "Chrome Tab" surface first so Chromium does not immediately enumerate
 *    macOS Windows/Screens (which triggers repeated macOS Screen Recording TCC prompts
 *    when Google Chrome has not been granted OS screen-capture permission).
 * 3. Any display video tracks returned by `getDisplayMedia` are stopped immediately
 *    so zero screen pixels are ever recorded or retained.
 */
export async function acquireDiscussionAudioStream(
  mode: DiscussionAudioCaptureMode = 'microphone',
): Promise<AcquiredDiscussionAudio> {
  clearLegacyPreferredAudioMode();

  if (mode === 'microphone') {
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return {
      stream: micStream,
      mode: 'microphone',
      cleanup: () => {
        micStream.getTracks().forEach((track) => track.stop());
      },
    };
  }

  if (!isSystemAudioMixSupported()) {
    throw new Error('System audio capture is not supported in this browser or environment.');
  }

  let displayStream: MediaStream | null = null;
  let micStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;

  try {
    const desktopApp = isElectron();
    const displayOptions: DisplayMediaStreamOptions & Record<string, unknown> = {
      video: desktopApp ? true : { displaySurface: 'browser' },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      ...(desktopApp
        ? {}
        : {
            systemAudio: 'include',
            selfBrowserSurface: 'exclude',
            surfaceSwitching: 'include',
          }),
    };

    displayStream = await navigator.mediaDevices.getDisplayMedia(displayOptions);

    // Privacy-first: discard video tracks immediately; we only want loopback/tab audio.
    displayStream.getVideoTracks().forEach((track) => track.stop());

    const systemAudioTracks = displayStream.getAudioTracks();
    if (systemAudioTracks.length === 0) {
      displayStream.getTracks().forEach((t) => t.stop());
      throw new Error(
        'No system or tab audio track was shared. Enable "Share tab/system audio" when selecting a source.',
      );
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    audioContext = new AudioContext();
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => undefined);
    }

    const destination = audioContext.createMediaStreamDestination();
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.15;
    compressor.connect(destination);

    const micGain = audioContext.createGain();
    micGain.gain.value = 1.0;
    const micSource = audioContext.createMediaStreamSource(
      new MediaStream(micStream.getAudioTracks()),
    );
    micSource.connect(micGain);
    micGain.connect(compressor);

    const sysGain = audioContext.createGain();
    sysGain.gain.value = 1.0;
    const sysSource = audioContext.createMediaStreamSource(new MediaStream(systemAudioTracks));
    sysSource.connect(sysGain);
    sysGain.connect(compressor);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      micStream?.getTracks().forEach((t) => t.stop());
      displayStream?.getTracks().forEach((t) => t.stop());
      destination.stream.getTracks().forEach((t) => t.stop());
      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close().catch(() => undefined);
      }
    };

    // If either underlying audio track ends unexpectedly, end the mixed output track
    // so MediaRecorder's interruption safeguard triggers cleanly.
    const forwardUnderlyingEnd = () => {
      destination.stream.getAudioTracks().forEach((t) => t.stop());
    };
    micStream.getAudioTracks().forEach((t) => t.addEventListener('ended', forwardUnderlyingEnd, { once: true }));
    systemAudioTracks.forEach((t) => t.addEventListener('ended', forwardUnderlyingEnd, { once: true }));

    return {
      stream: destination.stream,
      mode: 'meeting_mix',
      cleanup,
    };
  } catch (err) {
    micStream?.getTracks().forEach((t) => t.stop());
    displayStream?.getTracks().forEach((t) => t.stop());
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch(() => undefined);
    }
    throw err;
  }
}
