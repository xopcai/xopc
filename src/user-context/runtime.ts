import type { Config } from '../config/schema.js';
import { resolveUserDir } from '../config/paths.js';
import { BuiltinMemoryStore } from '../agent/memory/builtin-memory-store.js';
import { createMemoryManagerFromConfig } from '../agent/memory/create-memory-manager.js';
import { resolveBuiltinMemoryStoreConfig } from '../agent/memory/memory-config.js';
import type { MemoryManager } from '../agent/memory/manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('UserContextRuntimeRegistry');

export interface UserContextRuntime {
  builtinMemoryStore: BuiltinMemoryStore;
  memoryManager: MemoryManager;
}

/** Owns the process-wide user context runtime shared by every agent and workspace. */
export class UserContextRuntimeRegistry {
  private runtime?: UserContextRuntime;

  getOrCreate(config: Config): UserContextRuntime {
    if (this.runtime) return this.runtime;
    const userContextRoot = resolveUserDir();
    const builtinMemoryStore = new BuiltinMemoryStore(
      resolveBuiltinMemoryStoreConfig(userContextRoot, config),
    );
    this.runtime = {
      builtinMemoryStore,
      memoryManager: createMemoryManagerFromConfig(userContextRoot, builtinMemoryStore, config),
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
