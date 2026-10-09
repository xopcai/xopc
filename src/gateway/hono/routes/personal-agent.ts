import { registerProactivityRoutes } from '../../../personal-agent/proactivity/routes.js';
import type { Hono } from 'hono';
import { z } from 'zod';

import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { getDevice } from '../../../storage/sqlite/device-access-repository.js';
import { markPersonalRead, personalUnreadSnapshot } from '../../../personal-agent/unread.js';
import { getPersonalAgent } from '../../../personal-agent/repository.js';
import { finishPersonalWelcome, getPersonalOnboarding, PersonalOnboardingDraftSchema, PersonalOnboardingStepSchema, savePersonalOnboarding } from '../../../personal-agent/onboarding.js';
import { TaskOriginRepository } from '../../../tasks/task-origin-repository.js';
import { getPersonalRequest, listPersonalRequests } from '../../../personal-agent/request-repository.js';
import { cancelPersonalRequest, personalRequestSnapshot, publishPersonalRequest } from '../../../personal-agent/request-service.js';
import {
  createOrResumePersonalAgent, ensurePersonalConversationVisibility, listPersonalModels, patchPersonalProfile, refreshPersonalDelegationGuidance,
  PersonalAppearanceSchema, PersonalPreferencesSchema,
} from '../../../personal-agent/service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const CreateSchema = z.object({
  model: z.string().trim().min(3).optional(),
  displayName: z.string().trim().min(1).max(60).optional(),
  appearance: z.enum(['loopi', 'loopi-curious', 'loopi-care']).optional(),
  voicePreference: z.object({ provider: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(200), voice: z.string().trim().min(1).max(200) }).strict().optional(),
}).strict();
const OnboardingSchema = z.object({
  step: PersonalOnboardingStepSchema,
  draft: PersonalOnboardingDraftSchema,
}).strict();
const ProfileSchema = z.object({
  revision: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(60),
  appearance: PersonalAppearanceSchema,
  preferences: PersonalPreferencesSchema,
  voicePreference: z.object({ provider: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(200), voice: z.string().trim().min(1).max(200) }).strict().nullable().optional(),
}).strict();
const ActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerPersonalAgentRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const owner = (c: Parameters<typeof getGatewayPrincipal>[0]) => {
    const principal = getGatewayPrincipal(c);
    if (principal.kind === 'owner') return 'local-owner';
    if (principal.kind !== 'device' || !principal.deviceId) return null;
    const platform = getDevice(principal.deviceId)?.platform;
    return platform === 'harmonyos' || platform === 'ios' || platform === 'android' ? 'local-owner' : null;
  };

  registerProactivityRoutes(authenticated, deps, owner);

  authenticated.get('/api/personal-agent', async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    await refreshPersonalDelegationGuidance(deps.service, ownerId);
    ensurePersonalConversationVisibility(ownerId);
    return c.json({ ok: true, payload: getPersonalAgent(ownerId) });
  });

  authenticated.get('/api/personal-agent/unread', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const record = getPersonalAgent(ownerId);
    return c.json({ ok: true, payload: record ? personalUnreadSnapshot(record.conversationId) : null });
  });

  authenticated.post('/api/personal-agent/read', async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const parsed = z.object({ transcriptId: z.string().min(1), lastSeq: z.number().int().nonnegative() })
      .strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid read snapshot' }, 400);
    const record = getPersonalAgent(ownerId);
    if (!record) return c.json({ ok: false, error: 'Personal Agent is unavailable' }, 404);
    markPersonalRead(record.conversationId, parsed.data.transcriptId, parsed.data.lastSeq);
    deps.service.emit('personal.unread.updated', { conversationId: record.conversationId });
    return c.json({ ok: true, payload: personalUnreadSnapshot(record.conversationId) });
  });

  authenticated.get('/api/personal-agent/models', async c => {
    if (!owner(c)) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    return c.json({ ok: true, payload: await listPersonalModels() });
  });

  authenticated.get('/api/personal-agent/requests', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const record = getPersonalAgent(ownerId);
    return c.json({ ok: true, payload: record ? listPersonalRequests(record.conversationId).map(personalRequestSnapshot) : [] });
  });

  authenticated.get('/api/personal-agent/requests/:requestId', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const request = getPersonalRequest(c.req.param('requestId'));
    if (!request || request.conversationId !== getPersonalAgent(ownerId)?.conversationId) return c.json({ ok: false, error: 'Request not found' }, 404);
    return c.json({ ok: true, payload: personalRequestSnapshot(request) });
  });

  authenticated.post('/api/personal-agent/requests/:requestId/cancel', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const request = getPersonalRequest(c.req.param('requestId'));
    if (!request || request.conversationId !== getPersonalAgent(ownerId)?.conversationId) return c.json({ ok: false, error: 'Request not found' }, 404);
    const body = z.object({ expectedVersion: z.number().int().positive() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ ok: false, error: 'expectedVersion is required' }, 400);
    if (body.data.expectedVersion !== request.version) return c.json({ ok: false, error: 'Request changed' }, 409);
    try {
      const cancelled = cancelPersonalRequest(request);
      publishPersonalRequest(cancelled);
      return c.json({ ok: true, payload: { ...cancelled, executionStopConfirmed: false } });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 409); }
  });

  authenticated.get('/api/personal-agent/onboarding', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    return c.json({ ok: true, payload: getPersonalOnboarding(ownerId) });
  });

  authenticated.put('/api/personal-agent/onboarding', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    if (getPersonalAgent(ownerId)?.state === 'ready') return c.json({ ok: false, error: 'Onboarding is complete' }, 409);
    const parsed = OnboardingSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid onboarding draft' }, 400);
    savePersonalOnboarding(ownerId, parsed.data.step, parsed.data.draft);
    return c.json({ ok: true, payload: getPersonalOnboarding(ownerId) });
  });

  authenticated.post('/api/personal-agent/onboarding/welcome', deps.strictRateLimitMiddleware, c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    if (getPersonalAgent(ownerId)?.state !== 'ready') return c.json({ ok: false, error: 'Personal Agent is unavailable' }, 409);
    finishPersonalWelcome(ownerId);
    return c.json({ ok: true, payload: getPersonalOnboarding(ownerId) });
  });

  authenticated.get('/api/personal-agent/activity', c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const query = ActivityQuerySchema.safeParse({ limit: c.req.query('limit'), offset: c.req.query('offset') });
    if (!query.success) return c.json({ ok: false, error: 'Invalid activity pagination' }, 400);
    const record = getPersonalAgent(ownerId);
    if (!record || record.state !== 'ready') return c.json({ ok: true, payload: { items: [], total: 0 } });
    return c.json({ ok: true, payload: new TaskOriginRepository().list(record.conversationId, query.data.limit,
      { offset: query.data.offset, order: 'recent' }) });
  });

  authenticated.post('/api/personal-agent', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const parsed = CreateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid create request' }, 400);
    try {
      const selected = parsed.data.voicePreference;
      if (selected) {
        const { resolveStreamingTts } = await import('../../../voice/realtime/runtime.js');
        const route = resolveStreamingTts(deps.service.currentConfig);
        if (!route?.provider.plugin.listVoices || route.route.provider !== selected.provider || route.route.model !== selected.model) return c.json({ ok: false, error: 'Selected voice is unavailable' }, 400);
        const voices = await route.provider.plugin.listVoices({ cfg: deps.service.currentConfig, providerConfig: route.provider.providerConfig });
        if (!voices.some(voice => voice.id === selected.voice)) return c.json({ ok: false, error: 'Selected voice is unavailable' }, 400);
      }
      const record = await createOrResumePersonalAgent(deps.service, ownerId, parsed.data.model, listPersonalModels,
        parsed.data.displayName && parsed.data.appearance
          ? { displayName: parsed.data.displayName, appearance: parsed.data.appearance, ...(selected ? { voicePreference: selected } : {}) }
          : undefined);
      return c.json({ ok: true, payload: record });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.patch('/api/personal-agent/profile', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const parsed = ProfileSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid profile' }, 400);
    const { revision, displayName, appearance, preferences, voicePreference } = parsed.data;
    if (voicePreference) {
      const { resolveStreamingTts } = await import('../../../voice/realtime/runtime.js');
      const route = resolveStreamingTts(deps.service.currentConfig);
      if (!route?.provider.plugin.listVoices || route.route.provider !== voicePreference.provider || route.route.model !== voicePreference.model) return c.json({ ok: false, error: 'Selected voice is unavailable' }, 400);
      const voices = await route.provider.plugin.listVoices({ cfg: deps.service.currentConfig, providerConfig: route.provider.providerConfig });
      if (!voices.some(voice => voice.id === voicePreference.voice)) return c.json({ ok: false, error: 'Selected voice is unavailable' }, 400);
    }
    const updated = await patchPersonalProfile(deps.service, ownerId, revision, displayName, preferences, appearance, voicePreference);
    return updated
      ? c.json({ ok: true, payload: updated })
      : c.json({ ok: false, error: 'Profile changed or personal Agent is unavailable' }, 409);
  });
}
