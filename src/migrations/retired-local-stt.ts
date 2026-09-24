import { existsSync, readFileSync } from 'node:fs';

import { isGatewayConfigLockedByAnotherProcessSync } from '../gateway/lock.js';
import type { Migration, MigrationContext, MigrationPlanItem } from './types.js';

const id = 'retire-builtin-local-stt';

function migratedConfig(ctx: MigrationContext): Record<string, unknown> | null {
  if (!existsSync(ctx.configPath)) return null;
  const config = JSON.parse(readFileSync(ctx.configPath, 'utf8')) as Record<string, unknown>;
  const tools = config.tools;
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return null;
  const media = (tools as Record<string, unknown>).media;
  if (!media || typeof media !== 'object' || Array.isArray(media)) return null;
  const audio = (media as Record<string, unknown>).audio;
  if (!audio || typeof audio !== 'object' || Array.isArray(audio)) return null;
  const stt = audio as Record<string, unknown>;
  if (stt.provider !== 'xopc-local' && stt.provider !== 'local') return null;

  stt.enabled = false;
  stt.provider = 'openai';
  stt.fallback = { enabled: false, order: [] };
  return config;
}

function item(status: MigrationPlanItem['status']): MigrationPlanItem {
  return {
    id,
    title: 'Retire built-in local speech recognition',
    kind: 'config',
    safety: 'auto',
    status,
    message:
      'Disable the removed xopc-local STT provider. Select an installed STT extension or another provider before enabling voice input again.',
  };
}

export const retiredLocalSttMigration: Migration = {
  id,
  kind: 'config',
  safety: 'auto',
  detect: (ctx) => (migratedConfig(ctx) ? item('planned') : null),
  apply: (ctx) => {
    if (isGatewayConfigLockedByAnotherProcessSync(ctx.configPath)) {
      return {
        ...item('skipped'),
        message: 'Deferred local STT retirement until the running gateway restarts.',
      };
    }
    const config = migratedConfig(ctx);
    return config ? { ...item('applied'), details: { config } } : item('not_needed');
  },
};
