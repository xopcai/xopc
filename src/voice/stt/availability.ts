import type { STTConfig } from './types.js';
import { resolveSTTProviderChain } from './factory.js';

export function isSTTAvailable(config?: STTConfig): boolean {
  if (!config?.enabled) {
    return false;
  }
  try {
    return resolveSTTProviderChain(config).length > 0;
  } catch {
    return false;
  }
}
