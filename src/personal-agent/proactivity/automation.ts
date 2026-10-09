import type { AutomationService } from '../../automations/index.js';

/** A quiet SQL admission tick; model work is owned by the Personal worker. */
export async function reconcilePersonalProactivityAutomation(service: AutomationService): Promise<void> {
  const id = 'system-personal-proactivity';
  const current = await service.get(id);
  const definition = {
    name: 'Personal AI attention checks', description: 'Check due attention and resume pending Personal messages.',
    enabled: current?.enabled ?? true,
    trigger: current?.trigger ?? { kind: 'schedule' as const, schedule: { kind: 'interval' as const, everyMs: 60_000 } },
    action: { kind: 'system' as const, capability: 'personal.proactivity.tick' as const },
    safety: { mode: 'auto_apply' as const }, conversationMode: 'continuous' as const,
    delivery: { notificationPolicy: 'none' as const, destinations: [] },
    management: { owner: 'personal-proactivity', editable: ['enabled', 'trigger'] as Array<'enabled' | 'trigger'>,
      runnable: true, deletable: false },
  };
  if (!current) await service.create({ id, ...definition });
  else if (JSON.stringify(current.action) !== JSON.stringify(definition.action)
    || current.delivery.notificationPolicy !== 'none') await service.update(id, definition);
}
