import type { Hono } from 'hono';

import {
  AgentModelsOverrideSchema,
  AgentEntrySchema,
  AgentProfileSchema,
  ExternalAgentExecutionSchema,
  RuntimePolicySchema,
  SkillOverrideSchema,
  ToolPoliciesSchema,
  type AgentEntry,
} from '../../../agent-config/index.js';
import {
  cancelExternalRuntimeAuthFlow,
  getExternalRuntimeAuthFlow,
  logoutExternalAgentRuntime,
  probeAllExternalAgentRuntimes,
  probeExternalAgentRuntime,
  respondExternalRuntimeAuthFlow,
  startExternalRuntimeAuth,
  type ExternalRuntimeAuthMode,
} from '../../../agent/external/index.js';
import { getVoiceModelsConfig } from '../../../config/voice.js';
import { normalizeAgentId } from '../../../agent/agent-scope.js';
import {
  createGatewayAgent,
  deleteGatewayAgent,
  deleteAgentAvatarFile,
  getGatewayAgentEffectiveConfig,
  listAgentProfileFiles,
  listGatewayAgents,
  readAgentAvatarFile,
  resolveAgentAvatarImage,
  readAgentProfileFile,
  updateGatewayAgent,
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
  const allowedKeys = new Set(['id', 'workspace', 'profile', 'specialistProfile', 'execution']);
  const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknownKey) return { error: `unknown create-agent field "${unknownKey}"` };
  const workspace = typeof body.workspace === 'string' ? body.workspace : undefined;
  const profile = AgentProfileSchema.safeParse(body.profile);
  if (!profile.success) return { error: `profile ${profile.error.issues[0]?.message ?? 'is required'}` };
  const specialist = AgentEntrySchema.shape.specialistProfile.safeParse(body.specialistProfile);
  if (!specialist.success) return { error: `specialistProfile ${specialist.error.issues[0]?.message ?? 'is invalid'}` };
  const execution = AgentEntrySchema.shape.execution.safeParse(body.execution);
  if (!execution.success) return { error: 'Invalid Agent execution type' };
  const id = typeof body.id === 'string' ? body.id : undefined;
  return {
    workspace,
    profile: profile.data,
    ...(specialist.data ? { specialistProfile: specialist.data } : {}),
    ...(execution.data ? { execution: execution.data } : {}),
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
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const payload = await listGatewayAgents({ locale });
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
    const prep = await createGatewayAgent(parsed);
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const { agentId } = prep.data;
    service.refreshAgentCatalog();
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const agentsPayload = await listGatewayAgents({ locale });
    return c.json({
      ok: true,
      payload: {
        agentId,
        agents: agentsPayload,
      },
    });
  });

  authenticated.get('/api/agents/external-runtimes', async (c) => {
    const runtimes = await probeAllExternalAgentRuntimes();
    return c.json({ ok: true, payload: { runtimes } });
  });

  authenticated.post('/api/agents/external-runtimes/probe', strictRateLimitMiddleware, async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const parsed = ExternalAgentExecutionSchema.safeParse(body.execution);
    if (!parsed.success) {
      return c.json({ ok: false, error: { message: 'Invalid external runtime configuration' } }, 400);
    }
    const result = await probeExternalAgentRuntime(parsed.data);
    return c.json({ ok: true, payload: { runtime: result } });
  });

  authenticated.post('/api/agents/external-runtimes/auth/start', strictRateLimitMiddleware, async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const parsed = ExternalAgentExecutionSchema.safeParse(body.execution);
    if (!parsed.success) {
      return c.json({ ok: false, error: { message: 'Invalid external runtime configuration' } }, 400);
    }
    const rawMode = body.mode;
    const mode: ExternalRuntimeAuthMode =
      rawMode === 'device_code' || rawMode === 'api_key' || rawMode === 'browser' ? rawMode : 'browser';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined;
    const flow = await startExternalRuntimeAuth({ execution: parsed.data, mode, apiKey });
    return c.json({ ok: true, payload: { flow } });
  });

  authenticated.get('/api/agents/external-runtimes/auth/:flowId', async (c) => {
    const flowId = c.req.param('flowId')?.trim() ?? '';
    const flow = getExternalRuntimeAuthFlow(flowId);
    if (!flow) {
      return c.json({ ok: false, error: { message: 'Sign-in session not found or expired' } }, 404);
    }
    return c.json({ ok: true, payload: { flow } });
  });

  authenticated.post('/api/agents/external-runtimes/auth/:flowId/respond', strictRateLimitMiddleware, async (c) => {
    const flowId = c.req.param('flowId')?.trim() ?? '';
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const value = typeof body.value === 'string' ? body.value : '';
    if (!value.trim()) {
      return c.json({ ok: false, error: { message: 'Sign-in code or callback URL is required' } }, 400);
    }
    try {
      const flow = await respondExternalRuntimeAuthFlow(flowId, value);
      return c.json({ ok: true, payload: { flow } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: { message } }, 400);
    }
  });

  authenticated.post('/api/agents/external-runtimes/auth/:flowId/cancel', strictRateLimitMiddleware, async (c) => {
    const flowId = c.req.param('flowId')?.trim() ?? '';
    const flow = await cancelExternalRuntimeAuthFlow(flowId);
    if (!flow) {
      return c.json({ ok: false, error: { message: 'Sign-in session not found or expired' } }, 404);
    }
    return c.json({ ok: true, payload: { flow } });
  });

  authenticated.post('/api/agents/external-runtimes/auth/logout', strictRateLimitMiddleware, async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const parsed = ExternalAgentExecutionSchema.safeParse(body.execution);
    if (!parsed.success) {
      return c.json({ ok: false, error: { message: 'Invalid external runtime configuration' } }, 400);
    }
    const runtime = await logoutExternalAgentRuntime(parsed.data);
    return c.json({ ok: true, payload: { runtime } });
  });

  authenticated.get('/api/agents/:id/effective-config', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const res = getGatewayAgentEffectiveConfig(id);
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
      'specialistProfile',
      'expectedRevision',
      'profile',
      'execution',
      'models',
      'skills',
      'tools',
      'toolAllowlist',
      'runtime',
      'setDefault',
    ]);
    const unknownPatchKey = Object.keys(body).find((key) => !allowedPatchKeys.has(key));
    if (unknownPatchKey) {
      return c.json({ ok: false, error: { message: `unknown agent field "${unknownPatchKey}"` } }, 400);
    }
    if (body.expectedRevision !== undefined && (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1))
      return c.json({ ok: false, error: { message: 'expectedRevision must be a positive integer' } }, 400);
    const specialistPatch = body.specialistProfile === null ? null
      : Object.hasOwn(body, 'specialistProfile') ? AgentEntrySchema.shape.specialistProfile.safeParse(body.specialistProfile) : undefined;
    if (specialistPatch && !specialistPatch.success)
      return c.json({ ok: false, error: { message: `specialistProfile ${specialistPatch.error.issues[0]?.message ?? 'is invalid'}` } }, 400);
    const skillsPatch = body.skills === null ? null : Object.hasOwn(body, 'skills') ? SkillOverrideSchema.safeParse(body.skills) : undefined;
    if (skillsPatch && skillsPatch !== null && !skillsPatch.success) {
      return c.json({ ok: false, error: { message: `skills ${skillsPatch.error.issues[0]?.message ?? 'is invalid'}` } }, 400);
    }
    let toolsPatch: AgentEntry['tools'] | null | undefined;
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
    const toolAllowlistPatch = body.toolAllowlist === null
      ? null
      : Object.hasOwn(body, 'toolAllowlist')
        ? AgentEntrySchema.shape.toolAllowlist.safeParse(body.toolAllowlist)
        : undefined;
    if (toolAllowlistPatch && toolAllowlistPatch !== null && !toolAllowlistPatch.success) {
      return c.json({ ok: false, error: { message: `toolAllowlist ${toolAllowlistPatch.error.issues[0]?.message ?? 'is invalid'}` } }, 400);
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
    const executionPatch = Object.hasOwn(body, 'execution')
      ? ExternalAgentExecutionSchema.safeParse(body.execution)
      : undefined;
    if (executionPatch && !executionPatch.success) {
      return c.json({ ok: false, error: { message: `execution ${executionPatch.error.issues[0]?.message ?? 'is invalid'}` } }, 400);
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

    const prep = await updateGatewayAgent(id, {
      expectedRevision: body.expectedRevision as number | undefined,
      ...(specialistPatch !== undefined ? { specialistProfile: specialistPatch === null ? null : specialistPatch.data } : {}),
      ...(workspacePatch !== undefined ? { workspace: workspacePatch } : {}),
      ...(profilePatch !== undefined ? { profile: profilePatch === null ? null : profilePatch.data } : {}),
      ...(executionPatch !== undefined ? { execution: executionPatch.data } : {}),
      ...(modelsPatch !== undefined ? { models: modelsPatch } : {}),
      setDefault: body.setDefault === true,
      ...(skillsPatch !== undefined ? { skills: skillsPatch === null ? null : skillsPatch.data } : {}),
      ...(toolsPatch !== undefined ? { tools: toolsPatch } : {}),
      ...(toolAllowlistPatch !== undefined ? { toolAllowlist: toolAllowlistPatch === null ? null : toolAllowlistPatch.data } : {}),
      ...(runtimePatch !== undefined ? { runtime: runtimePatch === null ? null : runtimePatch.data } : {}),
    });
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    service.refreshAgentCatalog();
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const agentsPayload = await listGatewayAgents({ locale });
    return c.json({ ok: true, payload: agentsPayload });
  });

  authenticated.delete('/api/agents/:id', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const purge = c.req.query('purge') === '1' || c.req.query('purge') === 'true';
    const prep = await deleteGatewayAgent(id, { purge });
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const { agentId } = prep.data;
    service.refreshAgentCatalog();
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const agentsPayload = await listGatewayAgents({ locale });
    return c.json({
      ok: true,
      payload: { agentId, purged: purge, agents: agentsPayload },
    });
  });

  authenticated.get('/api/agents/:id/avatar', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const res = c.req.query('resolve') === '1' ? await resolveAgentAvatarImage(id) : await readAgentAvatarFile(id);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return new Response(res.data.buffer, {
      status: 200,
      headers: {
        'Content-Type': res.data.contentType,
        'Cache-Control': c.req.query('resolve') === '1' ? 'private, no-store' : 'private, max-age=3600',
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
    const res = await writeAgentAvatarFromBase64(id, base64, mimeType);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: { agentId: res.data.agentId } });
  });

  authenticated.delete('/api/agents/:id/avatar', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const res = await deleteAgentAvatarFile(id);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: { agentId: res.data.agentId } });
  });

  authenticated.get('/api/agents/:id/files', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const res = await listAgentProfileFiles(id);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: res.data });
  });

  authenticated.get('/api/agents/:id/files/:name', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const name = decodeURIComponent(c.req.param('name') ?? '');
    const res = await readAgentProfileFile(id, name);
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
    const res = await writeAgentProfileFile(id, name, content);
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
