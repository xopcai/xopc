import { mkdir, readdir, stat, readFile, writeFile, rmdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/logger.js';
import {
  resolveStateDir,
  resolveAgentDir,
  resolveAgentMetadataPath,
  resolveWorkspaceDir,
  resolveSessionsDir,
  resolveInboxDir,
  resolveRunDir,
  resolvePidPath,
  resolveStatusPath,
} from '../config/paths.js';

const log = createLogger('AgentRegistry');

// ============================================
// Types
// ============================================

export type AgentStatus = 'idle' | 'running' | 'stopped' | 'error';

export interface AgentDescriptor {
  /** Agent unique ID */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  /** Current status */
  status: AgentStatus;
  /** Process ID when running */
  pid?: number;
  /** Path to agent directory */
  agentDir: string;
  /** Path to workspace directory */
  workspaceDir: string;
  /** Path to sessions directory */
  sessionsDir: string;
  /** Last active timestamp */
  lastActiveAt?: string;
  /** Tags */
  tags?: string[];
  /** Model used by this agent */
  model?: string;
}

export interface AgentMetadata {
  version: number;
  id: string;
  name: string;
  description?: string;
  model: string;
  createdAt: string;
  lastActiveAt?: string;
  config?: {
    maxTokens?: number;
    temperature?: number;
    compaction?: {
      enabled?: boolean;
      mode?: string;
    };
  };
  channels?: string[];
  tags?: string[];
  credentialProfile?: string;
}

export interface CreateAgentOptions {
  name?: string;
  description?: string;
  model?: string;
  tags?: string[];
  copyFrom?: string;
}

// ============================================
// Agent Registry
// ============================================

export class AgentRegistry {
  private readonly stateDir: string;

  constructor(stateDir?: string) {
    this.stateDir = stateDir || resolveStateDir();
  }

  /**
   * List all agents
   */
  async listAgents(): Promise<AgentDescriptor[]> {
    const agentsDir = join(this.stateDir, 'agents');

    if (!existsSync(agentsDir)) {
      return [];
    }

    const entries = await readdir(agentsDir, { withFileTypes: true });
    const agentIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    const agents: AgentDescriptor[] = [];
    for (const id of agentIds) {
      const agent = await this.getAgent(id);
      if (agent) {
        agents.push(agent);
      }
    }

    return agents.sort((a, b) => {
      // main agent first, then by name
      if (a.id === 'main') return -1;
      if (b.id === 'main') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get a specific agent's descriptor
   */
  async getAgent(agentId: string): Promise<AgentDescriptor | null> {
    const agentDir = resolveAgentDir(agentId);

    if (!existsSync(agentDir)) {
      return null;
    }

    const metadata = await this.loadMetadata(agentId);
    const status = await this.checkStatus(agentId);

    return {
      id: agentId,
      name: metadata?.name || agentId,
      description: metadata?.description,
      status: status.status,
      pid: status.pid,
      agentDir,
      workspaceDir: resolveWorkspaceDir(agentId),
      sessionsDir: resolveSessionsDir(agentId),
      lastActiveAt: metadata?.lastActiveAt,
      tags: metadata?.tags,
      model: metadata?.model,
    };
  }

  /**
   * Create a new agent
   */
  async createAgent(id: string, options: CreateAgentOptions = {}): Promise<AgentDescriptor> {
    // Validate ID
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(
        'Agent ID must contain only letters, numbers, hyphens, and underscores'
      );
    }

    if (id === 'default') {
      throw new Error('"default" is a reserved agent ID');
    }

    const agentDir = resolveAgentDir(id);

    if (existsSync(agentDir)) {
      throw new Error(`Agent "${id}" already exists`);
    }

    // Create directory structure
    await mkdir(agentDir, { recursive: true });
    await mkdir(join(agentDir, 'credentials'), { recursive: true });
    await mkdir(resolveWorkspaceDir(id), { recursive: true });
    await mkdir(join(resolveWorkspaceDir(id), '.state'), { recursive: true });
    await mkdir(join(resolveWorkspaceDir(id), 'memory'), { recursive: true });
    await mkdir(resolveSessionsDir(id), { recursive: true });
    await mkdir(join(resolveSessionsDir(id), 'archive'), { recursive: true });
    await mkdir(resolveInboxDir(id), { recursive: true });
    await mkdir(join(resolveInboxDir(id), 'pending'), { recursive: true });
    await mkdir(join(resolveInboxDir(id), 'processed'), { recursive: true });
    await mkdir(resolveRunDir(id), { recursive: true });

    // Create metadata
    const now = new Date().toISOString();
    const metadata: AgentMetadata = {
      version: 1,
      id,
      name: options.name || id,
      description: options.description || `Agent ${id}`,
      model: options.model || 'anthropic/claude-sonnet-4-5',
      createdAt: now,
      lastActiveAt: now,
      tags: options.tags || [],
    };

    await writeFile(
      resolveAgentMetadataPath(id),
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );

    // If copyFrom is specified, copy workspace files
    if (options.copyFrom) {
      await this.copyWorkspace(options.copyFrom, id);
    }

    log.info({ agentId: id }, 'Created new agent');

    return {
      id,
      name: metadata.name,
      description: metadata.description,
      status: 'idle',
      agentDir,
      workspaceDir: resolveWorkspaceDir(id),
      sessionsDir: resolveSessionsDir(id),
      lastActiveAt: now,
      tags: metadata.tags,
      model: metadata.model,
    };
  }

  /**
   * Delete an agent
   */
  async deleteAgent(id: string, options: { force?: boolean } = {}): Promise<void> {
    if (id === 'main' && !options.force) {
      throw new Error('Cannot delete the main agent without --force');
    }

    const agentDir = resolveAgentDir(id);

    if (!existsSync(agentDir)) {
      throw new Error(`Agent "${id}" does not exist`);
    }

    // Check if agent is running
    const status = await this.checkStatus(id);
    if (status.status === 'running') {
      throw new Error(
        `Agent "${id}" is currently running. Stop it first or use --force.`
      );
    }

    await rmdir(agentDir, { recursive: true });

    log.info({ agentId: id }, 'Deleted agent');
  }

  /**
   * Update agent metadata
   */
  async updateAgent(
    id: string,
    updates: Partial<Pick<AgentMetadata, 'name' | 'description' | 'model' | 'tags'>>
  ): Promise<AgentDescriptor> {
    const metadata = await this.loadMetadata(id);

    if (!metadata) {
      throw new Error(`Agent "${id}" does not exist`);
    }

    Object.assign(metadata, updates);
    metadata.lastActiveAt = new Date().toISOString();

    await writeFile(
      resolveAgentMetadataPath(id),
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );

    const descriptor = await this.getAgent(id);
    return descriptor!;
  }

  /**
   * Set the default agent (symlink or env var approach)
   */
  async setDefaultAgent(id: string): Promise<void> {
    const agent = await this.getAgent(id);
    if (!agent) {
      throw new Error(`Agent "${id}" does not exist`);
    }

    // For now, we rely on environment variables
    // In the future, we could create a .default-agent file
    log.info({ agentId: id }, 'Set default agent (use XOPCBOT_AGENT_ID env var to activate)');
  }

  /**
   * Get the default agent ID
   */
  getDefaultAgentId(): string {
    return process.env.XOPCBOT_AGENT_ID || 'main';
  }

  /**
   * Check if an agent exists
   */
  async agentExists(id: string): Promise<boolean> {
    const agentDir = resolveAgentDir(id);
    return existsSync(agentDir);
  }

  /**
   * Clean up orphaned run directories
   */
  async cleanupOrphanedRuns(): Promise<number> {
    const agents = await this.listAgents();
    let cleaned = 0;

    for (const agent of agents) {
      const runDir = resolveRunDir(agent.id);
      if (!existsSync(runDir)) continue;

      const pidPath = resolvePidPath(agent.id);
      if (!existsSync(pidPath)) continue;

      try {
        const pidContent = await readFile(pidPath, 'utf-8');
        const pid = parseInt(pidContent.trim(), 10);

        // Check if process exists
        try {
          process.kill(pid, 0); // Signal 0 checks if process exists
          // Process exists, don't clean up
        } catch {
          // Process doesn't exist, clean up
          await rmdir(runDir, { recursive: true });
          cleaned++;
          log.info({ agentId: agent.id, pid }, 'Cleaned up orphaned run directory');
        }
      } catch (error) {
        log.warn({ agentId: agent.id, error }, 'Failed to check PID file');
      }
    }

    return cleaned;
  }

  // ============================================
  // Private Methods
  // ============================================

  private async loadMetadata(agentId: string): Promise<AgentMetadata | null> {
    const path = resolveAgentMetadataPath(agentId);

    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as AgentMetadata;
    } catch (error) {
      return null;
    }
  }

  private async checkStatus(agentId: string): Promise<{ status: AgentStatus; pid?: number }> {
    const runDir = resolveRunDir(agentId);
    const pidPath = resolvePidPath(agentId);
    const statusPath = resolveStatusPath(agentId);

    if (!existsSync(runDir) || !existsSync(pidPath)) {
      return { status: 'idle' };
    }

    try {
      const pidContent = await readFile(pidPath, 'utf-8');
      const pid = parseInt(pidContent.trim(), 10);

      // Check if process exists
      try {
        process.kill(pid, 0);
        return { status: 'running', pid };
      } catch {
        return { status: 'stopped' };
      }
    } catch (error) {
      return { status: 'error' };
    }
  }

  private async copyWorkspace(fromId: string, toId: string): Promise<void> {
    const fromDir = resolveWorkspaceDir(fromId);
    const toDir = resolveWorkspaceDir(toId);

    // Copy essential workspace files if they exist
    const filesToCopy = [
      'SOUL.md',
      'IDENTITY.md',
      'AGENTS.md',
      'TOOLS.md',
      'HEARTBEAT.md',
    ];

    for (const file of filesToCopy) {
      const fromPath = join(fromDir, file);
      const toPath = join(toDir, file);

      if (existsSync(fromPath) && !existsSync(toPath)) {
        try {
          const content = await readFile(fromPath, 'utf-8');
          await writeFile(toPath, content, 'utf-8');
        } catch (error) {
          log.warn({ file, error }, 'Failed to copy workspace file');
        }
      }
    }
  }
}

// ============================================
// Global Instance
// ============================================

let globalRegistry: AgentRegistry | undefined;

export function getAgentRegistry(stateDir?: string): AgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentRegistry(stateDir);
  }
  return globalRegistry;
}

export function resetAgentRegistry(): void {
  globalRegistry = undefined;
}

// ============================================
// Convenience Functions
// ============================================

export async function listAgents(stateDir?: string): Promise<AgentDescriptor[]> {
  const registry = getAgentRegistry(stateDir);
  return registry.listAgents();
}

export async function getAgent(agentId: string, stateDir?: string): Promise<AgentDescriptor | null> {
  const registry = getAgentRegistry(stateDir);
  return registry.getAgent(agentId);
}

export async function createAgent(
  id: string,
  options: CreateAgentOptions,
  stateDir?: string
): Promise<AgentDescriptor> {
  const registry = getAgentRegistry(stateDir);
  return registry.createAgent(id, options);
}

export async function deleteAgent(id: string, options?: { force?: boolean }, stateDir?: string): Promise<void> {
  const registry = getAgentRegistry(stateDir);
  return registry.deleteAgent(id, options);
}
