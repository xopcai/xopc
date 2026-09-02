import type { Hono } from 'hono';

import {
  AgentModelsOverrideSchema,
  AgentProfileSchema,
  RuntimePolicySchema,
  SkillOverrideSchema,
  ToolPoliciesSchema,
  WorkflowPolicySchema,
} from '../../../agent-config/index.js';
import type { Config } from '../../../config/schema.js';
import { getVoiceModelsConfig } from '../../../config/voice.js';
import { normalizeAgentId } from '../../../agent/agent-scope.js';
import {
  deleteAgentAvatarFile,
  finalizeCreateAgentDirs,
  getGatewayAgentEffectiveConfig,
  listAgentProfileFiles,
  listGatewayAgents,
  prepareCreateAgent,
  prepareDeleteAgent,
  prepareUpdateAgent,
  readAgentAvatarFile,
  readAgentProfileFile,
  runAfterDeletePurge,
  writeAgentAvatarFromBase64,
  writeAgentProfileFile,
  type CreateAgentBody,
} from '../../agents-admin.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function isParseError(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: string }).error === 'string'
  );
}

function parseCreateAgentBody(raw: unknown): CreateAgentBody | { error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'each agent must be an object' };
  }
  const body = raw as Record<string, unknown>;
  const allowedKeys = new Set(['id', 'workspace', 'profile']);
  const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknownKey) return { error: `unknown create-agent field "${unknownKey}"` };
  const workspace = typeof body.workspace === 'string' ? body.workspace : undefined;
  const profile = AgentProfileSchema.safeParse(body.profile);
  if (!profile.success) return { error: `profile ${profile.error.issues[0]?.message ?? 'is required'}` };
  const id = typeof body.id === 'string' ? body.id : undefined;
  return {
    workspace,
    profile: profile.data,
    ...(id !== undefined ? { id } : {}),
  };
}

type PatchModels = import('../../../agent-config/index.js').AgentModelsOverride;

function parsePatchModels(raw: unknown): PatchModels | null | undefined | { error: string } {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'models must be an object or null' };
  }
  const parsed = AgentModelsOverrideSchema.safeParse(raw);
  return parsed.success ? parsed.data : { error: `models ${parsed.error.issues[0]?.message ?? 'is invalid'}` };
}

export function registerAgentsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/agents', async (c) => {
    const cfg = service.currentConfig as Config;
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const payload = await listGatewayAgents(cfg, { locale });
    return c.json({ ok: true, payload });
  });

  authenticated.post('/api/agents', strictRateLimitMiddleware, async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const parsed = parseCreateAgentBody(body);
    if ('error' in parsed) {
      return c.json({ ok: false, error: { message: parsed.error } }, 400);
    }
    const prep = prepareCreateAgent(service.currentConfig as Config, parsed);
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const { nextConfig, agentId } = prep.data;
    const save = await service.saveConfig(nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    const finalized = await finalizeCreateAgentDirs(service.currentConfig as Config, agentId);
    if (finalized.ok === false) {
      return c.json({ ok: false, error: { message: finalized.error } }, finalized.status ?? 400);
    }
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const agentsPayload = await listGatewayAgents(service.currentConfig as Config, { locale });
    return c.json({
      ok: true,
      payload: {
        agentId,
        agents: agentsPayload,
      },
    });
  });

  authenticated.get('/api/agents/:id/effective-config', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const res = getGatewayAgentEffectiveConfig(service.currentConfig as Config, id);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: res.data });
  });

  authenticated.patch('/api/agents/:id', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const allowedPatchKeys = new Set([
      'workspace',
      'profile',
      'models',
      'skills',
      'tools',
      'workflows',
      'runtime',
      'setDefault',
    ]);
    const unknownPatchKey = Object.keys(body).find((key) => !allowedPatchKeys.has(key));
    if (unknownPatchKey) {
      return c.json({ ok: false, error: { message: `unknown agent field "${unknownPatchKey}"` } }, 400);
    }
    const skillsPatch = body.skills === null ? null : Object.hasOwn(body, 'skills') ? SkillOverrideSchema.safeParse(body.skills) : undefined;
    if (skillsPatch && skillsPatch !== null && !skillsPatch.success) {
      return c.json({ ok: false, error: { message: `skills ${skillsPatch.error.issues[0]?.message ?? 'is invalid'}` } }, 400);
    }
    let toolsPatch: Config['agents']['list'][number]['tools'] | null | undefined;
    if (Object.hasOwn(body, 'tools')) {
      if (body.tools === null) {
        toolsPatch = null;
      } else if (typeof body.tools === 'object' && !Array.isArray(body.tools)) {
        const parsedTools = ToolPoliciesSchema.safeParse(body.tools);
        if (!parsedTools.success) {
          return c.json({ ok: false, error: { message: `tools ${parsedTools.error.issues[0]?.message ?? 'is invalid'}` } }, 400);
        }
        toolsPatch = parsedTools.data;
      } else {
        return c.json({ ok: false, error: { message: 'tools must be an object or null' } }, 400);
      }
    }
    const modelsPatch = Object.hasOwn(body, 'models') ? parsePatchModels(body.models) : undefined;
    if (isParseError(modelsPatch)) {
      return c.json({ ok: false, error: { message: modelsPatch.error } }, 400);
    }
    const profilePatch = body.profile === null
      ? null
      : Object.hasOwn(body, 'profile')
        ? AgentProfileSchema.safeParse(body.profile)
        : undefined;
    if (profilePatch && profilePatch !== null && !profilePatch.success) {
      return c.json({ ok: false, error: { message: `profile ${profilePatch.error.issues[0]?.message ?? 'is invalid'}` } }, 400);
    }
    const workflowsPatch = body.workflows === null
      ? null
      : Object.hasOwn(body, 'workflows')
        ? WorkflowPolicySchema.safeParse(body.workflows)
        : undefined;
    if (workflowsPatch && workflowsPatch !== null && !workflowsPatch.success) {
      return c.json({ ok: false, error: { message: `workflows ${workflowsPatch.error.issues[0]?.message ?? 'is invalid'}` } }, 400);
    }
    const runtimePatch = body.runtime === null
      ? null
      : Object.hasOwn(body, 'runtime')
        ? RuntimePolicySchema.safeParse(body.runtime)
        : undefined;
    if (runtimePatch && runtimePatch !== null && !runtimePatch.success) {
      return c.json({ ok: false, error: { message: `runtime ${runtimePatch.error.issues[0]?.message ?? 'is invalid'}` } }, 400);
    }
    let workspacePatch: string | null | undefined;
    if (Object.hasOwn(body, 'workspace')) {
      if (body.workspace === null) {
        workspacePatch = null;
      } else if (typeof body.workspace === 'string') {
        workspacePatch = body.workspace;
      } else {
        return c.json({ ok: false, error: { message: 'workspace must be a string or null' } }, 400);
      }
    }

    const prep = prepareUpdateAgent(service.currentConfig as Config, id, {
      ...(workspacePatch !== undefined ? { workspace: workspacePatch } : {}),
      ...(profilePatch !== undefined ? { profile: profilePatch === null ? null : profilePatch.data } : {}),
      ...(modelsPatch !== undefined ? { models: modelsPatch } : {}),
      setDefault: body.setDefault === true,
      ...(skillsPatch !== undefined ? { skills: skillsPatch === null ? null : skillsPatch.data } : {}),
      ...(toolsPatch !== undefined ? { tools: toolsPatch } : {}),
      ...(workflowsPatch !== undefined ? { workflows: workflowsPatch === null ? null : workflowsPatch.data } : {}),
      ...(runtimePatch !== undefined ? { runtime: runtimePatch === null ? null : runtimePatch.data } : {}),
    });
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const save = await service.saveConfig(prep.data.nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const agentsPayload = await listGatewayAgents(service.currentConfig as Config, { locale });
    return c.json({ ok: true, payload: agentsPayload });
  });

  authenticated.delete('/api/agents/:id', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const purge = c.req.query('purge') === '1' || c.req.query('purge') === 'true';
    const prep = prepareDeleteAgent(service.currentConfig as Config, id);
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const { nextConfig, agentId } = prep.data;
    const save = await service.saveConfig(nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    if (purge) {
      await runAfterDeletePurge(service.currentConfig as Config, agentId);
    }
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const agentsPayload = await listGatewayAgents(service.currentConfig as Config, { locale });
    return c.json({
      ok: true,
      payload: { agentId, purged: purge, agents: agentsPayload },
    });
  });

  authenticated.get('/api/agents/:id/avatar', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const res = await readAgentAvatarFile(service.currentConfig as Config, id);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return new Response(res.data.buffer, {
      status: 200,
      headers: {
        'Content-Type': res.data.contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  });

  authenticated.put('/api/agents/:id/avatar', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const base64 = typeof body.base64 === 'string' ? body.base64 : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    const res = await writeAgentAvatarFromBase64(service.currentConfig as Config, id, base64, mimeType);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: { agentId: res.data.agentId } });
  });

  authenticated.delete('/api/agents/:id/avatar', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const res = await deleteAgentAvatarFile(service.currentConfig as Config, id);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: { agentId: res.data.agentId } });
  });

  authenticated.get('/api/agents/:id/files', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const res = await listAgentProfileFiles(service.currentConfig as Config, id);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: res.data });
  });

  authenticated.get('/api/agents/:id/files/:name', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const name = decodeURIComponent(c.req.param('name') ?? '');
    const res = await readAgentProfileFile(service.currentConfig as Config, id, name);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: { agentId: res.data.agentId, name, content: res.data.content } });
  });

  authenticated.put('/api/agents/:id/files/:name', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const name = decodeURIComponent(c.req.param('name') ?? '');
    let content = '';
    try {
      const body = (await c.req.json()) as { content?: unknown };
      content = typeof body.content === 'string' ? body.content : '';
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const res = await writeAgentProfileFile(service.currentConfig as Config, id, name, content);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: { agentId: res.data.agentId, name } });
  });

  // GET /api/voice/models - Get available STT/TTS models
  authenticated.get('/api/voice/models', (c) => {
    const models = getVoiceModelsConfig();
    return c.json({ ok: true, payload: { models } });
  });

}
