import { createHash } from 'node:crypto';

import type { Hono } from 'hono';
import { z } from 'zod';

import { resolveEffectiveAgentConfigForAgent } from '../../../config/agent-profile.js';
import { resolveStateDir } from '../../../config/paths.js';
import { phoneAllowsApp } from '../../../phone/app-access.js';
import { phoneModelProfile } from '../../../phone/model-adapter.js';
import { getPhoneRuntime } from '../../../phone/runtime.js';
import { PhoneSetupService } from '../../../phone/setup/service.js';
import { getModelRegistry } from '../../../providers/model-registry.js';
import { isProviderConfiguredSync } from '../../../providers/index.js';
import { PhoneDependencyManager } from '../../../runtime-tools/phone-dependencies.js';
import { getSessionMetadata } from '../../../storage/sqlite/session-read-repository.js';
import type { GatewayService } from '../../service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function createPhoneSetupService(service: GatewayService): PhoneSetupService {
  const runtime = getPhoneRuntime();
  return new PhoneSetupService({ runtime,
    revision: (context, deviceId) => {
      const agent = resolveEffectiveAgentConfigForAgent(context.agentId).config;
      const device = runtime.repository.list().find(device => device.id === deviceId);
      const model = agent.models.phoneUse?.primary ? getModelRegistry().resolve(agent.models.phoneUse.primary) : undefined;
      return createHash('sha256').update(JSON.stringify([service.currentConfig.phone, agent.models.phoneUse, agent.tools.phone_use, agent.toolAllowlist, device, model && [model.api, model.baseUrl, model.input, phoneModelProfile(model)]])).digest('hex');
    },
    leaseActive: deviceId => { const device = runtime.repository.list().find(device => device.id === deviceId); return device ? runtime.repository.leaseActive(device.serial) : false; },
    connected: async (deviceId, signal) => {
      const device = runtime.repository.get(deviceId);
      return (await (await runtime.driverFor(device, service.currentConfig)).discover(signal)).some(found => found.serial === device.serial && found.state === 'device');
    },
    inspect: async (context, source) => {
      const config = service.currentConfig;
      const resolved = resolveEffectiveAgentConfigForAgent(context.agentId);
      const agent = resolved.config;
      const ref = agent.models.phoneUse?.primary;
      const model = ref ? getModelRegistry().resolve(ref) : undefined;
      const dependencies = await new PhoneDependencyManager({ stateDir: resolveStateDir(), config: config.runtimeTools, adbPath: config.phone.adbPath }).status();
      let localDiscovery: Array<{ name: string; state: string; emulator: boolean }> = []; let diagnostic: string | undefined;
      if (source === 'local' && dependencies.some(item => item.kind === 'adb' && item.state === 'ready')) {
        try { localDiscovery = (await runtime.discover(config)).map(({ name, state, emulator }) => ({ name, state, emulator })); }
        catch { diagnostic = 'PHONE_SETUP_DISCOVERY_FAILED'; }
      }
      return { enabled: config.phone.enabled,
        toolAllowed: agent.tools.phone_use?.mode !== 'deny' && (!agent.toolAllowlist || agent.toolAllowlist.includes('phone_use')),
        model: { ref, source: resolved.sources['models.phoneUse.primary'], chatRef: agent.models.chat?.primary, supported: Boolean(model && phoneModelProfile(model)), configured: Boolean(model && isProviderConfiguredSync(model.provider)) },
        dependencies: dependencies.map(({ kind, state, version, canInstall }) => ({ kind, state, version, canInstall })),
        devices: runtime.repository.list().map(device => ({ id: device.id, name: device.name, source: device.connection ? 'aliyun' as const : 'local' as const,
          enabled: device.enabled, settingsAllowed: phoneAllowsApp(device, 'com.android.settings') })), localDiscovery, diagnostic };
    },
  });
}

/** Registered inside the existing Phone admin route group. */
export function registerPhoneSetupRoutes(app: Hono, deps: AuthenticatedRouteDeps) {
  const schema = z.strictObject({ conversationId: z.string().uuid(), setupId: z.string().uuid().optional(),
    action: z.enum(['inspect', 'start', 'get', 'recheck', 'source', 'begin_verification', 'release', 'cancel']),
    source: z.enum(['local', 'aliyun']).optional(), deviceId: z.string().uuid().optional(), expectedRevision: z.number().int().positive().optional() });
  app.post('/api/phone/setup', deps.strictRateLimitMiddleware, async c => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid phone setup request' }, 400);
    const body = parsed.data; const metadata = getSessionMetadata(body.conversationId);
    if (!metadata) return c.json({ ok: false, error: 'Conversation not found' }, 404);
    const context = { conversationId: body.conversationId, agentId: metadata.agentId }; const setup = deps.service.phoneSetup;
    try {
      let payload: unknown;
      if (body.action === 'source') {
        if (!body.setupId || !body.source || !body.expectedRevision) throw new Error('Choose a source and refresh current progress');
        payload = await setup.source(context, body.setupId, body.source, body.expectedRevision);
      } else if (body.action === 'begin_verification') {
        if (!body.setupId || !body.deviceId || !body.expectedRevision) throw new Error('Select a phone and approve the current test');
        payload = await setup.begin(context, body.setupId, body.deviceId, body.expectedRevision, c.req.raw.signal);
      } else if (body.action === 'release') {
        if (!body.setupId) throw new Error('setupId is required'); payload = await setup.release(context, body.setupId);
      } else payload = await setup.command(body.action, { setupId: body.setupId }, context);
      c.header('Cache-Control', 'no-store'); return c.json({ ok: true, payload });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : 'Phone setup failed' }, 409); }
  });
}
