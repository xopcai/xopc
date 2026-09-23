import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentDefaults, AgentEntry } from '../agent-config/index.js';
import { resolveAgentDir, resolveAgentHomeDir, resolveAgentProfileDir, resolveUserPath } from '../agent/agent-scope.js';
import { seedAgentProfileMarkdownFiles } from '../agent/context/workspace-seed.js';
import { resolveStateDir } from '../config/paths-state.js';
import { resolveDefaultAgentWorkspaceDir } from '../config/workspace-defaults.js';
import type { BindingRule } from '../routing/binding-schema.js';
import { DEFAULT_AGENT_ID, normalizeAgentId } from './id.js';
import { AgentCatalogRepository } from './repository.js';
import type { AgentCatalogSettings, StoredAgent } from './types.js';

function workspaceForEntry(entry: AgentEntry, defaultAgentId: string): string {
  if (entry.workspace?.trim()) return resolveUserPath(entry.workspace);
  if (entry.id === defaultAgentId) return resolveDefaultAgentWorkspaceDir(process.env);
  return join(resolveStateDir(process.env), `workspace-${entry.id}`);
}

export class AgentCatalogService {
  constructor(private readonly repository = new AgentCatalogRepository()) {}

  async create(entry: AgentEntry): Promise<StoredAgent> {
    const pending = this.repository.create(entry);
    try {
      await this.provision(pending);
      return this.repository.markProvisioned(pending.id);
    } catch (error) {
      this.repository.markProvisioningFailed(
        pending.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async resumePendingProvisioning(): Promise<void> {
    for (const agentId of this.repository.listPendingProvisioningAgentIds()) {
      const agent = this.repository.get(agentId);
      if (!agent) continue;
      try {
        await this.provision(agent);
        this.repository.markProvisioned(agentId);
      } catch (error) {
        this.repository.markProvisioningFailed(
          agentId,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /** Startup recovery for catalog rows committed before their directories were provisioned. */
  resumePendingProvisioningSync(): void {
    for (const agentId of this.repository.listPendingProvisioningAgentIds()) {
      const agent = this.repository.get(agentId);
      if (!agent) continue;
      try {
        this.provisionSync(agent);
        this.repository.markProvisioned(agentId);
      } catch (error) {
        this.repository.markProvisioningFailed(
          agentId,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  async update(agentIdRaw: string, patch: Partial<Omit<AgentEntry, 'id'>>): Promise<StoredAgent> {
    const agentId = normalizeAgentId(agentIdRaw);
    const current = this.repository.get(agentId);
    if (!current) throw new Error(`Agent "${agentId}" not found`);
    const { revision, provisioningState: _state, provisioningError: _error,
      createdAt: _created, updatedAt: _updated, deletedAt: _deleted, ...entry } = current;
    const next = { ...entry, ...patch, id: agentId } as AgentEntry;
    await this.provision(next);
    return this.repository.update(agentId, revision, next);
  }

  setDefault(agentId: string): AgentCatalogSettings {
    const settings = this.repository.getSettings();
    return this.repository.setDefault(agentId, settings.revision);
  }

  updateDefaults(defaults: AgentDefaults): AgentCatalogSettings {
    const settings = this.repository.getSettings();
    return this.repository.updateDefaults(defaults, settings.revision);
  }

  replaceBindings(bindings: BindingRule[]): BindingRule[] {
    return this.repository.replaceBindings(bindings);
  }

  setSurfaceDefault(surface: string, agentId: string): void {
    this.repository.setSurfaceDefault(surface, agentId);
  }

  clearSurfaceDefault(surface: string): void {
    this.repository.clearSurfaceDefault(surface);
  }

  async delete(agentIdRaw: string, options: { purge?: boolean } = {}): Promise<{ removedBindings: number }> {
    const agentId = normalizeAgentId(agentIdRaw);
    const current = this.repository.get(agentId);
    if (!current) throw new Error(`Agent "${agentId}" not found`);
    const defaultAgentId = this.repository.getSettings().defaultAgentId;
    const workspace = workspaceForEntry(current, defaultAgentId);
    const result = this.repository.delete(agentId);
    if (options.purge) {
      if (agentId === DEFAULT_AGENT_ID) throw new Error('Refusing to purge the primary Agent');
      const home = resolveAgentHomeDir(agentId);
      if (existsSync(home)) await rm(home, { recursive: true, force: true });
      if (existsSync(workspace) && workspace !== home) await rm(workspace, { recursive: true, force: true });
    }
    return { removedBindings: result.removedBindings };
  }

  private async provision(entry: AgentEntry): Promise<void> {
    const workspace = workspaceForEntry(entry, this.repository.getSettings().defaultAgentId);
    const profileDir = resolveAgentProfileDir(entry.id);
    await mkdir(workspace, { recursive: true });
    await mkdir(resolveAgentDir(entry.id), { recursive: true });
    await mkdir(profileDir, { recursive: true });
    seedAgentProfileMarkdownFiles(profileDir, workspace, { displayName: entry.profile?.name ?? entry.id });
  }

  private provisionSync(entry: AgentEntry): void {
    const workspace = workspaceForEntry(entry, this.repository.getSettings().defaultAgentId);
    const profileDir = resolveAgentProfileDir(entry.id);
    mkdirSync(workspace, { recursive: true });
    mkdirSync(resolveAgentDir(entry.id), { recursive: true });
    mkdirSync(profileDir, { recursive: true });
    seedAgentProfileMarkdownFiles(profileDir, workspace, { displayName: entry.profile?.name ?? entry.id });
  }
}
