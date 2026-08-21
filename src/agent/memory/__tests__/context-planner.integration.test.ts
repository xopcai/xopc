import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import { BuiltinMemoryProvider } from '../builtin-provider.js';
import { UserContextPlanner } from '../context/planner.js';
import { MemoryManager } from '../manager.js';

describe('user context recall integration', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-user-context-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('recalls confirmed local understanding even when its provenance names another source', async () => {
    upsertMemoryRecord({
      id: 'confirmed-understanding',
      providerId: 'local',
      kind: 'derived_insight',
      sourceAgentId: 'main',
      content: 'Often investigates the mechanism before deciding whether a proposal is sound.',
      source: { provider: 'personal-context' },
      confidence: 0.75,
      tags: ['user-understanding', 'user-confirmed'],
      status: 'active',
      explicitness: 'inferred',
      durability: 'durable',
      importance: 0.6,
      disclosurePolicy: 'referenceable',
    });
    const memoryManager = new MemoryManager({ searchStrategy: 'local-only' });
    memoryManager.addProvider(new BuiltinMemoryProvider());
    await memoryManager.initializeAll('session-1', { agentId: 'main' });

    const plan = await new UserContextPlanner().plan({
      memoryManager,
      agentId: 'main',
      sessionKey: 'session-1',
      turnId: 'turn-1',
      query: '介绍下你认知的我',
      userMessage: { role: 'user', content: '介绍下你认知的我' } as AgentMessage,
    });

    expect(plan.items).toEqual([
      expect.objectContaining({ recordId: 'confirmed-understanding' }),
    ]);
    expect(String(plan.modelMessage.content)).toContain('mechanism before deciding');
  });
});
