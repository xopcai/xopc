import { existsSync, readFileSync } from 'node:fs';

import { isGatewayConfigLockedByAnotherProcessSync } from '../gateway/lock.js';
import type { Migration, MigrationContext, MigrationPlanItem } from './types.js';

const id = 'automatic-memory-config';

function normalizeKnowledgeMemoryConfigInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const memory = input as Record<string, unknown>;
  if (!Array.isArray(memory.sources)) return input;
  const oldSources = memory.sources.filter((source): source is string => typeof source === 'string');
  const visibilityScopes = new Set(['session', 'workspace', 'project']);
  const normalized = { ...memory };
  if (!Array.isArray(normalized.readScopes)) {
    normalized.readScopes = oldSources.filter((source) => visibilityScopes.has(source));
  }
  if (!Array.isArray(normalized.contentSources)) {
    normalized.contentSources = [
      ...(oldSources.some((source) => visibilityScopes.has(source)) ? ['memory'] : []),
      ...(oldSources.includes('workspace') ? ['local_import'] : []),
      ...(oldSources.includes('connector') ? ['connector'] : []),
    ];
  }
  delete normalized.sources;
  return normalized;
}

function convertedConfig(ctx: MigrationContext): Record<string, unknown> | null {
  if (!existsSync(ctx.configPath)) return null;
  const config = JSON.parse(readFileSync(ctx.configPath, 'utf8')) as Record<string, unknown>;
  const userContext = config.userContext;
  if (!userContext || typeof userContext !== 'object' || Array.isArray(userContext)) return null;
  const context = userContext as Record<string, unknown>;
  let changed = false;
  for (const key of ['userModel', 'knowledgeMemory']) {
    const section = context[key];
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    const memory = section as Record<string, unknown>;
    if (memory.writePolicy === 'confirm') {
      memory.writePolicy = 'allow';
      changed = true;
    }
    if (key === 'knowledgeMemory' && Array.isArray(memory.sources)) {
      context[key] = normalizeKnowledgeMemoryConfigInput(memory);
      changed = true;
    }
  }
  if (!changed) return null;
  return config;
}

function item(status: MigrationPlanItem['status']): MigrationPlanItem {
  return {
    id,
    title: 'Automatic memory configuration',
    kind: 'config',
    safety: 'auto',
    status,
    message: 'Enable automatic ordinary memory and separate visibility scopes from content sources.',
  };
}

export const memoryConfigMigration: Migration = {
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
