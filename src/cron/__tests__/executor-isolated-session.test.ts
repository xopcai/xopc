import { describe, expect, it, vi } from 'vitest';

import { DefaultJobExecutor } from '../executor.js';
import type { JobData } from '../types.js';

function createAgentTurnJob(): JobData {
  return {
    id: 'template-job',
    name: 'Template job',
    schedule: { kind: 'cron', expr: '*/5 * * * *' },
    enabled: true,
    createdAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
    updatedAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: { kind: 'agentTurn', message: 'Check status' },
    delivery: { mode: 'none' },
    state: {},
  };
}

describe('DefaultJobExecutor isolated agent sessions', () => {
  it('uses a fresh cron session key for each isolated run', async () => {
    const sessionKeys: string[] = [];
    const agentService = {
      sessionConfig: {
        applyCronJobWorkingDirectory: vi.fn(async () => {}),
        applyCronJobModelOverride: vi.fn(async () => true),
      },
      turnDispatcher: {
        processDirect: vi.fn(async (_message: string, sessionKey: string) => {
          sessionKeys.push(sessionKey);
          return 'done';
        }),
      },
      getModelForSession: vi.fn(() => 'test/model'),
    };
    const executor = new DefaultJobExecutor();
    const job = createAgentTurnJob();

    await executor.execute(job, new AbortController().signal, {
      agentService,
      messageBus: { publishOutbound: vi.fn() },
      getDefaultCronAgentId: () => 'main',
    });
    await executor.execute(job, new AbortController().signal, {
      agentService,
      messageBus: { publishOutbound: vi.fn() },
      getDefaultCronAgentId: () => 'main',
    });

    expect(sessionKeys).toHaveLength(2);
    expect(sessionKeys[0]).toMatch(/^agent:main:cron:default:direct:template-job-/);
    expect(sessionKeys[1]).toMatch(/^agent:main:cron:default:direct:template-job-/);
    expect(sessionKeys[0]).not.toBe(sessionKeys[1]);
  });
});
