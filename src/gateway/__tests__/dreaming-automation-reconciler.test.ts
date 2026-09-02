import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AutomationService } from '../../automations/index.js';
import type { AutomationTrigger } from '../../automations/domain/types.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import {
  closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID } from '../../user-context/consolidation.js';
import { reconcileDreamingAutomations } from '../dreaming-automation-reconciler.js';

function config(workspaceDir: string, enabled = true, time = '03:00'): Config {
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({
    ...base,
    userContext: {
      ...base.userContext,
      dreaming: { ...base.userContext.dreaming, mode: enabled ? 'review' : 'off', timezone: 'Asia/Shanghai', schedule: { time } },
    },
    agents: {
      ...base.agents,
      default: 'main',
      list: [{
        id: 'main', enabled: true,
        profile: { name: 'main' },
        workspace: workspaceDir,
      }],
    },
  });
}

function cronExpr(trigger: AutomationTrigger): string {
  if (trigger.kind !== 'schedule' || trigger.schedule.kind !== 'cron') return '';
  return trigger.schedule.expr;
}

describe('structured user context automation', () => {
  let stateDir: string;
  let workspaceDir: string;
  let service: AutomationService;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-context-review-automation-'));
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

  it('creates and updates one review-only automation', async () => {
    expect((await reconcileDreamingAutomations({ config: config(workspaceDir), automationService: service })).created).toBe(true);
    const created = await service.get(USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID);
    expect(created).toMatchObject({
      enabled: true,
      action: { kind: 'agent', agentId: 'main', workingDirectory: workspaceDir },
      safety: { mode: 'auto_apply' },
    });
    expect(cronExpr(created!.trigger)).toBe('0 3 * * *');

    expect((await reconcileDreamingAutomations({ config: config(workspaceDir, true, '02:30'), automationService: service })).updated).toBe(true);
    expect(cronExpr((await service.get(USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID))!.trigger)).toBe('30 2 * * *');
  });

  it('disables the automation when review is off', async () => {
    await reconcileDreamingAutomations({ config: config(workspaceDir), automationService: service });
    expect((await reconcileDreamingAutomations({ config: config(workspaceDir, false), automationService: service })).disabled).toBe(true);
    expect((await service.get(USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID))?.enabled).toBe(false);
  });
});
