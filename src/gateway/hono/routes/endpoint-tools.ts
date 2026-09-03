import {
  endpointPrincipalRegistrationSchema,
  endpointSessionBindingRequestSchema,
} from '@xopcai/endpoint-tools-protocol';
import type { Hono } from 'hono';

import {
  createEndpointPrincipal,
  getEndpointPrincipal,
  listEndpointPrincipals,
  revokeEndpointPrincipal,
  listEndpointToolInvocationAudits,
} from '../../../storage/sqlite/index.js';
import { parseP256PublicKey } from '../../../crypto/p256.js';
import {
  ENDPOINT_UPLOAD_MAX_BYTES,
  EndpointUploadError,
} from '../../../endpoint-tools/upload-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

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
      if (size > maxBytes) throw new EndpointUploadError('Uploaded file is too large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function registerEndpointToolRoutes(
  authenticated: Hono,
  deps: AuthenticatedRouteDeps,
): void {
  authenticated.get('/api/endpoint-tools/principals', (c) => {
    const endpointsByPrincipal = new Map<string, ReturnType<typeof deps.service.endpointTools.registry.list>>();
    for (const endpoint of deps.service.endpointTools.registry.list()) {
      const endpoints = endpointsByPrincipal.get(endpoint.principalId) ?? [];
      endpoints.push(endpoint);
      endpointsByPrincipal.set(endpoint.principalId, endpoints);
    }
    return c.json({
      ok: true,
      payload: listEndpointPrincipals().map(({ publicKey: _publicKey, ...principal }) => ({
        ...principal,
        endpoints: endpointsByPrincipal.get(principal.id) ?? [],
      })),
    });
  });

  authenticated.post('/api/endpoint-tools/principals', async (c) => {
    const parsed = endpointPrincipalRegistrationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid endpoint principal' } }, 400);
    }
    try {
      parseP256PublicKey(parsed.data.publicKey);
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

  authenticated.delete('/api/endpoint-tools/principals/:principalId', (c) => {
    const principalId = c.req.param('principalId').trim();
    if (!principalId) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing principal id' } }, 400);
    }
    const revoked = revokeEndpointPrincipal(principalId);
    if (!revoked) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint principal not found' } }, 404);
    }
    for (const endpoint of deps.service.endpointTools.registry.list()) {
      if (endpoint.principalId === principalId) {
        deps.service.endpointTools.disconnect(endpoint.endpointId, 'Endpoint principal revoked');
      }
    }
    return c.json({ ok: true, payload: { principalId, revoked: true } });
  });

  authenticated.get('/api/endpoint-tools/invocations', (c) => {
    const limit = Number(c.req.query('limit') ?? 100);
    return c.json({
      ok: true,
      payload: listEndpointToolInvocationAudits(Number.isFinite(limit) ? limit : 100),
    });
  });

  authenticated.get('/api/endpoint-tools/bindings/:sessionKey', (c) => {
    try {
      const binding = deps.service.endpointTools.bindings.get(c.req.param('sessionKey'));
      return binding
        ? c.json({ ok: true, payload: binding })
        : c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint binding not found' } }, 404);
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid session key' } }, 400);
    }
  });

  authenticated.put('/api/endpoint-tools/bindings/:sessionKey', async (c) => {
    const parsed = endpointSessionBindingRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid endpoint binding' } }, 400);
    }
    try {
      const binding = deps.service.endpointTools.bindings.bind(
        c.req.param('sessionKey'),
        parsed.data.endpointId,
      );
      return c.json({ ok: true, payload: binding });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'Endpoint is offline' ? 409 : 400;
      return c.json({ ok: false, error: { code: 'BINDING_FAILED', message } }, status);
    }
  });

  authenticated.delete('/api/endpoint-tools/bindings/:sessionKey', (c) => {
    try {
      const removed = deps.service.endpointTools.bindings.unbind(c.req.param('sessionKey'));
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
    try {
      const bytes = await readBoundedBody(c.req.raw.body, ENDPOINT_UPLOAD_MAX_BYTES);
      const file = deps.service.endpointTools.uploads.upload({
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
      const message = error instanceof Error ? error.message : String(error);
      return c.json({
        ok: false,
        error: { code: error instanceof EndpointUploadError ? 'INVALID_UPLOAD_GRANT' : 'UPLOAD_FAILED', message },
      }, 400);
    }
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
