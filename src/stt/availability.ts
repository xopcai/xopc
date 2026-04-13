import type { STTConfig } from './types.js';
import { createSTTProvider } from './factory.js';

export function isSTTAvailable(config?: STTConfig): boolean {
  if (!config?.enabled) {
    return false;
  }

  try {
    const provider = createSTTProvider(config);
    return provider.isConfigured();
  } catch {
    return false;
  }
}
