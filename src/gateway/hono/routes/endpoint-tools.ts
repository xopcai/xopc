import {
  endpointPrincipalRegistrationSchema,
  endpointSessionBindingRequestSchema,
} from '@xopcai/endpoint-tools-protocol';
import type { Hono } from 'hono';

import {
  createEndpointPrincipal,
  getDevice,
  getEndpointPrincipal,
  listDevices,
  listEndpointPrincipals,
  revokeEndpointPrincipal,
  revokeDevice,
  listEndpointToolInvocationAuditPage,
} from '../../../storage/sqlite/index.js';
import { parseEndpointPublicKey } from '../../../endpoint-tools/auth.js';
import {
  ENDPOINT_UPLOAD_MAX_BYTES,
  EndpointUploadError,
} from '../../../endpoint-tools/upload-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('EndpointUpload');

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        value.fill(0);
        throw new EndpointUploadError('Uploaded file is too large', 'UPLOAD_TOO_LARGE');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    await reader.cancel().catch(() => {});
    for (const chunk of chunks) chunk.fill(0);
    reader.releaseLock();
  }
}

export function registerEndpointToolRoutes(
  authenticated: Hono,
  deps: AuthenticatedRouteDeps,
): void {
  authenticated.get('/api/endpoint-tools/devices', (c) => {
    const endpointsByPrincipal = new Map<string, ReturnType<typeof deps.service.endpointTools.registry.list>>();
    for (const endpoint of deps.service.endpointTools.registry.list()) {
      const endpoints = endpointsByPrincipal.get(endpoint.principalId) ?? [];
      endpoints.push(endpoint);
      endpointsByPrincipal.set(endpoint.principalId, endpoints);
    }

    const devicesById = new Map(listDevices().map((device) => [device.id, device]));
    const principalsById = new Map(listEndpointPrincipals().map((principal) => [principal.id, principal]));
    const ids = new Set([...devicesById.keys(), ...principalsById.keys()]);
    const devices = [...ids].map((id) => {
      const access = devicesById.get(id);
      const principal = principalsById.get(id);
      const lastSeenAt = Math.max(access?.lastSeenAt ?? 0, principal?.lastSeenAt ?? 0) || undefined;
      return {
        id,
        displayName: principal?.displayName ?? access?.displayName ?? id,
        kind: principal?.kind ?? (access?.platform === 'chrome' ? 'browser' : 'mobile'),
        platform: principal?.platform ?? access?.platform ?? 'unknown',
        createdAt: Math.min(access?.createdAt ?? Number.POSITIVE_INFINITY, principal?.createdAt ?? Number.POSITIVE_INFINITY),
        ...(lastSeenAt ? { lastSeenAt } : {}),
        access: access ? {
          scopes: access.scopes,
          createdAt: access.createdAt,
          ...(access.lastSeenAt ? { lastSeenAt: access.lastSeenAt } : {}),
          ...(access.revokedAt ? { revokedAt: access.revokedAt } : {}),
        } : null,
        principal: principal ? {
          createdAt: principal.createdAt,
          ...(principal.lastSeenAt ? { lastSeenAt: principal.lastSeenAt } : {}),
          ...(principal.revokedAt ? { revokedAt: principal.revokedAt } : {}),
        } : null,
        endpoints: endpointsByPrincipal.get(id) ?? [],
      };
    }).sort((left, right) => (right.lastSeenAt ?? right.createdAt) - (left.lastSeenAt ?? left.createdAt));

    return c.json({ ok: true, payload: devices });
  });

  authenticated.post('/api/endpoint-tools/devices/revoke', async (c) => {
    const body = await c.req.json().catch(() => null) as { ids?: unknown } | null;
    if (!Array.isArray(body?.ids) || body.ids.length === 0 || body.ids.length > 100
      || body.ids.some((id) => typeof id !== 'string' || !id.trim())) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Expected 1 to 100 device ids' } }, 400);
    }

    const ids = [...new Set(body.ids.map((id) => (id as string).trim()))];
    const results = ids.map((id) => {
      const access = getDevice(id);
      const principal = getEndpointPrincipal(id);
      const accessRevoked = Boolean(access && access.revokedAt === undefined && revokeDevice(id));
      const principalRevoked = Boolean(principal && principal.revokedAt === undefined && revokeEndpointPrincipal(id));
      if (accessRevoked) {
        deps.service.realtime.disconnectPrincipal(id);
        deps.service.voiceRealtime.disconnectPrincipal(id);
      }
      if (principalRevoked) {
        for (const endpoint of deps.service.endpointTools.registry.list()) {
          if (endpoint.principalId === id) deps.service.endpointTools.disconnect(endpoint.endpointId, 'Device revoked');
        }
      }
      return { id, found: Boolean(access || principal), revoked: accessRevoked || principalRevoked };
    });
    return c.json({ ok: true, payload: { results } });
  });

  authenticated.post('/api/endpoint-tools/principals', async (c) => {
    const parsed = endpointPrincipalRegistrationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid endpoint principal' } }, 400);
    }
    const gatewayPrincipal = getGatewayPrincipal(c);
    if (gatewayPrincipal.kind === 'device') {
      const device = gatewayPrincipal.deviceId ? getDevice(gatewayPrincipal.deviceId) : undefined;
      const ownsPrincipal = parsed.data.principalId === gatewayPrincipal.deviceId;
      const compatibleKind = device?.platform === 'chrome'
        ? parsed.data.kind === 'browser' && parsed.data.platform === 'chrome'
        : parsed.data.kind === 'mobile';
      if (!ownsPrincipal || !compatibleKind) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Endpoint identity does not match this device' } }, 403);
      }
    }
    try {
      parseEndpointPublicKey(parsed.data.publicKey);
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid endpoint public key' } }, 400);
    }
    const existing = getEndpointPrincipal(parsed.data.principalId);
    if (existing && !existing.revokedAt
      && existing.displayName === parsed.data.displayName
      && existing.kind === parsed.data.kind
      && existing.platform === parsed.data.platform
      && existing.publicKey === parsed.data.publicKey) {
      return c.json({ ok: true, payload: existing }, 200);
    }
    if (existing) {
      if (existing.revokedAt) {
        return c.json({
          ok: false,
          error: { code: 'PRINCIPAL_REVOKED', message: 'Endpoint principal was revoked' },
        }, 403);
      }
      return c.json({ ok: false, error: { code: 'CONFLICT', message: 'Endpoint principal already exists' } }, 409);
    }
    const principal = createEndpointPrincipal({
      id: parsed.data.principalId,
      displayName: parsed.data.displayName,
      kind: parsed.data.kind,
      platform: parsed.data.platform,
      publicKey: parsed.data.publicKey,
    });
    return c.json({ ok: true, payload: principal }, 201);
  });

  authenticated.get('/api/endpoint-tools/invocations', (c) => {
    const page = Number(c.req.query('page') ?? 1);
    const pageSize = Number(c.req.query('pageSize') ?? 20);
    const status = c.req.query('status');
    const effect = c.req.query('effect');
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
      || (status && !['running', 'succeeded', 'failed'].includes(status))
      || (effect && !['read', 'write', 'destructive'].includes(effect))) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid invocation filters' } }, 400);
    }
    return c.json({
      ok: true,
      payload: listEndpointToolInvocationAuditPage({
        page,
        pageSize,
        query: c.req.query('query'),
        principalId: c.req.query('principalId'),
        status: status as 'running' | 'succeeded' | 'failed' | undefined,
        effect: effect as 'read' | 'write' | 'destructive' | undefined,
      }),
    });
  });

  authenticated.get('/api/endpoint-tools/bindings/:conversationId', (c) => {
    try {
      const binding = deps.service.endpointTools.bindings.get(c.req.param('conversationId'));
      return binding
        ? c.json({ ok: true, payload: binding })
        : c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint binding not found' } }, 404);
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid session key' } }, 400);
    }
  });

  authenticated.put('/api/endpoint-tools/bindings/:conversationId', async (c) => {
    const parsed = endpointSessionBindingRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid endpoint binding' } }, 400);
    }
    const gatewayPrincipal = getGatewayPrincipal(c);
    const endpoint = deps.service.endpointTools.registry.get(parsed.data.endpointId);
    if (gatewayPrincipal.kind === 'device'
      && (!endpoint || !gatewayPrincipal.deviceId || endpoint.principalId !== gatewayPrincipal.deviceId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Endpoint does not belong to this device' } }, 403);
    }
    try {
      const binding = deps.service.endpointTools.bindings.bind(
        c.req.param('conversationId'),
        parsed.data.endpointId,
      );
      return c.json({ ok: true, payload: binding });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'Endpoint is offline' ? 409 : 400;
      return c.json({ ok: false, error: { code: 'BINDING_FAILED', message } }, status);
    }
  });

  authenticated.delete('/api/endpoint-tools/bindings/:conversationId', (c) => {
    try {
      const removed = deps.service.endpointTools.bindings.unbind(c.req.param('conversationId'));
      return c.json({ ok: true, payload: { removed } });
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid session key' } }, 400);
    }
  });

  authenticated.post('/api/endpoint-tools/invocations/:invocationId/files', async (c) => {
    const invocationId = c.req.param('invocationId');
    const endpointId = c.req.header('x-endpoint-id') ?? '';
    const token = c.req.header('x-endpoint-upload-token') ?? '';
    const name = c.req.query('name') ?? '';
    const mimeType = c.req.header('content-type')?.split(';', 1)[0]?.trim() ?? '';
    const declaredLength = Number(c.req.header('content-length') ?? 0);
    if (declaredLength > ENDPOINT_UPLOAD_MAX_BYTES) {
      return c.json({ ok: false, error: { code: 'RESULT_TOO_LARGE', message: 'Uploaded file is too large' } }, 413);
    }
    let bytes: Uint8Array | undefined;
    try {
      const limits = deps.service.endpointTools.uploads.getGrantLimits(invocationId, endpointId, token);
      if (declaredLength > limits.maxBytes) throw new EndpointUploadError('Uploaded file is too large', 'UPLOAD_TOO_LARGE');
      bytes = await readBoundedBody(c.req.raw.body, limits.maxBytes);
      const file = await deps.service.endpointTools.uploads.uploadValidated({
        invocationId,
        endpointId,
        token,
        name,
        mimeType,
        bytes,
      });
      return c.json({
        ok: true,
        payload: {
          type: 'file' as const,
          fileId: file.fileId,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          sha256: file.sha256,
        },
      }, 201);
    } catch (error) {
      const code = error instanceof EndpointUploadError ? error.code : 'UPLOAD_FAILED';
      const status = code === 'UPLOAD_TOO_LARGE' ? 413 : code === 'UPLOAD_BUSY' ? 429 : 400;
      log.warn({ invocationId, endpointId, phase: 'frame_upload', errorCode: code, httpStatus: status,
        size: bytes?.byteLength ?? declaredLength }, `Endpoint upload rejected: ${code}`);
      return c.json({
        ok: false,
        error: { code, message: error instanceof EndpointUploadError ? error.message : 'Endpoint upload failed' },
      }, status);
    } finally { bytes?.fill(0); }
  });

  authenticated.get('/api/endpoint-tools/files/:fileId', (c) => {
    const file = deps.service.endpointTools.uploads.getFile(c.req.param('fileId'));
    const bytes = file && deps.service.endpointTools.uploads.readFile(file.fileId);
    if (!file || !bytes) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint file not found' } }, 404);
    }
    c.header('Content-Type', file.mimeType);
    c.header('Content-Length', String(file.size));
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return c.body(body);
  });
}
