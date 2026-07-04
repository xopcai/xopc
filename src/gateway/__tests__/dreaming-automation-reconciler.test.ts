import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentManifest } from '../../agent-manifest/index.js';
import { AutomationService } from '../../automations/index.js';
import type { AutomationTrigger } from '../../automations/domain/types.js';
import type { Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { reconcileDreamingAutomations } from '../dreaming-automation-reconciler.js';

function manifest(id: string, workspaceDir: string, memory: AgentManifest['memory']): AgentManifest {
  return {
    id,
    enabled: true,
    identity: { name: id, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help'] },
    workspace: { root: workspaceDir },
    models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
    tools: { builtin: {} },
    skills: { mode: 'all' },
    memory,
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
  };
}

function config(workspaceDir: string, dreamingEnabled: boolean): Config {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: {
      default: 'main',
      capabilityPresets: {},
      list: [
        manifest('main', workspaceDir, {
          mode: 'confirmWrite',
          sources: ['session', 'curated', 'workspace'],
          writePolicy: { curated: 'confirm', workspace: 'confirm' },
          dreaming: {
            enabled: dreamingEnabled,
            timezone: 'Asia/Shanghai',
            phases: {
              light: { enabled: true, cron: '0 */6 * * *' },
              deep: { enabled: true, cron: '0 3 * * *', minScore: 0.8, minRecallCount: 3, limit: 10 },
              rem: { enabled: false, cron: '0 5 * * 0' },
            },
          },
        }),
      ],
    },
    channels: {},
  } as Config;
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

  it('creates and updates built-in dreaming automations from memory.dreaming', async () => {
    const created = await reconcileDreamingAutomations({
      config: config(workspaceDir, true),
      automationService: service,
    });
    expect(created.created).toEqual(['system-dreaming-light', 'system-dreaming-deep', 'system-dreaming-rem']);

    const deep = await service.get('system-dreaming-deep');
    const rem = await service.get('system-dreaming-rem');
    expect(deep).toMatchObject({
      enabled: true,
      action: { kind: 'agent', agentId: 'main', workingDirectory: workspaceDir },
      safety: { mode: 'auto_apply' },
    });
    expect(cronExpr(deep!.trigger)).toBe('0 3 * * *');
    expect(rem?.enabled).toBe(false);

    const nextConfig = config(workspaceDir, true);
    const memory = nextConfig.agents.list[0]!.memory!;
    memory.dreaming!.phases!.deep = { ...memory.dreaming!.phases!.deep, cron: '30 2 * * *' };
    memory.dreaming!.phases!.rem = { ...memory.dreaming!.phases!.rem, enabled: true };
    const updated = await reconcileDreamingAutomations({
      config: nextConfig,
      automationService: service,
    });
    expect(updated.updated).toEqual(['system-dreaming-deep', 'system-dreaming-rem']);
    expect(cronExpr((await service.get('system-dreaming-deep'))!.trigger)).toBe('30 2 * * *');
    expect((await service.get('system-dreaming-rem'))?.enabled).toBe(true);
  });

  it('disables existing dreaming automations when dreaming is turned off', async () => {
    await reconcileDreamingAutomations({ config: config(workspaceDir, true), automationService: service });
    const disabled = await reconcileDreamingAutomations({
      config: config(workspaceDir, false),
      automationService: service,
    });

    expect(disabled.disabled).toEqual(['system-dreaming-light', 'system-dreaming-deep']);
    expect((await service.get('system-dreaming-light'))?.enabled).toBe(false);
    expect((await service.get('system-dreaming-deep'))?.enabled).toBe(false);
    expect((await service.get('system-dreaming-rem'))?.enabled).toBe(false);
  });
});
