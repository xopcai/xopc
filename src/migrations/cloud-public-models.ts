import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveXopcCloudCatalogCachePath } from '../config/paths-state.js';
import { writeTextAtomicSync } from '../infra/write-file-atomic.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/index.js';
import { createWorkflowCatalog } from '../agent/workflow/catalog.js';
import { ModelCatalogPersistence } from '../providers/model-catalog-persistence.js';

const MIGRATION_ID = 'cloud-public-models-v1';
const PUBLIC_IDS = new Set(['auto', 'advanced', 'image', 'stt', 'tts', 'realtime', 'computer']);
const MODEL_FIELDS = new Set(['model', 'modelRef', 'modelOverride', 'primary', 'fallbacks', 'imageGeneration', 'imageUnderstanding', 'computerUse']);

type Kind = 'language' | 'image' | 'stt' | 'tts' | 'omni' | 'computer';

export function migrateCloudModelRef(ref: string, kind: Kind = 'language'): string {
  if (!ref.startsWith('xopc-cloud/')) return ref;
  const id = ref.slice('xopc-cloud/'.length);
  if (PUBLIC_IDS.has(id) || id.startsWith('openai-codex/')) return ref;
  const product = kind === 'omni' ? 'realtime' : kind === 'language' ? 'auto' : kind;
  return `xopc-cloud/${product}`;
}

/** Only model fields are rewritten; prompts and historical transcripts are untouched. */
export function migrateCloudModelFields(value: unknown, kind: Kind = 'language', cloud = false, modelField = false): unknown {
  if (typeof value === 'string') {
    if (!modelField) return value;
    const ref = cloud && !value.includes('/') ? `xopc-cloud/${value}` : value;
    const next = migrateCloudModelRef(ref, kind);
    return cloud && !value.includes('/') ? next.replace(/^xopc-cloud\//, '') : next;
  }
  if (Array.isArray(value)) {
    const next = value.map(item => migrateCloudModelFields(item, kind, cloud, modelField));
    return modelField && next.some((item, index) => item !== value[index]) ? [...new Set(next)] : next;
  }
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const explicitProvider = source.provider ?? source.providerOverride;
  const isCloud = typeof explicitProvider === 'string' ? explicitProvider === 'xopc-cloud' : cloud;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (key === 'providers' && item && typeof item === 'object' && !Array.isArray(item)) {
      result[key] = Object.fromEntries(Object.entries(item).map(([provider, settings]) => [provider, migrateCloudModelFields(settings, kind, provider === 'xopc-cloud')]));
      continue;
    }
    const nextKind: Kind = key === 'imageGeneration' ? 'image' : key === 'computerUse' ? 'computer'
      : key === 'summarization' || key === 'refinement' ? 'language' : key === 'stt' || key === 'audio' ? 'stt' : key === 'tts' ? 'tts' : key === 'omni' ? 'omni' : kind;
    result[key] = migrateCloudModelFields(item, nextKind, isCloud || key === 'xopc-cloud', MODEL_FIELDS.has(key));
  }
  if (isCloud && (kind === 'tts' || kind === 'omni') && (source.voice !== undefined || typeof source.model === 'string')) result.voice = 'default';
  if (typeof result.primary === 'string' && result.primary.startsWith('xopc-cloud/') && (result.primary !== source.primary || JSON.stringify(result.fallbacks) !== JSON.stringify(source.fallbacks)) && Array.isArray(result.fallbacks)) result.fallbacks = result.fallbacks.filter(ref => ref !== result.primary);
  return result;
}

/** Replayable file phase followed by a transactional database phase and completion marker. */
export function migrateCloudPublicModelsSync(configPath: string): boolean {
  const db = getSqliteDatabase();
  if (db.prepare('SELECT 1 FROM application_migrations WHERE id = ? AND state = ?').get(MIGRATION_ID, 'complete')) return false;
  const now = Date.now();
  const databaseBackup = `${configPath}.${MIGRATION_ID}.sqlite.bak`;
  if (!existsSync(databaseBackup)) {
    mkdirSync(dirname(databaseBackup), { recursive: true, mode: 0o700 });
    const temporary = `${databaseBackup}.${randomUUID()}.tmp`;
    try {
      db.prepare('VACUUM INTO ?').run(temporary);
      chmodSync(temporary, 0o600);
      renameSync(temporary, databaseBackup);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  const configBackup = `${configPath}.${MIGRATION_ID}.bak`;
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8');
    const next = JSON.stringify(migrateCloudModelFields(JSON.parse(raw)), null, 2) + '\n';
    if (JSON.stringify(JSON.parse(raw)) !== JSON.stringify(JSON.parse(next))) {
      if (!existsSync(configBackup)) copyFileSync(configPath, configBackup);
      writeTextAtomicSync(configPath, next);
    }
  }
  // Keep the original catalog as a diagnostic backup, but never hydrate retired models.
  const cache = resolveXopcCloudCatalogCachePath();
  if (existsSync(cache) && !existsSync(`${cache}.${MIGRATION_ID}.bak`)) copyFileSync(cache, `${cache}.${MIGRATION_ID}.bak`);
  new ModelCatalogPersistence().clearSync();
  return runSqliteWriteTransaction(() => {
    if (db.prepare('SELECT 1 FROM application_migrations WHERE id = ? AND state = ?').get(MIGRATION_ID, 'complete')) return false;
    const migrateJson = (table: string, key: string, column: string, where = '') => {
      const rows = db.prepare(`SELECT ${key} AS id, ${column} AS payload FROM ${table} ${where}`).all() as Array<{ id: string | number; payload: string }>;
      for (const row of rows) {
        const before = JSON.parse(row.payload);
        const next = JSON.stringify(migrateCloudModelFields(before));
        if (JSON.stringify(before) !== next) {
          const revision = table === 'agents' || table === 'agent_catalog_settings' ? ', revision = revision + 1, updated_at = ' + now : '';
          db.prepare(`UPDATE ${table} SET ${column} = ? ${revision} WHERE ${key} = ?`).run(next, row.id);
        }
      }
    };
    migrateJson('agent_catalog_settings', 'singleton_id', 'defaults_json');
    migrateJson('agents', 'id', 'overrides_json', 'WHERE deleted_at IS NULL');
    migrateJson('automations', 'automation_id', 'action_json');
    const rows = db.prepare("SELECT rowid AS id, payload FROM durable_state WHERE namespace IN ('workflow-drafts')").all() as Array<{ id: number; payload: string }>;
    for (const row of rows) {
      const before = JSON.parse(row.payload);
      const next = JSON.stringify(migrateCloudModelFields(before));
      if (JSON.stringify(before) !== next) db.prepare('UPDATE durable_state SET payload = ? WHERE rowid = ?').run(next, row.id);
    }
    const catalog = createWorkflowCatalog();
    for (const entry of catalog.list().filter(item => item.source === 'user')) {
      const definition = catalog.load(entry.name);
      const graph = migrateCloudModelFields(definition.graph) as typeof definition.graph;
      if (JSON.stringify(graph) !== JSON.stringify(definition.graph)) {
        const { graph: _graph, metadata: _metadata, contentHash: _hash, revision: _revision, ...manifest } = definition;
        catalog.save({ name: entry.name, graph, manifest: { ...manifest, tags: definition.metadata.tags, whenToUse: definition.metadata.whenToUse, estimatedAgents: definition.metadata.estimatedAgents, examplePrompts: definition.metadata.examplePrompts, i18n: definition.metadata.i18n }, expectedRevision: definition.revision });
      }
    }
    const sessions = db.prepare('SELECT conversation_id, model_override, provider_override FROM session_config WHERE model_override IS NOT NULL').all() as Array<{ conversation_id: string; model_override: string; provider_override: string | null }>;
    for (const row of sessions) {
      const ref = row.provider_override === 'xopc-cloud' && !row.model_override.includes('/') ? `xopc-cloud/${row.model_override}` : row.model_override;
      const migrated = migrateCloudModelRef(ref);
      const next = ref === row.model_override ? migrated : migrated.replace(/^xopc-cloud\//, '');
      if (next !== row.model_override) db.prepare('UPDATE session_config SET model_override = ?, updated_at = ? WHERE conversation_id = ?').run(next, now, row.conversation_id);
    }
    db.prepare(`INSERT INTO application_migrations(id,state,source_backup_path,database_backup_path,started_at,completed_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, completed_at=excluded.completed_at, updated_at=excluded.updated_at`)
      .run(MIGRATION_ID, 'complete', existsSync(configBackup) ? configBackup : null, databaseBackup, now, now, now);
    return true;
  });
}
