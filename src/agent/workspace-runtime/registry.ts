/**
 * WorkspaceRuntimeRegistry — lazy per-workspace cache of skill/memory/prompt-builder runtimes.
 *
 * Previously these four collaborators (`SkillManager`, `SystemPromptBuilder`,
 * `BuiltinMemoryStore`, `MemoryManager`) were created inline inside
 * `AgentManager.getWorkspaceRuntime` and cached in a private Map. They live
 * outside `AgentInstance` because multiple session keys for the same agent may
 * share a workspace. Memory ownership is agent-scoped, so runtimes are keyed by
 * both the effective agent id and resolved workspace path.
 *
 * Extracted so:
 *   - `AgentManager` no longer juggles four sibling caches.
 *   - Hot-reload teardown (`clearAll`) lives in one place — there are now no
 *     callers that forget to shut down `memoryManager`.
 *   - Future per-workspace runtimes (e.g. embedding store, vector cache) plug in
 *     through `getOrCreate` without touching `AgentManager`.
 */

import type { Config } from '../../config/schema.js';
import { normalizeAgentId } from '../../routing/agent-session-key.js';
import { resolveAgentIdForWorkspacePath } from '../agent-scope.js';
import { BuiltinMemoryStore } from '../memory/builtin-memory-store.js';
import { createMemoryManagerFromConfig } from '../memory/create-memory-manager.js';
import { resolveBuiltinMemoryStoreConfig } from '../memory/memory-config.js';
import type { MemoryManager } from '../memory/manager.js';
import { SkillManager } from '../skills/skill-manager.js';
import { SystemPromptBuilder } from '../prompt/service-prompt-builder.js';
import { CodeIntelligenceRuntime } from '../code-intelligence/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('WorkspaceRuntimeRegistry');

export interface WorkspaceRuntime {
  skillManager: SkillManager;
  systemPromptBuilder: SystemPromptBuilder;
  builtinMemoryStore: BuiltinMemoryStore;
  memoryManager: MemoryManager;
  codeIntelligence: CodeIntelligenceRuntime;
}

export interface WorkspaceRuntimeRegistryOptions {
  /** Effective config snapshot accessor (must always return a value when called). */
  getConfig: () => Config;
  /** Absolute path to the bundled skills directory shared by every workspace. */
  bundledSkillsDir: string;
  /** Called after a runtime is first created for a workspace. */
  onRuntimeCreated?: (resolvedPath: string) => void;
}

export class WorkspaceRuntimeRegistry {
  private readonly runtimes = new Map<string, WorkspaceRuntime>();
  private readonly notifiedWorkspacePaths = new Set<string>();
  private readonly getConfig: () => Config;
  private readonly bundledSkillsDir: string;
  private readonly onRuntimeCreated?: (resolvedPath: string) => void;

  constructor(opts: WorkspaceRuntimeRegistryOptions) {
    this.getConfig = opts.getConfig;
    this.bundledSkillsDir = opts.bundledSkillsDir;
    this.onRuntimeCreated = opts.onRuntimeCreated;
  }

  /** Lazily construct and cache an agent-scoped runtime for a workspace. */
  getOrCreate(resolvedPath: string, requestedAgentId?: string): WorkspaceRuntime {
    const cfg = this.getConfig();
    const agentId = normalizeAgentId(
      requestedAgentId?.trim() || resolveAgentIdForWorkspacePath(cfg, resolvedPath),
    );
    const runtimeKey = `${agentId}\u0000${resolvedPath}`;
    const existing = this.runtimes.get(runtimeKey);
    if (existing) {
      return existing;
    }

    const builtinMemoryStore = new BuiltinMemoryStore(
      resolveBuiltinMemoryStoreConfig(resolvedPath, cfg, agentId),
    );
    const memoryManager = createMemoryManagerFromConfig(resolvedPath, builtinMemoryStore, cfg, agentId);
    const skillManager = new SkillManager(resolvedPath, this.bundledSkillsDir);
    const systemPromptBuilder = new SystemPromptBuilder({
      workspace: resolvedPath,
      config: cfg,
      skillManager,
    });
    const codeIntelligence = new CodeIntelligenceRuntime({
      workspace: resolvedPath,
      getConfig: this.getConfig,
    });

    const rt: WorkspaceRuntime = {
      skillManager,
      systemPromptBuilder,
      builtinMemoryStore,
      memoryManager,
      codeIntelligence,
    };
    this.runtimes.set(runtimeKey, rt);
    if (!this.notifiedWorkspacePaths.has(resolvedPath)) {
      this.notifiedWorkspacePaths.add(resolvedPath);
      this.onRuntimeCreated?.(resolvedPath);
    }
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
    this.notifiedWorkspacePaths.clear();
    await Promise.allSettled(
      toShutdown.flatMap((rt) => [
        rt.memoryManager.shutdownAll().catch((err) => {
          log.warn({ err }, 'memoryManager.shutdownAll failed');
        }),
        rt.codeIntelligence.dispose().catch((err) => {
          log.warn({ err }, 'codeIntelligence.dispose failed');
        }),
      ]),
    );
  }
}
