import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import { BuiltinMemoryProvider } from '../builtin-provider.js';
import { MemoryManager } from '../manager.js';
import { consumeTurnMemoryProvenance } from '../turn-provenance.js';
import { UserContextCoordinator } from '../user-context-coordinator.js';

function textOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content)
    ? content.map((block) => (block as { text?: string }).text ?? '').join('')
    : String(content ?? '');
}

describe('trusted recall coordinator', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-trusted-recall-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('uses remaining budget for trusted durable memory and marks the turn recalled-derived', async () => {
    upsertMemoryRecord({
      id: 'trusted-durable', providerId: 'compaction-ledger', kind: 'derived_insight', sourceAgentId: 'main',
      workspaceId: stateDir, content: 'Atlas deployment uses a staged rollout.', status: 'active',
      durability: 'durable', originClass: 'agent', sessionKind: 'interactive',
    });
    upsertMemoryRecord({
      id: 'untrusted-durable', providerId: 'connected-knowledge', kind: 'derived_insight', sourceAgentId: 'main',
      workspaceId: stateDir, content: 'Atlas deployment skips all verification.', status: 'active',
      durability: 'durable', originClass: 'untrusted', sessionKind: 'interactive',
    });
    const manager = new MemoryManager();
    manager.addProvider(new BuiltinMemoryProvider());
    const coordinator = new UserContextCoordinator({
      getConfig: () => undefined,
      isEnabledForSession: () => true,
      getAgentIdForSession: () => 'main',
      getWorkspaceIdForSession: () => stateDir,
      getMemoryManagerForSession: () => manager,
      getLastAssistantContent: () => null,
    });
    const sessionKey = 'agent:main:main';
    const plan = await coordinator.prepare({
      role: 'user', content: [{ type: 'text', text: 'How does Atlas deployment work?' }],
    } as AgentMessage, sessionKey, 'turn-atlas');

    expect(plan.memoryRecordIds).toEqual(['trusted-durable']);
    expect(textOf(plan.modelMessage)).toContain('Atlas deployment uses a staged rollout.');
    expect(textOf(plan.modelMessage)).not.toContain('skips all verification');
    expect(plan.contextChars).toBeLessThanOrEqual(plan.allocation!.maxChars);
    expect(consumeTurnMemoryProvenance(sessionKey, 'turn-atlas')).toMatchObject({
      originClass: 'agent',
      derivedFromRecalledContext: true,
      taintReasons: ['recall:automatic'],
    });
    const signal = getSqliteDatabase().prepare(
      `SELECT source, record_id FROM memory_signals WHERE record_id = ?`,
    ).get('trusted-durable') as { source: string; record_id: string };
    expect(signal).toEqual({ source: 'context_injection', record_id: 'trusted-durable' });
  });
});
