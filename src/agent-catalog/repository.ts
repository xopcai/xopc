import { randomUUID } from 'node:crypto';

import {
  AgentDefaultsSchema,
  AgentEntrySchema,
  DEFAULT_AGENT_MODEL_REF,
  DEFAULT_SKILL_POLICY,
  type AgentDefaults,
  type AgentEntry,
} from '../agent-config/index.js';
import { DEFAULT_AGENT_ID, normalizeAgentId } from './id.js';
import { BindingsSchema, type BindingRule } from '../routing/binding-schema.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/index.js';
import type {
  AgentCatalogSettings,
  AgentCatalogSnapshot,
  AgentProvisioningState,
  StoredAgent,
} from './types.js';

const DEFAULT_AGENT_DEFAULTS: AgentDefaults = AgentDefaultsSchema.parse({
  models: {
    chat: { primary: DEFAULT_AGENT_MODEL_REF, fallbacks: [] },
    intents: {},
  },
  skills: DEFAULT_SKILL_POLICY,
});

type AgentRow = {
  id: string;
  enabled: number;
  workspace_override: string | null;
  profile_json: string | null;
  overrides_json: string;
  provisioning_state: AgentProvisioningState;
  provisioning_error: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type SettingsRow = {
  default_agent_id: string;
  defaults_json: string;
  revision: number;
  created_at: number;
  updated_at: number;
};

function parseObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function rowToAgent(row: AgentRow): StoredAgent {
  const overrides = parseObject(row.overrides_json, `Agent ${row.id} overrides`);
  const entry = AgentEntrySchema.parse({
    id: row.id,
    enabled: row.enabled === 1,
    ...(row.workspace_override ? { workspace: row.workspace_override } : {}),
    ...(row.profile_json ? { profile: JSON.parse(row.profile_json) } : {}),
    ...overrides,
  });
  return {
    ...entry,
    revision: row.revision,
    provisioningState: row.provisioning_state,
    ...(row.provisioning_error ? { provisioningError: row.provisioning_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
  };
}

function splitEntry(entry: AgentEntry): {
  workspace: string | null;
  profileJson: string | null;
  overridesJson: string;
} {
  const { id: _id, enabled: _enabled, workspace, profile, ...overrides } = AgentEntrySchema.parse(entry);
  return {
    workspace: workspace ?? null,
    profileJson: profile ? JSON.stringify(profile) : null,
    overridesJson: JSON.stringify(overrides),
  };
}

function requireSettings(): AgentCatalogSettings {
  const row = getSqliteDatabase().prepare(`SELECT default_agent_id, defaults_json, revision, created_at, updated_at
    FROM agent_catalog_settings WHERE singleton_id = 1`).get() as SettingsRow | undefined;
  if (!row) throw new Error('Agent catalog is not initialized');
  return {
    defaultAgentId: row.default_agent_id,
    defaults: AgentDefaultsSchema.parse(JSON.parse(row.defaults_json)),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bumpCatalogRevision(now: number): void {
  const result = getSqliteDatabase().prepare(`UPDATE agent_catalog_settings
    SET revision = revision + 1, updated_at = ? WHERE singleton_id = 1`).run(now);
  if (Number(result.changes) !== 1) throw new Error('Agent catalog is not initialized');
}

export class AgentCatalogRepository {
  ensureInitialized(defaults: AgentDefaults = DEFAULT_AGENT_DEFAULTS): void {
    runSqliteWriteTransaction((db) => {
      const now = Date.now();
      db.prepare(`INSERT OR IGNORE INTO agents
        (id, enabled, workspace_override, profile_json, overrides_json, provisioning_state,
         provisioning_error, revision, created_at, updated_at, deleted_at)
        VALUES (?, 1, NULL, ?, '{}', 'pending', NULL, 1, ?, ?, NULL)`)
        .run(DEFAULT_AGENT_ID, JSON.stringify({ name: 'Main' }), now, now);
      db.prepare(`INSERT OR IGNORE INTO agent_catalog_settings
        (singleton_id, default_agent_id, defaults_json, revision, created_at, updated_at)
        VALUES (1, ?, ?, 1, ?, ?)`)
        .run(DEFAULT_AGENT_ID, JSON.stringify(AgentDefaultsSchema.parse(defaults)), now, now);
      db.prepare(`INSERT OR IGNORE INTO agent_provisioning_jobs
        (agent_id, operation, state, attempts, last_error, created_at, updated_at)
        VALUES (?, 'provision', 'pending', 0, NULL, ?, ?)`)
        .run(DEFAULT_AGENT_ID, now, now);
    });
  }

  getSettings(): AgentCatalogSettings {
    return requireSettings();
  }

  list(options: { includeDeleted?: boolean; readyOnly?: boolean } = {}): StoredAgent[] {
    const clauses: string[] = [];
    if (!options.includeDeleted) clauses.push('deleted_at IS NULL');
    if (options.readyOnly) clauses.push("provisioning_state = 'ready'");
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return (getSqliteDatabase().prepare(`SELECT * FROM agents ${where} ORDER BY id`).all() as AgentRow[])
      .map(rowToAgent);
  }

  get(id: string, options: { includeDeleted?: boolean } = {}): StoredAgent | null {
    const agentId = normalizeAgentId(id);
    const row = getSqliteDatabase().prepare(`SELECT * FROM agents WHERE id = ?${options.includeDeleted ? '' : ' AND deleted_at IS NULL'}`)
      .get(agentId) as AgentRow | undefined;
    return row ? rowToAgent(row) : null;
  }

  snapshot(): AgentCatalogSnapshot {
    const settings = requireSettings();
    const agents = this.list({ readyOnly: true }).map(({ revision: _revision, provisioningState: _state,
      provisioningError: _error, createdAt: _created, updatedAt: _updated, deletedAt: _deleted, ...entry }) => entry);
    const bindings = (getSqliteDatabase().prepare(`SELECT id, agent_id, position, rule_json
      FROM agent_bindings ORDER BY position, id`).all() as Array<{
        id: string; agent_id: string; position: number; rule_json: string;
      }>).map((row) => ({ id: row.id, agentId: row.agent_id, ...parseObject(row.rule_json, `Binding ${row.id}`) }));
    const surfaceDefaults = Object.fromEntries((getSqliteDatabase().prepare(
      'SELECT surface, agent_id FROM agent_surface_defaults ORDER BY surface',
    ).all() as Array<{ surface: string; agent_id: string }>).map((row) => [row.surface, row.agent_id]));
    return {
      revision: settings.revision,
      defaultAgentId: settings.defaultAgentId,
      defaults: settings.defaults,
      agents,
      bindings: BindingsSchema.parse(bindings),
      surfaceDefaults,
    };
  }

  create(entryInput: AgentEntry, options: { ready?: boolean } = {}): StoredAgent {
    const entry = AgentEntrySchema.parse(entryInput);
    const id = normalizeAgentId(entry.id);
    if (id !== entry.id) throw new Error(`Invalid normalized Agent id: ${entry.id}`);
    return runSqliteWriteTransaction((db) => {
      const existing = db.prepare('SELECT 1 FROM agents WHERE id = ?').get(id);
      if (existing) throw new Error(`Agent "${id}" already exists`);
      const now = Date.now();
      const parts = splitEntry(entry);
      const state: AgentProvisioningState = options.ready ? 'ready' : 'pending';
      db.prepare(`INSERT INTO agents
        (id, enabled, workspace_override, profile_json, overrides_json, provisioning_state,
         provisioning_error, revision, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, NULL)`)
        .run(id, entry.enabled === false ? 0 : 1, parts.workspace, parts.profileJson, parts.overridesJson, state, now, now);
      if (!options.ready) {
        db.prepare(`INSERT INTO agent_provisioning_jobs
          (agent_id, operation, state, attempts, last_error, created_at, updated_at)
          VALUES (?, 'provision', 'pending', 0, NULL, ?, ?)`)
          .run(id, now, now);
      }
      bumpCatalogRevision(now);
      return rowToAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow);
    });
  }

  update(id: string, expectedRevision: number, entryInput: AgentEntry): StoredAgent {
    const agentId = normalizeAgentId(id);
    const entry = AgentEntrySchema.parse(entryInput);
    if (entry.id !== agentId) throw new Error('Agent id cannot be changed');
    return runSqliteWriteTransaction((db) => {
      if (entry.enabled === false) {
        const settings = requireSettings();
        if (settings.defaultAgentId === agentId) throw new Error('Default Agent cannot be disabled');
      }
      const parts = splitEntry(entry);
      const now = Date.now();
      const result = db.prepare(`UPDATE agents SET enabled = ?, workspace_override = ?, profile_json = ?,
        overrides_json = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`)
        .run(entry.enabled === false ? 0 : 1, parts.workspace, parts.profileJson, parts.overridesJson,
          now, agentId, expectedRevision);
      if (Number(result.changes) !== 1) throw new Error('Agent revision conflict');
      bumpCatalogRevision(now);
      return rowToAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow);
    });
  }

  setDefault(agentIdRaw: string, expectedRevision: number): AgentCatalogSettings {
    const agentId = normalizeAgentId(agentIdRaw);
    return runSqliteWriteTransaction((db) => {
      const agent = db.prepare(`SELECT enabled, provisioning_state, deleted_at FROM agents WHERE id = ?`).get(agentId) as
        { enabled: number; provisioning_state: string; deleted_at: number | null } | undefined;
      if (!agent || agent.enabled !== 1 || agent.provisioning_state !== 'ready' || agent.deleted_at !== null) {
        throw new Error(`Agent "${agentId}" is not available`);
      }
      const now = Date.now();
      const result = db.prepare(`UPDATE agent_catalog_settings SET default_agent_id = ?,
        revision = revision + 1, updated_at = ? WHERE singleton_id = 1 AND revision = ?`)
        .run(agentId, now, expectedRevision);
      if (Number(result.changes) !== 1) throw new Error('Agent catalog revision conflict');
      return requireSettings();
    });
  }

  updateDefaults(defaultsInput: AgentDefaults, expectedRevision: number): AgentCatalogSettings {
    const defaults = AgentDefaultsSchema.parse(defaultsInput);
    return runSqliteWriteTransaction((db) => {
      const now = Date.now();
      const result = db.prepare(`UPDATE agent_catalog_settings SET defaults_json = ?,
        revision = revision + 1, updated_at = ? WHERE singleton_id = 1 AND revision = ?`)
        .run(JSON.stringify(defaults), now, expectedRevision);
      if (Number(result.changes) !== 1) throw new Error('Agent catalog revision conflict');
      return requireSettings();
    });
  }

  replaceBindings(bindingsInput: BindingRule[]): BindingRule[] {
    const bindings = BindingsSchema.parse(bindingsInput);
    return runSqliteWriteTransaction((db) => {
      for (const binding of bindings) {
        const agentId = normalizeAgentId(binding.agentId);
        const available = db.prepare(`SELECT 1 FROM agents WHERE id = ? AND enabled = 1
          AND provisioning_state = 'ready' AND deleted_at IS NULL`).get(agentId);
        if (!available) throw new Error(`Agent "${agentId}" is not available`);
      }
      db.prepare('DELETE FROM agent_bindings').run();
      const now = Date.now();
      const insert = db.prepare(`INSERT INTO agent_bindings
        (id, agent_id, position, rule_json, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)`);
      bindings.forEach((binding, position) => {
        const { id, agentId, ...rule } = binding;
        insert.run(id ?? randomUUID(), normalizeAgentId(agentId), position, JSON.stringify(rule), now, now);
      });
      db.prepare(`UPDATE agent_catalog_settings SET revision = revision + 1, updated_at = ? WHERE singleton_id = 1`).run(now);
      return this.snapshot().bindings;
    });
  }

  setSurfaceDefault(surfaceRaw: string, agentIdRaw: string): void {
    const surface = surfaceRaw.trim();
    if (!surface) throw new Error('Surface is required');
    const agentId = normalizeAgentId(agentIdRaw);
    runSqliteWriteTransaction((db) => {
      const now = Date.now();
      const available = db.prepare(`SELECT 1 FROM agents WHERE id = ? AND enabled = 1
        AND provisioning_state = 'ready' AND deleted_at IS NULL`).get(agentId);
      if (!available) throw new Error(`Agent "${agentId}" is not available`);
      db.prepare(`INSERT INTO agent_surface_defaults(surface, agent_id, revision, updated_at)
        VALUES (?, ?, 1, ?) ON CONFLICT(surface) DO UPDATE SET agent_id = excluded.agent_id,
        revision = agent_surface_defaults.revision + 1, updated_at = excluded.updated_at`)
        .run(surface, agentId, now);
      db.prepare(`UPDATE agent_catalog_settings SET revision = revision + 1, updated_at = ? WHERE singleton_id = 1`).run(now);
    });
  }

  clearSurfaceDefault(surfaceRaw: string): void {
    const surface = surfaceRaw.trim();
    if (!surface) throw new Error('Surface is required');
    runSqliteWriteTransaction((db) => {
      const result = db.prepare('DELETE FROM agent_surface_defaults WHERE surface = ?').run(surface);
      if (Number(result.changes) > 0) bumpCatalogRevision(Date.now());
    });
  }

  markProvisioned(agentIdRaw: string): StoredAgent {
    const agentId = normalizeAgentId(agentIdRaw);
    return runSqliteWriteTransaction((db) => {
      const now = Date.now();
      const result = db.prepare(`UPDATE agents SET provisioning_state = 'ready', provisioning_error = NULL,
        revision = revision + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(now, agentId);
      if (Number(result.changes) !== 1) throw new Error(`Agent "${agentId}" not found`);
      db.prepare('DELETE FROM agent_provisioning_jobs WHERE agent_id = ?').run(agentId);
      bumpCatalogRevision(now);
      return rowToAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow);
    });
  }

  markProvisioningFailed(agentIdRaw: string, errorMessage: string): void {
    const agentId = normalizeAgentId(agentIdRaw);
    runSqliteWriteTransaction((db) => {
      const now = Date.now();
      const bounded = errorMessage.slice(0, 1_000);
      db.prepare(`UPDATE agents SET provisioning_state = 'error', provisioning_error = ?,
        revision = revision + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
        .run(bounded, now, agentId);
      db.prepare(`UPDATE agent_provisioning_jobs SET state = 'failed', attempts = attempts + 1,
        last_error = ?, updated_at = ? WHERE agent_id = ?`).run(bounded, now, agentId);
      bumpCatalogRevision(now);
    });
  }

  listPendingProvisioningAgentIds(): string[] {
    return (getSqliteDatabase().prepare(`SELECT agent_id FROM agent_provisioning_jobs
      WHERE operation = 'provision' AND state IN ('pending', 'failed') ORDER BY created_at`).all() as Array<{ agent_id: string }>)
      .map((row) => row.agent_id);
  }

  delete(agentIdRaw: string): { agent: StoredAgent; removedBindings: number } {
    const agentId = normalizeAgentId(agentIdRaw);
    return runSqliteWriteTransaction((db) => {
      const settings = requireSettings();
      if (agentId === DEFAULT_AGENT_ID) {
        throw new Error(`Agent id "${DEFAULT_AGENT_ID}" is reserved for the primary Agent`);
      }
      if (settings.defaultAgentId === agentId) {
        throw new Error(`Agent "${agentId}" is the global default Agent`);
      }
      const surface = db.prepare('SELECT surface FROM agent_surface_defaults WHERE agent_id = ? LIMIT 1')
        .get(agentId) as { surface: string } | undefined;
      if (surface) throw new Error(`Agent "${agentId}" is the ${surface.surface} default Agent`);
      const row = db.prepare('SELECT * FROM agents WHERE id = ? AND deleted_at IS NULL').get(agentId) as AgentRow | undefined;
      if (!row) throw new Error(`Agent "${agentId}" not found`);
      const removedBindings = Number(db.prepare('DELETE FROM agent_bindings WHERE agent_id = ?').run(agentId).changes);
      db.prepare('DELETE FROM agent_provisioning_jobs WHERE agent_id = ?').run(agentId);
      db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
      bumpCatalogRevision(Date.now());
      return { agent: rowToAgent(row), removedBindings };
    });
  }
}

export function defaultAgentDefaults(): AgentDefaults {
  return structuredClone(DEFAULT_AGENT_DEFAULTS);
}
