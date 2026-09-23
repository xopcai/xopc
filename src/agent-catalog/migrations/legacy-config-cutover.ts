import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';

import { z } from 'zod';

import {
  AgentDefaultsSchema,
  AgentEntrySchema,
  AgentIdSchema,
  DEFAULT_AGENT_MODEL_REF,
  DEFAULT_SKILL_POLICY,
  type AgentEntry,
} from '../../agent-config/index.js';
import { writeTextAtomicSync } from '../../infra/write-file-atomic.js';
import { BindingsSchema, type BindingRule } from '../../routing/binding-schema.js';
import { getXopcDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/index.js';
import { backupDatabaseBeforeCutover } from '../../storage/sqlite/migrations/conversation-backup.js';
import { AgentCatalogRepository } from '../repository.js';

const MIGRATION_ID = 'agent-catalog-sqlite-v1';

// The retired JSON shape is intentionally private to the one-shot migration.
const LegacyAgentsConfigSchema = z.object({
  default: AgentIdSchema.default('main'),
  defaults: AgentDefaultsSchema.default({
    models: {
      chat: { primary: DEFAULT_AGENT_MODEL_REF, fallbacks: [] },
      intents: {},
    },
    skills: DEFAULT_SKILL_POLICY,
    tools: {},
    workflows: {},
    runtime: {},
  }),
  list: z.array(AgentEntrySchema).default([{ id: 'main', enabled: true }]),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.list.forEach((agent, index) => {
    if (seen.has(agent.id)) {
      context.addIssue({ code: 'custom', path: ['list', index, 'id'], message: `duplicate agent id "${agent.id}"` });
    }
    seen.add(agent.id);
  });
  if (!value.list.some((agent) => agent.id === value.default && agent.enabled)) {
    context.addIssue({
      code: 'custom',
      path: ['default'],
      message: `default agent "${value.default}" must reference an enabled entry`,
    });
  }
});

const DEFAULT_LEGACY_AGENTS = LegacyAgentsConfigSchema.parse({});

const LegacyRootSchema = z.object({
  agents: LegacyAgentsConfigSchema.default(DEFAULT_LEGACY_AGENTS),
  bindings: BindingsSchema.optional(),
  tui: z.object({ defaultAgent: z.string().min(1).optional() }).passthrough().optional(),
}).passthrough();

type MigrationRow = {
  state: string;
  source_digest: string | null;
};

export type AgentCatalogCutoverResult = {
  status: 'not_needed' | 'migrated' | 'recovered';
  importedAgents: number;
  importedBindings: number;
};

export type AgentCatalogCutoverOptions = {
  configPath: string;
  /** Test-only crash injection after a durable stage. */
  stopAfterStage?: 'database' | 'config';
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sourceDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function splitEntry(entry: AgentEntry): {
  profileJson: string | null;
  overridesJson: string;
} {
  const { id: _id, enabled: _enabled, workspace: _workspace, profile, ...overrides } = entry;
  return {
    profileJson: profile ? JSON.stringify(profile) : null,
    overridesJson: JSON.stringify(overrides),
  };
}

function readRawConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('xopc.json must contain a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function migrationRow(): MigrationRow | undefined {
  return getXopcDatabase().db.prepare(`SELECT state, source_digest FROM application_migrations WHERE id = ?`)
    .get(MIGRATION_ID) as MigrationRow | undefined;
}

function writeCleanConfig(configPath: string, raw: Record<string, unknown>): void {
  const next = structuredClone(raw);
  delete next.agents;
  delete next.bindings;
  if (next.tui && typeof next.tui === 'object' && !Array.isArray(next.tui)) {
    const tui = { ...(next.tui as Record<string, unknown>) };
    delete tui.defaultAgent;
    if (Object.keys(tui).length) next.tui = tui;
    else delete next.tui;
  }
  writeTextAtomicSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
}

function insertBinding(binding: BindingRule, position: number, now: number): void {
  const { id, agentId, ...rule } = binding;
  getXopcDatabase().db.prepare(`INSERT INTO agent_bindings
    (id, agent_id, position, rule_json, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)`)
    .run(id ?? randomUUID(), agentId.trim().toLowerCase(), position, JSON.stringify(rule), now, now);
}

function importLegacyPayload(
  payload: z.output<typeof LegacyRootSchema>,
  digest: string,
  configBackupPath: string,
  databaseBackupPath: string | null,
): void {
  runSqliteWriteTransaction((db) => {
    const existing = db.prepare('SELECT COUNT(*) AS count FROM agents').get() as { count: number };
    if (existing.count > 0) throw new Error('Agent catalog already contains data before legacy import');
    const now = Date.now();
    const insertAgent = db.prepare(`INSERT INTO agents
      (id, enabled, workspace_override, profile_json, overrides_json, provisioning_state,
       provisioning_error, revision, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, 'ready', NULL, 1, ?, ?, NULL)`);
    for (const entry of payload.agents.list) {
      const parts = splitEntry(entry);
      insertAgent.run(entry.id, entry.enabled === false ? 0 : 1, entry.workspace ?? null,
        parts.profileJson, parts.overridesJson, now, now);
    }
    db.prepare(`INSERT INTO agent_catalog_settings
      (singleton_id, default_agent_id, defaults_json, revision, created_at, updated_at)
      VALUES (1, ?, ?, 1, ?, ?)`)
      .run(payload.agents.default, JSON.stringify(payload.agents.defaults), now, now);
    (payload.bindings ?? []).forEach((binding, index) => insertBinding(binding, index, now));
    const tuiDefault = payload.tui?.defaultAgent?.trim().toLowerCase();
    if (tuiDefault && payload.agents.list.some((entry) => entry.id === tuiDefault && entry.enabled !== false)) {
      db.prepare(`INSERT INTO agent_surface_defaults(surface, agent_id, revision, updated_at)
        VALUES ('tui', ?, 1, ?)`).run(tuiDefault, now);
    }
    db.prepare(`INSERT INTO application_migrations
      (id, state, source_digest, source_backup_path, database_backup_path, error_json,
       started_at, completed_at, updated_at)
      VALUES (?, 'db_committed', ?, ?, ?, NULL, ?, NULL, ?)`)
      .run(MIGRATION_ID, digest, configBackupPath, databaseBackupPath, now, now);
  });
}

function completeMigration(): void {
  const now = Date.now();
  getXopcDatabase().db.prepare(`UPDATE application_migrations SET state = 'completed',
    completed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, MIGRATION_ID);
}

export function cutoverLegacyAgentConfig(options: AgentCatalogCutoverOptions): AgentCatalogCutoverResult {
  const raw = readRawConfig(options.configPath);
  const legacyTui = raw.tui && typeof raw.tui === 'object' && !Array.isArray(raw.tui)
    ? raw.tui as Record<string, unknown>
    : undefined;
  const hasLegacyAgents = Object.hasOwn(raw, 'agents')
    || Object.hasOwn(raw, 'bindings')
    || Boolean(legacyTui && Object.hasOwn(legacyTui, 'defaultAgent'));
  const marker = migrationRow();

  if (!hasLegacyAgents) {
    if (marker?.state === 'db_committed') {
      completeMigration();
      return { status: 'recovered', importedAgents: 0, importedBindings: 0 };
    }
    if (!marker) new AgentCatalogRepository().ensureInitialized();
    return { status: 'not_needed', importedAgents: 0, importedBindings: 0 };
  }

  const payload = LegacyRootSchema.parse(raw);
  const digest = sourceDigest({ agents: payload.agents, bindings: payload.bindings ?? [],
    tuiDefaultAgent: payload.tui?.defaultAgent });
  if (marker?.state === 'completed') {
    throw new Error('Legacy Agent configuration reappeared after the SQLite cutover completed');
  }
  if (marker?.state === 'db_committed') {
    if (marker.source_digest !== digest) throw new Error('Legacy Agent configuration changed during cutover recovery');
    writeCleanConfig(options.configPath, raw);
    if (options.stopAfterStage === 'config') throw new Error('Injected stop after config stage');
    completeMigration();
    return { status: 'recovered', importedAgents: payload.agents.list.length,
      importedBindings: payload.bindings?.length ?? 0 };
  }

  const configBackupPath = `${options.configPath}.pre-agent-sqlite-v1.bak`;
  if (!existsSync(configBackupPath)) copyFileSync(options.configPath, configBackupPath);
  const database = getXopcDatabase();
  const databaseBackupPath = database.path === ':memory:' ? null
    : backupDatabaseBeforeCutover(database.db, database.path, 'agent-sqlite-v1');
  importLegacyPayload(payload, digest, configBackupPath, databaseBackupPath);
  if (options.stopAfterStage === 'database') throw new Error('Injected stop after database stage');
  writeCleanConfig(options.configPath, raw);
  if (options.stopAfterStage === 'config') throw new Error('Injected stop after config stage');
  completeMigration();
  return { status: 'migrated', importedAgents: payload.agents.list.length,
    importedBindings: payload.bindings?.length ?? 0 };
}
