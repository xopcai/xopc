import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendMemoryTraceEvent,
  closeXopcDatabase,
  getMemoryRecord,
  listMemoryTraceEvents,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertMemoryRecord,
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
    upsertMemoryRecord({
      id: 'preference-1',
      providerId: 'local',
      kind: 'preference',
      agentId: 'main',
      content: 'Prefer concise answers.',
      tags: ['user-understanding'],
      status: 'active',
      confidence: 0.9,
    });
    const previousTraceId = appendMemoryTraceEvent({
      phase: 'inject',
      providerId: 'user-understanding',
      sessionKey,
      selectedRecordIds: ['preference-1'],
    });
    const captureTurnUnderstanding = vi.fn().mockResolvedValue(undefined);
    const memoryManager = {
      search: async () => [],
      captureTurnUnderstanding,
      syncProvidersForTurn: vi.fn().mockResolvedValue(undefined),
      queuePrefetchAll: vi.fn(),
    } as unknown as MemoryManager;
    const coordinator = new UserContextCoordinator({
      getConfig: () => undefined,
      isEnabledForSession: () => true,
      getAgentIdForSession: () => 'main',
      getMemoryManagerForSession: () => memoryManager,
      getLastAssistantContent: () => null,
    });

    await coordinator.prepare({
      role: 'user',
      content: [{ type: 'text', text: '你记错了我的偏好，我需要详细回答。' }],
    } as AgentMessage, sessionKey);

    const previous = listMemoryTraceEvents({ sessionKey, limit: 10 })
      .find((trace) => trace.traceId === previousTraceId);
    expect(previous?.feedback).toMatchObject({
      outcome: 'not_helpful',
      source: 'system',
      reason: 'detected_explicit_user_correction',
    });
    expect(getMemoryRecord('preference-1')).toMatchObject({
      status: 'needs_review',
      confidence: 0.7,
    });

    await coordinator.afterTurn(sessionKey, '你记错了我的偏好，我需要详细回答。');
    expect(captureTurnUnderstanding).toHaveBeenCalledWith(
      '你记错了我的偏好，我需要详细回答。',
      '',
      { agentId: 'main', sessionId: sessionKey, correctionTargetRecordIds: ['preference-1'] },
    );
  });
});
