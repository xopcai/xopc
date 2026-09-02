import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { ManagedComposioEventPoller } from '../composio-managed-events.js';
import { listComposioTriggerEvents } from '../composio-triggers.js';

describe('ManagedComposioEventPoller', () => {
  let stateDir: string;
  let config: Config;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-managed-events-'));
    process.env.XOPC_WORKSPACE = stateDir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    config = {
      agents: { list: [] },
      connectors: {
        instances: {
          'composio-gmail': {
            connectorId: 'composio-gmail',
            runtime: { type: 'composio', role: 'toolkit', toolkit: 'gmail' },
          },
        },
      },
    } as unknown as Config;
  });

  afterEach(() => {
    delete process.env.XOPC_WORKSPACE;
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('archives and dispatches each platform event only once across poller restarts', async () => {
    const event = {
      sequence: 7,
      id: 'webhook_7',
      type: 'composio.trigger.message',
      toolkit: 'gmail',
      payload: {
        type: 'composio.trigger.message',
        metadata: { toolkit_slug: 'gmail', trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE' },
        data: { subject: 'hello' },
      },
      createdAt: new Date().toISOString(),
    };
    const client = { events: vi.fn(async () => ({ items: [event], nextCursor: 7 })) };
    const triggerAutomation = vi.fn(async () => []);
    const options = {
      getConfig: () => config,
      triggerAutomation,
      requestLearning: vi.fn(),
      setLearningPaused: vi.fn(),
      client,
      hasByok: vi.fn(async () => false),
    };
    await new ManagedComposioEventPoller(options).sync();
    await new ManagedComposioEventPoller(options).sync();

    expect(triggerAutomation).toHaveBeenCalledTimes(1);
    expect(triggerAutomation).toHaveBeenCalledWith(expect.objectContaining({
      type: 'connector.GMAIL_NEW_GMAIL_MESSAGE', source: 'composio:gmail',
    }));
    await expect(listComposioTriggerEvents(config)).resolves.toEqual([
      expect.objectContaining({ id: 'webhook_7', toolkit: 'gmail' }),
    ]);
  });

  it('does not poll the platform when BYOK is active', async () => {
    const client = { events: vi.fn(async () => ({ items: [], nextCursor: 0 })) };
    await new ManagedComposioEventPoller({
      getConfig: () => config,
      triggerAutomation: vi.fn(async () => []),
      requestLearning: vi.fn(),
      setLearningPaused: vi.fn(),
      client,
      hasByok: vi.fn(async () => true),
    }).sync();
    expect(client.events).not.toHaveBeenCalled();
  });
});
