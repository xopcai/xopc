import { verify } from 'node:crypto';
import { COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';
import { DEVICE_FOLDER_SEARCH, desktopCapabilitySigningPayload, desktopCapabilitySnapshotSchema, deviceConnectionChatRequestSchema, deviceFolderSnapshotSchema, deviceFolderSigningPayload, endpointTurnClaimSchema, mobileDeviceCapabilityGrantSchema, type DeviceConnection, type DeviceConnections } from '@xopcai/endpoint-tools-protocol';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import { parseEndpointPublicKey } from '../../../endpoint-tools/auth.js';
import { deviceExecutionPrincipalId } from '../../../endpoint-tools/execution-actor.js';
import { deviceFoldersFor, deviceFolderSnapshots, mobileFolderPlatforms, pairedFolderClientId, saveDeviceFolderSnapshot } from '../../../endpoint-tools/folder-connections.js';
import { deviceCapabilityAllowed, deviceCapabilityTitles, isManagedDeviceCapability, mobileToolAllowsBackground, saveDesktopCapabilitySnapshot, setMobileCapabilityAllowed } from '../../../endpoint-tools/device-capability-grants.js';
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
const desktopPublicationSchema = publicationSchema.extend({ snapshot: desktopCapabilitySnapshotSchema });

export function registerDeviceConnectionRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const runtime = deps.service.endpointTools;

  app.get(root, c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    const owner = actor.kind === 'owner' && actor.scopes.includes('gateway.admin');
    const sourceId = pairedFolderClientId(actor);
    if (!owner && !sourceId) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const ids = new Map<string, { kind: DeviceConnection['kind']; platform: string; name: string }>();
    for (const device of listDevices()) {
      if (device.revokedAt !== undefined || (!owner && device.id !== sourceId)) continue;
      if (device.platform === 'desktop' || mobileFolderPlatforms.has(device.platform)) {
        ids.set(device.id, { kind: device.platform === 'desktop' ? 'desktop' : 'mobile', platform: device.platform, name: device.displayName });
      }
    }
    for (const principal of listEndpointPrincipals()) {
      if (principal.revokedAt !== undefined || (principal.kind !== 'desktop' && principal.kind !== 'mobile')
        || (!owner && principal.kind !== 'desktop' && principal.id !== sourceId)) continue;
      const device = getDevice(principal.id);
      if (device?.revokedAt !== undefined) continue;
      ids.set(principal.id, { kind: principal.kind, platform: principal.platform, name: principal.displayName });
    }
    const connections = runtime.registry.list().sort((a, b) => b.lastHeartbeatAt - a.lastHeartbeatAt);
    const devices = [...ids].map(([id, metadata]): DeviceConnection => {
      const candidates = connections.filter(endpoint => endpoint.principalId === id && endpoint.kind === metadata.kind);
      const endpoint = metadata.kind === 'mobile'
        ? candidates.find(candidate => candidate.availability === 'foreground' && candidate.tools.length > 0) ?? candidates[0]
        : candidates.find(candidate => candidate.tools.some(tool => tool.descriptor.name === DEVICE_FOLDER_SEARCH))
          ?? candidates.find(candidate => !candidate.executionAuthority) ?? candidates[0];
      const folders = metadata.kind !== 'desktop' ? [] : (deviceFolderSnapshots.get(id)?.folders ?? [])
        .filter(folder => owner || folder.access === 'gateway' || Boolean(sourceId && folder.mobileIds?.includes(sourceId)))
        .map(({ id, kind, label, access }) => ({ id, kind, label, ...(access && { access }) }));
      const mayExposeEndpoint = owner || id === sourceId || folders.length > 0
        && endpoint?.tools.some(tool => tool.descriptor.name === DEVICE_FOLDER_SEARCH);
      const capabilities = owner || id === sourceId
        ? endpoint?.tools.flatMap(({ descriptor: { name, requiresForeground } }) => {
          if (!isManagedDeviceCapability(endpoint, name)) return [];
          const [titleZh, title] = deviceCapabilityTitles[name];
          const effectiveRequiresForeground = requiresForeground && !mobileToolAllowsBackground(endpoint, name);
          return [{ name, title, titleZh, requiresForeground: effectiveRequiresForeground, allowed: deviceCapabilityAllowed(endpoint, name),
            ...(name === COMPUTER_CONTROL_TOOL && !deps.service.currentConfig.computer.enabled && { needsSetup: true as const }) }];
        }) ?? [] : undefined;
      return {
        id, ...metadata, name: getEndpointDeviceSettings(id)?.nickname ?? metadata.name,
        ...(mayExposeEndpoint && endpoint ? { endpointId: endpoint.endpointId } : {}),
        availability: endpoint?.availability ?? 'offline',
        tools: mayExposeEndpoint ? endpoint?.tools.map(tool => tool.descriptor.name) ?? [] : [],
        ...(capabilities && { capabilities }),
        folders,
      };
    });
    const payload: DeviceConnections = { ...(sourceId ? { currentDeviceId: sourceId } : {}), devices };
    return c.json({ ok: true, payload });
  });

  app.patch(root, bodyLimit({ maxSize: 1024 }), async c => {
    c.header('Cache-Control', 'no-store');
    const deviceId = pairedFolderClientId(getGatewayPrincipal(c));
    if (!deviceId) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const parsed = mobileDeviceCapabilityGrantSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const { toolName, allowed } = parsed.data;
    if (allowed && !runtime.registry.list().some(endpoint => endpoint.principalId === deviceId && endpoint.kind === 'mobile'
      && runtime.registry.getTool(endpoint.endpointId, toolName))) {
      return c.json({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } }, 409);
    }
    setMobileCapabilityAllowed(deviceId, toolName, allowed);
    if (!allowed) runtime.invocations.revokeDeviceCapability(deviceId, toolName);
    return c.json({ ok: true, payload: { toolName, allowed } });
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
    if (toolName && !owner) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const endpoint = runtime.registry.get(endpointId);
    if (!endpoint) return c.json({ ok: false, error: { code: 'TARGET_OFFLINE' } }, 409);
    if (toolName) {
      const principal = getEndpointPrincipal(endpoint.principalId);
      const device = getDevice(endpoint.principalId);
      if (!isManagedDeviceCapability(endpoint, toolName) || principal?.kind !== endpoint.kind
        || principal.revokedAt !== undefined || device?.revokedAt !== undefined) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
      }
      const tool = runtime.registry.getTool(endpointId, toolName);
      const effectiveRequiresForeground = Boolean(tool?.descriptor.requiresForeground && !mobileToolAllowsBackground(endpoint, toolName));
      if (!tool || effectiveRequiresForeground && endpoint.availability !== 'foreground'
        || toolName === COMPUTER_CONTROL_TOOL && !deps.service.currentConfig.computer.enabled) {
        return c.json({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } }, 409);
      }
      if (!deviceCapabilityAllowed(endpoint, toolName)) {
        return c.json({ ok: false, error: { code: 'CAPABILITY_AUTHORIZATION_REQUIRED' } }, 403);
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

  app.post(`${root}/capabilities`, bodyLimit({ maxSize: 4096 }), async c => {
    c.header('Cache-Control', 'no-store');
    const actor = getGatewayPrincipal(c);
    if (actor.kind !== 'owner' || !actor.scopes.includes('gateway.admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const parsed = desktopPublicationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    const { origin, snapshot, signature } = parsed.data;
    const endpoint = runtime.registry.get(origin.endpointId);
    if (endpoint?.kind !== 'desktop' || endpoint.executionAuthority || !runtime.registry.verifyTurnClaim(origin.endpointId, origin.token)) {
      return c.json({ ok: false, error: { code: 'SOURCE_UNAVAILABLE' } }, 409);
    }
    const principal = getEndpointPrincipal(endpoint.principalId);
    if (principal?.kind !== 'desktop' || principal.revokedAt !== undefined || getDevice(principal.id)?.revokedAt !== undefined
      || !verify('sha256', Buffer.from(desktopCapabilitySigningPayload(origin, snapshot)),
        { key: parseEndpointPublicKey(principal.publicKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    if (new Set(snapshot.allowed).size !== snapshot.allowed.length || snapshot.allowed.some(name => !runtime.registry.getTool(endpoint.endpointId, name))) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    }
    const revoked = saveDesktopCapabilitySnapshot(endpoint.principalId, snapshot);
    if (!revoked) return c.json({ ok: false, error: { code: 'CAPABILITY_REVISION_CONFLICT' } }, 409);
    for (const name of revoked) runtime.invocations.revokeDeviceCapability(endpoint.principalId, name);
    return c.json({ ok: true, payload: { revision: snapshot.revision } });
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
