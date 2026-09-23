import { beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { AgentCatalogRepository } from '../repository.js';

describe('AgentCatalogRepository', () => {
  beforeEach(() => {
    closeXopcDatabase();
    openXopcDatabase({ path: ':memory:' });
  });

  it('initializes a pending main Agent and catalog defaults', () => {
    const repository = new AgentCatalogRepository();
    repository.ensureInitialized();

    expect(repository.getSettings().defaultAgentId).toBe('main');
    expect(repository.list()).toMatchObject([
      { id: 'main', enabled: true, provisioningState: 'pending', revision: 1 },
    ]);
    expect(repository.snapshot().agents).toEqual([]);
    expect(repository.listPendingProvisioningAgentIds()).toEqual(['main']);
  });

  it('creates ready Agents and returns a validated snapshot', () => {
    const repository = new AgentCatalogRepository();
    repository.ensureInitialized();
    repository.create({
      id: 'coder',
      enabled: true,
      workspace: '/tmp/coder',
      profile: { name: 'Coder' },
      tools: { exec_command: { mode: 'ask' } },
    }, { ready: true });

    const snapshot = repository.snapshot();
    expect(snapshot.agents).toContainEqual(expect.objectContaining({
      id: 'coder',
      workspace: '/tmp/coder',
      profile: { name: 'Coder' },
    }));
    expect(snapshot.revision).toBeGreaterThan(1);
  });

  it('makes provisioned Agents selectable and protects the default Agent', () => {
    const repository = new AgentCatalogRepository();
    repository.ensureInitialized();
    repository.markProvisioned('main');

    expect(repository.snapshot().agents).toContainEqual(expect.objectContaining({ id: 'main' }));
    const main = repository.get('main')!;
    expect(() => repository.update('main', main.revision, { id: 'main', enabled: false }))
      .toThrow('cannot be disabled');
  });

  it('enforces Agent and catalog revisions', () => {
    const repository = new AgentCatalogRepository();
    repository.ensureInitialized();
    const coder = repository.create({ id: 'coder', enabled: true, profile: { name: 'Coder' } }, { ready: true });
    const updated = repository.update('coder', coder.revision, {
      id: 'coder', enabled: true, profile: { name: 'Code Reviewer' },
    });

    expect(updated.revision).toBe(coder.revision + 1);
    expect(() => repository.update('coder', coder.revision, {
      id: 'coder', enabled: true, profile: { name: 'Stale' },
    })).toThrow('revision conflict');
    expect(() => repository.setDefault('coder', 99)).toThrow('catalog revision conflict');
    expect(repository.setDefault('coder', repository.getSettings().revision).defaultAgentId).toBe('coder');
  });

  it('stores ordered bindings and surface defaults', () => {
    const repository = new AgentCatalogRepository();
    repository.ensureInitialized();
    repository.create({ id: 'coder', enabled: true, profile: { name: 'Coder' } }, { ready: true });
    repository.replaceBindings([
      { id: 'binding-1', agentId: 'coder', priority: 100, enabled: true, match: { channel: 'telegram' } },
    ]);
    repository.setSurfaceDefault('tui', 'coder');

    expect(repository.snapshot()).toMatchObject({
      bindings: [{ id: 'binding-1', agentId: 'coder', match: { channel: 'telegram' } }],
      surfaceDefaults: { tui: 'coder' },
    });
  });
});
