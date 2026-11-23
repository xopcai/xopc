export type DiscussionAudioCaptureMode = 'microphone' | 'meeting_mix';

export interface AcquiredDiscussionAudio {
  stream: MediaStream;
  mode: DiscussionAudioCaptureMode;
  cleanup: () => void;
}

export function isSystemAudioMixSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof AudioContext !== 'undefined'
  );
}

/**
 * Acquire either a plain microphone stream ('microphone') or a real-time WebAudio mix
 * of OS/browser system audio + microphone ('meeting_mix') for online meetings
 * (Zoom, Feishu, Tencent Meeting, Teams, browser calls).
 *
 * Any display video tracks returned by `getDisplayMedia` are stopped immediately
 * so zero screen pixels are ever recorded or retained.
 */
export async function acquireDiscussionAudioStream(
  mode: DiscussionAudioCaptureMode = 'microphone',
): Promise<AcquiredDiscussionAudio> {
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

  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  let displayStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;

  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as MediaTrackConstraints,
    });

    // Privacy-first: discard video tracks immediately; we only want loopback/tab audio.
    displayStream.getVideoTracks().forEach((track) => track.stop());

    const systemAudioTracks = displayStream.getAudioTracks();
    if (systemAudioTracks.length === 0) {
      displayStream.getTracks().forEach((t) => t.stop());
      micStream.getTracks().forEach((t) => t.stop());
      throw new Error(
        'No system or tab audio track was shared. Enable "Share system/tab audio" or grant Screen & System Audio Recording permission.',
      );
    }

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
      micStream.getTracks().forEach((t) => t.stop());
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
    micStream.getTracks().forEach((t) => t.stop());
    displayStream?.getTracks().forEach((t) => t.stop());
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch(() => undefined);
    }
    throw err;
  }
}
