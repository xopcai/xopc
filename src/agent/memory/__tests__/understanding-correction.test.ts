import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  createUnderstanding,
  getSqliteDatabase,
  getUnderstanding,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { UserContextCoordinator } from '../user-context-coordinator.js';
import type { MemoryManager } from '../manager.js';
import {
  extractExplicitUnderstandingCorrectionContent,
  isExplicitUnderstandingCorrection,
} from '../understanding/correction.js';

describe('isExplicitUnderstandingCorrection', () => {
  it.each([
    '你记错了我的偏好，我喜欢简洁回答。',
    '这不是我的习惯，请改掉。',
    'You remembered my preference wrong.',
    "I never said that about my work style.",
  ])('recognizes explicit corrections about the user: %s', (text) => {
    expect(isExplicitUnderstandingCorrection(text)).toBe(true);
  });

  it.each([
    '这个代码不对，请重新实现。',
    'The command failed, try another approach.',
    '我不喜欢这个页面的颜色。',
  ])('does not turn ordinary task feedback into memory feedback: %s', (text) => {
    expect(isExplicitUnderstandingCorrection(text)).toBe(false);
  });
});

describe('extractExplicitUnderstandingCorrectionContent', () => {
  it('extracts a concrete replacement without inventing one for a pure denial', () => {
    expect(extractExplicitUnderstandingCorrectionContent('你记错了我的偏好，我更喜欢详细解释。'))
      .toBe('我更喜欢详细解释。');
    expect(extractExplicitUnderstandingCorrectionContent(
      'You remembered my preference wrong; I prefer detailed explanations.',
    )).toBe('I prefer detailed explanations.');
    expect(extractExplicitUnderstandingCorrectionContent('我从没说过这个。')).toBeNull();
  });
});

describe('understanding correction attribution', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-understanding-correction-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('marks the previous context trace before planning the correction turn', async () => {
    const sessionKey = 'agent:main:webchat:correction';
    const previous = createUnderstanding({
      kind: 'preference',
      status: 'active',
      canonicalKey: 'preference:concise',
      scope: { type: 'global' },
      explicitness: 'explicit',
      durability: 'durable',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
      confidence: 0.9,
      statement: 'Prefer concise answers.',
      createdBy: 'user',
      changeReason: 'test setup',
    });
    const captureTurnUnderstanding = vi.fn().mockResolvedValue(undefined);
    const memoryManager = {
      search: async () => [],
      list: async () => [],
      captureTurnUnderstanding,
      syncProvidersForTurn: vi.fn().mockResolvedValue(undefined),
      queuePrefetchAll: vi.fn(),
    } as unknown as MemoryManager;
    const coordinator = new UserContextCoordinator({
      getConfig: () => undefined,
      isEnabledForSession: () => true,
      getAgentIdForSession: () => 'main',
      getWorkspaceIdForSession: () => '/workspace/project',
      getProjectIdForSession: () => 'project-1',
      getMemoryManagerForSession: () => memoryManager,
      getLastAssistantContent: () => null,
    });

    await coordinator.prepare({
      role: 'user',
      content: [{ type: 'text', text: '普通问题' }],
    } as AgentMessage, sessionKey, 'previous-turn');
    await coordinator.prepare({
      role: 'user',
      content: [{ type: 'text', text: '你记错了我的偏好，我需要详细回答。' }],
    } as AgentMessage, sessionKey, 'correction-turn');

    const feedback = getSqliteDatabase().prepare(
      'SELECT rating, reason FROM context_feedback WHERE turn_id = ?',
    ).get('previous-turn') as { rating: string; reason: string } | undefined;
    expect(feedback).toEqual({ rating: 'wrong', reason: 'detected_explicit_user_correction' });
    expect(getUnderstanding(previous.id)?.status).toBe('needs_review');

    await coordinator.afterTurn(sessionKey, '你记错了我的偏好，我需要详细回答。');
    expect(captureTurnUnderstanding).toHaveBeenCalledWith(
      '你记错了我的偏好，我需要详细回答。',
      '',
      {
        agentId: 'main',
        sessionId: sessionKey,
        turnId: 'correction-turn',
        workspaceId: '/workspace/project',
        projectId: 'project-1',
        correctionTargetRecordIds: [previous.id],
      },
    );
  });

  it('does not expose or learn owner context in group sessions', async () => {
    const captureTurnUnderstanding = vi.fn();
    const syncProvidersForTurn = vi.fn().mockResolvedValue(undefined);
    const memoryManager = {
      captureTurnUnderstanding,
      syncProvidersForTurn,
      queuePrefetchAll: vi.fn(),
    } as unknown as MemoryManager;
    const coordinator = new UserContextCoordinator({
      getConfig: () => undefined,
      isEnabledForSession: () => true,
      getAgentIdForSession: () => 'main',
      getWorkspaceIdForSession: () => '/workspace/project',
      getMemoryManagerForSession: () => memoryManager,
      getLastAssistantContent: () => 'assistant reply',
    });
    const sessionKey = 'agent:main:telegram:group:-100123456';
    const userMessage = { role: 'user', content: [{ type: 'text', text: '以后都叫我老板' }] } as AgentMessage;

    const plan = await coordinator.prepare(userMessage, sessionKey, 'group-turn');
    expect(plan.modelMessage).toBe(userMessage);
    expect(plan.items).toEqual([]);
    await coordinator.afterTurn(sessionKey, '以后都叫我老板');

    expect(captureTurnUnderstanding).not.toHaveBeenCalled();
    expect(syncProvidersForTurn).not.toHaveBeenCalled();
  });
});
