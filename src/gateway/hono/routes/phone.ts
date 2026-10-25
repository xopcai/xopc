import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { normalizePhoneAppAccess, phoneAppAccess } from '../../../phone/app-access.js';

import { getDefaultAgentId } from '../../../routing/resolve-route.js';
import { getModelRegistry } from '../../../providers/model-registry.js';
import { isProviderConfiguredSync } from '../../../providers/index.js';
import { MOCK_PHONE_MODEL, PhoneActionSchema, PhoneConfigSchema, PhoneDeviceSchema, PhoneError, PhoneInputSchema } from '../../../phone/contracts.js';
import { createPhoneModel, phoneModelProfile } from '../../../phone/model-adapter.js';
import { getPhoneRuntime, phoneExecutionContext, type PhoneRuntime } from '../../../phone/runtime.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { createLogger } from '../../../utils/logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { registerPhoneSetupRoutes } from './phone-setup.js';
import { registerPhoneWirelessRoutes } from './phone-wireless.js';
import { resolveAdbPath } from '../../../phone/adb-driver.js';

const log = createLogger('Hono:Phone');
const deviceInput = PhoneDeviceSchema.omit({ id: true, createdAt: true, revision: true, connection: true, wireless: true });

export function registerPhoneRoutes(parent: Hono, deps: AuthenticatedRouteDeps, runtime: PhoneRuntime = getPhoneRuntime()): void {
  const app = new Hono();
  app.onError((error, c) => {
    const code = error instanceof PhoneError ? error.code : error instanceof z.ZodError ? 'PHONE_INVALID_INPUT' : 'PHONE_OPERATION_FAILED';
    if (!(error instanceof PhoneError) && !(error instanceof z.ZodError)) log.warn({ phase: 'phone_route', errorCode: code }, 'Phone operation failed');
    return c.json({ ok: false, error: { code, message: error instanceof PhoneError ? error.message : error instanceof z.ZodError ? 'Invalid phone request' : 'Phone operation failed. Check device diagnostics.' } }, error instanceof PhoneError ? error.status : error instanceof z.ZodError ? 400 : 500);
  });
  const { service, strictRateLimitMiddleware } = deps;
  app.use('/api/phone/*', async (c, next) => {
    const principal = getGatewayPrincipal(c);
    if ((principal.kind !== 'owner' && principal.kind !== 'trusted-proxy') || !principal.scopes.includes('gateway.admin')) return c.json({ ok: false, error: { code: 'PHONE_ADMIN_REQUIRED', message: 'Phone settings require Gateway administrator access' } }, 403);
    return next();
  });

  registerPhoneSetupRoutes(app, deps);
  registerPhoneWirelessRoutes(app, deps, runtime);

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
    await runtime.shutdown();
    const next = structuredClone(service.currentConfig); next.phone = config;
    const result = await service.saveConfig(next);
    if (!result.saved) throw new PhoneError('PHONE_CONFIG_SAVE_FAILED', 'Unable to save Phone Use settings');
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
    return c.json({ ok: true, payload: runtime.repository.save(next, id) });
  });
  app.delete('/api/phone/devices/:id', strictRateLimitMiddleware, async c => {
    const id = c.req.param('id'); const device = runtime.repository.get(id); await runtime.stopDevice(id);
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
    op: z.enum(['takeover', 'release', 'handback', 'pause', 'cancel', 'heartbeat', 'input', 'recover']),
    frameSeq: z.number().int().positive().optional(), geometry: z.number().int().positive().optional(), action: PhoneActionSchema.optional(),
  }).strict();
  async function conversationPhone(conversationId: string, requestedSessionId?: string) {
    z.string().uuid().parse(conversationId);
    const conversation = await service.sessions.getSession(conversationId);
    if (!conversation) throw new PhoneError('PHONE_CONVERSATION_NOT_FOUND', 'Conversation not found', 404);
    const report = runtime.status(conversationId);
    if (requestedSessionId && report?.sessionId !== requestedSessionId) throw new PhoneError('PHONE_SESSION_NOT_FOUND', 'Phone session not found', 404);
    if (report && report.agentId !== conversation.agentId) throw new PhoneError('PHONE_ACCESS_CHANGED', 'Conversation Agent changed', 403);
    return { report, transcriptId: conversation.transcriptId, context: phoneExecutionContext(service.currentConfig, conversation.agentId) };
  }
  app.get('/api/phone/conversations/:conversationId', async c => {
    const owner = c.req.param('conversationId'); const client = liveClient.parse(c.req.query('clientId'));
    const { report, context } = await conversationPhone(owner);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: report ? runtime.liveStatus(owner, report.sessionId, context, `${getGatewayPrincipal(c).principalId}:${client}`) : null });
  });
  app.get('/api/phone/conversations/:conversationId/:sessionId/frame', async c => {
    const owner = c.req.param('conversationId'); const id = c.req.param('sessionId');
    const { context } = await conversationPhone(owner, id);
    const frame = await runtime.liveFrame(owner, id, context, c.req.raw.signal);
    c.header('Cache-Control', 'no-store'); c.header('Content-Type', 'image/png'); c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Phone-Frame-Seq', String(frame.seq)); c.header('X-Phone-Captured-At', String(frame.capturedAt));
    c.header('X-Phone-Width', String(frame.width)); c.header('X-Phone-Height', String(frame.height)); c.header('X-Phone-Rotation', String(frame.rotation));
    const bytes = Uint8Array.from(frame.frame); frame.frame.fill(0);
    return c.body(bytes);
  });
  app.post('/api/phone/conversations/:conversationId/:sessionId/video-ticket', strictRateLimitMiddleware, async c => {
    const owner = c.req.param('conversationId'); const id = c.req.param('sessionId');
    const { clientId } = z.object({ clientId: liveClient }).strict().parse(await c.req.json());
    await conversationPhone(owner, id);
    const principal = getGatewayPrincipal(c); const client = `${principal.principalId}:${clientId}`;
    const validate = async () => { const { context } = await conversationPhone(owner, id); runtime.liveStatus(owner, id, context, client); };
    const issued = service.phoneStreams.issue({ origin: new URL(c.req.url).origin, principal: principal.principalId, client, validate,
      connect: async () => { const { context } = await conversationPhone(owner, id); return runtime.liveVideo(owner, id, context); },
      disconnect: () => runtime.disconnectVideo(owner, id, client) });
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: { ...issued, transport: 'scrcpy-h264', protocolVersion: 1 } });
  });
  app.post('/api/phone/conversations/:conversationId/:sessionId/control', async c => {
    const owner = c.req.param('conversationId'); const id = c.req.param('sessionId');
    const { context, transcriptId } = await conversationPhone(owner, id);
    const { clientId, ...input } = liveControlInput.parse(await c.req.json());
    const result = await runtime.liveControl(owner, id, context, `${getGatewayPrincipal(c).principalId}:${clientId}`, input);
    if (input.op === 'handback' && (result as { resumeTurnRequired?: boolean }).resumeTurnRequired && !service.sessions.getActiveRun(owner).active) {
      const resumed = await service.submitSessionInput({ conversationId: owner, expectedTranscriptId: transcriptId, clientMessageId: input.operationId,
        delivery: 'next', content: '手机已交还，请先确认当前页面，继续未完成的任务；已完成的步骤不要重复，结束后关闭手机会话。',
        origin: { type: 'system', source: 'internal' } });
      if (!resumed.ok) throw new PhoneError('PHONE_RESUME_FAILED', 'Phone control returned. Send Continue in chat to resume the task.', 409);
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
