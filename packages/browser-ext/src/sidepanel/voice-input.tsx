import { useEffect, useRef, useState } from 'react';
import { PcmWavRecorder } from '@xopcai/composer-core/pcm-wav-recorder';
import { gatewayFetch } from './auth';
import { t } from '../i18n';
import { MicrophoneIcon } from './icons';

export function VoiceInput({ disabled, onTranscript, onBusy }: {
  disabled: boolean; onTranscript: (text: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<PcmWavRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const audio = useRef<Blob | undefined>(undefined);
  const busy = useRef(false);
  const stopTracks = (media = stream.current) => { media?.getTracks().forEach(track => track.stop()); if (stream.current === media) { stream.current = undefined; clearInterval(timer.current); } };
  function cancel() {
    generation.current++; controller.current?.abort(); recorder.current?.cancel(); recorder.current = undefined;
    stopTracks(); busy.current = false; audio.current = undefined; setState('idle'); onBusy(false);
  }
  useEffect(() => () => { generation.current++; controller.current?.abort(); recorder.current?.cancel(); stopTracks(); onBusy(false); }, []);

  async function transcribe(blob: Blob, id: number) {
    setState('transcribing'); setError(''); busy.current = true; onBusy(true);
    controller.current = new AbortController();
    try {
      const form = new FormData(); form.append('audio', blob, 'recording.wav');
      const response = await gatewayFetch('/api/voice/transcriptions', {
        method: 'POST', body: form, signal: AbortSignal.any([controller.current.signal, AbortSignal.timeout(120_000)]),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? t('errorGatewayStatus', String(response.status)));
      if (typeof body.payload?.text !== 'string' || !body.payload.text.trim()) throw new Error(t('voiceNoSpeech'));
      if (generation.current === id) { onTranscript(body.payload.text.trim()); audio.current = undefined; }
    } catch (cause) {
      if (generation.current === id) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation.current === id) { busy.current = false; setState('idle'); onBusy(false); }
    }
  }
  async function finish(id = generation.current) {
    if (!recorder.current || generation.current !== id) return;
    const current = recorder.current; const media = stream.current; recorder.current = undefined;
    clearInterval(timer.current); setState('transcribing');
    try {
      const blob = await current.stop(); stopTracks(media);
      if (generation.current !== id) return;
      audio.current = blob;
      await transcribe(blob, id);
    } catch (cause) {
      if (generation.current === id) stopTracks();
      if (generation.current === id) { busy.current = false; setState('idle'); onBusy(false); setError(String(cause)); }
    }
  }
  async function start() {
    if (disabled || busy.current) return;
    busy.current = true; onBusy(true); setState('starting'); setError(''); setNeedsPermission(false); audio.current = undefined;
    const id = ++generation.current;
    try {
      const statusResponse = await gatewayFetch('/api/status');
      if (!statusResponse.ok) throw new Error(t('errorGatewayStatus', String(statusResponse.status)));
      const status = await statusResponse.json();
      if (!status.voice?.sttAvailable) throw new Error(t('voiceUnavailable'));
      if (generation.current !== id) return;
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation.current !== id) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const next = await PcmWavRecorder.start(media);
      if (generation.current !== id) { next.cancel(); media.getTracks().forEach(track => track.stop()); return; }
      recorder.current = next; setSeconds(0); setState('recording');
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000); setSeconds(elapsed);
        if (elapsed >= 120) void finish(id);
      }, 1000);
    } catch (cause) {
      if (generation.current === id) stopTracks();
      if (generation.current === id) {
        const denied = (cause instanceof DOMException || cause instanceof Error) && cause.name === 'NotAllowedError';
        busy.current = false; setState('idle'); onBusy(false); setNeedsPermission(denied);
        setError(denied ? t('voicePermissionHelp') : cause instanceof Error ? cause.message : String(cause));
      }
    }
  }
  return <div className="voice-input">
    {state === 'idle' ? <button type="button" className="composer-icon-button" disabled={disabled} title={t('voiceInput')} aria-label={t('voiceInput')} onClick={() => void start()}><MicrophoneIcon /></button> : null}
    {state !== 'idle' || error ? <div className="voice-input-panel" role="status">
      <span>{error || (state === 'recording' ? `${t('voiceRecording')} ${seconds}s` : state === 'starting' ? t('voiceStarting') : t('voiceTranscribing'))}</span>
      {needsPermission ? <button type="button" onClick={() => { void chrome.tabs.create({ url: chrome.runtime.getURL('dist/sidepanel.html?microphone-permission') }).catch(cause => setError(String(cause))); }}>{t('voicePermissionOpen')}</button> : null}
      {state === 'recording' ? <button type="button" onClick={() => void finish()}>{t('voiceFinish')}</button> : null}
      {state === 'idle' && audio.current ? <button type="button" disabled={disabled} onClick={() => void transcribe(audio.current!, ++generation.current)}>{t('voiceRetry')}</button> : null}
      <button type="button" onClick={() => { cancel(); setError(''); }}>{t('cancelQueuedMessage')}</button>
    </div> : null}
  </div>;
}
