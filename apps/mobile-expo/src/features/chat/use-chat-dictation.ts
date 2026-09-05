import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { preflightVoice, createVoiceConnection } from '../../query/voice';
import { refineVoiceTranscript } from '../../api/agent-client';
import { NativeAudioSession } from '../voice/native-audio-session';
import { VoiceTransport } from '../voice/voice-transport';
import { useGatewayStore } from '../../stores/gateway-store';
import { useMessages } from '../../i18n/messages';
import { DictationTranscript } from './dictation-transcript';

export function useChatDictation(sessionKey: string, insert: (text: string) => void) {
  const { voice: m } = useMessages();
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'recording' | 'processing' | 'error'>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== 'recording') return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase, startedAt]);
  const state = useRef({ generation: 0, transport: undefined as VoiceTransport | undefined, audio: undefined as NativeAudioSession | undefined,
    abort: undefined as AbortController | undefined, transcript: new DictationTranscript(), timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const callback = useRef(insert); callback.current = insert;
  const refine = useMutation({ mutationFn: refineVoiceTranscript, retry: false });
  const refineRef = useRef(refine.mutateAsync); refineRef.current = refine.mutateAsync;
  const cleanup = useCallback(() => {
    const current = state.current;
    clearTimeout(current.timer);
    current.audio?.capture(false);
    current.transport?.close(); current.transport = undefined;
    current.abort?.abort(); current.abort = undefined;
    const audio = current.audio; current.audio = undefined;
    return audio?.stop() ?? Promise.resolve();
  }, []);
  const cancel = useCallback(() => { state.current.generation++; void cleanup(); setPhase('idle'); setText(''); setError(undefined); }, [cleanup]);
  useEffect(() => {
    const consent = DeviceEventEmitter.addListener('voice-consent-revoked', cancel);
    const gateway = useGatewayStore.subscribe((next, previous) => { if (next.activeGatewayId !== previous.activeGatewayId || next.unauthorized) cancel(); });
    const subscription = AppState.addEventListener('change', next => { if (next === 'background') cancel(); });
    return () => { consent.remove(); gateway(); subscription.remove(); state.current.generation++; void cleanup(); };
  }, [sessionKey, cancel, cleanup]);
  const start = useCallback(async () => {
    if (state.current.audio) return;
    const current = state.current;
    const generation = ++current.generation;
    const active = () => current.generation === generation;
    setPhase('connecting'); setText(''); setError(undefined); setStartedAt(0); current.transcript = new DictationTranscript();
    const abort = new AbortController(); current.abort = abort;
    const audio = new NativeAudioSession(); current.audio = audio;
    const request = { purpose: 'dictation' as const };
    const fail = (code: string) => {
      if (!active()) return;
      current.generation++;
      void cleanup(); setPhase('error'); setError(code);
    };
    try {
      await preflightVoice(request, abort.signal);
      if (!active()) return;
      await audio.start(false, m, { pcm: bytes => {
        if (!active()) return;
        try { current.transport?.audio(bytes); } catch { fail('INPUT_DROPPED'); }
      }, played: () => {}, interrupted: fail });
      if (!active()) { await audio.stop(); return; }
      const connection = await createVoiceConnection(request, abort.signal);
      if (!active()) return;
      const transport = new VoiceTransport({
        audio: () => {},
        event: event => {
          if (!active()) return;
          if (event.type === 'input.transcript.final' || event.type === 'input.transcript.delta') {
            const p = event.payload;
            current.transcript.update(p.utteranceId, p.revision, p.text, event.type === 'input.transcript.final');
            setText(current.transcript.text());
          }
        },
        close: reason => {
          if (!active()) return;
          if (reason !== 'input_committed') { fail(reason); return; }
          const raw = current.transcript.text(true);
          const completedGeneration = ++current.generation;
          void cleanup();
          if (!raw) { setPhase('error'); setError('EMPTY_UTTERANCE'); return; }
          setPhase('processing');
          void refineRef.current(raw).catch(() => raw).then(result => {
            if (current.generation !== completedGeneration) return;
            callback.current(result); setPhase('idle'); setText('');
          });
        },
      });
      current.transport = transport;
      await transport.connect(connection.origin, connection.session, abort.signal);
      if (!active()) return;
      setPhase('recording'); setStartedAt(Date.now()); audio.capture(true);
      current.timer = setTimeout(() => fail('TIME_LIMIT'), connection.session.limits.maxSessionMs);
    } catch (failure) { if (active()) fail(failure instanceof Error ? failure.message : 'SERVICE_UNAVAILABLE'); }
  }, [cleanup, m]);
  const finish = () => {
    if (phase !== 'recording') return;
    const generation = state.current.generation;
    state.current.audio?.capture(false); setPhase('processing');
    state.current.transport?.send('input.commit', {});
    clearTimeout(state.current.timer);
    if (generation !== state.current.generation) return;
    state.current.timer = setTimeout(() => {
      if (generation !== state.current.generation) return;
      state.current.generation++; void cleanup(); setPhase('error'); setError('CONNECT_TIMEOUT');
    }, 15_000);
  };
  return { phase, text, error, startedAt, elapsed, start, finish, cancel, insertExisting: () => { if (text.trim()) callback.current(text); cancel(); } };
}
