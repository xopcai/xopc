import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AutomationService } from '../../automations/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import {
  HOME_ADVISOR_REFRESH_AUTOMATION_ID,
  reconcileHomeIntelligenceAutomation,
} from '../home-intelligence-automation-reconciler.js';

describe('home intelligence automation reconciliation', () => {
  let directory: string;
  let service: AutomationService;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-home-intelligence-automation-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    service = new AutomationService();
    await service.initialize();
  });

  afterEach(async () => {
    await service.stop();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates one protected periodic refresh automation disabled by default', async () => {
    expect(await reconcileHomeIntelligenceAutomation(service)).toBe('created');
    expect(await service.get(HOME_ADVISOR_REFRESH_AUTOMATION_ID)).toMatchObject({
      enabled: false,
      trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: 1_800_000 } },
      action: { kind: 'system', capability: 'home.advisor.refresh' },
      management: {
        owner: 'home-intelligence',
        editable: ['enabled', 'trigger'],
        runnable: true,
        deletable: false,
      },
    });
    expect(await reconcileHomeIntelligenceAutomation(service)).toBe('unchanged');
  });

  it('preserves the user enabled state and schedule while repairing runtime-owned fields', async () => {
    await reconcileHomeIntelligenceAutomation(service);
    const customTrigger = { kind: 'schedule' as const, schedule: { kind: 'interval' as const, everyMs: 3_600_000 } };
    await service.update(HOME_ADVISOR_REFRESH_AUTOMATION_ID, {
      enabled: true,
      trigger: customTrigger,
      name: 'Tampered name',
    });
    expect(await reconcileHomeIntelligenceAutomation(service)).toBe('updated');
    expect(await service.get(HOME_ADVISOR_REFRESH_AUTOMATION_ID)).toMatchObject({
      enabled: true,
      trigger: customTrigger,
      name: 'Refresh Home AI suggestions',
    });
  });
});
