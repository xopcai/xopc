import type { Config } from '../config/schema.js';
import type { MemoryMaintenanceJob } from './service.js';

export const MEMORY_MAINTENANCE_TOKEN = '__xopc_memory_maintenance__';

const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as const;

function cronAt(time: string, weekday?: number): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} * * ${weekday ?? '*'}`;
}

export interface MemoryMaintenanceSchedule {
  jobType: Exclude<MemoryMaintenanceJob, 'manual_repair'>;
  automationId: string;
  name: string;
  cron: string;
  timezone: string;
}

export function resolveMemoryMaintenanceSchedules(config: Config): MemoryMaintenanceSchedule[] {
  const maintenance = config.userContext.userModel.maintenance;
  if (!config.userContext.enabled || !config.userContext.userModel.enabled || !maintenance.enabled) return [];
  const timezone = maintenance.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  return [
    {
      jobType: 'temporal_sweep',
      automationId: 'system-memory-temporal-sweep',
      name: 'Memory temporal sweep',
      cron: `*/${maintenance.temporalSweepMinutes} * * * *`,
      timezone,
    },
    {
      jobType: 'daily_reconciliation',
      automationId: 'system-memory-daily-reconciliation',
      name: 'Memory daily reconciliation',
      cron: cronAt(maintenance.dailyTime),
      timezone,
    },
    {
      jobType: 'weekly_knowledge',
      automationId: 'system-memory-weekly-knowledge',
      name: 'Memory weekly knowledge maintenance',
      cron: cronAt(maintenance.weeklyTime, WEEKDAY[maintenance.weeklyDay]),
      timezone,
    },
  ];
}

export function maintenanceInstruction(jobType: MemoryMaintenanceSchedule['jobType']): string {
  return `${MEMORY_MAINTENANCE_TOKEN}:${jobType}`;
}

export function parseMaintenanceInstruction(value: string): MemoryMaintenanceSchedule['jobType'] | undefined {
  const match = new RegExp(`${MEMORY_MAINTENANCE_TOKEN}:(temporal_sweep|daily_reconciliation|weekly_knowledge)`).exec(value);
  return match?.[1] as MemoryMaintenanceSchedule['jobType'] | undefined;
}
