import { Loader2, Mic, Play, Square } from 'lucide-react';
import { useContext, useEffect, useRef, useState } from 'react';

import { VoiceCallContext } from '@/features/voice/realtime/voice-call-context';
import { voiceInputConstraints } from '@/stores/voice-preferences-store';
import { Button } from '@/components/ui/button';
import { PcmFrameCapture, PcmStreamEncoder } from '@/features/chat/composer/pcm-wav-recorder';
import { PcmPlayer } from '@/features/voice/realtime/pcm-player';
import { VoiceSessionClient } from '@/features/voice/realtime/voice-session-client';
import type { VoiceSettingsMessages } from '@/i18n/messages';

import { previewRealtimeVoice } from './voice-config-api';

type Phase = 'idle' | 'connecting' | 'listening' | 'playing' | 'confirm' | 'passed' | 'error';

/** Exercises real input/output without creating a chat or invoking an agent. */
export function VoiceDiagnostics({ v, canListen, canSpeak, disabled, onVerified }: {
  v: VoiceSettingsMessages;
  canListen: boolean;
  canSpeak: boolean;
  disabled: boolean;
  onVerified?: (result: { input: boolean; output: boolean }) => void;
}) {
  const s = v.setup;
  const callActive = useContext(VoiceCallContext)?.active ?? false;
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const phaseRef = useRef<Phase>('idle');
  const disposeRef = useRef<(() => void) | null>(null);
  const inputPassed = useRef(false);

  const transition = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  const stop = () => {
    disposeRef.current?.();
    disposeRef.current = null;
  };
  useEffect(() => () => disposeRef.current?.(), []);

  async function run(withMicrophone: boolean) {
    stop();
    onVerified?.({ input: false, output: false });
    inputPassed.current = false;
    setTranscript('');
    setError('');
    transition(withMicrophone ? 'connecting' : 'playing');
    const controller = new AbortController();
    let stream: MediaStream | undefined;
    let capture: PcmFrameCapture | undefined;
    let client: VoiceSessionClient | undefined;
    let player: PcmPlayer | undefined;
    const stopInput = () => {
      capture?.cancel();
      stream?.getTracks().forEach((track) => track.stop());
      client?.stop('surface_closed');
    };
    const timeout = window.setTimeout(() => fail(s.timeout), 60_000);
    disposeRef.current = () => {
      controller.abort();
      window.clearTimeout(timeout);
      stopInput();
      void player?.close();
    };
    function fail(message: string) {
      if (controller.signal.aborted) return;
      transition('error');
      setError(message);
      stop();
    }
    async function play() {
      transition('playing');
      stopInput();
      try {
        const audio = await previewRealtimeVoice(controller.signal);
        if (controller.signal.aborted) return;
        player?.enqueue(audio, () => {
          if (controller.signal.aborted) return;
          window.clearTimeout(timeout);
          transition('confirm');
        });
      } catch (err) {
        fail(err instanceof Error ? err.message : s.testFailed);
      }
    }
    try {
      // Resume output from the click gesture, before asynchronous microphone/network work.
      if (canSpeak) {
        player = new PcmPlayer();
        await player.start();
        controller.signal.throwIfAborted();
      }
      if (!withMicrophone) { await play(); return; }
      const system = window.electronAPI?.system;
      if (system) {
        const permission = await system.requestMicrophone();
        controller.signal.throwIfAborted();
        if (permission.status === 'denied') throw new Error(s.microphoneDenied);
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: voiceInputConstraints(),
      });
      if (controller.signal.aborted) { stopInput(); return; }
      client = await VoiceSessionClient.connect({
        purpose: 'dictation',
        signal: controller.signal,
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          if (event.type === 'session.error') fail(s.testFailed);
          if (phaseRef.current !== 'listening') return;
          if (event.type === 'input.transcript.delta') setTranscript(event.payload.text);
          if (event.type === 'input.transcript.final' && event.payload.text.trim()) {
            setTranscript(event.payload.text.trim());
            inputPassed.current = true;
            if (canSpeak) void play();
            else { transition('passed'); onVerified?.({ input: true, output: false }); stop(); }
          }
        },
        onClose: () => {
          if (phaseRef.current === 'listening' || phaseRef.current === 'connecting') fail(s.testFailed);
        },
      });
      if (controller.signal.aborted) { stopInput(); return; }
      let encoder: PcmStreamEncoder | undefined;
      capture = await PcmFrameCapture.start(stream, {
        onSamples: (samples) => {
          if (encoder && !controller.signal.aborted) client?.sendAudio(encoder.push(samples));
        },
      });
      if (controller.signal.aborted) { stopInput(); return; }
      encoder = new PcmStreamEncoder(capture.sampleRate, client.session.inputFormat.sampleRate);
      transition('listening');
    } catch (err) {
      if (controller.signal.aborted) { stopInput(); return; }
      fail(err instanceof Error ? err.message : s.testFailed);
    }
  }

  const busy = phase === 'connecting' || phase === 'listening' || phase === 'playing';
  return (
    <div className="space-y-3 border-t border-edge pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" disabled={callActive || disabled || !canListen || busy} onClick={() => void run(true)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
          {canSpeak ? s.test : s.testInput}
        </Button>
        <Button type="button" variant="secondary" disabled={callActive || disabled || !canSpeak || busy} onClick={() => void run(false)}>
          <Play className="size-4" />{v.tts.test.play}
        </Button>
        {busy ? <Button type="button" variant="ghost" onClick={() => { stop(); transition('idle'); }}><Square className="size-4" />{v.tts.test.stop}</Button> : null}
      </div>
      <div role="status" aria-live="polite" className="space-y-2 text-xs text-fg-muted">
        {phase === 'idle' ? <p>{callActive ? v.experience.endCallBeforeTest : disabled ? s.saveBeforeTest : s.microphoneHint}</p> : null}
        {phase === 'connecting' ? <p>{s.connecting}</p> : null}
        {phase === 'listening' ? <p>{s.speakNow}</p> : null}
        {transcript ? <p className="rounded-lg bg-surface-base p-3 text-sm text-fg">{transcript}</p> : null}
        {phase === 'playing' ? <p>{s.playing}</p> : null}
        {phase === 'confirm' ? <div className="flex items-center gap-3"><span>{s.heardQuestion}</span><Button type="button" variant="secondary" onClick={() => { stop(); onVerified?.({ input: inputPassed.current, output: true }); transition('passed'); }}>{s.heard}</Button><Button type="button" variant="ghost" onClick={() => { stop(); transition('error'); setError(s.notHeard); }}>{s.notHeardButton}</Button></div> : null}
        {phase === 'passed' ? <p>{inputPassed.current ? (canSpeak ? s.passed : s.inputPassed) : s.outputPassed}</p> : null}
        {phase === 'error' ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
