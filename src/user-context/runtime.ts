import type { Config } from '../config/schema.js';
import { createMemoryManagerFromConfig } from '../agent/memory/create-memory-manager.js';
import type { MemoryManager } from '../agent/memory/manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('UserContextRuntimeRegistry');

export interface UserContextRuntime {
  memoryManager: MemoryManager;
}

/** Owns the process-wide user context runtime shared by every agent and workspace. */
export class UserContextRuntimeRegistry {
  private runtime?: UserContextRuntime;

  getOrCreate(config: Config): UserContextRuntime {
    if (this.runtime) return this.runtime;
    this.runtime = {
      memoryManager: createMemoryManagerFromConfig(config),
    };
    return this.runtime;
  }

  async clear(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = undefined;
    if (!runtime) return;
    await runtime.memoryManager.shutdownAll().catch((err) => {
      log.warn({ err }, 'Shared memory manager shutdown failed');
    });
  }
}
