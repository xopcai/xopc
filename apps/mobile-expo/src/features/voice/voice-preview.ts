import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { apiFetch } from '../../api/client';
import { claimAudioPlayback, releaseAudioPlayback, isAudioCaptureActive } from './audio-playback-coordinator';
import { decodePcm } from './native-audio-session';

export class VoicePreview {
  private abort?: AbortController;
  private file?: File;
  private player?: AudioPlayer;
  private owner = `voice-preview:${randomUUID()}`;
  stop = () => {
    this.abort?.abort(); this.abort = undefined;
    this.player?.pause(); this.player?.remove(); this.player = undefined;
    if (this.file?.exists) this.file.delete(); this.file = undefined;
    releaseAudioPlayback(this.owner);
  };
  async play(): Promise<void> {
    this.stop();
    if (isAudioCaptureActive()) throw new Error('MICROPHONE_BUSY');
    claimAudioPlayback(this.owner, this.stop);
    const abort = new AbortController(); this.abort = abort;
    try {
      const response = await apiFetch('/api/voice/realtime/preview', { method: 'POST', signal: abort.signal });
      if (!response.ok) throw new Error('PROVIDER_UNAVAILABLE');
      const { payload } = await response.json();
      if (payload.sampleRate !== 24000 || typeof payload.audio !== 'string') throw new Error('PROTOCOL_ERROR');
      const pcm = decodePcm(payload.audio);
      if (!pcm.length || pcm.length % 2 || pcm.length > 960000) throw new Error('PROTOCOL_ERROR');
      const wav = new Uint8Array(44 + pcm.length); const view = new DataView(wav.buffer);
      const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i); };
      write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); write(8, 'WAVEfmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      write(36, 'data'); view.setUint32(40, pcm.length, true); wav.set(pcm, 44);
      abort.signal.throwIfAborted();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      abort.signal.throwIfAborted();
      if (isAudioCaptureActive()) throw new Error('MICROPHONE_BUSY');
      const file = new File(Paths.cache, `${this.owner}.wav`); file.write(wav); this.file = file;
      const player = createAudioPlayer(file.uri); this.player = player;
      player.addListener('playbackStatusUpdate', status => { if (this.player === player && status.didJustFinish) this.stop(); });
      player.play();
    } catch (error) { if (this.abort === abort) this.stop(); throw error; }
  }
}
