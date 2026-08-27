import type { STTConfig } from './types.js';
import { resolveSTTProviderChain } from './factory.js';

/**
 * Runtime-truth availability check shared by channels and the gateway.
 */
export function isSTTAvailable(config?: STTConfig): boolean {
  if (!config?.enabled) return false;
  return resolveSTTProviderChain(config).length > 0;
}
