import { useSyncExternalStore } from 'react';
import { queryClient } from '../../query/query-client';
import { queryKeys } from '../../query/keys';
import {
  cancelVoiceConnection,
  createVoiceConnection,
  preflightVoice,
  VoiceRequestError,
  voiceSessionIdentity,
  voiceStatusOptions,
} from '../../query/voice';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { messages } from '../../i18n/messages';
import { NativeAudioSession } from './native-audio-session';
import { VoiceTransport } from './voice-transport';
import { VoiceCallController } from './voice-call-controller';

const audio = new NativeAudioSession();
const RECOVERY_PREPARE_DELAYS_MS = [0, 500, 1_500, 3_000, 6_000, 10_000] as const;
const RECOVERY_REQUEST_TIMEOUT_MS = 3_000;

function waitForRecovery(delayMs: number, signal: AbortSignal): Promise<void> {
  if (!delayMs) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new Error('CANCELLED')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function retryableRecoveryPreparation(error: unknown): boolean {
  if (error instanceof VoiceRequestError) return [0, 408, 409, 425, 429, 500, 502, 503, 504].includes(error.status);
  if (!(error instanceof Error)) return true;
  return !['CANCELLED', 'GATEWAY_CHANGED', 'SESSION_CHANGED'].includes(error.message);
}

export const voiceCall = new VoiceCallController({
  audio: {
    start: (background, callbacks) => audio.start(background, messages(usePreferencesStore.getState().language).voice, callbacks),
    capture: value => audio.capture(value), flush: () => audio.flush(), stop: () => audio.stop(),
    enqueue: (id, bytes) => audio.enqueue(id, bytes),
    duck: () => audio.duck(), resumeOutput: () => audio.resumeOutput(),
  },
  prepare: async (target, signal, recovering) => {
    const assertGateway = () => {
      if (useGatewayStore.getState().activeGatewayId !== target.gatewayId) throw new Error('GATEWAY_CHANGED');
      if (signal.aborted) throw new Error('CANCELLED');
    };
    let lastError: unknown;
    const delays = recovering ? RECOVERY_PREPARE_DELAYS_MS : [0] as const;
    for (const [attempt, delay] of delays.entries()) {
      await waitForRecovery(delay, signal);
      try {
        assertGateway();
        const status = await queryClient.fetchQuery(voiceStatusOptions(
          target.gatewayId,
          recovering ? { signal, timeoutMs: RECOVERY_REQUEST_TIMEOUT_MS } : {},
        ));
        const mode = target.mode ?? status.defaultMode;
        if (!status.capabilities[mode].available) throw new Error(status.capabilities[mode].reasonCode ?? 'PROVIDER_UNAVAILABLE');
        const engine = mode === 'natural' ? 'omni' as const : 'agent' as const;
        let identity = target.identity;
        let name = target.name;
        if (recovering || !identity) {
          const session = await voiceSessionIdentity(
            target.gatewayId,
            target.sessionKey,
            signal,
            recovering ? RECOVERY_REQUEST_TIMEOUT_MS : undefined,
          );
          assertGateway();
          if (!session?.sessionId) throw new Error('SESSION_CHANGED');
          identity = session.sessionId;
          name = session.name ?? name;
        }
        if (!identity) throw new Error('SESSION_CHANGED');
        if (recovering) await preflightVoice({ purpose: 'conversation', mode, sessionKey: target.sessionKey,
          supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] }, signal, RECOVERY_REQUEST_TIMEOUT_MS);
        assertGateway();
        return { mode, engine, identity, name: name ?? messages(usePreferencesStore.getState().language).voice.title };
      } catch (error) {
        lastError = error;
        if (!recovering || attempt === delays.length - 1 || !retryableRecoveryPreparation(error)) throw error;
      }
    }
    throw lastError;
  },
  create: createVoiceConnection,
  discard: cancelVoiceConnection,
  transport: callbacks => new VoiceTransport(callbacks),
  invalidate: target => {
    if (target.gatewayId !== useGatewayStore.getState().activeGatewayId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.session(target.sessionKey) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll });
  },
});
export const setCallSpeaker = (enabled: boolean) => audio.speaker(enabled);
export const isCallPermissionPromptActive = () => audio.permissionPromptActive;
export function useVoiceCall() { return useSyncExternalStore(voiceCall.subscribe, voiceCall.getSnapshot); }
