import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import type { Hono } from 'hono';

import { getEndpointPrincipal } from '../../../storage/sqlite/endpoint-principal-repository.js';
import { getSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import { currentDeviceExecutionActor, deviceExecutionPrincipalId } from '../../../endpoint-tools/execution-actor.js';
import { deviceDelegationRequestSchema, issueDeviceDelegation, listDeviceDelegations, revokeDeviceDelegation } from '../../../endpoint-tools/delegation.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const admissionSchema = z.strictObject({ principalId: z.string().min(1).max(160), localId: z.string().min(1).max(64),
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/), allowed: z.boolean() });

export function registerDeviceProviderRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.get('/api/endpoint-tools/interactions/:conversationId', c => {
    const conversationId = c.req.param('conversationId'), actor = getGatewayPrincipal(c);
    const transcriptId = z.uuid().safeParse(conversationId).success ? getSessionMetadata(conversationId)?.transcriptId : undefined;
    const actorPrincipalId = deviceExecutionPrincipalId(actor);
    c.header('Cache-Control', 'no-store');
    const activeActor = Boolean(transcriptId && currentDeviceExecutionActor(conversationId)?.principalId === actorPrincipalId);
    const payload = transcriptId
      ? deps.service.endpointTools.invocations.listInteractions({ conversationId, transcriptId, actorPrincipalId }, activeActor) : [];
    return c.json({ ok: true, payload });
  });
  app.post('/api/endpoint-tools/interactions/:conversationId', bodyLimit({ maxSize: 8192 }), async c => {
    const parsed = z.strictObject({ requestId: z.uuid(), action: z.enum(['accept', 'decline', 'cancel']), content: z.record(z.string(), z.unknown()).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const conversationId = c.req.param('conversationId'), actor = getGatewayPrincipal(c);
    const transcriptId = z.uuid().safeParse(conversationId).success ? getSessionMetadata(conversationId)?.transcriptId : undefined;
    const actorPrincipalId = deviceExecutionPrincipalId(actor);
    if (!transcriptId) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const { requestId, action, content } = parsed.data;
    const activeActor = currentDeviceExecutionActor(conversationId)?.principalId === actorPrincipalId;
    const accepted = deps.service.endpointTools.invocations.answerInteraction({ conversationId, transcriptId, actorPrincipalId }, requestId, action, content, activeActor);
    c.header('Cache-Control', 'no-store');
    return accepted ? c.json({ ok: true }) : c.json({ ok: false, error: { code: 'INTERACTION_UNAVAILABLE' } }, 409);
  });
  app.use('/api/endpoint-tools/delegations/*', async (c, next) => {
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'owner' || !actor.scopes.includes('gateway.admin')) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/api/endpoint-tools/delegations', c => c.json({ ok: true, payload: listDeviceDelegations() }));
  app.post('/api/endpoint-tools/delegations', bodyLimit({ maxSize: 16_384 }), async c => {
    const parsed = deviceDelegationRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    try {
      const runtime = deps.service.endpointTools;
      runtime.providers.assertExecutable(parsed.data.endpointId, parsed.data.toolName);
      const grant = issueDeviceDelegation(parsed.data, runtime.registry);
      return c.json({ ok: true, payload: grant }, 201);
    } catch {
      return c.json({ ok: false, error: { code: 'DELEGATION_UNAVAILABLE' } }, 409);
    }
  });
  app.delete('/api/endpoint-tools/delegations/:delegationId', c => {
    revokeDeviceDelegation(c.req.param('delegationId'));
    return c.json({ ok: true });
  });
  app.get('/api/endpoint-tools/artifact-transfers', c => {
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'owner' || !actor.scopes.includes('gateway.admin')) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const conversationId = z.uuid().safeParse(c.req.query('conversationId'));
    if (!conversationId.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const runtime = deps.service.endpointTools, target = runtime.targets.get(conversationId.data);
    const endpoint = target && runtime.registry.get(target.endpointId);
    c.header('Cache-Control', 'no-store');
    if (!target?.transcriptId || target.actorPrincipalId !== deviceExecutionPrincipalId(actor) || target.expiresAt <= Date.now()
      || endpoint?.connectionId !== target.connectionId) return c.json({ ok: true, payload: { files: [], tools: [] } });
    const tools = endpoint.tools.filter(tool => tool.provider?.artifactInput && runtime.providers.isReady(tool.provider)).map(tool => ({
      toolName: tool.descriptor.name, title: tool.descriptor.title, input: tool.provider!.artifactInput!,
    }));
    const files = tools.length ? runtime.uploads.listTransferFiles(conversationId.data, target.transcriptId, target.endpointId).map(file => {
      const principalId = runtime.uploads.getFile(file.fileId)?.principalId;
      const sourceName = runtime.registry.get(file.endpointId)?.displayName
        ?? (principalId ? getEndpointPrincipal(principalId)?.displayName : undefined) ?? file.endpointId;
      return { ...file, sourceName };
    }) : [];
    return c.json({ ok: true, payload: { files, tools } });
  });
  app.post('/api/endpoint-tools/artifact-transfers', bodyLimit({ maxSize: 4096 }), async c => {
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'owner' || !actor.scopes.includes('gateway.admin')) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const parsed = z.strictObject({ conversationId: z.uuid(), fileId: z.uuid(), toolName: z.string().min(1).max(256) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const { conversationId, fileId, toolName } = parsed.data;
    const runtime = deps.service.endpointTools;
    const actorPrincipalId = deviceExecutionPrincipalId(actor);
    const target = runtime.targets.get(conversationId);
    const tool = target && runtime.registry.getTool(target.endpointId, toolName);
    if (!target?.transcriptId || target.actorPrincipalId !== actorPrincipalId || !tool?.provider?.artifactInput) {
      return c.json({ ok: false, error: { code: 'TRANSFER_UNAVAILABLE' } }, 409);
    }
    const { digest } = tool.provider;
    const stillAuthorized = () => {
      const current = runtime.targets.get(conversationId), endpoint = runtime.registry.get(target.endpointId);
      if (current?.executionRef !== target.executionRef || current.expiresAt <= Date.now()
        || endpoint?.connectionId !== target.connectionId || runtime.registry.getTool(target.endpointId, toolName)?.provider?.digest !== digest) return false;
      try { runtime.providers.assertExecutable(target.endpointId, toolName); return true; }
      catch { return false; }
    };
    const result = runtime.uploads.issueTransfer(fileId, {
      scope: { conversationId, transcriptId: target.transcriptId, actorPrincipalId }, endpointId: target.endpointId,
      connectionId: target.connectionId, toolName, providerDigest: digest,
    }, stillAuthorized);
    c.header('Cache-Control', 'no-store');
    return result ? c.json({ ok: true, payload: result }, 201) : c.json({ ok: false, error: { code: 'TRANSFER_UNAVAILABLE' } }, 409);
  });
  app.delete('/api/endpoint-tools/artifact-transfers/:transferId', c => {
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'owner' || !actor.scopes.includes('gateway.admin')) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    deps.service.endpointTools.uploads.revokeTransfer(c.req.param('transferId'));
    return c.json({ ok: true });
  });
  app.get('/api/endpoint-tools/invocations/:invocationId/artifact', c => {
    const actor = getGatewayPrincipal(c), runtime = deps.service.endpointTools;
    const endpointId = c.req.header('x-endpoint-id') ?? '';
    const endpoint = runtime.registry.get(endpointId);
    if (actor.kind !== 'device' || !actor.deviceId || endpoint?.principalId !== actor.deviceId) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const bytes = runtime.uploads.takeTransfer(c.req.param('invocationId'), endpointId, endpoint.connectionId, c.req.header('idempotency-key') ?? '',
      scope => currentDeviceExecutionActor(scope.conversationId)?.principalId === scope.actorPrincipalId);
    c.header('Cache-Control', 'no-store');
    if (!bytes) return c.json({ ok: false, error: { code: 'TRANSFER_UNAVAILABLE' } }, 404);
    c.header('Content-Type', 'application/octet-stream');
    c.header('Content-Length', String(bytes.byteLength));
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(new Uint8Array(bytes));
  });
  app.get('/api/endpoint-tools/provider-operations/:operationId', async c => {
    const actor = getGatewayPrincipal(c);
    if (actor.kind === 'device' || !actor.scopes.includes('gateway.admin')) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const parsed = z.uuid().safeParse(c.req.param('operationId'));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const result = await deps.service.endpointTools.providerOperations.query(parsed.data);
    c.header('Cache-Control', 'no-store');
    return result ? c.json({ ok: true, payload: result }) : c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
  });
  app.get('/api/endpoint-tools/providers', c => {
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'device' && !actor.scopes.includes('gateway.admin')) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const principalId = actor.kind === 'device' ? actor.deviceId ?? actor.principalId : c.req.query('principalId');
    if (principalId && principalId.length > 160) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: deps.service.endpointTools.providers.list(principalId) });
  });
  app.post('/api/endpoint-tools/providers/admission', bodyLimit({ maxSize: 4096 }), async c => {
    const actor = getGatewayPrincipal(c);
    if (actor.kind === 'device' || !actor.scopes.includes('gateway.admin')) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const parsed = admissionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const input = parsed.data, principal = getEndpointPrincipal(input.principalId);
    if (!principal || principal.revokedAt !== undefined) return c.json({ ok: false, error: { code: 'PRINCIPAL_REVOKED' } }, 403);
    try {
      deps.service.endpointTools.providers.admit(input.principalId, input.localId, input.expectedDigest, input.allowed);
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false, error: { code: 'PROVIDER_CONTRACT_CHANGED' } }, 409);
    }
  });
}
