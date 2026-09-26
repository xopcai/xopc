import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AutomationTrigger } from '../../automations/domain/types.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { AutomationService } from '../../automations/index.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { reconcileMemoryMaintenanceAutomations } from '../memory-maintenance-automation-reconciler.js';

function config(workspace: string, enabled = true): Config {
  const repository = new AgentCatalogRepository();
  const main = repository.get('main')!;
  repository.update('main', main.revision, { id: 'main', enabled: true, profile: { name: 'main' }, workspace });
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({
    ...base,
    userContext: {
      ...base.userContext,
      userModel: {
        ...base.userContext.userModel,
        maintenance: {
          ...base.userContext.userModel.maintenance,
          enabled,
          timezone: 'Asia/Shanghai',
          dailyTime: '02:30',
        },
      },
    },
  });
}

function cron(trigger: AutomationTrigger): string {
  return trigger.kind === 'schedule' && trigger.schedule.kind === 'cron' ? trigger.schedule.expr : '';
}

describe('memory maintenance automation reconciliation', () => {
  let stateDir: string;
  let service: AutomationService;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-memory-maintenance-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    seedTestAgentCatalog();
    service = new AutomationService();
    await service.initialize();
  });

  afterEach(async () => {
    await service.stop();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates hourly, daily, and weekly deterministic jobs', async () => {
    const result = await reconcileMemoryMaintenanceAutomations({
      config: config(join(stateDir, 'workspace')),
      automationService: service,
    });
    expect(result.created).toBe(3);
    expect(cron((await service.get('system-memory-temporal-sweep'))!.trigger)).toBe('*/60 * * * *');
    expect(cron((await service.get('system-memory-daily-reconciliation'))!.trigger)).toBe('30 2 * * *');
    expect(cron((await service.get('system-memory-weekly-knowledge'))!.trigger)).toBe('0 4 * * 0');
    expect(await service.get('system-memory-temporal-sweep')).toMatchObject({
      action: { kind: 'system', capability: 'memory.temporal_sweep' },
      management: { owner: 'memory-maintenance', editable: ['enabled', 'trigger'], runnable: true, deletable: false },
    });
  });

  it('disables every built-in job when maintenance is off', async () => {
    const workspace = join(stateDir, 'workspace');
    await reconcileMemoryMaintenanceAutomations({ config: config(workspace), automationService: service });
    const result = await reconcileMemoryMaintenanceAutomations({
      config: config(workspace, false),
      automationService: service,
    });
    expect(result.disabled).toBe(3);
  });

  it('preserves user-owned pause and schedule after the first reconciliation', async () => {
    const workspace = join(stateDir, 'workspace');
    await reconcileMemoryMaintenanceAutomations({ config: config(workspace), automationService: service });
    await service.update('system-memory-temporal-sweep', {
      enabled: false,
      trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: 7_200_000 } },
    });
    await reconcileMemoryMaintenanceAutomations({ config: config(workspace), automationService: service });
    expect(await service.get('system-memory-temporal-sweep')).toMatchObject({
      enabled: false,
      trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: 7_200_000 } },
    });
  });
});
