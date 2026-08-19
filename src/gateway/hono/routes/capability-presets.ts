import type { Hono } from 'hono';

import { CapabilityPresetSchema } from '../../../agent-manifest/schema.js';
import type { Config } from '../../../config/schema.js';
import {
  listCapabilityPresets,
  prepareCreateCapabilityPreset,
  prepareDeleteCapabilityPreset,
  prepareUpdateCapabilityPreset,
  previewCapabilityPresetUpdate,
  type CreateCapabilityPresetBody,
  type UpdateCapabilityPresetBody,
} from '../../capability-presets-admin.js';
import { normalizeAgentId } from '../../../agent/agent-scope.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function parseJsonObject(raw: unknown): Record<string, unknown> | { error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'body must be an object' };
  }
  return raw as Record<string, unknown>;
}

function isParseError(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: string }).error === 'string'
  );
}

function parseCreateBody(raw: unknown): CreateCapabilityPresetBody | { error: string } {
  const body = parseJsonObject(raw);
  if (isParseError(body)) return body;
  const out: CreateCapabilityPresetBody = {
    id: typeof body.id === 'string' ? body.id : undefined,
    name: typeof body.name === 'string' ? body.name : undefined,
    description: typeof body.description === 'string' ? body.description : undefined,
  };
  if (Object.hasOwn(body, 'version')) out.version = Number(body.version);
  if (Object.hasOwn(body, 'memory')) return { error: 'memory is not a capability preset field' };
  for (const key of ['extends', 'models', 'tools', 'skills', 'workflows', 'boundaries', 'runtime', 'locks'] as const) {
    if (!Object.hasOwn(body, key)) continue;
    const parsed = CapabilityPresetSchema.pick({ [key]: true } as Record<typeof key, true>).safeParse({
      [key]: body[key],
    });
    if (!parsed.success) {
      return { error: `${key} ${parsed.error.issues[0]?.message ?? 'is invalid'}` };
    }
    out[key] = parsed.data[key] as never;
  }
  return out;
}

function parseUpdateBody(raw: unknown): UpdateCapabilityPresetBody | { error: string } {
  const body = parseJsonObject(raw);
  if (isParseError(body)) return body;
  const out: UpdateCapabilityPresetBody = {};
  if (Object.hasOwn(body, 'name')) out.name = String(body.name ?? '');
  if (Object.hasOwn(body, 'description')) {
    out.description = body.description === null ? null : String(body.description ?? '');
  }
  if (Object.hasOwn(body, 'version')) out.version = Number(body.version);
  if (Object.hasOwn(body, 'memory')) return { error: 'memory is not a capability preset field' };
  for (const key of ['extends', 'models', 'tools', 'skills', 'workflows', 'boundaries', 'runtime', 'locks'] as const) {
    if (!Object.hasOwn(body, key)) continue;
    if (body[key] === null) {
      out[key] = null as never;
      continue;
    }
    const parsed = CapabilityPresetSchema.pick({ [key]: true } as Record<typeof key, true>).safeParse({
      [key]: body[key],
    });
    if (!parsed.success) {
      return { error: `${key} ${parsed.error.issues[0]?.message ?? 'is invalid'}` };
    }
    out[key] = parsed.data[key] as never;
  }
  return out;
}

export function registerCapabilityPresetsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/capability-presets', async (c) => {
    return c.json({ ok: true, payload: listCapabilityPresets(service.currentConfig as Config) });
  });

  authenticated.post('/api/capability-presets', strictRateLimitMiddleware, async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const body = parseCreateBody(raw);
    if (isParseError(body)) {
      return c.json({ ok: false, error: { message: body.error } }, 400);
    }
    const prep = prepareCreateCapabilityPreset(service.currentConfig as Config, body);
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const save = await service.saveConfig(prep.data.nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    return c.json({
      ok: true,
      payload: {
        presetId: prep.data.presetId,
        presets: listCapabilityPresets(service.currentConfig as Config),
      },
    });
  });

  authenticated.patch('/api/capability-presets/:id', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const body = parseUpdateBody(raw);
    if (isParseError(body)) {
      return c.json({ ok: false, error: { message: body.error } }, 400);
    }
    const prep = prepareUpdateCapabilityPreset(service.currentConfig as Config, id, body);
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const save = await service.saveConfig(prep.data.nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    return c.json({ ok: true, payload: listCapabilityPresets(service.currentConfig as Config) });
  });

  authenticated.post('/api/capability-presets/:id/preview', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const body = parseUpdateBody(raw);
    if (isParseError(body)) {
      return c.json({ ok: false, error: { message: body.error } }, 400);
    }
    const preview = previewCapabilityPresetUpdate(service.currentConfig as Config, id, body);
    if (preview.ok === false) {
      return c.json({ ok: false, error: { message: preview.error } }, preview.status ?? 400);
    }
    return c.json({ ok: true, payload: preview.data });
  });

  authenticated.delete('/api/capability-presets/:id', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const prep = prepareDeleteCapabilityPreset(service.currentConfig as Config, id);
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const save = await service.saveConfig(prep.data.nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    return c.json({ ok: true, payload: listCapabilityPresets(service.currentConfig as Config) });
  });
}
