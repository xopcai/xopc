import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/index.js';
import type {
  LocalApp,
  LocalAppAcceptanceCheck,
  LocalAppAcceptanceRun,
  LocalAppRelease,
  LocalAppStatus,
  LocalAppUiGrant,
  RecordLocalAppAcceptanceInput,
} from './types.js';

type LocalAppRow = {
  app_id: string;
  extension_id: string;
  project_id: string;
  name: string;
  description: string | null;
  idea: string;
  status: string;
  workspace_root: string;
  preview_token: string;
  draft_version: number;
  active_version: number | null;
  created_at: number;
  updated_at: number;
  installed_at: number | null;
  installation_state: string;
  enabled: number;
  active_release_id: string | null;
};

type LocalAppReleaseRow = {
  release_id: string;
  app_id: string;
  version: number;
  source_hash: string;
  artifact_path: string | null;
  manifest_json: string;
  health_status: string;
  created_at: number;
  activated_at: number | null;
};

type LocalAppAcceptanceRunRow = {
  run_id: string;
  app_id: string;
  source_hash: string;
  status: string;
  checks_json: string;
  interactive_count: number;
  created_at: number;
};

type LocalAppGrantRow = {
  extension_id: string;
  app_id: string | null;
  manifest_digest: string;
  permissions_json: string;
  granted_at: number;
  revoked_at: number | null;
};

export interface StoredLocalAppRelease extends LocalAppRelease {
  artifactPath: string;
  manifestJson: string;
}

function fromRow(row: LocalAppRow): LocalApp {
  return {
    id: row.app_id,
    extensionId: row.extension_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description ?? undefined,
    idea: row.idea,
    status: row.status as LocalAppStatus,
    workspaceRoot: row.workspace_root,
    draftVersion: row.draft_version,
    activeVersion: row.active_version ?? undefined,
    activeReleaseId: row.active_release_id ?? undefined,
    installationState: row.installation_state as LocalApp['installationState'],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    installedAt: row.installed_at ?? undefined,
  };
}

function releaseFromRow(row: LocalAppReleaseRow, activeReleaseId?: string): StoredLocalAppRelease {
  return {
    id: row.release_id,
    appId: row.app_id,
    version: row.version,
    sourceHash: row.source_hash,
    artifactPath: row.artifact_path ?? '',
    manifestJson: row.manifest_json,
    healthStatus: row.health_status as LocalAppRelease['healthStatus'],
    createdAt: row.created_at,
    activatedAt: row.activated_at ?? undefined,
    isActive: row.release_id === activeReleaseId,
  };
}

function acceptanceRunFromRow(row: LocalAppAcceptanceRunRow): LocalAppAcceptanceRun {
  return {
    id: row.run_id,
    appId: row.app_id,
    sourceHash: row.source_hash,
    status: row.status as LocalAppAcceptanceRun['status'],
    checks: JSON.parse(row.checks_json) as LocalAppAcceptanceCheck[],
    interactiveCount: row.interactive_count,
    createdAt: row.created_at,
  };
}

export class LocalAppStore {
  create(input: {
    extensionId: string;
    projectId: string;
    name: string;
    description?: string;
    idea: string;
    workspaceRoot: string;
    previewToken: string;
  }): LocalApp {
    const now = Date.now();
    const id = randomUUID();
    runSqliteWriteTransaction((db) => {
      db.prepare(`INSERT INTO local_apps (
        app_id, extension_id, project_id, name, description, idea, status,
        workspace_root, preview_token, draft_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'preview_ready', ?, ?, 1, ?, ?)`).run(
        id,
        input.extensionId,
        input.projectId,
        input.name,
        input.description ?? null,
        input.idea,
        input.workspaceRoot,
        input.previewToken,
        now,
        now,
      );
    });
    return this.get(id)!;
  }

  get(id: string): LocalApp | null {
    const row = getSqliteDatabase().prepare('SELECT * FROM local_apps WHERE app_id = ?').get(id) as LocalAppRow | undefined;
    return row ? fromRow(row) : null;
  }

  findByProjectId(projectId: string): LocalApp | null {
    const row = getSqliteDatabase()
      .prepare('SELECT * FROM local_apps WHERE project_id = ?')
      .get(projectId) as LocalAppRow | undefined;
    return row ? fromRow(row) : null;
  }

  findByExtensionId(extensionId: string): LocalApp | null {
    const row = getSqliteDatabase()
      .prepare('SELECT * FROM local_apps WHERE extension_id = ?')
      .get(extensionId) as LocalAppRow | undefined;
    return row ? fromRow(row) : null;
  }

  list(): LocalApp[] {
    const rows = getSqliteDatabase().prepare('SELECT * FROM local_apps ORDER BY updated_at DESC').all() as LocalAppRow[];
    return rows.map(fromRow);
  }

  findByPreviewToken(previewToken: string): LocalApp | null {
    const row = getSqliteDatabase().prepare('SELECT * FROM local_apps WHERE preview_token = ?').get(previewToken) as LocalAppRow | undefined;
    return row ? fromRow(row) : null;
  }

  getPreviewToken(id: string): string | null {
    const row = getSqliteDatabase().prepare('SELECT preview_token FROM local_apps WHERE app_id = ?').get(id) as { preview_token: string } | undefined;
    return row?.preview_token ?? null;
  }

  listReleases(appId: string): StoredLocalAppRelease[] {
    const app = this.get(appId);
    const rows = getSqliteDatabase()
      .prepare('SELECT * FROM local_app_releases WHERE app_id = ? ORDER BY version DESC')
      .all(appId) as LocalAppReleaseRow[];
    return rows.map((row) => releaseFromRow(row, app?.activeReleaseId));
  }

  getRelease(appId: string, releaseId: string): StoredLocalAppRelease | null {
    const app = this.get(appId);
    const row = getSqliteDatabase()
      .prepare('SELECT * FROM local_app_releases WHERE app_id = ? AND release_id = ?')
      .get(appId, releaseId) as LocalAppReleaseRow | undefined;
    return row ? releaseFromRow(row, app?.activeReleaseId) : null;
  }

  listAcceptanceRuns(appId: string, limit = 20): LocalAppAcceptanceRun[] {
    const rows = getSqliteDatabase()
      .prepare('SELECT * FROM local_app_acceptance_runs WHERE app_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(appId, Math.max(1, Math.min(Math.floor(limit), 100))) as LocalAppAcceptanceRunRow[];
    return rows.map(acceptanceRunFromRow);
  }

  getLatestAcceptanceForSource(appId: string, sourceHash: string): LocalAppAcceptanceRun | null {
    const row = getSqliteDatabase()
      .prepare(`SELECT * FROM local_app_acceptance_runs
        WHERE app_id = ? AND source_hash = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(appId, sourceHash) as LocalAppAcceptanceRunRow | undefined;
    return row ? acceptanceRunFromRow(row) : null;
  }

  getUiGrant(extensionId: string, manifestDigest: string): LocalAppUiGrant | null {
    const row = getSqliteDatabase()
      .prepare(`SELECT * FROM extension_ui_grants
        WHERE extension_id = ? AND manifest_digest = ? AND revoked_at IS NULL`)
      .get(extensionId, manifestDigest) as LocalAppGrantRow | undefined;
    if (!row) return null;
    return {
      granted: true,
      extensionId: row.extension_id,
      appId: row.app_id ?? undefined,
      manifestDigest: row.manifest_digest,
      permissions: JSON.parse(row.permissions_json) as string[],
      grantedAt: row.granted_at,
    };
  }

  saveUiGrant(input: {
    extensionId: string;
    appId?: string;
    manifestDigest: string;
    permissions: string[];
  }): LocalAppUiGrant {
    const grantedAt = Date.now();
    getSqliteDatabase().prepare(`INSERT INTO extension_ui_grants (
      extension_id, app_id, manifest_digest, permissions_json, granted_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(extension_id, manifest_digest) DO UPDATE SET
      app_id = excluded.app_id,
      permissions_json = excluded.permissions_json,
      granted_at = excluded.granted_at,
      revoked_at = NULL`).run(
      input.extensionId,
      input.appId ?? null,
      input.manifestDigest,
      JSON.stringify(input.permissions),
      grantedAt,
    );
    return {
      granted: true,
      extensionId: input.extensionId,
      appId: input.appId,
      manifestDigest: input.manifestDigest,
      permissions: input.permissions,
      grantedAt,
    };
  }

  recordAcceptance(appId: string, input: RecordLocalAppAcceptanceInput): LocalAppAcceptanceRun {
    const checksJson = JSON.stringify(input.checks);
    const latest = this.listAcceptanceRuns(appId, 1)[0];
    if (latest
      && latest.sourceHash === input.sourceHash
      && latest.status === input.status
      && latest.interactiveCount === input.interactiveCount
      && JSON.stringify(latest.checks) === checksJson) {
      return latest;
    }
    const row: LocalAppAcceptanceRunRow = {
      run_id: randomUUID(),
      app_id: appId,
      source_hash: input.sourceHash,
      status: input.status,
      checks_json: checksJson,
      interactive_count: input.interactiveCount,
      created_at: Date.now(),
    };
    getSqliteDatabase().prepare(`INSERT INTO local_app_acceptance_runs (
      run_id, app_id, source_hash, status, checks_json, interactive_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      row.run_id,
      row.app_id,
      row.source_hash,
      row.status,
      row.checks_json,
      row.interactive_count,
      row.created_at,
    );
    return acceptanceRunFromRow(row);
  }

  markInstalled(input: {
    id: string;
    version: number;
    sourceHash: string;
    artifactPath: string;
    manifestJson: string;
  }): LocalApp {
    const now = Date.now();
    const releaseId = randomUUID();
    runSqliteWriteTransaction((db) => {
      db.prepare(`INSERT INTO local_app_releases (
        release_id, app_id, version, source_hash, artifact_path, manifest_json,
        health_status, created_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'healthy', ?, ?)`).run(
        releaseId,
        input.id,
        input.version,
        input.sourceHash,
        input.artifactPath,
        input.manifestJson,
        now,
        now,
      );
      db.prepare(`UPDATE local_apps SET status = 'installed', active_version = ?, active_release_id = ?,
        draft_version = ?, installation_state = 'installed', enabled = 1,
        installed_at = COALESCE(installed_at, ?), updated_at = ? WHERE app_id = ?`)
        .run(input.version, releaseId, input.version + 1, now, now, input.id);
    });
    return this.get(input.id)!;
  }

  activateRelease(appId: string, releaseId: string): LocalApp {
    const release = this.getRelease(appId, releaseId);
    if (!release) throw new Error('Local app release not found');
    const now = Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare('UPDATE local_app_releases SET activated_at = ? WHERE release_id = ?').run(now, releaseId);
      db.prepare(`UPDATE local_apps SET status = 'installed', active_version = ?, active_release_id = ?,
        installation_state = 'installed', enabled = 1, updated_at = ? WHERE app_id = ?`)
        .run(release.version, releaseId, now, appId);
    });
    return this.get(appId)!;
  }

  setEnabled(appId: string, enabled: boolean): LocalApp {
    const now = Date.now();
    getSqliteDatabase().prepare('UPDATE local_apps SET enabled = ?, updated_at = ? WHERE app_id = ?')
      .run(enabled ? 1 : 0, now, appId);
    const app = this.get(appId);
    if (!app) throw new Error('Local app not found');
    return app;
  }

  markUninstalled(appId: string): LocalApp {
    const now = Date.now();
    getSqliteDatabase().prepare(`UPDATE local_apps SET status = 'preview_ready', active_version = NULL,
      active_release_id = NULL, installation_state = 'not_installed', enabled = 0, updated_at = ? WHERE app_id = ?`)
      .run(now, appId);
    const app = this.get(appId);
    if (!app) throw new Error('Local app not found');
    return app;
  }
}
