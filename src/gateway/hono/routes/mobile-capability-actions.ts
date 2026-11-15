import { randomUUID } from 'node:crypto';

import type { Context, Hono } from 'hono';
import { z } from 'zod';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { AgentCatalogService } from '../../../agent-catalog/service.js';
import { McpConnectionDrafts, McpDraftError } from '../../../agent/mcp/connection-drafts.js';
import { searchSkillMarketplaces } from '../../../agent/skills/marketplace/search.js';
import { checkUrlSafety } from '../../../agent/tools/url-safety.js';
import { evictAllEmbeddedSessionRunners } from '../../../agent/embedded/session-runner.js';
import { getWorkspacePath } from '../../../config/workspace-path-helpers.js';
import { AgentPluginStore } from '../../../extensions/agent-plugins/store.js';
import { pluginAuthorizations } from '../../../extensions/agent-plugins/setup-contract.js';
import { PluginSetupService, setupActionSchema } from '../../../extensions/agent-plugins/setup.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { getGatewayPrincipal, getPersonalOwnerId } from '../../security/gateway-principal.js';
import { withGatewayConfigWriteLock } from '../lib/config-write-lock.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const prefix = '/api/capabilities/mobile-actions';
const install = z.strictObject({
  selection: z.uuid(),
});
const httpMcp = z.strictObject({
  serverId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).refine(id => !['__proto__', 'constructor', 'prototype'].includes(id.toLowerCase())),
  url: z.url().max(2048),
});
const mcpAction = z.discriminatedUnion('action', [
  z.strictObject({ action: z.enum(['probe', 'authorize', 'status', 'save', 'remove']) }),
  z.strictObject({ action: z.literal('redirect'), url: z.url().max(8192) }),
]);
const pluginAction = z.union([
  z.strictObject({ action: z.literal('start') }),
  z.strictObject({ action: z.literal('status'), server: z.string().min(1).max(120) }),
  z.strictObject({ action: z.literal('redirect'), server: z.string().min(1).max(120), url: z.url().max(8192) }),
  setupActionSchema,
]);
const agentProfile = z.strictObject({
  expectedRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000),
});

/** The native surface accepts exact product operations from a paired owner device, never general Gateway administration. */
export function registerMobileCapabilityActions(app: Hono, { service, strictRateLimitMiddleware }: AuthenticatedRouteDeps): void {
  const drafts = new McpConnectionDrafts({ readConfig: () => service.currentConfig,
    saveConfig: (next, expected) => service.saveConfig(next, expected) });
  const pluginStore = new AgentPluginStore();
  const pluginSetup = new PluginSetupService(pluginStore);
  const owner = 'gateway-owner';
  const selections = new Map<string, { principal: string; provider: string; name: string; expiresAt: number }>();
  const guard = (fn: (c: Context) => unknown | Promise<unknown>) => async (c: Context) => {
    if (!getPersonalOwnerId(c)) return c.json({ ok: false, error: 'A paired owner device is required.' }, 403);
    c.header('Cache-Control', 'no-store');
    try { return c.json({ ok: true, payload: await fn(c) }); }
    catch (err) {
      const message = err instanceof McpDraftError ? err.message : err instanceof z.ZodError ? 'Invalid request.' : 'This operation could not be completed.';
      return c.json({ ok: false, error: message }, err instanceof McpDraftError ? err.status : 400);
    }
  };

  app.get(prefix + '/skills', strictRateLimitMiddleware, guard(async c => {
    const query = z.string().trim().min(2).max(160).parse(c.req.query('q'));
    const result = await searchSkillMarketplaces({ config: service.currentConfig, query, limit: 15 });
    const installed = new Set(service.marketplace.getSkillsApi().catalog.map(skill => skill.directoryId.toLowerCase()));
    const now = Date.now(), principal = getGatewayPrincipal(c).principalId;
    for (const [key, value] of selections) if (value.expiresAt <= now) selections.delete(key);
    return { items: result.results.map(row => {
      const alreadyInstalled = installed.has(row.id.toLowerCase()) || installed.has(row.name.toLowerCase())
        || installed.has(row.install.reference.split('/').at(-1)?.toLowerCase() ?? '');
      const selection = alreadyInstalled || row.security.status === 'fail' ? undefined : randomUUID();
      if (selection) {
        if (selections.size >= 600) selections.delete(selections.keys().next().value!);
        selections.set(selection, { principal, provider: row.provider, name: row.install.reference, expiresAt: now + 10 * 60_000 });
      }
      return { id: row.install.reference, name: row.name, description: row.description, provider: row.provider,
        author: row.author, security: row.security.status, installed: alreadyInstalled, selection };
    }),
    incomplete: result.sources.some(source => !source.ok) };
  }));
  app.post(prefix + '/skills', strictRateLimitMiddleware, guard(async c => {
    const body = install.parse(await c.req.json());
    const item = selections.get(body.selection);
    if (!item || item.expiresAt <= Date.now() || item.principal !== getGatewayPrincipal(c).principalId) {
      throw new McpDraftError(409, 'Search again before installing this skill.');
    }
    selections.delete(body.selection);
    try {
      const result = await service.marketplace.installSkill({ name: item.name, provider: item.provider, target: 'global', overwrite: false });
      return { installed: true, name: result.skillId };
    } catch (error) {
      selections.set(body.selection, item);
      throw error;
    }
  }));

  app.post(prefix + '/mcp', strictRateLimitMiddleware, guard(async c => {
    const input = httpMcp.parse(await c.req.json());
    const url = new URL(input.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !checkUrlSafety(url.href).safe) {
      throw new McpDraftError(400, 'Use a public HTTPS MCP endpoint without credentials or query parameters.');
    }
    return drafts.create(getGatewayPrincipal(c).principalId, { serverId: input.serverId,
      server: { type: 'http', url: url.href, xopcPublicOnly: true } });
  }));
  app.post(prefix + '/mcp/:id', strictRateLimitMiddleware, guard(async c => {
    const id = z.uuid().parse(c.req.param('id'));
    const principal = getGatewayPrincipal(c).principalId;
    const body = mcpAction.parse(await c.req.json());
    switch (body.action) {
      case 'probe': {
        const { state, toolCount, errorCode } = await drafts.probe(principal, id);
        return { state, toolCount, errorCode };
      }
      case 'authorize': {
        const { state, authorizationUrl } = drafts.authorize(principal, id);
        return { state, authorizationUrl };
      }
      case 'status': {
        const { state, authorizationUrl, toolCount } = drafts.authorization(principal, id);
        return { state, authorizationUrl, toolCount };
      }
      case 'redirect': drafts.redirect(principal, id, body.url); return { state: 'authorizing' };
      case 'save': return withGatewayConfigWriteLock(service, () => drafts.commit(principal, id, true));
      case 'remove': drafts.remove(principal, id); return { state: 'cancelled' };
    }
  }));

  function editableAgent(c: Context) {
    const id = c.req.param('id');
    const agent = new AgentCatalogRepository().get(id);
    if (!agent || agent.enabled === false || agent.id === personalAgentId(getPersonalOwnerId(c)!)) {
      throw new McpDraftError(404, 'This agent profile is not editable here.');
    }
    return agent;
  }

  function publicAgentProfile(agent: ReturnType<typeof editableAgent>) {
    return { revision: agent.revision, name: agent.profile?.name ?? agent.id, description: agent.profile?.description ?? '' };
  }

  app.get(prefix + '/agent/:id', guard(c => publicAgentProfile(editableAgent(c))));
  app.post(prefix + '/agent/:id', strictRateLimitMiddleware, guard(async c => {
    const agent = editableAgent(c);
    const { expectedRevision, name, description } = agentProfile.parse(await c.req.json());
    if (agent.revision !== expectedRevision) throw new McpDraftError(409, 'The agent profile changed. Reopen it before saving.');
    const updated = await new AgentCatalogService().update(agent.id, {
      profile: { ...agent.profile, name, description },
    }, expectedRevision);
    service.refreshAgentCatalog();
    return publicAgentProfile(updated);
  }));

  function pluginSummary(id: string) {
    const plugin = pluginStore.pending(id) ?? pluginStore.get(id);
    if (!plugin) throw new McpDraftError(404, 'Install the reviewed plugin package before setting it up.');
    const job = pluginSetup.get(id, owner);
    const fields = Object.entries(plugin.layout?.userConfig ?? {}).map(([id, field]) =>
      ({ id, title: field.title ?? id, type: field.type, sensitive: field.sensitive }));
    const accounts = pluginAuthorizations(plugin.manifest).map(account => ({
      id: account.id, title: account.title, description: account.description, methods: account.methods.map(method => ({
        id: method.id, title: method.title, type: method.type,
        fields: 'fields' in method ? method.fields : [], instructions: method.instructions,
      })),
    }));
    return { active: plugin.receipt.enabled, accounts, fields,
      job: job && job.packageRevision === plugin.receipt.revision ? { revision: job.revision, state: job.state,
        connections: job.connections.map(({ name, state }) => ({ name, state })),
        authorizations: job.authorizations.map(({ id, state }) => ({ id, state })), missingConfig: job.missingConfig } : undefined };
  }

  app.get(prefix + '/plugin/:id', guard(c => pluginSummary(c.req.param('id'))));
  app.post(prefix + '/plugin/:id', strictRateLimitMiddleware, guard(async c => {
    const id = c.req.param('id');
    const body = pluginAction.parse(await c.req.json());
    const config = service.currentConfig;
    if (body.action === 'start') { pluginSetup.create(id, owner); return pluginSummary(id); }
    if (body.action === 'status') {
      const auth = await pluginSetup.authorization(id, owner, body.server, config);
      return { ...pluginSummary(id), authorizationUrl: auth && ('challenge' in auth ? auth.challenge?.url :
        'authorizationUrl' in auth ? auth.authorizationUrl : undefined) };
    }
    if (body.action === 'redirect') {
      if (!pluginSetup.redirect(id, owner, body.server, body.url, config)) throw new McpDraftError(400, 'The callback does not match this authorization.');
      return pluginSummary(id);
    }
    if ('workspacePaths' in body && body.workspacePaths !== undefined) throw new McpDraftError(400, 'Mobile setup preserves workspace access.');
    if (body.action === 'prepare') {
      pluginSetup.startPrepare(id, owner, body.expectedRevision, config, getWorkspacePath(config) || process.cwd(), body.idempotencyKey);
    } else {
      await pluginSetup.act(id, owner, body, config, getWorkspacePath(config) || process.cwd());
      evictAllEmbeddedSessionRunners();
      service.marketplace.reloadSkills();
    }
    return pluginSummary(id);
  }));
}
