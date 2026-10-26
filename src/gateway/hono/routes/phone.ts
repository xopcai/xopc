import { phoneAssistance, pendingPhoneAssistance, phoneAssistanceReport, cancelPhoneAssistance } from '../../../phone/assistance.js';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ConversationPhoneSummary } from '@xopcai/gateway-contract';

import { getSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import { setDevicePhoneAccess } from '../../../storage/sqlite/device-access-repository.js';
import { authorizePhoneAccess, phoneAdministrator } from '../../security/phone-access.js';

import { normalizePhoneAppAccess, phoneAppAccess } from '../../../phone/app-access.js';

import { getDefaultAgentId } from '../../../routing/resolve-route.js';
import { getModelRegistry } from '../../../providers/model-registry.js';
import { isProviderConfiguredSync } from '../../../providers/index.js';
import { type PhoneReport, MOCK_PHONE_MODEL, PhoneExecutionModeSchema, PhoneActionSchema, PhoneConfigSchema, PhoneDeviceSchema, PhoneError, PhoneInputSchema } from '../../../phone/contracts.js';
import { createPhoneModel, phoneModelProfile } from '../../../phone/model-adapter.js';
import { getPhoneRuntime, phoneExecutionContext, type PhoneRuntime } from '../../../phone/runtime.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { createLogger } from '../../../utils/logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { registerPhoneSetupRoutes } from './phone-setup.js';
import { registerPhoneWirelessRoutes } from './phone-wireless.js';
import { resolveAdbPath } from '../../../phone/adb-driver.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';

const log = createLogger('Hono:Phone');
const deviceInput = PhoneDeviceSchema.omit({ id: true, createdAt: true, revision: true, connection: true, wireless: true });

export function registerPhoneRoutes(parent: Hono, deps: AuthenticatedRouteDeps, runtime: PhoneRuntime = getPhoneRuntime()): void {
  const app = new Hono();
  app.onError((error, c) => {
    const code = error instanceof PhoneError ? error.code : error instanceof z.ZodError ? 'PHONE_INVALID_INPUT' : 'PHONE_OPERATION_FAILED';
    if (!(error instanceof PhoneError) && !(error instanceof z.ZodError)) log.warn({ phase: 'phone_route', errorCode: code }, 'Phone operation failed');
    return c.json({ ok: false, error: { code, ...(error instanceof PhoneError ? error.details : {}), message: error instanceof PhoneError ? error.message : error instanceof z.ZodError ? 'Invalid phone request' : 'Phone operation failed. Check device diagnostics.' } }, error instanceof PhoneError ? error.status : error instanceof z.ZodError ? 400 : 500);
  });
  const { service, strictRateLimitMiddleware } = deps;
  app.use('/api/phone/*', async (c, next) => {
    const principal = getGatewayPrincipal(c);
    if (!phoneAdministrator(principal)) {
      const path = c.req.path;
      const conversation = /^\/api\/phone\/conversations\/([0-9a-f-]{36})(?:\/(summary|[0-9a-f-]{36}\/(?:frame|video-ticket|control)))?$/i.test(path);
      const summary = path.endsWith('/summary') && c.req.method === 'GET';
      const allowed = conversation && (c.req.method === 'GET' || c.req.method === 'POST' && /\/(video-ticket|control)$/.test(path));
      if (!allowed || principal.kind !== 'device' || !principal.scopes.includes('sessions.read')) throw new PhoneError('PHONE_ADMIN_REQUIRED', 'Phone management requires administrator access', 403);
      if (!summary) authorizePhoneAccess(principal, path.endsWith('/control'));
    }
    await next();
    if (principal.kind === 'device' && c.res.status === 200 && c.res.headers.get('Content-Type')?.includes('application/json')) {
      const body = await c.res.clone().json() as { payload?: { report?: Partial<PhoneReport>; ownControl?: boolean; textInput?: string } };
      const report = body.payload?.report;
      if (report && body.payload) {
        const { sessionId, deviceId, deviceName, status, mode, controlOwner, controlEpoch, handoff, assistanceId,
          reconnectRequired, stopReason, currentAction, updatedAt, revision, hasPendingTask, assistanceVersion, transcriptId } = report;
        body.payload = { ownControl: body.payload.ownControl, textInput: body.payload.textInput,
          report: { sessionId, deviceId, deviceName, status, mode, controlOwner, controlEpoch, handoff, assistanceId,
            reconnectRequired, stopReason, currentAction, updatedAt, revision, hasPendingTask, assistanceVersion, transcriptId } };
        c.res = c.json(body);
        c.header('Cache-Control', 'no-store');
      }
    }
  });

  app.patch('/api/phone/device-access/:id', strictRateLimitMiddleware, async c => {
    const actor = getGatewayPrincipal(c);
    if (actor.kind === 'device' || !actor.scopes.includes('gateway.admin')) return c.json({ ok: false }, 403);
    const input = z.object({ access: z.enum(['none', 'view', 'control']) }).strict().safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false }, 400);
    const device = setDevicePhoneAccess(c.req.param('id'), input.data.access);
    if (!device) return c.json({ ok: false }, 404);
    deps.service.phoneStreams.disconnectPrincipal(device.id);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: { id: device.id, scopes: device.scopes } });
  });

  registerPhoneSetupRoutes(app, deps);
  registerPhoneWirelessRoutes(app, deps, runtime);
  app.get('/api/phone/devices/:id/environment', c => {
    const id = z.uuid().parse(c.req.param('id')); const device = runtime.repository.get(id);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: { ...runtime.environment.status(id), supported: device.connection?.kind === 'aliyun-adb' } });
  });
  app.post('/api/phone/devices/:id/environment/cleanup', strictRateLimitMiddleware, async c => {
    const id = z.uuid().parse(c.req.param('id')); runtime.repository.get(id);
    const state = runtime.environment.status(id);
    const cleared = state.shareId ? await runtime.environment.clear(state.shareId, id) : true;
    return c.json({ ok: true, payload: { cleared, ...runtime.environment.status(id) } });
  });

  const connectionReports = () => {
    const reports = runtime.reports().filter(report => report.status !== 'closed');
    for (const wait of pendingPhoneAssistance()) {
      if (!reports.some(report => report.deviceId === wait.checkpoint.report.deviceId)) reports.push(phoneAssistanceReport(wait));
    }
    return reports.map(report => {
      const wait = phoneAssistance(report.owner);
      return wait && ['open', 'queued'].includes(wait.status) ? { ...report, assistanceId: wait.id, assistanceVersion: wait.version, transcriptId: wait.transcriptId, hasPendingTask: true, ...(wait.status === 'open' && report.controlOwner !== 'human' ? { status: 'needs_user' as const } : {}) } : report;
    });
  };
  const liveStatus = (owner: string, id: string, context: ReturnType<typeof phoneExecutionContext>, client: string) => {
    const state = runtime.liveStatus(owner, id, context, client);
    state.report.transcriptId = getSessionMetadata(owner)?.transcriptId;
    const wait = phoneAssistance(owner);
    if (!wait || !['open', 'queued'].includes(wait.status)) { state.report.assistanceId = undefined; state.report.assistanceVersion = undefined; }
    return wait && ['open', 'queued'].includes(wait.status) ? { ...state, report: { ...state.report, assistanceId: wait.id, assistanceVersion: wait.version, transcriptId: wait.transcriptId, hasPendingTask: true, ...(wait.status === 'open' && state.report.controlOwner !== 'human' ? { status: 'needs_user' as const } : {}) } } : state;
  };
  app.get('/api/phone/connections', async c => {
    c.header('Cache-Control', 'no-store');
    const payload = await Promise.all(connectionReports().map(async report => {
      const source = report.sourceConversationId ?? report.owner;
      const conversation = /^[\da-f]{8}-[\da-f-]{27}$/i.test(source) ? await service.sessions.getSession(source) : undefined;
      const { facts: _facts, readings: _readings, steps: _steps, task: _task, feedback: _feedback, ...metadata } = report;
      return { ...metadata, sourceConversationName: conversation?.name };
    }));
    return c.json({ ok: true, payload });
  });
  app.post('/api/phone/devices/:id/disconnect', strictRateLimitMiddleware, async c => {
    await runtime.stopDevice(z.string().uuid().parse(c.req.param('id')));
    return c.json({ ok: true });
  });
  app.post('/api/phone/devices/:id/view', strictRateLimitMiddleware, async c => {
    const id = z.string().uuid().parse(c.req.param('id'));
    await runtime.viewDevice(id, service.currentConfig, getDefaultAgentId(), c.req.raw.signal);
    c.header('Cache-Control', 'no-store'); return c.json({ ok: true });
  });
  app.post('/api/phone/devices/:id/conversations', strictRateLimitMiddleware, async c => {
    const device = runtime.repository.get(z.string().uuid().parse(c.req.param('id')));
    if (!device.enabled) throw new PhoneError('PHONE_DEVICE_DENIED', 'This phone is disabled', 403);
    const conversation = createConversation({ agentId: getDefaultAgentId(), sourceChannel: 'webchat',
      sourceChatId: 'webchat', name: device.name, customData: { phoneDeviceId: device.id } });
    c.header('Cache-Control', 'no-store'); return c.json({ ok: true, payload: { conversationId: conversation.key, deviceId: device.id } }, 201);
  });

  app.use('/api/phone/cloud/aliyun/*', bodyLimit({ maxSize: 24 * 1024, onError: c => c.json({ ok: false, error: { code: 'PHONE_UPLOAD_TOO_LARGE', message: 'Phone key upload exceeds 24 KB' } }, 413) }));
  app.post('/api/phone/cloud/aliyun/test', strictRateLimitMiddleware, async c => {
    const input = z.object({ endpoint: z.string().max(200), privateKey: z.string().max(16384) }).strict().parse(await c.req.json());
    const payload = await runtime.cloud.test(getGatewayPrincipal(c).principalId, input.endpoint, input.privateKey, c.req.raw.signal);
    c.header('Cache-Control', 'no-store'); return c.json({ ok: true, payload });
  });
  app.post('/api/phone/cloud/aliyun/add', strictRateLimitMiddleware, async c => {
    const input = z.object({ token: z.string().uuid(), name: z.string().trim().min(1).max(100), makeDefault: z.boolean().default(false) }).strict().parse(await c.req.json());
    const payload = await runtime.cloud.add(getGatewayPrincipal(c).principalId, input.token, input.name, input.makeDefault);
    c.header('Cache-Control', 'no-store'); return c.json({ ok: true, payload }, 201);
  });
  app.delete('/api/phone/cloud/aliyun/tests/:token', c => {
    runtime.cloud.cancel(getGatewayPrincipal(c).principalId, z.string().uuid().parse(c.req.param('token')));
    return c.json({ ok: true });
  });
  app.get('/api/phone/settings', c => c.json({ ok: true, payload: { config: service.currentConfig.phone, defaultDeviceId: runtime.repository.defaultDevice(), runner: 'gateway-local', agentId: getDefaultAgentId() } }));
  app.patch('/api/phone/settings', strictRateLimitMiddleware, async c => {
    const config = PhoneConfigSchema.parse(await c.req.json());
    if (!config.enabled || config.adbPath !== service.currentConfig.phone.adbPath) await runtime.shutdown();
    const next = structuredClone(service.currentConfig); next.phone = config;
    const result = await service.saveConfig(next);
    if (!result.saved) throw new PhoneError('PHONE_CONFIG_SAVE_FAILED', 'Unable to save Phone Use settings');
    runtime.updateConnectionPolicy(next);
    return c.json({ ok: true, payload: { config } });
  });
  app.get('/api/phone/devices', async c => {
    let discovery: Awaited<ReturnType<PhoneRuntime['discover']>> = []; let diagnostic: string | undefined;
    try { discovery = await runtime.discover(service.currentConfig, c.req.raw.signal); }
    catch (error) { diagnostic = error instanceof PhoneError ? error.code : 'PHONE_ADB_UNAVAILABLE'; }
    return c.json({ ok: true, payload: { devices: runtime.repository.list(), discovery, diagnostic, defaultDeviceId: runtime.repository.defaultDevice() } });
  });
  app.get('/api/phone/apps', async c => {
    const input = z.object({ serial: z.string().min(1).max(200) }).strict().parse(c.req.query());
    const applications = await runtime.applications(input, service.currentConfig, c.req.raw.signal);
    c.header('Cache-Control', 'no-store'); return c.json({ ok: true, payload: { applications } });
  });
  app.get('/api/phone/devices/:id/apps', async c => {
    const applications = await runtime.applications({ deviceId: c.req.param('id') }, service.currentConfig, c.req.raw.signal);
    c.header('Cache-Control', 'no-store'); return c.json({ ok: true, payload: { applications } });
  });
  app.get('/api/phone/devices/:id/input-status', async c => {
    const payload = await runtime.textInputStatus(c.req.param('id'), service.currentConfig, c.req.raw.signal);
    c.header('Cache-Control', 'no-store'); return c.json({ ok: true, payload });
  });
  app.post('/api/phone/devices', strictRateLimitMiddleware, async c => {
    const input = deviceInput.parse(await c.req.json());
    const discovered = await runtime.discover(service.currentConfig, c.req.raw.signal);
    if (!discovered.some(device => device.serial === input.serial && device.state === 'device')) throw new PhoneError('PHONE_DEVICE_OFFLINE', 'Choose a connected and authorized ADB device');
    const wireless = runtime.wireless.known(input.serial);
    if (wireless) {
      const verified = await runtime.wireless.connect(resolveAdbPath(service.currentConfig.phone.adbPath), wireless, c.req.raw.signal, wireless);
      input.serial = verified.device.serial;
    }
    const device = runtime.repository.save({ ...input, ...(wireless ? { wireless } : {}) });
    if (!runtime.repository.defaultDevice()) runtime.repository.setDefault(device.id);
    return c.json({ ok: true, payload: device }, 201);
  });
  app.patch('/api/phone/devices/:id', strictRateLimitMiddleware, async c => {
    const id = c.req.param('id'); const previous = runtime.repository.get(id);
    const patch = deviceInput.omit({ serial: true }).partial().parse(await c.req.json());
    const next = normalizePhoneAppAccess({ ...previous, ...patch,
      ...(patch.allowedApps && patch.appAccess === undefined ? { appAccess: 'selected' as const } : {}) });
    await runtime.stopDevice(id);
    if (previous.connection) await runtime.environment.recover(id, true);
    return c.json({ ok: true, payload: runtime.repository.save(next, id) });
  });
  app.delete('/api/phone/devices/:id', strictRateLimitMiddleware, async c => {
    const id = c.req.param('id'); const device = runtime.repository.get(id); await runtime.stopDevice(id);
    if (device.connection) await runtime.environment.recover(id, true);
    await runtime.cloud.remove(device); runtime.repository.remove(id);
    return c.json({ ok: true });
  });
  app.post('/api/phone/devices/:id/default', strictRateLimitMiddleware, c => {
    runtime.repository.setDefault(c.req.param('id')); return c.json({ ok: true });
  });
  app.post('/api/phone/devices/:id/diagnostics', strictRateLimitMiddleware, async c => {
    const device = runtime.repository.get(c.req.param('id'));
    const found = (await (await runtime.driverFor(device, service.currentConfig)).discover(c.req.raw.signal)).find(item => item.serial === device.serial);
    return c.json({ ok: true, payload: { state: found?.state ?? 'disconnected', emulator: found?.emulator ?? false, runner: 'gateway-local', appAccess: phoneAppAccess(device), allowedApps: device.allowedApps } });
  });
  app.get('/api/phone/devices/:id/screen', async c => {
    const observation = await runtime.preview(c.req.param('id'), service.currentConfig, c.req.raw.signal);
    const bytes = Uint8Array.from(observation.frame); observation.frame.fill(0);
    c.header('Cache-Control', 'no-store'); c.header('Content-Type', 'image/png'); c.header('X-Content-Type-Options', 'nosniff');
    return c.body(bytes);
  });

  app.get('/api/phone/models', c => c.json({ ok: true, payload: { models: [
    ...getModelRegistry().getAll().flatMap(model => {
      const profile = phoneModelProfile(model);
      return profile ? [{ id: `${model.provider}/${model.id}`, name: model.name, profile, mock: false, configured: isProviderConfiguredSync(model.provider) }] : [];
    }),
  ] } }));
  app.post('/api/phone/models/diagnostics', strictRateLimitMiddleware, async c => {
    const body = z.object({ modelRef: z.string().min(1), agentId: z.string().optional() }).strict().parse(await c.req.json());
    const adapter = await createPhoneModel(body.modelRef, service.currentConfig, body.agentId ?? getDefaultAgentId());
    const { default: sharp } = await import('sharp');
    const frame = await sharp(Buffer.from('<svg width="600" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="1000" fill="white"/><text x="60" y="100" font-size="26">Phone Use connection test</text><rect x="100" y="400" width="400" height="160" fill="#2563eb"/><text x="200" y="495" font-size="36" fill="white">Continue</text></svg>')).png().toBuffer();
    try {
      const decision = await adapter.predict({ goal: 'Tap the blue Continue button. This is a synthetic test image; no phone action will be executed.', allowedApps: ['com.android.settings'], history: [], scenario: body.modelRef === MOCK_PHONE_MODEL ? 'settings-about' : undefined,
        observation: { frameId: randomUUID(), capturedAt: Date.now(), width: 600, height: 1000, rotation: 0, package: 'com.android.settings', frame, elements: [] } }, c.req.raw.signal);
      const grounded = decision.kind === 'action' && decision.action.type === 'tap'
        && decision.action.point[0] >= 167 && decision.action.point[0] <= 833 && decision.action.point[1] >= 400 && decision.action.point[1] <= 560;
      return c.json({ ok: true, payload: { protocolValid: true, groundingVerified: grounded, mock: body.modelRef === MOCK_PHONE_MODEL, deviceActions: 0 } });
    } finally { frame.fill(0); }
  });
  const liveClient = z.string().uuid();
  const liveControlInput = z.object({
    clientId: liveClient, operationId: z.string().uuid(), epoch: z.number().int().positive(),
    assistanceId: z.string().uuid().optional(), assistanceVersion: z.number().int().positive().optional(),
    op: z.enum(['takeover', 'release', 'handback', 'pause', 'cancel', 'heartbeat', 'input', 'recover']),
    expectedTranscriptId: z.uuid().optional(),
    frameSeq: z.number().int().positive().optional(), geometry: z.number().int().positive().optional(), action: PhoneActionSchema.optional(),
  }).strict();
  async function conversationPhone(conversationId: string, requestedSessionId?: string) {
    if (conversationId.startsWith('device:')) {
      const deviceId = z.string().uuid().parse(conversationId.slice(7));
      const report = connectionReports().find(report => report.deviceId === deviceId);
      if (!report || requestedSessionId && report.sessionId !== requestedSessionId) throw new PhoneError('PHONE_SESSION_NOT_FOUND', 'Phone connection changed. Refresh the phone panel.', 404);
      const conversation = /^[\da-f]{8}-[\da-f-]{27}$/i.test(report.owner) ? await service.sessions.getSession(report.owner) : undefined;
      return { owner: report.owner, report, transcriptId: conversation?.transcriptId, context: runtime.status(report.owner) && runtime.status(report.owner)?.status !== 'closed' ? runtime.deviceContext(deviceId, service.currentConfig) : phoneExecutionContext(service.currentConfig, report.agentId) };
    }
    z.string().uuid().parse(conversationId);
    const conversation = await service.sessions.getSession(conversationId);
    if (!conversation) throw new PhoneError('PHONE_CONVERSATION_NOT_FOUND', 'Conversation not found', 404);
    const connected = runtime.status(conversationId);
    const wait = phoneAssistance(conversationId);
    const report = connected && connected.status !== 'closed' ? connected : wait && ['open', 'queued'].includes(wait.status) ? phoneAssistanceReport(wait) : undefined;
    if (requestedSessionId && report?.sessionId !== requestedSessionId) throw new PhoneError('PHONE_SESSION_NOT_FOUND', 'Phone session not found', 404);
    if (report && report.agentId !== conversation.agentId) throw new PhoneError('PHONE_ACCESS_CHANGED', 'Conversation Agent changed', 403);
    return { owner: conversationId, report, transcriptId: conversation.transcriptId, context: phoneExecutionContext(service.currentConfig, conversation.agentId) };
  }
  app.get('/api/phone/conversations/:conversationId/summary', async c => {
    const principal = getGatewayPrincipal(c);
    const id = c.req.param('conversationId');
    const { report, transcriptId } = await conversationPhone(id);
    let access: ConversationPhoneSummary['access'] = 'none';
    try { authorizePhoneAccess(principal); access = 'view'; } catch { /* Summary carries no private phone metadata without a grant. */ }
    if (access === 'view') { try { authorizePhoneAccess(principal, true); access = 'control'; } catch { /* Read-only grant. */ } }
    const assistance = phoneAssistance(id);
    const payload: ConversationPhoneSummary = { available: Boolean(report), access, needsUser: Boolean(report && access !== 'none' && (assistance?.status === 'open' || report.status === 'needs_user')) };
    if (report && access !== 'none') {
      if (assistance?.status === 'open') payload.assistance = { id: assistance.id, version: assistance.version };
      payload.deviceName = report.deviceName; payload.taskState = report.status; payload.updatedAt = report.updatedAt;
      if (transcriptId && report.deviceId) payload.binding = { conversationId: id, transcriptId, phoneSessionId: report.sessionId, phoneDeviceId: report.deviceId };
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload });
  });
  app.get('/api/phone/conversations/:conversationId', async c => {
    let owner = c.req.param('conversationId'); const client = liveClient.parse(c.req.query('clientId'));
    const { report, context, owner: resolvedOwner } = await conversationPhone(owner); owner = resolvedOwner;
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: report ? runtime.status(owner)?.status !== 'closed' && runtime.status(owner) ? liveStatus(owner, report.sessionId, context, `${getGatewayPrincipal(c).principalId}:${client}${c.req.param('conversationId').startsWith('device:') ? ':viewer' : ''}`) : { report, ownControl: false, frame: null } : null });
  });
  app.post('/api/phone/conversations/:conversationId/:sessionId/execution-mode', strictRateLimitMiddleware, async c => {
    const address = c.req.param('conversationId');
    if (address.startsWith('device:')) throw new PhoneError('PHONE_OBSERVE_ONLY', 'Change execution mode from the source conversation', 403);
    const { owner, context } = await conversationPhone(address, c.req.param('sessionId'));
    const input = z.object({ executionMode: PhoneExecutionModeSchema, applyCurrent: z.boolean().default(false), epoch: z.number().int().positive(), clientId: liveClient }).strict().parse(await c.req.json());
    await runtime.setExecutionMode(owner, input.executionMode, context, input.applyCurrent, input.epoch);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: liveStatus(owner, c.req.param('sessionId'), context, `${getGatewayPrincipal(c).principalId}:${input.clientId}`) });
  });
  app.get('/api/phone/conversations/:conversationId/:sessionId/frame', async c => {
    let owner = c.req.param('conversationId'); const id = c.req.param('sessionId');
    const { context, transcriptId, owner: resolvedOwner } = await conversationPhone(owner, id); owner = resolvedOwner;
    const principal = getGatewayPrincipal(c);
    if (principal.kind === 'device' && c.req.query('expectedTranscriptId') !== transcriptId) throw new PhoneError('PHONE_BINDING_CHANGED', 'Conversation changed', 409);
    const frame = await runtime.liveFrame(owner, id, context, c.req.raw.signal);
    try { authorizePhoneAccess(principal); } catch (error) { frame.frame.fill(0); throw error; }
    c.header('Cache-Control', 'no-store'); c.header('Content-Type', 'image/png'); c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Phone-Frame-Seq', String(frame.seq)); c.header('X-Phone-Captured-At', String(frame.capturedAt));
    c.header('X-Phone-Width', String(frame.width)); c.header('X-Phone-Height', String(frame.height)); c.header('X-Phone-Rotation', String(frame.rotation));
    const bytes = Uint8Array.from(frame.frame); frame.frame.fill(0);
    return c.body(bytes);
  });
  app.post('/api/phone/conversations/:conversationId/:sessionId/video-ticket', strictRateLimitMiddleware, async c => {
    const address = c.req.param('conversationId'); const id = c.req.param('sessionId');
    const { clientId, purpose, expectedTranscriptId, epoch } = z.object({ clientId: liveClient, purpose: z.enum(['view', 'control']).optional(), expectedTranscriptId: z.uuid().optional(), epoch: z.number().int().positive().optional() }).strict().parse(await c.req.json());
    const initial = await conversationPhone(address, id);
    const principal = getGatewayPrincipal(c); const client = `${principal.principalId}:${clientId}${address.startsWith('device:') || purpose === 'view' || principal.kind === 'device' && purpose !== 'control' ? ':viewer' : ''}`;
    const native = principal.kind === 'device';
    const interactive = native ? purpose === 'control' : purpose !== 'view' && !address.startsWith('device:');
    if (native && (!expectedTranscriptId || expectedTranscriptId !== initial.transcriptId)) throw new PhoneError('PHONE_BINDING_CHANGED', 'Conversation changed; refresh the phone', 409);
    const validate = async () => {
      authorizePhoneAccess(principal, interactive);
      const resolved = await conversationPhone(address, id);
      if (resolved.transcriptId !== initial.transcriptId) throw new PhoneError('PHONE_BINDING_CHANGED', 'Conversation changed', 409);
      const state = runtime.liveStatus(resolved.owner, id, resolved.context, client);
      if (native && interactive && (!state.ownControl || epoch !== state.report.controlEpoch)) throw new PhoneError('PHONE_CONTROL_CHANGED', 'Take over before opening an interactive stream', 409);
    };
    if (native) await validate();
    const issued = service.phoneStreams.issue({ ...(native ? { deviceId: principal.deviceId, readOnly: !interactive, inputEpoch: interactive ? epoch : undefined } : { readOnly: !interactive }), origin: new URL(c.req.url).origin, principal: principal.principalId, client, validate,
      connect: async () => { const resolved = await conversationPhone(address, id); return runtime.liveVideo(resolved.owner, id, resolved.context); },
      disconnect: async () => {
        await runtime.disconnectVideo(initial.owner, id, client, native ? epoch : undefined);
      } });
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: { ...issued, transport: 'scrcpy-h264', protocolVersion: 1 } });
  });
  app.post('/api/phone/conversations/:conversationId/:sessionId/control', async c => {
    if (c.req.param('conversationId').startsWith('device:')) throw new PhoneError('PHONE_OBSERVE_ONLY', 'The global phone viewer is read only. Use the controlling conversation for input.', 403);
    let owner = c.req.param('conversationId'); const id = c.req.param('sessionId');
    const actor = getGatewayPrincipal(c);
    const { clientId, assistanceId, assistanceVersion, expectedTranscriptId, ...input } = liveControlInput.parse(await c.req.json());
    const requestedWait = phoneAssistance(owner);
    const allowRecovery = assistanceId && requestedWait?.id === assistanceId
      && requestedWait.checkpoint.report.sessionId === id && ['takeover', 'handback'].includes(input.op);
    const { context, transcriptId, owner: resolvedOwner } = await conversationPhone(owner, allowRecovery ? undefined : id); owner = resolvedOwner;
    if ((getGatewayPrincipal(c).kind === 'device' && !expectedTranscriptId) || expectedTranscriptId && expectedTranscriptId !== transcriptId) throw new PhoneError('PHONE_BINDING_CHANGED', 'Conversation changed; refresh the phone', 409);
    const wait = phoneAssistance(owner);
    if (assistanceId && (!wait || wait.id !== assistanceId || !['open', 'queued', 'resuming', 'completed'].includes(wait.status)))
      throw new PhoneError('PHONE_ASSISTANCE_CHANGED', 'The phone task changed. Refresh before continuing.', 409);
    if (assistanceVersion !== undefined && wait?.status === 'open' && wait.version !== assistanceVersion)
      throw new PhoneError('PHONE_ASSISTANCE_CHANGED', 'The phone assistance request changed. Refresh before continuing.', 409);
    // A retried completion must not repeat handback or enqueue another run.
    if (input.op === 'handback' && assistanceId && wait?.status !== 'open') {
      service.resumePhoneAssistance(owner, assistanceId);
      return c.json({ ok: true, payload: runtime.status(owner) && runtime.status(owner)?.status !== 'closed' ? liveStatus(owner, runtime.status(owner)!.sessionId, context, `${getGatewayPrincipal(c).principalId}:${clientId}`) : { report: phoneAssistanceReport(wait!), ownControl: false, frame: null } });
    }
    let sessionId = id;
    if (wait?.status === 'open' && ['takeover', 'handback'].includes(input.op)) {
      const restored = await runtime.restoreAssistance(wait.checkpoint, context, c.req.raw.signal, wait.id);
      if (restored.sessionId !== id) { sessionId = restored.sessionId; input.epoch = restored.controlEpoch!; }
    }
    let result: unknown;
    try {
      const current = runtime.status(owner);
      result = input.op === 'handback' && wait?.status === 'open' && current?.status === 'ready' && current.controlOwner === 'agent'
        ? liveStatus(owner, sessionId, context, `${getGatewayPrincipal(c).principalId}:${clientId}`)
        : await runtime.liveControl(owner, sessionId, context, `${getGatewayPrincipal(c).principalId}:${clientId}`, input, () => authorizePhoneAccess(actor, true));
    }
    catch (error) {
      const latest = phoneAssistance(owner);
      if (input.op !== 'handback' || !wait || latest?.id !== wait.id || latest.status === 'open'
        || !(error instanceof PhoneError) || !['PHONE_CONTROL_CHANGED', 'PHONE_CONTROL_BUSY'].includes(error.code)) throw error;
      result = liveStatus(owner, sessionId, context, `${getGatewayPrincipal(c).principalId}:${clientId}`);
    }
    if (input.op === 'cancel') cancelPhoneAssistance(owner);
    if (input.op === 'handback') {
      if (wait?.status === 'open') service.resumePhoneAssistance(owner, wait.id);
      else if (transcriptId && (result as { resumeTurnRequired?: boolean }).resumeTurnRequired) {
        const resumed = await service.submitSessionInput({ conversationId: owner, expectedTranscriptId: transcriptId,
          clientMessageId: `phone-handback:${sessionId}:${input.epoch}`, delivery: 'next',
          content: '手机已交还，请先确认当前页面，继续未完成的任务；已完成的步骤不要重复。', origin: { type: 'system', source: 'internal' } });
        if (!resumed.ok) throw new PhoneError('PHONE_RESUME_FAILED', 'Phone control returned. Send Continue in chat to resume the task.', 409);
      }
    }
    c.header('Cache-Control', 'no-store'); return c.json({ ok: true, payload: result });
  });

  const ownerFor = (principalId: string, id: string) => `phone-settings:${principalId}:${id}`;
  app.get('/api/phone/sessions', c => c.json({ ok: true, payload: { sessions: runtime.reports(), history: runtime.repository.history() } }));
  app.post('/api/phone/sessions', strictRateLimitMiddleware, async c => {
    const body = z.object({ deviceId: z.string().uuid().optional(), agentId: z.string().optional(), mode: z.enum(['observe', 'control']), appPackage: z.string().optional() }).strict().parse(await c.req.json());
    const id = randomUUID(); const principal = getGatewayPrincipal(c);
    const owner = ownerFor(principal.principalId, id);
    const { agentId = getDefaultAgentId(), ...input } = body;
    const report = await runtime.execute(owner, { op: 'open', ...input }, phoneExecutionContext(service.currentConfig, agentId), c.req.raw.signal);
    return c.json({ ok: true, payload: { id, report } }, 201);
  });
  app.get('/api/phone/sessions/:id', c => {
    const owner = ownerFor(getGatewayPrincipal(c).principalId, c.req.param('id'));
    const report = runtime.status(owner);
    if (!report) throw new PhoneError('PHONE_SESSION_NOT_FOUND', 'Phone session not found', 404);
    return c.json({ ok: true, payload: report });
  });
  app.get('/api/phone/sessions/:id/screen', async c => {
    const owner = ownerFor(getGatewayPrincipal(c).principalId, c.req.param('id'));
    const report = runtime.status(owner);
    if (!report) throw new PhoneError('PHONE_SESSION_NOT_FOUND', 'Phone session not found', 404);
    const observation = await runtime.previewSession(owner, phoneExecutionContext(service.currentConfig, report.agentId), c.req.raw.signal);
    const bytes = Uint8Array.from(observation.frame); observation.frame.fill(0);
    c.header('Cache-Control', 'no-store'); c.header('Content-Type', 'image/png'); c.header('X-Content-Type-Options', 'nosniff');
    return c.body(bytes);
  });
  app.post('/api/phone/sessions/:id/execute', strictRateLimitMiddleware, async c => {
    const owner = ownerFor(getGatewayPrincipal(c).principalId, c.req.param('id'));
    const report = runtime.status(owner);
    if (!report) throw new PhoneError('PHONE_SESSION_NOT_FOUND', 'Phone session not found', 404);
    const input = PhoneInputSchema.parse(await c.req.json());
    if (['open', 'discover'].includes(input.op)) throw new PhoneError('PHONE_INVALID_OPERATION', 'Use the phone discovery and session creation endpoints');
    const operation = runtime.execute(owner, input, phoneExecutionContext(service.currentConfig, report.agentId));
    if (input.op === 'run' || input.op === 'step') {
      // The browser can navigate away; bounded execution continues and remains cancellable.
      let immediateError: unknown;
      void operation.catch(error => {
        immediateError = error;
        log.info({ sessionId: report.sessionId, errorCode: error instanceof PhoneError ? error.code : 'PHONE_OPERATION_FAILED' }, 'Phone execution stopped');
      });
      await Promise.resolve();
      if (immediateError) throw immediateError;
      return c.json({ ok: true, payload: runtime.status(owner) }, 202);
    }
    return c.json({ ok: true, payload: await operation });
  });
  parent.route('/', app);
}
