import type { VoiceServerEvent } from '@xopcai/realtime-protocol/voice';

export type VoiceEventSink = <T extends VoiceServerEvent['type']>(
  type: T,
  payload: Extract<VoiceServerEvent, { type: T }>['payload'],
) => void;

export interface VoiceEngine {
  start(): Promise<void>;
  appendAudio(bytes: Uint8Array): void;
  commit(): Promise<void>;
  cancel(responseId: string, reason: 'client_cancelled' | 'barge_in'): boolean;
  acknowledge(responseId: string, playedBytes: number): void;
  close(): void;
}
