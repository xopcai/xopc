import type { AutomationService } from '../automations/index.js';
import { getProactivitySettings } from '../personal-agent/proactivity/repository.js';

const PULSE_AUTOMATIONS = [
  {
    id: 'system-proactive-pulse-morning',
    name: 'Proactive Morning Pulse Digest',
    description: 'Synthesize buffered non-urgent updates into the morning Pulse card.',
    cron: '30 8 * * *',
  },
  {
    id: 'system-proactive-pulse-evening',
    name: 'Proactive Evening Pulse Digest',
    description: 'Synthesize buffered non-urgent updates into the evening Pulse card.',
    cron: '30 18 * * *',
  },
] as const;

/**
 * Ensures morning (08:30) and evening (18:30) Pulse Digest flush schedules exist
 * in the owner's configured proactivity timezone. Empty buffers stay completely silent.
 */
export async function reconcileProactivePulseAutomations(
  service: AutomationService,
  ownerId = 'local-owner',
): Promise<void> {
  const tz = getProactivitySettings(ownerId).timezone || 'Asia/Shanghai';

  for (const spec of PULSE_AUTOMATIONS) {
    const current = await service.get(spec.id);
    const definition = {
      name: spec.name,
      description: spec.description,
      enabled: current?.enabled ?? true,
      trigger: current?.trigger ?? {
        kind: 'schedule' as const,
        schedule: { kind: 'cron' as const, expr: spec.cron, tz },
      },
      action: { kind: 'system' as const, capability: 'proactive.pulse.flush' as const },
      safety: { mode: 'auto_apply' as const },
      conversationMode: 'new_session' as const,
      delivery: { notificationPolicy: 'none' as const, destinations: [] },
      management: {
        owner: 'proactive-hub',
        editable: ['enabled', 'trigger'] as Array<'enabled' | 'trigger'>,
        runnable: true,
        deletable: false,
      },
    };
    if (!current) {
      await service.create({ id: spec.id, ...definition });
    } else if (
      JSON.stringify(current.action) !== JSON.stringify(definition.action)
      || current.delivery.notificationPolicy !== 'none'
    ) {
      await service.update(spec.id, definition);
    }
  }
}
