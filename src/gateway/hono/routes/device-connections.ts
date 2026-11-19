import { verify } from 'node:crypto';
import { DEVICE_FOLDER_SEARCH, deviceConnectionChatRequestSchema, deviceFolderSnapshotSchema, deviceFolderSigningPayload, endpointTurnClaimSchema, type DeviceConnection, type DeviceConnections } from '@xopcai/endpoint-tools-protocol';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import { parseEndpointPublicKey } from '../../../endpoint-tools/auth.js';
import { deviceExecutionPrincipalId } from '../../../endpoint-tools/execution-actor.js';
import { deviceFoldersFor, deviceFolderSnapshots, mobileFolderPlatforms, saveDeviceFolderSnapshot } from '../../../endpoint-tools/folder-connections.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { createLogger } from '../../../utils/logger.js';
import { runSqliteWriteTransaction } from '../../../storage/sqlite/transaction.js';
import { getDevice, listDevices } from '../../../storage/sqlite/device-access-repository.js';
import { getEndpointDeviceSettings } from '../../../storage/sqlite/endpoint-device-settings-repository.js';
import { getEndpointPrincipal, listEndpointPrincipals } from '../../../storage/sqlite/endpoint-principal-repository.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('Hono:DeviceConnections');
const root = '/api/endpoint-tools/device-connections';
const publicationSchema = z.strictObject({ origin: endpointTurnClaimSchema, snapshot: deviceFolderSnapshotSchema, signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) });

export function registerDeviceConnectionRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const runtime = deps.service.endpointTools;

  app.get(root, c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    const owner = actor.kind === 'owner' && actor.scopes.includes('gateway.admin');
    const sourceDevice = actor.kind === 'device' && actor.deviceId ? getDevice(actor.deviceId) : undefined;
    if (!owner && (!sourceDevice || !mobileFolderPlatforms.has(sourceDevice.platform) || sourceDevice.revokedAt !== undefined)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const ids = new Map<string, { kind: DeviceConnection['kind']; platform: string; name: string }>();
    for (const device of listDevices()) {
      if (device.revokedAt !== undefined || (!owner && device.id !== sourceDevice?.id)) continue;
      if (device.platform === 'desktop' || mobileFolderPlatforms.has(device.platform)) {
        ids.set(device.id, { kind: device.platform === 'desktop' ? 'desktop' : 'mobile', platform: device.platform, name: device.displayName });
      }
    }
    for (const principal of listEndpointPrincipals()) {
      if (principal.revokedAt !== undefined || (principal.kind !== 'desktop' && principal.kind !== 'mobile')
        || (!owner && principal.kind !== 'desktop' && principal.id !== sourceDevice?.id)) continue;
      const device = getDevice(principal.id);
      if (device?.revokedAt !== undefined) continue;
      ids.set(principal.id, { kind: principal.kind, platform: principal.platform, name: principal.displayName });
    }
    const connections = runtime.registry.list().sort((a, b) => b.lastHeartbeatAt - a.lastHeartbeatAt);
    const devices = [...ids].map(([id, metadata]): DeviceConnection => {
      const candidates = connections.filter(endpoint => endpoint.principalId === id && endpoint.kind === metadata.kind);
      const endpoint = metadata.kind === 'mobile'
        ? candidates.find(candidate => candidate.availability === 'foreground' && candidate.tools.length > 0) ?? candidates[0]
        : candidates.find(candidate => candidate.tools.some(tool => tool.descriptor.name === DEVICE_FOLDER_SEARCH)) ?? candidates[0];
      const folders = metadata.kind !== 'desktop' ? [] : (deviceFolderSnapshots.get(id)?.folders ?? [])
        .filter(folder => owner || folder.mobileIds.includes(sourceDevice!.id))
        .map(({ id, kind, label }) => ({ id, kind, label }));
      const mayExposeEndpoint = owner || id === sourceDevice?.id || folders.length > 0
        && endpoint?.tools.some(tool => tool.descriptor.name === DEVICE_FOLDER_SEARCH);
      return {
        id, ...metadata, name: getEndpointDeviceSettings(id)?.nickname ?? metadata.name,
        ...(mayExposeEndpoint && endpoint ? { endpointId: endpoint.endpointId } : {}),
        availability: endpoint?.availability ?? 'offline',
        tools: mayExposeEndpoint ? endpoint?.tools.map(tool => tool.descriptor.name) ?? [] : [],
        folders,
      };
    });
    const payload: DeviceConnections = { ...(sourceDevice ? { currentDeviceId: sourceDevice.id } : {}), devices };
    return c.json({ ok: true, payload });
  });

  app.post(`${root}/chat`, bodyLimit({ maxSize: 4096 }), async c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    const owner = actor.kind === 'owner' && actor.scopes.includes('gateway.admin');
    if (!owner && (actor.kind !== 'device' || !actor.scopes.includes('sessions.write'))) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const parsed = deviceConnectionChatRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const { endpointId, toolName } = parsed.data;
    if (owner !== Boolean(toolName)) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const endpoint = runtime.registry.get(endpointId);
    if (!endpoint) return c.json({ ok: false, error: { code: 'TARGET_OFFLINE' } }, 409);
    if (toolName) {
      const principal = getEndpointPrincipal(endpoint.principalId);
      const device = getDevice(endpoint.principalId);
      if (endpoint.kind !== 'mobile' || principal?.kind !== 'mobile'
        || principal.revokedAt !== undefined || device?.revokedAt !== undefined) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
      }
      if (endpoint.availability !== 'foreground' || !runtime.registry.getTool(endpointId, toolName)) {
        return c.json({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } }, 409);
      }
    } else if (!deviceFoldersFor(endpoint, actor).length) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    try {
      const agentId = resolveDefaultAgentId();
      const conversation = runSqliteWriteTransaction(() => {
        const created = createConversation({ agentId, sourceChannel: 'webchat' });
        runtime.targets.select(created.key, endpointId, Date.now(), deviceExecutionPrincipalId(actor), toolName);
        return created;
      });
      return c.json({ ok: true, payload: { conversationId: conversation.key, agentId } }, 201);
    } catch (err) {
      log.warn({ err, endpointId: endpoint.endpointId }, 'Could not start a chat on the selected device');
      return c.json({ ok: false, error: { code: 'TARGET_SELECTION_FAILED' } }, 409);
    }
  });

  app.post(`${root}/folders`, bodyLimit({ maxSize: 48_000 }), async c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'owner' || !actor.scopes.includes('gateway.admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const parsed = publicationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const { origin, snapshot, signature } = parsed.data;
    const endpoint = runtime.registry.get(origin.endpointId);
    if (endpoint?.kind !== 'desktop' || !endpoint.tools.some(tool => tool.descriptor.name === DEVICE_FOLDER_SEARCH)
      || !runtime.registry.verifyTurnClaim(origin.endpointId, origin.token)) {
      return c.json({ ok: false, error: { code: 'SOURCE_UNAVAILABLE' } }, 409);
    }
    const principal = getEndpointPrincipal(endpoint.principalId);
    if (!principal || principal.revokedAt !== undefined || !verify('sha256', Buffer.from(deviceFolderSigningPayload(origin, snapshot)),
      { key: parseEndpointPublicKey(principal.publicKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const ids = new Set(snapshot.folders.map(folder => folder.id));
    const presets = snapshot.folders.filter(folder => folder.kind !== 'custom').map(folder => folder.kind);
    if (ids.size !== snapshot.folders.length || new Set(presets).size !== presets.length) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    }
    if (!saveDeviceFolderSnapshot(endpoint.principalId, snapshot)) {
      return c.json({ ok: false, error: { code: 'FOLDER_REVISION_CONFLICT' } }, 409);
    }
    return c.json({ ok: true, payload: { revision: snapshot.revision } });
  });
}
