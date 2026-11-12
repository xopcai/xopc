import type { MusicGenerationDefaults, MusicMode } from '@xopcai/gateway-contract';

import { CredentialResolver } from '../auth/credentials.js';
import { DurableState } from '../storage/sqlite/durable-state.js';

const settings = new DurableState<string>('music-generation');
const defaults = new DurableState<MusicGenerationDefaults>('music-generation-defaults');

export function storedMusicModel(): string | undefined {
  return settings.get('model');
}

export function saveMusicModel(modelRef: string): void {
  settings.set('model', modelRef);
}

export function getMusicDefaults(modelRef: string, modes: readonly MusicMode[]): MusicGenerationDefaults {
  const saved = defaults.get(modelRef);
  return { mode: saved && modes.includes(saved.mode) ? saved.mode : modes[0] ?? 'song' };
}

export function saveMusicDefaults(modelRef: string, settings: MusicGenerationDefaults): void {
  defaults.set(modelRef, settings);
}

export function musicCredentials() {
  return new CredentialResolver();
}
