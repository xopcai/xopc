import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { AutomationService } from '../../../automations/service/automation-service.js';
import { ConfigSchema } from '../../../config/schema.js';
import { createPersonalScheduleTool } from '../personal-schedule-tool.js';
import { personalAgentId, personalConversationId } from '../../../personal-agent/repository.js';
import { setSessionConfig } from '../../../storage/sqlite/config-repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';

describe('personal_schedule tool', () => {
  let dir: string;
  let automationService: AutomationService;
  let conversationId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-personal-schedule-tool-'));
    vi.stubEnv('XOPC_STATE_DIR', dir);
    vi.stubEnv('XOPC_LOG_FILE', 'false');
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    const config = ConfigSchema.parse({});
    const agentId = personalAgentId('local-owner');
    conversationId = personalConversationId('local-owner');
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    catalog.create({ id: agentId, profile: { name: 'Ada', emoji: '◉' }, runtime: { thinkingLevel: 'off' } }, { ready: true });
    createConversation({
      agentId,
      sourceChannel: 'webchat',
      name: 'Ada',
      hiddenFromSessionList: true,
      customData: { personalAgent: true, keepHiddenFromSessionList: true },
    }, dir, conversationId);
    setSessionConfig(conversationId, { modelOverride: 'test/fast', fixedModel: true, thinkingLevel: 'off' }, dir);
    automationService = new AutomationService({
      getConfig: () => config,
      executeAgentAction: vi.fn().mockResolvedValue({ summary: 'ok', outputText: 'ok' }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates, lists, updates, pauses, resumes, and deletes personal schedules while isolating non-personal automations', async () => {
    const otherAutomation = await automationService.create({
      name: 'Other Automation',
      trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Shanghai' } },
      action: { kind: 'agent', instruction: 'Other work' },
    });

    const tool = createPersonalScheduleTool({
      getAutomationService: () => automationService,
      getCurrentConversationId: () => conversationId,
    });

    const created = await tool.execute('call-1', {
      command: 'create',
      name: 'Daily AI Briefing',
      instruction: 'Summarize top AI news from the last 24 hours.',
      schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' },
    });
    expect(created.details.ok).toBe(true);
    const createdSchedule = created.details.schedule as { id: string; enabled: boolean; revision: number; nextRunAt: string | null };
    expect(createdSchedule.id).toBeTruthy();
    expect(createdSchedule.enabled).toBe(true);
    expect(createdSchedule.nextRunAt).toBeTruthy();

    const listed = await tool.execute('call-2', { command: 'list' });
    const schedules = listed.details.schedules as Array<{ id: string }>;
    expect(schedules.map(s => s.id)).toEqual([createdSchedule.id]);
    expect(schedules.map(s => s.id)).not.toContain(otherAutomation.id);

    const forbiddenGet = await tool.execute('call-3', { command: 'get', scheduleId: otherAutomation.id });
    expect(forbiddenGet.details.ok).toBe(false);

    const paused = await tool.execute('call-4', { command: 'pause', scheduleId: createdSchedule.id });
    expect(paused.details.ok).toBe(true);
    expect((paused.details.schedule as { enabled: boolean }).enabled).toBe(false);

    const resumed = await tool.execute('call-5', { command: 'resume', scheduleId: createdSchedule.id });
    expect(resumed.details.ok).toBe(true);
    expect((resumed.details.schedule as { enabled: boolean }).enabled).toBe(true);

    const updated = await tool.execute('call-6', {
      command: 'update',
      scheduleId: createdSchedule.id,
      name: 'Morning AI Digest',
      schedule: { kind: 'once', afterMs: 300_000 },
    });
    expect(updated.details.ok).toBe(true);
    expect((updated.details.schedule as { name: string }).name).toBe('Morning AI Digest');

    const deleted = await tool.execute('call-7', { command: 'delete', scheduleId: createdSchedule.id });
    expect(deleted.details.ok).toBe(true);

    const listedAfter = await tool.execute('call-8', { command: 'list' });
    expect(listedAfter.details.schedules).toEqual([]);
  });
});
