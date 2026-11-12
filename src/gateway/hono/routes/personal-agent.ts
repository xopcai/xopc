import { registerProactivityRoutes } from '../../../personal-agent/proactivity/routes.js';
import type { Hono } from 'hono';
import { z } from 'zod';
import { HIGGS_REALTIME_REF, voiceCallPreferencesPatchSchema } from '@xopcai/realtime-protocol/voice';

import { writeAgentAvatarFromBase64 } from '../../agents-admin.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { getDevice } from '../../../storage/sqlite/device-access-repository.js';
import { markPersonalRead, personalUnreadSnapshot } from '../../../personal-agent/unread.js';
import { getPersonalAgent } from '../../../personal-agent/repository.js';
import { isPersonalSchedule } from '../../../personal-agent/schedules.js';
import { AutomationScheduleSchema } from '../../../automations/domain/validation.js';
import { getAutomation } from '../../../automations/storage/index.js';
import { runSqliteWriteTransaction } from '../../../storage/sqlite/transaction.js';
import { listDeliverables } from '../../../tasks/task-deliverables.js';
import { legacyNaturalModel } from '../../../voice/realtime/omniRoute.js';
import { finishPersonalWelcome, getPersonalOnboarding, PersonalOnboardingDraftSchema, PersonalOnboardingStepSchema, savePersonalOnboarding } from '../../../personal-agent/onboarding.js';
import { TaskOriginRepository } from '../../../tasks/task-origin-repository.js';
import { getPersonalRequest, listPersonalRequests } from '../../../personal-agent/request-repository.js';
import { cancelPersonalRequest, personalRequestSnapshot, publishPersonalRequest } from '../../../personal-agent/request-service.js';
import {
  createOrResumePersonalAgent, ensurePersonalConversationVisibility, listPersonalModels, patchPersonalProfile, refreshPersonalDelegationGuidance,
  PersonalAppearanceSchema,
} from '../../../personal-agent/service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const AvatarSchema = z.object({
  base64: z.string().min(1).max(700_000),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
}).strict();

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
  voiceCallPreferences: voiceCallPreferencesPatchSchema.optional(),
  revision: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(60),
  appearance: PersonalAppearanceSchema,
  voicePreference: z.object({ provider: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(200), voice: z.string().trim().min(1).max(200) }).strict().nullable().optional(),
}).strict();
const ActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
  offset: z.coerce.number().int().min(0).default(0),
  view: z.enum(['work', 'deliverables']).optional(),
});
const PersonalScheduleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  instruction: z.string().trim().min(1).max(50_000),
  locale: z.enum(['zh', 'en']),
  schedule: AutomationScheduleSchema,
}).strict();
const PersonalSchedulePatchSchema = PersonalScheduleSchema.partial().extend({
  enabled: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative(),
}).refine(value => Object.keys(value).length > 1);

export function registerPersonalAgentRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const owner = (c: Parameters<typeof getGatewayPrincipal>[0]) => {
    const principal = getGatewayPrincipal(c);
    if (principal.kind === 'owner') return 'local-owner';
    if (principal.kind !== 'device' || !principal.deviceId) return null;
    const platform = getDevice(principal.deviceId)?.platform;
    return platform === 'harmonyos' || platform === 'ios' || platform === 'android' ? 'local-owner' : null;
  };

  registerProactivityRoutes(authenticated, deps, owner);

  authenticated.get('/api/personal-agent/schedules', async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const profile = getPersonalAgent(ownerId);
    if (profile?.state !== 'ready') return c.json({ ok: true, payload: [] });
    const items = await deps.service.automationServiceInstance.list();
    return c.json({ ok: true, payload: items.filter(item => isPersonalSchedule(item, profile.conversationId, profile.agentId)) });
  });

  authenticated.post('/api/personal-agent/schedules', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const profile = getPersonalAgent(ownerId);
    if (profile?.state !== 'ready') return c.json({ ok: false, error: 'Personal Agent is unavailable' }, 409);
    const parsed = PersonalScheduleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid Personal schedule' }, 400);
    const { name, instruction, locale, schedule } = parsed.data;
    try {
      const automation = await deps.service.automationServiceInstance.create({
        name, trigger: { kind: 'schedule', schedule },
        action: { kind: 'personal_task', agentId: profile.agentId, conversationId: profile.conversationId, instruction, locale },
        management: { owner: 'personal-agent', editable: ['enabled', 'trigger'], runnable: true, deletable: true },
        conversationMode: 'new_session',
        delivery: { notificationPolicy: 'attention', destinations: [{ key: 'gateway_event', kind: 'gateway_event' }] },
      });
      return c.json({ ok: true, payload: automation }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.patch('/api/personal-agent/schedules/:id', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const profile = getPersonalAgent(ownerId);
    if (profile?.state !== 'ready') return c.json({ ok: false, error: 'Personal Agent is unavailable' }, 409);
    const parsed = PersonalSchedulePatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid Personal schedule changes' }, 400);
    const service = deps.service.automationServiceInstance;
    const id = c.req.param('id');
    const { name, instruction, locale, schedule, enabled, expectedRevision } = parsed.data;
    try {
      const result = runSqliteWriteTransaction(() => {
        const current = getAutomation(id);
        if (!isPersonalSchedule(current, profile.conversationId, profile.agentId)) return { status: 'missing' } as const;
        if (current.updatedAtMs !== expectedRevision) return { status: 'conflict' } as const;
        const automation = service.updateAtomically(id, {
          ...(name !== undefined ? { name } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
          ...(schedule ? { trigger: { kind: 'schedule', schedule } } : {}),
          ...(instruction !== undefined || locale !== undefined ? {
            action: { ...current.action, instruction: instruction ?? current.action.instruction, locale: locale ?? current.action.locale },
          } : {}),
        });
        return { status: 'updated', automation } as const;
      });
      if (result.status === 'missing') return c.json({ ok: false, error: 'Personal schedule not found' }, 404);
      if (result.status === 'conflict') return c.json({ ok: false, error: 'The schedule changed. Reload and try again.' }, 409);
      service.refreshSchedule();
      return c.json({ ok: true, payload: result.automation });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/personal-agent/schedules/:id/run', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const profile = getPersonalAgent(ownerId);
    if (profile?.state !== 'ready') return c.json({ ok: false, error: 'Personal Agent is unavailable' }, 409);
    const id = c.req.param('id');
    if (!isPersonalSchedule(getAutomation(id), profile.conversationId, profile.agentId)) {
      return c.json({ ok: false, error: 'Personal schedule not found' }, 404);
    }
    try {
      const run = await deps.service.automationServiceInstance.runNow(id);
      return c.json({ ok: true, payload: run }, 202);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  authenticated.put('/api/personal-agent/avatar', deps.strictRateLimitMiddleware, async c => {
    const ownerId = owner(c);
    if (!ownerId) return c.json({ ok: false, error: 'Owner access is required' }, 403);
    const record = getPersonalAgent(ownerId);
    if (!record || record.state !== 'ready') return c.json({ ok: false, error: 'Personal AI is not ready' }, 409);
    const input = AvatarSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ ok: false, error: 'Invalid avatar' }, 400);
    const result = await writeAgentAvatarFromBase64(record.agentId, input.data.base64, input.data.mimeType);
    if (result.ok === false) return c.json({ ok: false, error: result.error }, result.status ?? 400);
    return c.json({ ok: true, payload: { agentId: record.agentId } });
  });


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
    const query = ActivityQuerySchema.safeParse({ limit: c.req.query('limit'), offset: c.req.query('offset'), view: c.req.query('view') });
    if (!query.success) return c.json({ ok: false, error: 'Invalid activity pagination' }, 400);
    const record = getPersonalAgent(ownerId);
    const { limit, offset, view } = query.data;
    if (view === 'deliverables') {
      const payload = record?.state === 'ready'
        ? listDeliverables({ conversationId: record.conversationId }, limit, offset) : { items: [], nextOffset: null };
      return c.json({ ok: true, payload });
    }
    const tasks = new TaskOriginRepository();
    if (view === 'work') {
      const conversationId = record?.state === 'ready' ? record.conversationId : null;
      const recent = conversationId ? tasks.listRecentEnded(conversationId, limit, offset) : { items: [], total: 0 };
      return c.json({ ok: true, payload: { ...recent, current: conversationId && offset === 0 ? tasks.listCurrent(conversationId) : [] } });
    }
    if (!record || record.state !== 'ready') return c.json({ ok: true, payload: { items: [], total: 0 } });
    return c.json({ ok: true, payload: tasks.list(record.conversationId, limit, { offset, order: 'recent' }) });
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
        const voices = await route.provider.plugin.listVoices({ cfg: deps.service.currentConfig, providerConfig: route.provider.providerConfig, mode: 'speech.stream' });
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
    const { revision, displayName, appearance, voicePreference, voiceCallPreferences } = parsed.data;
    const naturalModel = voiceCallPreferences?.naturalModel;
    if (naturalModel && naturalModel !== HIGGS_REALTIME_REF && naturalModel !== legacyNaturalModel(deps.service.currentConfig)
      && naturalModel !== getPersonalAgent(ownerId)?.voiceCallPreferences.naturalModel) {
      return c.json({ ok: false, error: 'Selected natural voice model is unavailable' }, 400);
    }
    if (voicePreference) {
      const { resolveStreamingTts } = await import('../../../voice/realtime/runtime.js');
      const route = resolveStreamingTts(deps.service.currentConfig);
      if (!route?.provider.plugin.listVoices || route.route.provider !== voicePreference.provider || route.route.model !== voicePreference.model) return c.json({ ok: false, error: 'Selected voice is unavailable' }, 400);
      const voices = await route.provider.plugin.listVoices({ cfg: deps.service.currentConfig, providerConfig: route.provider.providerConfig, mode: 'speech.stream' });
      if (!voices.some(voice => voice.id === voicePreference.voice)) return c.json({ ok: false, error: 'Selected voice is unavailable' }, 400);
    }
    const updated = await patchPersonalProfile(deps.service, ownerId, revision, displayName, appearance, voicePreference, voiceCallPreferences);
    return updated
      ? c.json({ ok: true, payload: updated })
      : c.json({ ok: false, error: 'Profile changed or personal Agent is unavailable' }, 409);
  });
}
