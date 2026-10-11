import type { OpeningGreetingResult } from './opening-greeting.js';
import type { VoiceServerEvent } from '@xopcai/realtime-protocol/voice';

export type VoiceEventSink = <T extends VoiceServerEvent['type']>(
  type: T,
  payload: Extract<VoiceServerEvent, { type: T }>['payload'],
) => void;

export interface VoiceEngine {
  start(): Promise<void>;
  offerOpeningGreeting?(input: { responseId: string; text: string; deadlineAt: number }): Promise<OpeningGreetingResult>;
  appendAudio(bytes: Uint8Array): void;
  setInputMuted(muted: boolean): void | Promise<void>;
  commit(): Promise<void>;
  cancel(responseId: string, reason: 'client_cancelled' | 'barge_in'): boolean;
  cancelTask(taskId: string): Promise<boolean>;
  acknowledge(responseId: string, playedDurationMs: number): void;
  isConversationIdle?(): boolean;
  canOfferTaskUpdate?(): boolean;
  offerTaskUpdate?(input: { clientMessageId: string; content: string }): Promise<boolean>;
  close(): void | Promise<void>;
}
