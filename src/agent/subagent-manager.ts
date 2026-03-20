import { fork, spawn, type ChildProcess } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/logger.js';
import { resolveAgentDir, resolveRunDir, resolvePidPath, resolveStatusPath } from '../config/paths.js';
import { getAgentRegistry, createAgent } from './agent-registry.js';
import { getSubagentRegistry } from './subagent-registry.js';
import { AgentBus, type SubagentResult } from './ipc/bus.js';

const log = createLogger('SubagentManager');

// ============================================
// Types
// ============================================

export interface SubagentConfig {
  /** Agent ID for the subagent */
  agentId?: string;
  /** Model to use */
  model?: string;
  /** Task timeout in ms */
  timeoutMs?: number;
  /** Cleanup mode */
  cleanup?: 'keep' | 'delete' | 'archive';
  /** Whether to use fork or spawn */
  mode?: 'fork' | 'spawn';
  /** Environment variables */
  env?: Record<string, string>;
}

export interface RunningSubagent {
  runId: string;
  agentId: string;
  process: ChildProcess;
  startTime: number;
}

// ============================================
// Subagent Manager
// ============================================

export class SubagentManager {
  private readonly stateDir: string;
  private readonly parentAgentId: string;
  private runningSubagents: Map<string, RunningSubagent> = new Map();
  private bus: AgentBus;

  constructor(stateDir: string, parentAgentId: string) {
    this.stateDir = stateDir;
    this.parentAgentId = parentAgentId;
    this.bus = new AgentBus(stateDir, parentAgentId);
  }

  /**
   * Spawn a new subagent and execute a task
   */
  async spawn(task: string, options: SubagentConfig = {}): Promise<SubagentResult> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const agentId = options.agentId || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    log.info({ runId, agentId, task: task.slice(0, 100) }, 'Spawning subagent');

    // Register the run
    const registry = getSubagentRegistry();
    await registry.register({
      runId,
      parentAgentId: this.parentAgentId,
      childAgentId: agentId,
      task,
      status: 'pending',
      cleanup: options.cleanup || 'keep',
      createdAt: Date.now(),
    });

    try {
      // Create agent if it doesn't exist
      const agentRegistry = getAgentRegistry(this.stateDir);
      const exists = await agentRegistry.agentExists(agentId);

      if (!exists) {
        await createAgent(agentId, {
          model: options.model,
          description: `Subagent for: ${task.slice(0, 100)}`,
          tags: ['subagent'],
        });
      }

      // Start the agent process
      const childProcess = await this.startAgentProcess(agentId, options);

      // Track running subagent
      this.runningSubagents.set(runId, {
        runId,
        agentId,
        process: childProcess,
        startTime: Date.now(),
      });

      // Update status
      await registry.updateStatus(runId, 'running');

      // Set up process monitoring
      childProcess.on('exit', async (code, signal) => {
        log.info({ runId, agentId, code, signal }, 'Subagent process exited');
        this.runningSubagents.delete(runId);

        const status = code === 0 ? 'completed' : 'failed';
        await registry.updateStatus(runId, status, {
          success: code === 0,
          summary: `Exited with code ${code}`,
        });
      });

      // Wait for the task to complete
      const result = await this.executeTask(runId, agentId, task, options);

      return result;
    } catch (error) {
      log.error({ runId, agentId, error }, 'Failed to spawn subagent');

      await registry.updateStatus(runId, 'failed', {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        runId,
      };
    }
  }

  /**
   * Send a signal to a running subagent
   */
  async signal(runId: string, signal: 'STOP' | 'PAUSE' | 'RESUME'): Promise<boolean> {
    const subagent = this.runningSubagents.get(runId);

    if (!subagent) {
      log.warn({ runId }, 'Subagent not found or not running');
      return false;
    }

    try {
      switch (signal) {
        case 'STOP':
          subagent.process.kill('SIGTERM');
          break;
        case 'PAUSE':
          subagent.process.kill('SIGSTOP');
          break;
        case 'RESUME':
          subagent.process.kill('SIGCONT');
          break;
      }

      log.info({ runId, signal }, 'Signal sent to subagent');
      return true;
    } catch (error) {
      log.error({ runId, signal, error }, 'Failed to send signal');
      return false;
    }
  }

  /**
   * Get list of running subagents
   */
  getRunningSubagents(): Array<{ runId: string; agentId: string; startTime: number }> {
    return Array.from(this.runningSubagents.values()).map((s) => ({
      runId: s.runId,
      agentId: s.agentId,
      startTime: s.startTime,
    }));
  }

  /**
   * Clean up completed subagents based on their cleanup mode
   */
  async cleanupCompleted(): Promise<number> {
    const registry = getSubagentRegistry();
    const pendingCleanups = await registry.getPendingCleanups(this.parentAgentId);

    let cleaned = 0;

    for (const run of pendingCleanups) {
      try {
        switch (run.cleanup) {
          case 'delete':
            await this.deleteSubagent(run.childAgentId);
            break;
          case 'archive':
            await this.archiveSubagent(run.childAgentId, run.runId);
            break;
          case 'keep':
          default:
            // Do nothing, keep the agent
            break;
        }

        await registry.markCleanupHandled(run.runId);
        cleaned++;
      } catch (error) {
        log.error({ runId: run.runId, error }, 'Failed to cleanup subagent');
      }
    }

    return cleaned;
  }

  /**
   * Dispose and clean up
   */
  async dispose(): Promise<void> {
    // Stop all running subagents
    for (const [runId, subagent] of this.runningSubagents) {
      log.info({ runId }, 'Stopping subagent on dispose');
      subagent.process.kill('SIGTERM');
    }

    this.runningSubagents.clear();
    this.bus.stopListening();
  }

  // ============================================
  // Private Methods
  // ============================================

  private async startAgentProcess(
    agentId: string,
    options: SubagentConfig
  ): Promise<ChildProcess> {
    const runDir = resolveRunDir(agentId);
    await mkdir(runDir, { recursive: true });

    // Write PID file (will be updated by child)
    const pidPath = resolvePidPath(agentId);

    // Write initial status
    const statusPath = resolveStatusPath(agentId);
    await writeFile(
      statusPath,
      JSON.stringify(
        {
          agentId,
          startedAt: new Date().toISOString(),
          status: 'starting',
        },
        null,
        2
      ),
      'utf-8'
    );

    // Prepare environment
    const env = {
      ...process.env,
      XOPCBOT_AGENT_ID: agentId,
      XOPCBOT_STATE_DIR: this.stateDir,
      ...options.env,
    };

    // Start the process
    if (options.mode === 'spawn') {
      // Spawn as separate process
      const child = spawn(process.execPath, ['--eval', `require('${this.getEntryPoint()}').startAgent('${agentId}')`], {
        env,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Write PID
      if (child.pid) {
        await writeFile(pidPath, String(child.pid), 'utf-8');
      }

      return child;
    } else {
      // Fork as child process (default)
      const child = fork(this.getEntryPoint(), [agentId], {
        env,
        detached: false,
        silent: true,
      });

      // Write PID
      if (child.pid) {
        await writeFile(pidPath, String(child.pid), 'utf-8');
      }

      return child;
    }
  }

  private async executeTask(
    runId: string,
    agentId: string,
    task: string,
    options: SubagentConfig
  ): Promise<SubagentResult> {
    // Wait for agent to be ready (socket available)
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      // Check if socket is available
      const { AgentSocketClient } = await import('./ipc/socket.js');
      const client = new AgentSocketClient(agentId);

      try {
        await client.connect();

        // Send task via socket
        const { createTaskMessage } = await import('./ipc/types.js');
        const msg = createTaskMessage(this.parentAgentId, agentId, task, {
          timeoutMs: options.timeoutMs,
        });

        const response = await client.sendAndWait(msg, options.timeoutMs || 600000);

        client.disconnect();

        if (response.type === 'response') {
          const pl = response.payload as {
            success: boolean;
            data?: unknown;
            error?: string;
          };
          return {
            success: pl.success,
            output: pl.data as string,
            error: pl.error,
            runId,
          };
        }

        return {
          success: false,
          error: 'Unexpected response type',
          runId,
        };
      } catch (error) {
        if (i === maxAttempts - 1) {
          throw error;
        }
        // Continue waiting
      }
    }

    throw new Error('Timeout waiting for subagent to be ready');
  }

  private async deleteSubagent(agentId: string): Promise<void> {
    const agentDir = resolveAgentDir(agentId);

    if (!existsSync(agentDir)) return;

    const { rm } = await import('fs/promises');
    await rm(agentDir, { recursive: true, force: true });

    log.info({ agentId }, 'Deleted subagent');
  }

  private async archiveSubagent(agentId: string, runId: string): Promise<void> {
    // For now, just rename the directory
    const agentDir = resolveAgentDir(agentId);
    const archiveDir = join(this.stateDir, 'agents', `.archived-${agentId}-${runId}`);

    if (!existsSync(agentDir)) return;

    const { rename } = await import('fs/promises');
    await rename(agentDir, archiveDir);

    log.info({ agentId, runId }, 'Archived subagent');
  }

  private getEntryPoint(): string {
    // Return path to agent entry point
    // This should be the main xopcbot entry point
    return join(process.cwd(), 'dist', 'agent', 'runner.js');
  }
}

// ============================================
// Convenience Functions
// ============================================

let globalManager: SubagentManager | undefined;

export function getSubagentManager(
  stateDir: string,
  parentAgentId: string
): SubagentManager {
  if (!globalManager) {
    globalManager = new SubagentManager(stateDir, parentAgentId);
  }
  return globalManager;
}

export function resetSubagentManager(): void {
  globalManager?.dispose();
  globalManager = undefined;
}
