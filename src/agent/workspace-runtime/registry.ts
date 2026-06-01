/**
 * WorkspaceRuntimeRegistry — lazy per-workspace cache of skill/memory/prompt-builder runtimes.
 *
 * Previously these four collaborators (`SkillManager`, `SystemPromptBuilder`,
 * `BuiltinMemoryStore`, `MemoryManager`) were created inline inside
 * `AgentManager.getWorkspaceRuntime` and cached in a private Map. They live
 * outside `AgentInstance` because multiple session keys may share a workspace
 * (the runtime is keyed by **resolved workspace path**, not session key).
 *
 * Extracted so:
 *   - `AgentManager` no longer juggles four sibling caches.
 *   - Hot-reload teardown (`clearAll`) lives in one place — there are now no
 *     callers that forget to shut down `memoryManager`.
 *   - Future per-workspace runtimes (e.g. embedding store, vector cache) plug in
 *     through `getOrCreate` without touching `AgentManager`.
 */

import type { Config } from '../../config/schema.js';
import { BuiltinMemoryStore } from '../memory/builtin-memory-store.js';
import { createMemoryManagerFromConfig } from '../memory/create-memory-manager.js';
import { resolveBuiltinMemoryStoreConfig } from '../memory/memory-config.js';
import type { MemoryManager } from '../memory/manager.js';
import { SkillManager } from '../skills/skill-manager.js';
import { SystemPromptBuilder } from '../prompt/service-prompt-builder.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('WorkspaceRuntimeRegistry');

export interface WorkspaceRuntime {
  skillManager: SkillManager;
  systemPromptBuilder: SystemPromptBuilder;
  builtinMemoryStore: BuiltinMemoryStore;
  memoryManager: MemoryManager;
}

export interface WorkspaceRuntimeRegistryOptions {
  /** Effective config snapshot accessor (must always return a value when called). */
  getConfig: () => Config;
  /** Absolute path to the bundled skills directory shared by every workspace. */
  bundledSkillsDir: string;
}

export class WorkspaceRuntimeRegistry {
  private readonly runtimes = new Map<string, WorkspaceRuntime>();
  private readonly getConfig: () => Config;
  private readonly bundledSkillsDir: string;

  constructor(opts: WorkspaceRuntimeRegistryOptions) {
    this.getConfig = opts.getConfig;
    this.bundledSkillsDir = opts.bundledSkillsDir;
  }

  /** Lazily construct (and cache) the runtime for a resolved workspace path. */
  getOrCreate(resolvedPath: string): WorkspaceRuntime {
    const existing = this.runtimes.get(resolvedPath);
    if (existing) {
      return existing;
    }

    const cfg = this.getConfig();
    const builtinMemoryStore = new BuiltinMemoryStore(
      resolveBuiltinMemoryStoreConfig(resolvedPath, cfg),
    );
    const memoryManager = createMemoryManagerFromConfig(resolvedPath, builtinMemoryStore, cfg);
    const skillManager = new SkillManager(resolvedPath, this.bundledSkillsDir);
    const systemPromptBuilder = new SystemPromptBuilder({
      workspace: resolvedPath,
      config: cfg,
      skillManager,
    });

    const rt: WorkspaceRuntime = {
      skillManager,
      systemPromptBuilder,
      builtinMemoryStore,
      memoryManager,
    };
    this.runtimes.set(resolvedPath, rt);
    return rt;
  }

  /** Iterate every live workspace runtime (used by skill / config hot-reload). */
  values(): IterableIterator<WorkspaceRuntime> {
    return this.runtimes.values();
  }

  /**
   * Tear down every runtime (shutdown memory providers) and forget the cache.
   * Used by `AgentManager.updateAgentDefaults` and `AgentManager.dispose`.
   */
  async clearAll(): Promise<void> {
    const toShutdown = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.allSettled(
      toShutdown.map((rt) =>
        rt.memoryManager.shutdownAll().catch((err) => {
          log.warn({ err }, 'memoryManager.shutdownAll failed');
        }),
      ),
    );
  }
}
