import { ensureStarterAgentsInitialized } from '../agent/starter-agents.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { AgentCatalogService } from '../agent-catalog/service.js';
import { requireXopcDatabase } from '../storage/sqlite/index.js';

/** Initialize current application state without importing retired configuration. */
export function bootstrapApplicationStateSync(): void {
  requireXopcDatabase();
  new AgentCatalogRepository().ensureInitialized();
  ensureStarterAgentsInitialized();
  new AgentCatalogService().resumePendingProvisioningSync();
}
