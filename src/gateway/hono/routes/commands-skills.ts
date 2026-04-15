import type { Hono } from 'hono';

import { commandRegistry } from '../../../chat-commands/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerCommandsSkillsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  // ========== Chat slash commands (CommandRegistry) ==========

  authenticated.get('/api/commands', (c) => {
    const commands = commandRegistry
      .list()
      .filter((cmd) => cmd.scope.includes('global') || cmd.scope.includes('private'))
      .map((cmd) => ({
        id: cmd.id,
        name: cmd.name,
        aliases: cmd.aliases ?? [],
        description: cmd.description,
        category: cmd.category,
        acceptsArgs: cmd.acceptsArgs ?? false,
        examples: cmd.examples ?? [],
      }));
    return c.json({ ok: true, payload: { commands } });
  });

  // ========== Skills (managed global skills under ~/.xopc/skills) ==========

  authenticated.get('/api/skills', (c) => {
    const payload = service.getSkillsApi();
    return c.json({ ok: true, payload });
  });

  authenticated.get('/api/skills/:skillName/content', (c) => {
    const raw = c.req.param('skillName');
    if (!raw) {
      return c.json({ ok: false, error: 'Missing skill name' }, 400);
    }
    let skillName: string;
    try {
      skillName = decodeURIComponent(raw);
    } catch {
      return c.json({ ok: false, error: 'Invalid skill name' }, 400);
    }
    const data = service.getSkillMarkdownSource(skillName);
    if (!data) {
      return c.json({ ok: false, error: 'Skill not found' }, 404);
    }
    return c.json({ ok: true, payload: data });
  });

  authenticated.post('/api/skills/reload', (c) => {
    service.reloadSkillsFromDisk();
    return c.json({ ok: true });
  });

  authenticated.patch('/api/skills/enabled', async (c) => {
    let body: { skillName?: unknown; enabled?: unknown };
    try {
      body = (await c.req.json()) as { skillName?: unknown; enabled?: unknown };
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    const skillName = typeof body.skillName === 'string' ? body.skillName.trim() : '';
    const enabled = body.enabled;
    if (!skillName || typeof enabled !== 'boolean') {
      return c.json({ ok: false, error: 'Expected { skillName: string, enabled: boolean }' }, 400);
    }
    try {
      service.patchSkillEnabled(skillName, enabled);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Update failed' },
        400,
      );
    }
  });

  authenticated.post('/api/skills/upload', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody({ all: true });
    } catch {
      return c.json({ ok: false, error: 'Invalid multipart body' }, 400);
    }
    const file = body['file'];
    if (!file || typeof file !== 'object') {
      return c.json({ ok: false, error: 'Missing file field' }, 400);
    }
    let buf: Buffer;
    if (file instanceof File) {
      buf = Buffer.from(await file.arrayBuffer());
    } else if (typeof (file as Blob).arrayBuffer === 'function') {
      buf = Buffer.from(await (file as Blob).arrayBuffer());
    } else {
      return c.json({ ok: false, error: 'Invalid file upload' }, 400);
    }
    const skillIdRaw = body['skillId'];
    const overwriteRaw = body['overwrite'];
    const skillId = typeof skillIdRaw === 'string' && skillIdRaw.trim() ? skillIdRaw.trim() : undefined;
    const overwrite =
      overwriteRaw === 'true' ||
      overwriteRaw === true ||
      overwriteRaw === '1';

    try {
      const result = service.installManagedSkillZip(buf, { skillId, overwrite });
      return c.json({ ok: true, payload: result });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Install failed' },
        400,
      );
    }
  });

  authenticated.delete('/api/skills/:id', (c) => {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ ok: false, error: 'Missing id' }, 400);
    }
    try {
      service.deleteManagedSkill(id);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Delete failed' },
        400,
      );
    }
  });
}
