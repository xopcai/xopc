import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import type { GatewayService } from '../../../service.js';
import { registerProjectSkillRoutes } from '../project-skills.js';

function makeSkillZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile('sales/SKILL.md', Buffer.from('---\nname: sales\ndescription: Sales helper\n---\n\nSell well.\n'));
  return zip.toBuffer();
}

describe('project skill routes', () => {
  let stateDir: string;
  let workspaceRoot: string;
  let previousStateDir: string | undefined;
  let projects: ProjectService;
  const refreshSkillsAfterDiskChange = vi.fn();
  const getWorkspaceTrust = vi.fn((workspacePath: string) => ({
    workspacePath,
    required: false,
    decision: null,
    trusted: false,
  }));
  const setWorkspaceTrust = vi.fn((workspacePath: string, trusted: boolean) => ({
    workspacePath,
    required: true,
    decision: trusted,
    trusted,
  }));

  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-project-skill-routes-'));
    workspaceRoot = mkdtempSync(join(tmpdir(), 'xopc-project-skill-workspace-'));
    process.env.XOPC_STATE_DIR = stateDir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projects = new ProjectService();
    refreshSkillsAfterDiskChange.mockReset();
    getWorkspaceTrust.mockClear();
    setWorkspaceTrust.mockClear();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function app(): Hono {
    const app = new Hono();
    const service = {
      projects,
      currentConfig: ConfigSchema.parse({}),
      agentService: { refreshSkillsAfterDiskChange, getWorkspaceTrust, setWorkspaceTrust },
    } as unknown as GatewayService;
    registerProjectSkillRoutes(app, { service } as Parameters<typeof registerProjectSkillRoutes>[1]);
    return app;
  }

  it('uploads and lists a skill in the project workspace', async () => {
    const project = projects.create({ name: 'Sales', workspaceRoot });
    const form = new FormData();
    form.set('file', new File([makeSkillZip()], 'sales.zip', { type: 'application/zip' }));

    const upload = await app().request(`/api/projects/${project.id}/skills/upload`, { method: 'POST', body: form });
    const list = await app().request(`/api/projects/${project.id}/skills`);

    expect(upload.status).toBe(201);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual(expect.objectContaining({
      ok: true,
      workspaceRoot: realpathSync(workspaceRoot),
      items: [expect.objectContaining({ directoryId: 'sales', name: 'sales', origin: 'xopc-workspace' })],
    }));
    expect(refreshSkillsAfterDiskChange).toHaveBeenCalledOnce();
  });

  it('reads and updates project workspace trust without requiring a session', async () => {
    const project = projects.create({ name: 'Trust', workspaceRoot });

    const read = await app().request(`/api/projects/${project.id}/workspace-trust`);
    const update = await app().request(`/api/projects/${project.id}/workspace-trust`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trusted: true }),
    });

    expect(read.status).toBe(200);
    expect(update.status).toBe(200);
    expect(getWorkspaceTrust).toHaveBeenCalledWith(realpathSync(workspaceRoot));
    expect(setWorkspaceTrust).toHaveBeenCalledWith(realpathSync(workspaceRoot), true);
  });

  it('returns an explicit error instead of falling back to a global workspace', async () => {
    const project = projects.create({ name: 'No workspace' });

    const response = await app().request(`/api/projects/${project.id}/skills`);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'project_workspace_required',
      error: 'Project workspace is required',
    });
  });
});
