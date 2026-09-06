import { useSyncExternalStore } from 'react';
import { queryClient } from '../../query/query-client';
import { queryKeys } from '../../query/keys';
import { preflightVoice, createVoiceConnection, voiceSessionIdentity, voiceStatusOptions } from '../../query/voice';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { messages } from '../../i18n/messages';
import { NativeAudioSession } from './native-audio-session';
import { VoiceTransport } from './voice-transport';
import { VoiceCallController } from './voice-call-controller';

const audio = new NativeAudioSession();
export const voiceCall = new VoiceCallController({
  audio: {
    start: (background, callbacks) => audio.start(background, messages(usePreferencesStore.getState().language).voice, callbacks),
    capture: value => audio.capture(value), flush: () => audio.flush(), stop: () => audio.stop(),
    enqueue: (id, bytes) => audio.enqueue(id, bytes),
  },
  prepare: async (target, signal, recovering) => {
    const assertGateway = () => {
      if (useGatewayStore.getState().activeGatewayId !== target.gatewayId) throw new Error('GATEWAY_CHANGED');
      if (signal.aborted) throw new Error('CANCELLED');
    };
    assertGateway();
    const status = await queryClient.fetchQuery(voiceStatusOptions(target.gatewayId));
    const engine = target.engine ?? status.defaultEngine;
    if (!status.capabilities[engine].available) throw new Error(status.capabilities[engine].reasonCode ?? 'PROVIDER_UNAVAILABLE');
    const session = await voiceSessionIdentity(target.gatewayId, target.sessionKey);
    assertGateway();
    if (!session?.sessionId) throw new Error('SESSION_CHANGED');
    for (const delay of recovering ? [0, 1000, 3000] : [0]) {
      if (delay) await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(new Error('CANCELLED')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, delay);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      try { await preflightVoice({ purpose: 'conversation', engine, sessionKey: target.sessionKey }, signal); break; }
      catch (error) {
        if (!recovering || !(error instanceof Error) || !('status' in error) || error.status !== 409) throw error;
        if (delay === 3000) throw error;
      }
    }
    assertGateway();
    return { engine, identity: session.sessionId, name: session.name ?? messages(usePreferencesStore.getState().language).voice.title };
  },
  create: async (request, signal, identity) => {
    const connection = await createVoiceConnection(request, signal);
    const gatewayId = useGatewayStore.getState().activeGatewayId;
    if (!gatewayId || !request.sessionKey) throw new Error('GATEWAY_CHANGED');
    const session = await voiceSessionIdentity(gatewayId, request.sessionKey);
    if (signal.aborted) throw new Error('CANCELLED');
    if (session?.sessionId !== identity) throw new Error('SESSION_CHANGED');
    return connection;
  },
  transport: callbacks => new VoiceTransport(callbacks),
  invalidate: target => {
    if (target.gatewayId !== useGatewayStore.getState().activeGatewayId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.session(target.sessionKey) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll });
  },
});
export const setCallSpeaker = (enabled: boolean) => audio.speaker(enabled);
export function useVoiceCall() { return useSyncExternalStore(voiceCall.subscribe, voiceCall.getSnapshot); }
