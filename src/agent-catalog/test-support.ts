import type { AgentDefaults, AgentEntry } from '../agent-config/index.js';
import type { BindingRule } from '../routing/binding-schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../storage/sqlite/index.js';
import { AgentCatalogRepository } from './repository.js';

export type TestAgentCatalogSeed = {
  defaults?: AgentDefaults;
  defaultAgentId?: string;
  agents?: AgentEntry[];
  bindings?: BindingRule[];
  surfaceDefaults?: Record<string, string>;
};

/** Build an isolated, ready in-memory Agent catalog for a unit test. */
export function initializeTestAgentCatalog(seed: TestAgentCatalogSeed = {}): AgentCatalogRepository {
  closeXopcDatabase();
  openXopcDatabase({ path: ':memory:' });
  return seedTestAgentCatalog(seed);
}

/** Seed the currently open test database with a ready Agent catalog. */
export function seedTestAgentCatalog(seed: TestAgentCatalogSeed = {}): AgentCatalogRepository {
  const repository = new AgentCatalogRepository();
  repository.ensureInitialized(seed.defaults);

  const entries = seed.agents ?? [{ id: 'main', enabled: true }];
  const main = entries.find((entry) => entry.id === 'main');
  if (main) {
    const stored = repository.get('main')!;
    repository.update('main', stored.revision, main);
  }
  repository.markProvisioned('main');

  for (const entry of entries) {
    if (entry.id !== 'main') repository.create(entry, { ready: true });
  }

  if (seed.defaultAgentId && seed.defaultAgentId !== 'main') {
    repository.setDefault(seed.defaultAgentId, repository.getSettings().revision);
  }
  if (seed.bindings) repository.replaceBindings(seed.bindings);
  for (const [surface, agentId] of Object.entries(seed.surfaceDefaults ?? {})) {
    repository.setSurfaceDefault(surface, agentId);
  }
  return repository;
}
