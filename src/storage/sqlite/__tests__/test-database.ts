import { afterEach, beforeEach } from 'vitest';
import { closeXopcDatabase, openXopcDatabase } from '../connection.js';
import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';

/** Isolated database for consumers that previously only needed a temporary folder. */
export function useTestDatabase(): void {
  beforeEach(() => {
    closeXopcDatabase();
    openXopcDatabase({ path: ':memory:' });
    const repository = new AgentCatalogRepository();
    repository.ensureInitialized();
    repository.markProvisioned('main');
  });
  afterEach(() => { closeXopcDatabase(); });
}
