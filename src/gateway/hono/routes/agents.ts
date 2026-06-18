import type { Hono } from 'hono';

import { AgentModelsSchema, type Config, parseModelRef } from '../../../config/schema.js';
import { getVoiceModelsConfig } from '../../../config/voice.js';
import {
  isProviderConfigured,
  resolveModel,
} from '../../../providers/index.js';
import { normalizeAgentId } from '../../../agent/agent-scope.js';
import {
  deleteAgentAvatarFile,
  finalizeCreateAgentDirs,
  listAgentProfileFiles,
  listGatewayAgents,
  prepareCreateAgent,
  prepareCreateAgentsBatch,
  prepareDeleteAgent,
  prepareUpdateAgent,
  readAgentAvatarFile,
  readAgentProfileFile,
  runAfterDeletePurge,
  writeAgentAvatarFromBase64,
  writeAgentProfileFile,
  type CreateAgentBody,
} from '../../agents-admin.js';
import {
  resolveImageGenerationCapabilities,
  resolveImageUnderstandingCapabilities,
} from '../../image-capabilities.js';
import {
  agentModelFallbacksToArray,
  agentModelRefToString,
} from '../lib/agent-model.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function parseProfileFiles(raw: unknown): Record<string, string> | undefined | { error: string } {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'profileFiles must be an object' };
  }
  const profileFiles: Record<string, string> = {};
  for (const [name, content] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof content !== 'string') {
      return { error: `profileFiles["${name}"] must be a string` };
    }
    profileFiles[name] = content;
  }
  return profileFiles;
}

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
  if (Object.hasOwn(body, 'model')) {
    return { error: 'model is not supported; use models.chat.primary' };
  }
  if (Object.hasOwn(body, 'toolsDisable')) {
    return { error: 'toolsDisable is not supported; use tools.disable' };
  }
  if (Object.hasOwn(body, 'typedModels')) {
    return { error: 'typedModels is not supported; use models.roles' };
  }
  if (Object.hasOwn(body, 'name')) {
    return { error: 'name is not supported; write IDENTITY.md in profileFiles' };
  }
  if (Object.hasOwn(body, 'description')) {
    return { error: 'description is not supported; write IDENTITY.md in profileFiles' };
  }
  const workspace = typeof body.workspace === 'string' ? body.workspace : '';
  const models = Object.hasOwn(body, 'models')
    ? AgentModelsSchema.safeParse(body.models)
    : undefined;
  if (models && !models.success) {
    return { error: `models ${models.error.issues[0]?.message ?? 'is invalid'}` };
  }
  const agentDir = typeof body.agentDir === 'string' ? body.agentDir : undefined;
  const id = typeof body.id === 'string' ? body.id : undefined;
  const skills = Object.hasOwn(body, 'skills')
    ? Array.isArray(body.skills)
      ? body.skills.map((x: unknown) => String(x).trim()).filter(Boolean)
      : null
    : undefined;
  if (skills === null) {
    return { error: 'skills must be an array' };
  }
  const toolsRaw = Object.hasOwn(body, 'tools') ? body.tools : undefined;
  let tools: CreateAgentBody['tools'] | undefined;
  if (toolsRaw !== undefined) {
    if (toolsRaw === null || typeof toolsRaw !== 'object' || Array.isArray(toolsRaw)) {
      return { error: 'tools must be an object' };
    }
    const disableRaw = (toolsRaw as Record<string, unknown>).disable;
    if (disableRaw !== undefined && !Array.isArray(disableRaw)) {
      return { error: 'tools.disable must be an array' };
    }
    const disable = Array.isArray(disableRaw)
      ? disableRaw.map((x: unknown) => String(x).trim()).filter(Boolean)
      : undefined;
    tools = disable !== undefined ? { disable } : {};
  }
  let profileFiles: Record<string, string> | undefined;
  if (Object.hasOwn(body, 'profileFiles')) {
    const parsed = parseProfileFiles(body.profileFiles);
    if (isParseError(parsed)) {
      return parsed;
    }
    profileFiles = parsed;
  }
  if (!profileFiles?.['IDENTITY.md'] && typeof body.cloneFrom !== 'string') {
    return { error: 'profileFiles.IDENTITY.md is required' };
  }
  const cloneFrom = typeof body.cloneFrom === 'string' ? body.cloneFrom : undefined;
  return {
    workspace,
    ...(models && models.data !== undefined ? { models: models.data } : {}),
    ...(agentDir !== undefined ? { agentDir } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(profileFiles !== undefined ? { profileFiles } : {}),
    ...(cloneFrom !== undefined ? { cloneFrom } : {}),
  };
}

type PatchModels = {
  chat?: { primary: string; fallbacks?: string[] } | null;
  roles?: Record<string, { model: string; description?: string }> | null;
};

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
  const body = raw as Record<string, unknown>;
  const out: PatchModels = {};
  if (Object.hasOwn(body, 'chat')) {
    if (body.chat === null) {
      out.chat = null;
    } else {
      const parsed = AgentModelsSchema.safeParse({ chat: body.chat });
      if (!parsed.success) {
        return { error: `models.chat ${parsed.error.issues[0]?.message ?? 'is invalid'}` };
      }
      out.chat = parsed.data?.chat;
    }
  }
  if (Object.hasOwn(body, 'roles')) {
    if (body.roles === null) {
      out.roles = null;
    } else {
      const parsed = AgentModelsSchema.safeParse({ roles: body.roles });
      if (!parsed.success) {
        return { error: `models.roles ${parsed.error.issues[0]?.message ?? 'is invalid'}` };
      }
      out.roles = parsed.data?.roles;
    }
  }
  return out;
}

export function registerAgentsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/agents', async (c) => {
    const cfg = service.currentConfig as Config;
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const payload = await listGatewayAgents(cfg, { locale });
    return c.json({ ok: true, payload });
  });

  authenticated.post('/api/agents/batch', strictRateLimitMiddleware, async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const rawAgents = body.agents;
    if (!Array.isArray(rawAgents)) {
      return c.json({ ok: false, error: { message: 'agents must be an array' } }, 400);
    }
    const parsedAgents: CreateAgentBody[] = [];
    for (const raw of rawAgents) {
      const parsed = parseCreateAgentBody(raw);
      if ('error' in parsed) {
        return c.json({ ok: false, error: { message: parsed.error } }, 400);
      }
      parsedAgents.push(parsed);
    }
    const prep = prepareCreateAgentsBatch(service.currentConfig as Config, parsedAgents);
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const { nextConfig, created } = prep.data;
    const save = await service.saveConfig(nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    const cfg = service.currentConfig as Config;
    const agentIds: string[] = [];
    for (const item of created) {
      const finalized = await finalizeCreateAgentDirs(cfg, item.agentId, {
        ...(item.profileFiles !== undefined ? { profileFiles: item.profileFiles } : {}),
      });
      if (finalized.ok === false) {
        return c.json({ ok: false, error: { message: finalized.error } }, finalized.status ?? 400);
      }
      agentIds.push(item.agentId);
    }
    const locale = c.req.query('locale') || c.req.header('Accept-Language')?.split(',')[0]?.trim();
    const agentsPayload = await listGatewayAgents(cfg, { locale });
    return c.json({
      ok: true,
      payload: {
        agentIds,
        agents: agentsPayload,
      },
    });
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
    const finalized = await finalizeCreateAgentDirs(service.currentConfig as Config, agentId, {
      ...(parsed.profileFiles !== undefined ? { profileFiles: parsed.profileFiles } : {}),
      ...(parsed.cloneFrom ? { cloneFrom: parsed.cloneFrom } : {}),
    });
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

  authenticated.patch('/api/agents/:id', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    if (Object.hasOwn(body, 'model')) {
      return c.json({ ok: false, error: { message: 'model is not supported; use models.chat' } }, 400);
    }
    if (Object.hasOwn(body, 'typedModels')) {
      return c.json({ ok: false, error: { message: 'typedModels is not supported; use models.roles' } }, 400);
    }
    if (Object.hasOwn(body, 'toolsDisable')) {
      return c.json({ ok: false, error: { message: 'toolsDisable is not supported; use tools.disable' } }, 400);
    }
    if (Object.hasOwn(body, 'name')) {
      return c.json({ ok: false, error: { message: 'name is not supported; edit IDENTITY.md' } }, 400);
    }
    if (Object.hasOwn(body, 'description')) {
      return c.json({ ok: false, error: { message: 'description is not supported; edit IDENTITY.md' } }, 400);
    }
    const skillsPatch =
      body.skills === null
        ? null
        : Array.isArray(body.skills)
          ? body.skills.map((x: unknown) => String(x).trim()).filter(Boolean)
          : undefined;
    let toolsPatch: { disable?: string[] | null } | null | undefined;
    if (Object.hasOwn(body, 'tools')) {
      if (body.tools === null) {
        toolsPatch = null;
      } else if (typeof body.tools === 'object' && !Array.isArray(body.tools)) {
        const disable = (body.tools as Record<string, unknown>).disable;
        if (disable === null) {
          toolsPatch = { disable: null };
        } else if (disable === undefined) {
          toolsPatch = {};
        } else if (Array.isArray(disable)) {
          toolsPatch = { disable: disable.map((x: unknown) => String(x).trim()).filter(Boolean) };
        } else {
          return c.json({ ok: false, error: { message: 'tools.disable must be an array or null' } }, 400);
        }
      } else {
        return c.json({ ok: false, error: { message: 'tools must be an object or null' } }, 400);
      }
    }
    const modelsPatch = Object.hasOwn(body, 'models') ? parsePatchModels(body.models) : undefined;
    if (isParseError(modelsPatch)) {
      return c.json({ ok: false, error: { message: modelsPatch.error } }, 400);
    }

    const prep = prepareUpdateAgent(service.currentConfig as Config, id, {
      workspace: typeof body.workspace === 'string' ? body.workspace : undefined,
      ...(modelsPatch !== undefined ? { models: modelsPatch } : {}),
      agentDir:
        body.agentDir === null
          ? null
          : typeof body.agentDir === 'string'
            ? body.agentDir
            : undefined,
      setDefault: body.setDefault === true,
      ...(skillsPatch !== undefined ? { skills: skillsPatch } : {}),
      ...(toolsPatch !== undefined ? { tools: toolsPatch } : {}),
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

  authenticated.get('/api/image/capabilities', async (c) => {
    const config = service.currentConfig as Config;
    const imageGenerationProviders = await resolveImageGenerationCapabilities(config);
    const imageUnderstandingProviders = await resolveImageUnderstandingCapabilities(config);
    return c.json({
      ok: true,
      payload: {
        current: {
          imageModel: agentModelRefToString(config.agents?.defaults?.imageModel) ?? null,
          imageModelFallbacks: agentModelFallbacksToArray(config.agents?.defaults?.imageModel),
          imageGenerationModel: agentModelRefToString(config.agents?.defaults?.imageGenerationModel) ?? null,
          imageGenerationModelFallbacks: agentModelFallbacksToArray(
            config.agents?.defaults?.imageGenerationModel,
          ),
          mediaMaxMb: config.agents?.defaults?.mediaMaxMb ?? null,
        },
        imageGeneration: { providers: imageGenerationProviders },
        imageUnderstanding: { providers: imageUnderstandingProviders },
      },
    });
  });

  authenticated.post('/api/image/validate-model', strictRateLimitMiddleware, async (c) => {
    let body: { modelRef?: unknown };
    try {
      body = (await c.req.json()) as { modelRef?: unknown };
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    const modelRef = body.modelRef;
    if (!modelRef || typeof modelRef !== 'string') {
      return c.json({ ok: false, error: 'modelRef is required' }, 400);
    }

    const parsed = parseModelRef(modelRef);
    if (!parsed) {
      return c.json({
        ok: true,
        payload: {
          valid: false,
          reason: 'invalid_format',
          message: 'Model reference must be in "provider/model" format',
        },
      });
    }

    const configured = await isProviderConfigured(parsed.provider);
    if (!configured) {
      return c.json({
        ok: true,
        payload: {
          valid: false,
          reason: 'provider_not_configured',
          message: `Provider "${parsed.provider}" is not configured. Set the API key first.`,
          provider: parsed.provider,
        },
      });
    }

    try {
      resolveModel(modelRef);
    } catch {
      return c.json({
        ok: true,
        payload: {
          valid: false,
          reason: 'model_not_found',
          message: `Model not found in registry: ${modelRef}`,
          provider: parsed.provider,
          model: parsed.model,
        },
      });
    }

    return c.json({
      ok: true,
      payload: {
        valid: true,
        provider: parsed.provider,
        model: parsed.model,
      },
    });
  });

}
