import type { Hono } from 'hono';

import { type Config, parseModelRef } from '../../../config/schema.js';
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
  prepareDeleteAgent,
  prepareUpdateAgent,
  readAgentAvatarFile,
  readAgentProfileFile,
  runAfterDeletePurge,
  writeAgentAvatarFromBase64,
  writeAgentProfileFile,
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

export function registerAgentsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/agents', async (c) => {
    const cfg = service.currentConfig as Config;
    const payload = await listGatewayAgents(cfg);
    return c.json({ ok: true, payload });
  });

  authenticated.post('/api/agents', strictRateLimitMiddleware, async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const name = typeof body.name === 'string' ? body.name : '';
    const workspace = typeof body.workspace === 'string' ? body.workspace : '';
    const model = typeof body.model === 'string' ? body.model : undefined;
    const agentDir = typeof body.agentDir === 'string' ? body.agentDir : undefined;
    const description = typeof body.description === 'string' ? body.description : undefined;
    const id = typeof body.id === 'string' ? body.id : undefined;
    const toolsDisable = Array.isArray(body.toolsDisable)
      ? body.toolsDisable.map((x: unknown) => String(x).trim()).filter(Boolean)
      : undefined;
    let profileFiles: Record<string, string> | undefined;
    if (Object.hasOwn(body, 'profileFiles')) {
      const raw = body.profileFiles;
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return c.json({ ok: false, error: { message: 'profileFiles must be an object' } }, 400);
      }
      profileFiles = {};
      for (const [name, content] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof content !== 'string') {
          return c.json(
            { ok: false, error: { message: `profileFiles["${name}"] must be a string` } },
            400,
          );
        }
        profileFiles[name] = content;
      }
    }
    const prep = prepareCreateAgent(service.currentConfig as Config, {
      name,
      workspace,
      model,
      agentDir,
      ...(id !== undefined ? { id } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(toolsDisable !== undefined ? { toolsDisable } : {}),
      ...(profileFiles !== undefined ? { profileFiles } : {}),
    });
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const { nextConfig, agentId } = prep.data;
    const save = await service.saveConfig(nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    const finalized = await finalizeCreateAgentDirs(service.currentConfig as Config, agentId, {
      ...(profileFiles !== undefined ? { profileFiles } : {}),
    });
    if (finalized.ok === false) {
      return c.json({ ok: false, error: { message: finalized.error } }, finalized.status ?? 400);
    }
    const agentsPayload = await listGatewayAgents(service.currentConfig as Config);
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
    const skillsPatch =
      body.skills === null
        ? null
        : Array.isArray(body.skills)
          ? body.skills.map((x: unknown) => String(x).trim()).filter(Boolean)
          : undefined;
    const toolsDisablePatch =
      body.toolsDisable === null
        ? null
        : Array.isArray(body.toolsDisable)
          ? body.toolsDisable.map((x: unknown) => String(x).trim()).filter(Boolean)
          : undefined;

    const descriptionPatch: string | null | undefined = Object.hasOwn(body, 'description')
      ? body.description === null
        ? null
        : typeof body.description === 'string'
          ? body.description
          : undefined
      : undefined;

    const prep = prepareUpdateAgent(service.currentConfig as Config, id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      ...(descriptionPatch !== undefined ? { description: descriptionPatch } : {}),
      workspace: typeof body.workspace === 'string' ? body.workspace : undefined,
      model:
        body.model === null
          ? null
          : typeof body.model === 'string'
            ? body.model
            : undefined,
      agentDir:
        body.agentDir === null
          ? null
          : typeof body.agentDir === 'string'
            ? body.agentDir
            : undefined,
      setDefault: body.setDefault === true,
      ...(skillsPatch !== undefined ? { skills: skillsPatch } : {}),
      ...(toolsDisablePatch !== undefined ? { toolsDisable: toolsDisablePatch } : {}),
    });
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const save = await service.saveConfig(prep.data.nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    const agentsPayload = await listGatewayAgents(service.currentConfig as Config);
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
    const agentsPayload = await listGatewayAgents(service.currentConfig as Config);
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
