import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AutomationService } from '../../automations/index.js';
import type { AutomationTrigger } from '../../automations/domain/types.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { reconcileDreamingAutomations } from '../dreaming-automation-reconciler.js';

function config(workspaceDir: string, dreamingEnabled: boolean): Config {
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({
    ...base,
    userContext: {
      ...base.userContext,
      memory: {
        ...base.userContext.memory,
        mode: 'auto',
        writePolicy: { ...base.userContext.memory.writePolicy, understanding: 'allow' },
      },
      dreaming: {
        ...base.userContext.dreaming,
        mode: dreamingEnabled ? 'automatic' : 'off',
        timezone: 'Asia/Shanghai',
        phases: {
          light: { enabled: true, schedule: { kind: 'interval', everyHours: 6, minute: 0 } },
          deep: { enabled: true, schedule: { kind: 'daily', time: '03:00' }, minScore: 0.8, minRecallCount: 3, limit: 10 },
          rem: { enabled: false, schedule: { kind: 'weekly', weekday: 0, time: '05:00' } },
        },
      },
    },
    agents: {
      ...base.agents,
      default: 'main',
      capabilityPresets: {},
      list: [
        {
          id: 'main',
          enabled: true,
          identity: { name: 'main', role: 'Agent', language: 'en', tone: 'direct' },
          responsibilities: { primary: ['Help'] },
          workspace: { root: workspaceDir },
          models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
          tools: { builtin: {} },
          skills: { mode: 'all' },
          workflows: {},
          boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
        },
      ],
    },
  });
}

function cronExpr(trigger: AutomationTrigger): string {
  expect(trigger.kind).toBe('schedule');
  if (trigger.kind !== 'schedule') return '';
  expect(trigger.schedule.kind).toBe('cron');
  return trigger.schedule.kind === 'cron' ? trigger.schedule.expr : '';
}

describe('reconcileDreamingAutomations', () => {
  let stateDir: string;
  let workspaceDir: string;
  let service: AutomationService;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-dreaming-automation-'));
    workspaceDir = join(stateDir, 'workspace');
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    service = new AutomationService();
    await service.initialize();
  });

  afterEach(async () => {
    await service.stop();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates and updates one global set of dreaming automations', async () => {
    const created = await reconcileDreamingAutomations({
      config: config(workspaceDir, true),
      automationService: service,
    });
    expect(created.created).toEqual(['system-user-context-dreaming:light', 'system-user-context-dreaming:deep', 'system-user-context-dreaming:rem']);

    const deep = await service.get('system-user-context-dreaming:deep');
    const rem = await service.get('system-user-context-dreaming:rem');
    expect(deep).toMatchObject({
      enabled: true,
      action: { kind: 'agent', agentId: 'main', workingDirectory: workspaceDir },
      safety: { mode: 'auto_apply' },
    });
    expect(cronExpr(deep!.trigger)).toBe('0 3 * * *');
    expect(rem?.enabled).toBe(false);

    const nextConfig = config(workspaceDir, true);
    nextConfig.userContext.dreaming.phases.deep = {
      ...nextConfig.userContext.dreaming.phases.deep,
      schedule: { kind: 'daily', time: '02:30' },
    };
    nextConfig.userContext.dreaming.phases.rem = { ...nextConfig.userContext.dreaming.phases.rem, enabled: true };
    const updated = await reconcileDreamingAutomations({
      config: nextConfig,
      automationService: service,
    });
    expect(updated.updated).toEqual(['system-user-context-dreaming:deep', 'system-user-context-dreaming:rem']);
    expect(cronExpr((await service.get('system-user-context-dreaming:deep'))!.trigger)).toBe('30 2 * * *');
    expect((await service.get('system-user-context-dreaming:rem'))?.enabled).toBe(true);
  });

  it('disables existing dreaming automations when dreaming is turned off', async () => {
    await reconcileDreamingAutomations({ config: config(workspaceDir, true), automationService: service });
    const disabled = await reconcileDreamingAutomations({
      config: config(workspaceDir, false),
      automationService: service,
    });

    expect(disabled.disabled).toEqual(['system-user-context-dreaming:light', 'system-user-context-dreaming:deep']);
    expect((await service.get('system-user-context-dreaming:light'))?.enabled).toBe(false);
    expect((await service.get('system-user-context-dreaming:deep'))?.enabled).toBe(false);
    expect((await service.get('system-user-context-dreaming:rem'))?.enabled).toBe(false);
  });

});
