import type { AutomationService } from '../automations/index.js';

export const HOME_ADVISOR_REFRESH_AUTOMATION_ID = 'system-home-advisor-refresh';

export async function reconcileHomeIntelligenceAutomation(
  automationService: AutomationService,
): Promise<'created' | 'updated' | 'unchanged'> {
  const current = await automationService.get(HOME_ADVISOR_REFRESH_AUTOMATION_ID);
  const managed = {
    name: 'Refresh Home AI suggestions',
    description: 'Re-evaluate Home suggestions from current workspace context.',
    action: { kind: 'system' as const, capability: 'home.advisor.refresh' as const },
    safety: { mode: 'auto_apply' as const },
    conversationMode: 'new_session' as const,
    delivery: { notificationPolicy: 'none' as const, destinations: [] },
    reliability: { disableAfterConsecutiveFailures: 3 },
    management: {
      owner: 'home-intelligence',
      editable: ['enabled', 'trigger'] as Array<'enabled' | 'trigger'>,
      runnable: true,
      deletable: false,
    },
  };
  if (!current) {
    await automationService.create({
      id: HOME_ADVISOR_REFRESH_AUTOMATION_ID,
      enabled: false,
      trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: 30 * 60_000, anchorMs: Date.now() } },
      ...managed,
    });
    return 'created';
  }
  const patch = {
    ...managed,
    enabled: current.enabled,
    trigger: current.trigger,
  };
  const changed = Object.entries(patch).some(([key, value]) => (
    JSON.stringify(current[key as keyof typeof current]) !== JSON.stringify(value)
  ));
  if (!changed) return 'unchanged';
  await automationService.update(HOME_ADVISOR_REFRESH_AUTOMATION_ID, patch);
  return 'updated';
}
