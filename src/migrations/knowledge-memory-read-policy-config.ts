import { existsSync, readFileSync } from 'node:fs';

import { isGatewayConfigLockedByAnotherProcessSync } from '../gateway/lock.js';
import { normalizeKnowledgeMemoryConfigInput } from '../user-context/config.js';
import type { Migration, MigrationContext, MigrationPlanItem } from './types.js';

const id = 'knowledge-memory-read-policy-config';

function convertedConfig(ctx: MigrationContext): Record<string, unknown> | null {
  if (!existsSync(ctx.configPath)) return null;
  const config = JSON.parse(readFileSync(ctx.configPath, 'utf8')) as Record<string, unknown>;
  const userContext = config.userContext;
  if (!userContext || typeof userContext !== 'object' || Array.isArray(userContext)) return null;
  const knowledgeMemory = (userContext as Record<string, unknown>).knowledgeMemory;
  if (!knowledgeMemory || typeof knowledgeMemory !== 'object' || Array.isArray(knowledgeMemory)) return null;
  const memory = knowledgeMemory as Record<string, unknown>;
  if (!Array.isArray(memory.sources)) return null;

  (userContext as Record<string, unknown>).knowledgeMemory = normalizeKnowledgeMemoryConfigInput(memory);
  return config;
}

function item(status: MigrationPlanItem['status']): MigrationPlanItem {
  return {
    id,
    title: 'Knowledge memory read policy configuration',
    kind: 'config',
    safety: 'auto',
    status,
    message: 'Split knowledge memory visibility scopes from content sources.',
  };
}

export const knowledgeMemoryReadPolicyConfigMigration: Migration = {
  id,
  kind: 'config',
  safety: 'auto',
  detect: (ctx) => convertedConfig(ctx) ? item('planned') : null,
  apply: (ctx) => {
    if (isGatewayConfigLockedByAnotherProcessSync(ctx.configPath)) {
      return {
        ...item('skipped'),
        message: 'Deferred knowledge memory config migration until the running gateway restarts.',
      };
    }
    const config = convertedConfig(ctx);
    return config ? { ...item('applied'), details: { config } } : item('not_needed');
  },
};
