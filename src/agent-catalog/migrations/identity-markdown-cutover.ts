import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentProfile } from '../../agent-config/index.js';
import { resolveAgentProfileDir } from '../../agent/agent-scope.js';
import { getXopcDatabase } from '../../storage/sqlite/index.js';
import { AgentCatalogRepository } from '../repository.js';

const MIGRATION_ID = 'agent-identity-structured-v1';
const FIELDS: Record<string, keyof Pick<AgentProfile,
  'name' | 'description' | 'creature' | 'style' | 'language' | 'emoji' | 'avatar'>> = {
  name: 'name', 名称: 'name',
  description: 'description', 简介: 'description', 一句话介绍: 'description', 职责: 'description',
  creature: 'creature', type: 'creature', role: 'creature', 类型: 'creature', 角色: 'creature',
  vibe: 'style', style: 'style', 风格: 'style', 表达风格: 'style',
  language: 'language', 语言: 'language', 主要语言: 'language',
  emoji: 'emoji', 签名表情: 'emoji', 表情: 'emoji',
  avatar: 'avatar', 头像: 'avatar', 头像地址: 'avatar',
};

/** Parse only known identity fields. The original document is archived after migration. */
export function parseIdentityFieldsForCutover(content: string): Partial<AgentProfile> {
  const fields: Partial<AgentProfile> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*[-*]\s+\*\*([^*:：]+?)(?:[:：]\*\*|\*\*[:：])\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = FIELDS[match[1]!.trim().toLowerCase()];
    const value = match[2]!.trim();
    if (key && value && !/^_\(.*\)_$/.test(value)) fields[key] = value;
  }
  return fields;
}

/** One-time upgrade. Runtime never reads the retired identity document. */
export function migrateIdentityMarkdownToCatalog(): void {
  const database = getXopcDatabase().db;
  const marker = database.prepare('SELECT state FROM application_migrations WHERE id = ?')
    .get(MIGRATION_ID) as { state: string } | undefined;
  if (marker?.state === 'completed') return;

  const repository = new AgentCatalogRepository();
  const migratedPaths: Array<{ source: string; backup: string }> = [];
  for (const agent of repository.list()) {
    const source = join(resolveAgentProfileDir(agent.id), 'IDENTITY.md');
    if (!existsSync(source)) continue;
    const fields = parseIdentityFieldsForCutover(readFileSync(source, 'utf8'));
    const current = agent.profile;
    const profile: AgentProfile = {
      name: current?.name || fields.name || agent.id,
      ...Object.fromEntries(
        (['description', 'creature', 'style', 'language', 'emoji', 'avatar'] as const)
          .filter((key) => current?.[key] || fields[key])
          .map((key) => [key, current?.[key] || fields[key]]),
      ),
      ...(current?.instructions ? { instructions: current.instructions } : {}),
    };
    const { revision, provisioningState: _provisioningState, provisioningError: _provisioningError,
      createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, ...entry } = agent;
    repository.update(agent.id, revision, { ...entry, profile });
    migratedPaths.push({ source, backup: join(resolveAgentProfileDir(agent.id), '.identity-migration-backup') });
  }

  for (const { source, backup } of migratedPaths) {
    if (existsSync(backup)) throw new Error(`Identity migration backup already exists: ${backup}`);
    renameSync(source, backup);
  }
  const now = Date.now();
  database.prepare(`INSERT INTO application_migrations
    (id, state, source_digest, source_backup_path, database_backup_path, error_json,
     started_at, completed_at, updated_at)
    VALUES (?, 'completed', NULL, NULL, NULL, NULL, ?, ?, ?)`).run(MIGRATION_ID, now, now, now);
}
