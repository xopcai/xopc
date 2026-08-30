import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createUnderstanding,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  searchActiveUnderstandings,
} from '../../../storage/sqlite/index.js';
import { UserContextPlanner } from '../../planner.js';
import { evaluateRetrievalCases } from '../harness.js';

function message(text: string): AgentMessage {
  return { role: 'user', content: text } as AgentMessage;
}

describe('user-context retrieval evaluation baseline', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-context-eval-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('passes bilingual, temporal, scope, and abstention cases without embeddings', () => {
    const project = createUnderstanding({
      kind: 'project_context', canonicalKey: 'eval:project', status: 'active',
      scope: { type: 'workspace', id: '/repo/xopc' }, explicitness: 'explicit', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
      statement: 'The xopc release uses the canary checklist.', createdBy: 'user', changeReason: 'eval',
    });
    const chinese = createUnderstanding({
      kind: 'preference', canonicalKey: 'eval:zh', status: 'active', scope: { type: 'global' },
      explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 1, statement: '低风险修改可以直接处理，不必反复询问。', createdBy: 'user', changeReason: 'eval',
    });
    const historical = createUnderstanding({
      kind: 'current_state', canonicalKey: 'eval:historical', status: 'archived', scope: { type: 'global' },
      explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 1, statement: 'The previous release meeting was on Monday.', validTo: Date.now() - 1_000,
      createdBy: 'user', changeReason: 'eval',
    });
    const current = createUnderstanding({
      kind: 'current_state', canonicalKey: 'eval:current', status: 'active', scope: { type: 'global' },
      explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 1, statement: 'The current release meeting is on Friday.', validFrom: Date.now() - 500,
      createdBy: 'user', changeReason: 'eval',
    });
    createUnderstanding({
      kind: 'project_context', canonicalKey: 'eval:other-scope', status: 'active',
      scope: { type: 'workspace', id: '/repo/other' }, explicitness: 'explicit', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
      statement: 'The xopc release uses an unsafe production shortcut.', createdBy: 'user', changeReason: 'eval',
    });

    let turn = 0;
    const plannerRetrieve = (query: string) => () => {
      const ids = new UserContextPlanner().plan({
      sessionKey: 'agent:main:webchat:default:direct:eval', workspaceId: '/repo/xopc',
      turnId: `eval-turn-${turn += 1}`, query, userMessage: message(query),
      }).items.map((item) => item.recordId);
      return ids;
    };
    const cases = [
      { id: 'project', expectedIds: [project.id], query: 'Use the xopc canary release checklist' },
      { id: 'zh', expectedIds: [chinese.id], query: '低风险操作直接执行' },
      { id: 'historical', expectedIds: [historical.id], query: 'When was the meeting before?' },
      { id: 'current', expectedIds: [current.id], query: 'What is the current meeting schedule?' },
      { id: 'abstain', expectedIds: [], shouldAbstain: true, query: 'Explain photosynthesis in seaweed' },
    ];
    const metrics = evaluateRetrievalCases(cases.map((item) => ({
      ...item,
      retrieve: plannerRetrieve(item.query),
    })), 3);
    const ftsBaseline = evaluateRetrievalCases(cases.map((item) => ({
      ...item,
      retrieve: () => searchActiveUnderstandings(item.query, 3)
        .map((result) => result.understanding.id),
    })), 3);

    expect(metrics).toEqual({ cases: 5, recallAtK: 1, precisionAtK: 1, abstentionAccuracy: 1 });
    expect(metrics.recallAtK - ftsBaseline.recallAtK).toBeGreaterThanOrEqual(0.2);
    expect(metrics.precisionAtK).toBeGreaterThanOrEqual(ftsBaseline.precisionAtK);
  });
});
