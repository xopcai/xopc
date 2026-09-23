import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';

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
    await this.resumePendingPurge();
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
    this.resumePendingPurgeSync();
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

  /** Remove data for an Agent that has already been deleted from the catalog. */
  async purgeEntryData(entry: AgentEntry, defaultAgentId: string): Promise<void> {
    if (entry.id === DEFAULT_AGENT_ID) throw new Error('Refusing to purge the primary Agent');
    const workspace = workspaceForEntry(entry, defaultAgentId);
    const home = resolveAgentHomeDir(entry.id);
    this.assertSafeWorkspacePurge(workspace);
    this.assertPurgeTargetsAreNotShared(entry.id, [home, workspace], defaultAgentId);
    if (existsSync(home)) await rm(home, { recursive: true, force: true });
    if (existsSync(workspace) && resolve(workspace) !== resolve(home)) {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  validatePurgeEntry(entry: AgentEntry, defaultAgentId: string): void {
    if (entry.id === DEFAULT_AGENT_ID) throw new Error('Refusing to purge the primary Agent');
    const workspace = workspaceForEntry(entry, defaultAgentId);
    this.assertSafeWorkspacePurge(workspace);
    this.assertPurgeTargetsAreNotShared(entry.id, [resolveAgentHomeDir(entry.id), workspace], defaultAgentId);
  }

  async resumePendingPurge(): Promise<string[]> {
    const failed: string[] = [];
    for (const agentId of this.repository.listPendingPurgeAgentIds()) {
      const agent = this.repository.get(agentId, { includeDeleted: true });
      if (!agent) continue;
      try {
        await this.purgeEntryData(agent, this.repository.getSettings().defaultAgentId);
        this.repository.markPurged(agentId);
      } catch (error) {
        this.repository.markPurgeFailed(agentId, error instanceof Error ? error.message : String(error));
        failed.push(agentId);
      }
    }
    return failed;
  }

  private resumePendingPurgeSync(): void {
    for (const agentId of this.repository.listPendingPurgeAgentIds()) {
      const agent = this.repository.get(agentId, { includeDeleted: true });
      if (!agent) continue;
      try {
        this.purgeEntryDataSync(agent, this.repository.getSettings().defaultAgentId);
        this.repository.markPurged(agentId);
      } catch (error) {
        this.repository.markPurgeFailed(agentId, error instanceof Error ? error.message : String(error));
      }
    }
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
    if (options.purge) this.validatePurgeEntry(current, this.repository.getSettings().defaultAgentId);
    const result = this.repository.delete(agentId, options);
    if (options.purge) {
      const failed = await this.resumePendingPurge();
      if (failed.includes(agentId)) throw new Error(`Agent "${agentId}" was deleted; data purge is pending retry`);
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

  private purgeEntryDataSync(entry: AgentEntry, defaultAgentId: string): void {
    if (entry.id === DEFAULT_AGENT_ID) throw new Error('Refusing to purge the primary Agent');
    const workspace = workspaceForEntry(entry, defaultAgentId);
    const home = resolveAgentHomeDir(entry.id);
    this.assertSafeWorkspacePurge(workspace);
    this.assertPurgeTargetsAreNotShared(entry.id, [home, workspace], defaultAgentId);
    if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    if (existsSync(workspace) && resolve(workspace) !== resolve(home)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  private assertSafeWorkspacePurge(workspaceRaw: string): void {
    const workspace = resolve(workspaceRaw);
    const stateDir = resolve(resolveStateDir(process.env));
    const rel = relative(workspace, stateDir);
    if (workspace === parse(workspace).root || workspace === stateDir
      || rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      throw new Error(`Refusing to purge unsafe workspace path: ${workspace}`);
    }
  }

  private assertPurgeTargetsAreNotShared(
    agentId: string,
    targetsRaw: string[],
    defaultAgentId: string,
  ): void {
    const targets = [...new Set(targetsRaw.map((target) => resolve(target)))];
    for (const other of this.repository.list()) {
      if (other.id === agentId) continue;
      const otherWorkspace = resolve(workspaceForEntry(other, defaultAgentId));
      if (targets.some((target) => {
        const rel = relative(target, otherWorkspace);
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
      })) {
        throw new Error(`Refusing to purge workspace used by Agent "${other.id}"`);
      }
    }
  }
}
