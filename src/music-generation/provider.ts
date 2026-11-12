import type { MusicJobErrorCode, MusicMode } from '@xopcai/gateway-contract';

export interface MusicInput {
  mode: MusicMode;
  prompt: string;
  lyrics: string | null;
}

export type MusicProviderStatus =
  | { state: 'submitted' | 'running' }
  | { state: 'completed'; url: string; durationMs: number | null }
  | { state: 'failed'; reason: string };

export interface MusicProvider {
  id: string;
  name: string;
  models: Readonly<Record<string, {
    name?: string;
    modes: readonly MusicMode[];
    maxPromptCharacters: number;
    maxLyricsCharacters: number;
  }>>;
  environmentKey(): string | undefined;
  submit(key: string, model: string, input: MusicInput): Promise<string>;
  query(key: string, mode: MusicMode, taskId: string): Promise<MusicProviderStatus>;
  allowsAudioHost(host: string): boolean;
}

export class MusicRequestRejected extends Error {
  constructor(message: string, readonly code: Extract<MusicJobErrorCode, 'provider_rate_limited' | 'provider_rejected'>) {
    super(message);
  }
}
