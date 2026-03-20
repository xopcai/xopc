import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { createLogger } from '../utils/logger.js';
import { resolveSubagentRegistryPath } from '../config/paths.js';

const log = createLogger('SubagentRegistry');

// ============================================
// Types
// ============================================

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type CleanupMode = 'keep' | 'delete' | 'archive';

export interface RunResult {
  success: boolean;
  summary?: string;
  output?: string;
  error?: string;
}

export interface RequesterOrigin {
  channel?: string;
  accountId?: string;
  chatId?: string;
  sessionKey?: string;
}

export interface SubagentRun {
  runId: string;
  parentAgentId: string;
  childAgentId: string;
  task: string;
  status: RunStatus;
  cleanup: CleanupMode;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  cleanupHandled?: boolean;
  result?: RunResult;
  requesterOrigin?: RequesterOrigin;
}

export interface SubagentRegistryFile {
  version: number;
  runs: Record<string, SubagentRun>;
}

export interface RunFilter {
  parentAgentId?: string;
  childAgentId?: string;
  status?: RunStatus;
  cleanup?: CleanupMode;
}

// ============================================
// Subagent Registry
// ============================================

export class SubagentRegistry {
  private readonly registryPath: string;

  constructor(registryPath?: string) {
    this.registryPath = registryPath || resolveSubagentRegistryPath();
  }

  /**
   * Register a new subagent run
   */
  async register(run: SubagentRun): Promise<void> {
    const data = await this.load();

    data.runs[run.runId] = run;

    await this.save(data);
    log.debug({ runId: run.runId, parent: run.parentAgentId }, 'Registered subagent run');
  }

  /**
   * Update run status
   */
  async updateStatus(
    runId: string,
    status: RunStatus,
    result?: RunResult
  ): Promise<void> {
    const data = await this.load();
    const run = data.runs[runId];

    if (!run) {
      throw new Error(`Run "${runId}" not found`);
    }

    run.status = status;

    if (status === 'running' && !run.startedAt) {
      run.startedAt = Date.now();
    }

    if (['completed', 'failed', 'cancelled'].includes(status)) {
      run.endedAt = Date.now();
    }

    if (result) {
      run.result = result;
    }

    await this.save(data);
    log.debug({ runId, status }, 'Updated subagent run status');
  }

  /**
   * Mark a run's cleanup as handled
   */
  async markCleanupHandled(runId: string): Promise<void> {
    const data = await this.load();
    const run = data.runs[runId];

    if (run) {
      run.cleanupHandled = true;
      await this.save(data);
    }
  }

  /**
   * Get runs pending cleanup for a parent agent
   */
  async getPendingCleanups(parentAgentId: string): Promise<SubagentRun[]> {
    const data = await this.load();

    return Object.values(data.runs).filter(
      (run) =>
        run.parentAgentId === parentAgentId &&
        ['completed', 'failed', 'cancelled'].includes(run.status) &&
        !run.cleanupHandled
    );
  }

  /**
   * List runs with optional filtering
   */
  async listRuns(filter?: RunFilter): Promise<SubagentRun[]> {
    const data = await this.load();
    let runs = Object.values(data.runs);

    if (filter) {
      if (filter.parentAgentId) {
        runs = runs.filter((r) => r.parentAgentId === filter.parentAgentId);
      }
      if (filter.childAgentId) {
        runs = runs.filter((r) => r.childAgentId === filter.childAgentId);
      }
      if (filter.status) {
        runs = runs.filter((r) => r.status === filter.status);
      }
      if (filter.cleanup) {
        runs = runs.filter((r) => r.cleanup === filter.cleanup);
      }
    }

    return runs.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get a specific run
   */
  async getRun(runId: string): Promise<SubagentRun | null> {
    const data = await this.load();
    return data.runs[runId] || null;
  }

  /**
   * Prune old completed runs
   */
  async pruneCompleted(olderThanDays: number): Promise<number> {
    const data = await this.load();
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    let pruned = 0;
    for (const [runId, run] of Object.entries(data.runs)) {
      if (
        ['completed', 'failed', 'cancelled'].includes(run.status) &&
        run.endedAt &&
        run.endedAt < cutoff
      ) {
        delete data.runs[runId];
        pruned++;
      }
    }

    if (pruned > 0) {
      await this.save(data);
      log.info({ pruned, olderThanDays }, 'Pruned old subagent runs');
    }

    return pruned;
  }

  // ============================================
  // Private Methods
  // ============================================

  private async load(): Promise<SubagentRegistryFile> {
    if (!existsSync(this.registryPath)) {
      return { version: 2, runs: {} };
    }

    try {
      const content = await readFile(this.registryPath, 'utf-8');
      const data = JSON.parse(content);
      return {
        version: data.version || 2,
        runs: data.runs || {},
      };
    } catch (error) {
      log.warn({ error }, 'Failed to load subagent registry, starting fresh');
      return { version: 2, runs: {} };
    }
  }

  private async save(data: SubagentRegistryFile): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true });
    await writeFile(this.registryPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

// ============================================
// Global Instance
// ============================================

let globalRegistry: SubagentRegistry | undefined;

export function getSubagentRegistry(registryPath?: string): SubagentRegistry {
  if (!globalRegistry) {
    globalRegistry = new SubagentRegistry(registryPath);
  }
  return globalRegistry;
}

export function resetSubagentRegistry(): void {
  globalRegistry = undefined;
}
