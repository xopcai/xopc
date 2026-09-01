import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { MemoryManager } from '../../../agent/memory/manager.js';
import {
  closeXopcDatabase,
  createUnderstanding,
  getUnderstanding,
  isUnderstandingSuppressed,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { executeUnderstandingInterpretation } from '../executor.js';
import { claimRegisteredExtraction } from '../registry.js';
import type { SemanticUnderstandingInterpretation } from '../semantic.js';

const evidence = [{
  ref: 'user-entry',
  role: 'user' as const,
  text: '请记住：我的长期目标是把 xopc 推进到正式上线。',
  createdAt: Date.now(),
  message: { role: 'user', content: '请记住：我的长期目标是把 xopc 推进到正式上线。' },
}];

function config(policy: 'deny' | 'confirm' | 'allow'): Config {
  return { userContext: { memory: {
    mode: policy === 'allow' ? 'auto' : 'confirmWrite',
    writePolicy: { understanding: policy },
  } } } as Config;
}

function interpretation(overrides: Partial<SemanticUnderstandingInterpretation> = {}): SemanticUnderstandingInterpretation {
  return {
    intent: 'memory_create',
    targetUnderstandingIds: [],
    candidates: [{
      kind: 'long_term_goal',
      content: '把 xopc 推进到正式上线',
      confidence: 0.98,
      importance: 0.9,
      explicitness: 'explicit',
      durability: 'durable',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
      evidenceRefs: ['user-entry'],
    }],
    ...overrides,
  };
}

describe('semantic understanding executor', () => {
  let stateDir: string;
  let memoryManager: MemoryManager;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-understanding-executor-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    memoryManager = new MemoryManager();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  async function execute(value: SemanticUnderstandingInterpretation, policy: 'deny' | 'confirm' | 'allow' = 'confirm') {
    const extraction = claimRegisteredExtraction({
      extractorId: 'turn-semantics',
      sourceRef: `turn:${crypto.randomUUID()}`,
      contentForHash: JSON.stringify(value),
      processingPolicy: 'remote_allowed',
      destination: 'remote_model',
    });
    return executeUnderstandingInterpretation({
      interpretation: value,
      evidence,
      extractionRunId: extraction.run.id,
      extractorId: 'turn-semantics',
      sessionKey: 'agent:main:webchat:executor',
      memoryManager,
      getConfig: () => config(policy),
      reviewSource: 'turn',
      processingPolicy: 'remote_allowed',
    });
  }

  it('honors deny, confirm, and allow write policies', async () => {
    expect(await execute(interpretation(), 'deny')).toMatchObject({ created: 0, rejected: 1 });
    const confirmed = await execute(interpretation(), 'confirm');
    expect(getUnderstanding(confirmed.createdRecords[0]!.id)).toMatchObject({ status: 'candidate', explicitness: 'observed' });

    const allowed = await execute(interpretation({ candidates: [{
      ...interpretation().candidates[0]!, content: '正式发布 xopc 2.0',
    }] }), 'allow');
    expect(getUnderstanding(allowed.createdRecords[0]!.id)).toMatchObject({ status: 'active', explicitness: 'explicit' });
  });

  it('marks a pure correction for review without inventing a replacement', async () => {
    const target = createUnderstanding({
      kind: 'long_term_goal', canonicalKey: 'goal:wrong', status: 'active', scope: { type: 'global' },
      explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 1, statement: '错误的长期目标', createdBy: 'runtime', changeReason: 'test',
    });
    await execute(interpretation({ intent: 'memory_correct', candidates: [], targetUnderstandingIds: [target.id] }));
    expect(getUnderstanding(target.id)?.status).toBe('needs_review');
  });

  it('rejects and suppresses an explicitly forgotten understanding', async () => {
    const target = createUnderstanding({
      kind: 'preference', canonicalKey: 'preference:forgotten', status: 'active', scope: { type: 'global' },
      explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 1, statement: '偏好简短回答', createdBy: 'runtime', changeReason: 'test',
    });
    await execute(interpretation({ intent: 'memory_forget', candidates: [], targetUnderstandingIds: [target.id] }), 'deny');
    expect(getUnderstanding(target.id)?.status).toBe('rejected');
    expect(isUnderstandingSuppressed(target.canonicalKey, target.scope)).toBe(true);
  });

  it('activates a candidate only after an explicit confirmation', async () => {
    const target = createUnderstanding({
      kind: 'preference', canonicalKey: 'preference:confirm', status: 'candidate', scope: { type: 'global' },
      explicitness: 'observed', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 0.8, statement: '偏好详细解释', createdBy: 'runtime', changeReason: 'test',
    });
    await execute(interpretation({ intent: 'memory_confirm', candidates: [], targetUnderstandingIds: [target.id] }), 'confirm');
    expect(getUnderstanding(target.id)).toMatchObject({ status: 'active', explicitness: 'explicit', confidence: 1 });
  });
});
