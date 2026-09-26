import type { AutomationAction, AutomationTrigger } from '../automations/domain/types.js';
import type { AutomationService } from '../automations/index.js';
import type { Config } from '../config/schema.js';
import { resolveMemoryMaintenanceSchedules } from '../memory-maintenance/index.js';

export interface MemoryMaintenanceAutomationReconcileResult {
  created: number;
  updated: number;
  disabled: number;
}

const AUTOMATION_IDS = [
  'system-memory-temporal-sweep',
  'system-memory-daily-reconciliation',
  'system-memory-weekly-knowledge',
] as const;

export async function reconcileMemoryMaintenanceAutomations(input: {
  config: Config;
  automationService: AutomationService;
}): Promise<MemoryMaintenanceAutomationReconcileResult> {
  const result = { created: 0, updated: 0, disabled: 0 };
  const schedules = resolveMemoryMaintenanceSchedules(input.config);
  const enabledIds = new Set(schedules.map((item) => item.automationId));

  for (const id of AUTOMATION_IDS) {
    if (enabledIds.has(id)) continue;
    const current = await input.automationService.get(id);
    if (current?.enabled) {
      await input.automationService.update(id, { enabled: false });
      result.disabled += 1;
    }
  }

  for (const schedule of schedules) {
    const trigger: AutomationTrigger = {
      kind: 'schedule',
      schedule: { kind: 'cron', expr: schedule.cron, tz: schedule.timezone },
    };
    const action: AutomationAction = {
      kind: 'system',
      capability: `memory.${schedule.jobType}`,
    };
    const next = {
      name: schedule.name,
      description: `Run deterministic ${schedule.jobType} without model inference.`,
      enabled: true,
      trigger,
      action,
      safety: { mode: 'auto_apply' as const },
      conversationMode: 'continuous' as const,
      notificationPolicy: 'none' as const,
      reliability: { disableAfterConsecutiveFailures: 3 },
      management: {
        owner: 'memory-maintenance',
        editable: ['enabled', 'trigger'] as Array<'enabled' | 'trigger'>,
        runnable: true,
        deletable: false,
      },
    };
    const current = await input.automationService.get(schedule.automationId);
    if (!current) {
      await input.automationService.create({ id: schedule.automationId, ...next });
      result.created += 1;
      continue;
    }
    const reconciled = current.management
      ? { ...next, enabled: current.enabled, trigger: current.trigger }
      : next;
    const changed = current.name !== reconciled.name
      || current.description !== next.description
      || current.enabled !== reconciled.enabled
      || JSON.stringify(current.trigger) !== JSON.stringify(reconciled.trigger)
      || JSON.stringify(current.action) !== JSON.stringify(action)
      || current.safety?.mode !== 'auto_apply'
      || current.notificationPolicy !== 'none'
      || JSON.stringify(current.management) !== JSON.stringify(next.management);
    if (changed) {
      await input.automationService.update(schedule.automationId, reconciled);
      result.updated += 1;
    }
  }
  return result;
}
