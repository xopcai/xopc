import { ensureStarterAgentsInitialized } from '../agent/starter-agents.js';
import { migrateIdentityMarkdownToCatalog } from '../agent-catalog/migrations/identity-markdown-cutover.js';
import { cutoverLegacyAgentConfig, type AgentCatalogCutoverResult } from '../agent-catalog/index.js';
import { AgentCatalogService } from '../agent-catalog/service.js';
import { migrateCloudPublicModelsSync } from '../migrations/cloud-public-models.js';
import { runBootstrapMigrationsSync } from '../migrations/runner.js';
import { requireXopcDatabase } from '../storage/sqlite/index.js';

export type ApplicationStateBootstrapResult = {
  agentCatalog: AgentCatalogCutoverResult;
  configChanged: boolean;
};

/**
 * Bring durable application state to the current shape before strict config loading.
 * Ordering is intentional: legacy Agent fields must leave JSON before ConfigSchema sees it.
 */
export function bootstrapApplicationStateSync(configPath: string): ApplicationStateBootstrapResult {
  requireXopcDatabase();
  const agentCatalog = cutoverLegacyAgentConfig({ configPath });
  const configMigration = runBootstrapMigrationsSync(configPath);
  const cloudModelsChanged = migrateCloudPublicModelsSync(configPath);
  ensureStarterAgentsInitialized();
  migrateIdentityMarkdownToCatalog();
  new AgentCatalogService().resumePendingProvisioningSync();
  return { agentCatalog, configChanged: configMigration.changed || cloudModelsChanged };
}
