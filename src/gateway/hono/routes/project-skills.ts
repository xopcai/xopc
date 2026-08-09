import type { Context, Hono } from 'hono';

import { ProjectSkillError, ProjectSkillService } from '../../../projects/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function projectSkills(deps: AuthenticatedRouteDeps): ProjectSkillService {
  return new ProjectSkillService({
    projects: deps.service.projects,
    getConfig: () => deps.service.currentConfig,
    refreshSkills: () => deps.service.agentService.refreshSkillsAfterDiskChange(),
  });
}

function errorResponse(c: Context, error: unknown) {
  if (error instanceof ProjectSkillError) {
    return c.json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  return c.json({ ok: false, code: 'project_skill_operation_failed', error: error instanceof Error ? error.message : String(error) }, 400);
}

export function registerProjectSkillRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/projects/:projectId/skills', (c) => {
    try {
      return c.json({ ok: true, ...projectSkills(deps).list(c.req.param('projectId')) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authenticated.get('/api/projects/:projectId/skills/:skillId', (c) => {
    try {
      return c.json({ ok: true, skill: projectSkills(deps).getContent(c.req.param('projectId'), c.req.param('skillId')) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authenticated.post('/api/projects/:projectId/skills/upload', async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) return c.json({ ok: false, error: 'Skill zip file is required' }, 400);
      const skill = await projectSkills(deps).installZip(c.req.param('projectId'), Buffer.from(await file.arrayBuffer()), {
        skillId: typeof body.skillId === 'string' ? body.skillId : undefined,
        overwrite: body.overwrite === 'true',
      });
      return c.json({ ok: true, skill }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authenticated.post('/api/projects/:projectId/skills/marketplace/install', async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return c.json({ ok: false, error: 'Marketplace skill name is required' }, 400);
      const skill = await projectSkills(deps).installMarketplace(c.req.param('projectId'), {
        name,
        version: typeof body.version === 'string' ? body.version : undefined,
        provider: typeof body.provider === 'string' ? body.provider : undefined,
        overwrite: body.overwrite === true,
      });
      return c.json({ ok: true, skill }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authenticated.post('/api/projects/:projectId/skills/source/install', async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const source = typeof body.source === 'string' ? body.source.trim() : '';
      if (!source) return c.json({ ok: false, error: 'Skill source is required' }, 400);
      const skill = await projectSkills(deps).installSource(c.req.param('projectId'), {
        source,
        skillId: typeof body.skillId === 'string' ? body.skillId : undefined,
        ref: typeof body.ref === 'string' ? body.ref : undefined,
        subpath: typeof body.subpath === 'string' ? body.subpath : undefined,
        force: body.force === true,
      });
      return c.json({ ok: true, skill }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authenticated.delete('/api/projects/:projectId/skills/:skillId', async (c) => {
    try {
      await projectSkills(deps).remove(c.req.param('projectId'), c.req.param('skillId'));
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(c, error);
    }
  });
}
