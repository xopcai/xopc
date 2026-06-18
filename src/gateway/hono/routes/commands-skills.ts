import type { Hono } from 'hono';

import { commandRegistry } from '../../../chat-commands/index.js';
import { isRegisteredProvider } from '../../../agent/skills/skills-marketplace.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function parseMarketplaceProviderQuery(raw: string | undefined): string | undefined {
  const v = raw?.trim().toLowerCase();
  if (v && isRegisteredProvider(v)) return v;
  return undefined;
}

export function registerCommandsSkillsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  // ========== Chat slash commands (CommandRegistry) ==========

  authenticated.get('/api/commands', (c) => {
    const all = commandRegistry.list();
    const commands = all
      .filter((cmd) => cmd.scope.includes('global') || cmd.scope.includes('private'))
      .map((cmd) => ({
        id: cmd.id,
        name: cmd.name,
        aliases: cmd.aliases ?? [],
        description: cmd.description,
        category: cmd.category,
        scope: cmd.scope,
        acceptsArgs: cmd.acceptsArgs ?? false,
        examples: cmd.examples ?? [],
      }));
    const extensionCommands = all
      .filter((cmd) => cmd.category === 'extension')
      .map((cmd) => ({
        id: cmd.id,
        name: cmd.name,
        description: cmd.description,
        extensionId: cmd.id.startsWith('ext.') ? cmd.id.split('.')[1] : undefined,
      }));
    return c.json({ ok: true, payload: { commands, extensionCommands } });
  });

  // ========== Skills (managed global skills under ~/.xopc/skills) ==========

  authenticated.get('/api/skills', (c) => {
    const payload = service.marketplace.getSkillsApi();
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
    const data = service.marketplace.getSkillMarkdownSource(skillName);
    if (!data) {
      return c.json({ ok: false, error: 'Skill not found' }, 404);
    }
    return c.json({ ok: true, payload: data });
  });

  authenticated.post('/api/skills/reload', (c) => {
    service.marketplace.reloadSkills();
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
      service.marketplace.patchSkillEnabled(skillName, enabled);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Update failed' },
        400,
      );
    }
  });

  authenticated.get('/api/skills/marketplace', async (c) => {
    const q = c.req.query('q')?.trim() ?? '';
    const pageRaw = c.req.query('page');
    const pageSizeRaw = c.req.query('pageSize');
    const sortRaw = c.req.query('sort');
    const page = pageRaw != null && pageRaw !== '' ? Math.max(1, Number(pageRaw) || 1) : undefined;
    const pageSize =
      pageSizeRaw != null && pageSizeRaw !== ''
        ? Math.min(50, Math.max(1, Number(pageSizeRaw) || 20))
        : undefined;
    const sort =
      sortRaw === 'newest' || sortRaw === 'downloads' ? sortRaw : undefined;
    const category = c.req.query('category')?.trim() ?? '';
    const provider = parseMarketplaceProviderQuery(c.req.query('provider'));
    try {
      const payload = await service.marketplace.fetchSkillsCatalog(
        {
          q: q || undefined,
          page,
          pageSize,
          sort,
          category: category || undefined,
        },
        provider,
      );
      return c.json({ ok: true, payload });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Marketplace request failed' },
        502,
      );
    }
  });

  authenticated.get('/api/skills/marketplace/provider', (c) => {
    const info = service.marketplace.getSkillsProvider();
    return c.json({ ok: true, payload: info });
  });

  /** All registered marketplace providers (built-in + extension-contributed). */
  authenticated.get('/api/skills/marketplace/providers', (c) => {
    const providers = service.marketplace.getSkillsProviders();
    const current = service.marketplace.getSkillsProvider();
    return c.json({ ok: true, payload: { providers, current: current.provider } });
  });

  authenticated.get('/api/skills/marketplace/categories', async (c) => {
    const provider = parseMarketplaceProviderQuery(c.req.query('provider'));
    try {
      const payload = await service.marketplace.fetchSkillsCategories(provider);
      return c.json({ ok: true, payload });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Marketplace categories failed' },
        502,
      );
    }
  });

  authenticated.get('/api/skills/marketplace/packages/:pkgName', async (c) => {
    const raw = c.req.param('pkgName');
    if (!raw) {
      return c.json({ ok: false, error: 'Missing package name' }, 400);
    }
    let pkgName: string;
    try {
      pkgName = decodeURIComponent(raw);
    } catch {
      return c.json({ ok: false, error: 'Invalid package name' }, 400);
    }
    try {
      const provider = parseMarketplaceProviderQuery(c.req.query('provider'));
      const payload = await service.marketplace.fetchSkillsPackageDetail(pkgName, provider);
      return c.json({ ok: true, payload });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Marketplace request failed' },
        502,
      );
    }
  });

  authenticated.post('/api/skills/marketplace/install', async (c) => {
    let body: { name?: unknown; version?: unknown; overwrite?: unknown; provider?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const version = typeof body.version === 'string' ? body.version.trim() : undefined;
    const overwrite =
      body.overwrite === true ||
      body.overwrite === 'true' ||
      body.overwrite === '1';
    const provider = parseMarketplaceProviderQuery(
      typeof body.provider === 'string' ? body.provider : undefined,
    );
    if (!name) {
      return c.json({ ok: false, error: 'Expected { name: string, version?: string, overwrite?: boolean }' }, 400);
    }
    try {
      const payload = await service.marketplace.installSkill({ name, version, overwrite, provider });
      return c.json({ ok: true, payload });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Install failed' },
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
      const result = service.marketplace.installSkillZip(buf, { skillId, overwrite });
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
      service.marketplace.deleteSkill(id);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Delete failed' },
        400,
      );
    }
  });
}
